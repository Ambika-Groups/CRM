// Delta-posting engine tests (decisions D-07, D-08, D-13, D-16, D-20). IDs P-xxx are referenced from
// docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { approveWorkerPayment, CategoryTree, MemoryStore, seedCategories, sumCost, sumFinance, type Expense, type WorkerPayment } from "../src";

const NOW = "2026-10-25T09:00:00.000Z";

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "e1", projectId: "pA", date: "2026-10-20", monthKey: "2026-10", fy: "2026-27", categoryId: "cat_materials_cement",
    amountPaise: 1_180_000, cgstPaise: 90_000, sgstPaise: 90_000, igstPaise: 0, mode: "cash", accountId: "cash",
    approvalStatus: "approved", source: "manual", enteredBy: "u1", ...over,
  };
}

function setup() {
  const s = new MemoryStore();
  s.set("accounts", { id: "cash", balancePaise: 0 });
  s.set("accounts", { id: "bank", balancePaise: 0 });
  return s;
}

const roll = (s: MemoryStore, id: string) => s.get<Record<string, unknown>>("rollups", id) as never;

describe("delta posting (D-08)", () => {
  it("P-001 posts an approved expense to every target in one go", async () => {
    const s = setup();
    s.set("expenses", expense() as never);
    const r = await s.post("expenses", "e1", NOW);
    expect(r.changed).toBe(true);
    for (const id of ["co_2026-10", "p_pA_2026-10", "p_pA_all"]) {
      expect(sumCost([roll(s, id)]).expense.approvedPaise.cat_materials_cement).toBe(1_180_000);
    }
    expect(s.get<{ balancePaise: number }>("accounts", "cash")!.balancePaise).toBe(-1_180_000);
    expect(s.get("account_transactions", "expenses_e1")).toMatchObject({ amountPaise: 1_180_000, directionSign: -1 });
    expect(s.get<{ gstInputPaise: number }>("finance_rollups", "co_2026-10")!.gstInputPaise).toBe(180_000);
    expect(s.get<{ scope: string; projectId: string }>("rollups", "p_pA_2026-10")).toMatchObject({ scope: "project", projectId: "pA" });
  });

  it("P-002 a replay writes nothing (idempotent)", async () => {
    const s = setup();
    s.set("expenses", expense() as never);
    await s.post("expenses", "e1", NOW);
    const before = JSON.stringify(s.snapshot());
    const r = await s.post("expenses", "e1", NOW);
    expect(r.changed).toBe(false);
    expect(JSON.stringify(s.snapshot())).toBe(before);
  });

  it("P-003 moving project, month, category and account moves the amount, not nets it", async () => {
    const s = setup();
    s.set("expenses", expense() as never);
    await s.post("expenses", "e1", NOW);
    s.set("expenses", expense({ projectId: "pB", date: "2026-09-30", monthKey: "2026-09", categoryId: "cat_materials_steel", accountId: "bank" }) as never);
    await s.post("expenses", "e1", NOW);
    expect(sumCost([roll(s, "p_pA_2026-10")]).expenseTotalPaise).toBe(0);
    expect(sumCost([roll(s, "p_pB_2026-09")]).expense.approvedPaise.cat_materials_steel).toBe(1_180_000);
    expect(sumCost([roll(s, "co_2026-10"), roll(s, "co_2026-09")]).expenseTotalPaise).toBe(1_180_000);
    expect(s.get<{ balancePaise: number }>("accounts", "cash")!.balancePaise).toBe(0);
    expect(s.get<{ balancePaise: number }>("accounts", "bank")!.balancePaise).toBe(-1_180_000);
    expect(s.list("account_transactions")).toHaveLength(1);
  });

  it("P-004 events in any order converge on the current state (re-read)", async () => {
    const a = setup();
    const b = setup();
    // a: create, edit, edit — posting after each step
    for (const amt of [100_000, 250_000, 175_000]) {
      a.set("expenses", expense({ amountPaise: amt, cgstPaise: 0, sgstPaise: 0 }) as never);
      await a.post("expenses", "e1", NOW);
    }
    // b: three edits, then the events arrive late and repeated
    for (const amt of [100_000, 250_000, 175_000]) b.set("expenses", expense({ amountPaise: amt, cgstPaise: 0, sgstPaise: 0 }) as never);
    for (let i = 0; i < 3; i++) await b.post("expenses", "e1", NOW);
    expect(sumCost([roll(b, "co_2026-10")]).expenseTotalPaise).toBe(175_000);
    expect(JSON.stringify(a.snapshot().rollups)).toBe(JSON.stringify(b.snapshot().rollups));
  });

  it("P-005 pending, rejected and soft-deleted expenses don't count (D-20)", async () => {
    const s = setup();
    s.set("expenses", expense({ approvalStatus: "pending" }) as never);
    await s.post("expenses", "e1", NOW);
    expect(s.get("rollups", "co_2026-10")).toBeNull();
    s.set("expenses", expense() as never);
    await s.post("expenses", "e1", NOW);
    s.set("expenses", expense({ isDeleted: true, deleteReason: "duplicate" }) as never);
    await s.post("expenses", "e1", NOW);
    expect(sumCost([roll(s, "co_2026-10")]).expenseTotalPaise).toBe(0);
    expect(s.get("account_transactions", "expenses_e1")).toBeNull();
    expect(s.get<{ balancePaise: number }>("accounts", "cash")!.balancePaise).toBe(0);
  });

  it("P-006 a locked month refuses posting and records why (D-13)", async () => {
    const s = setup();
    s.set("period_locks", { id: "2026-10" });
    s.set("expenses", expense() as never);
    const r = await s.post("expenses", "e1", NOW);
    expect(r.error).toMatch(/2026-10 is closed/);
    expect(s.get<Expense>("expenses", "e1")!.postingError).toMatch(/closed/);
    expect(s.get("rollups", "co_2026-10")).toBeNull();
  });

  it("P-007 a path-only change writes nothing (category moves, D-10a)", async () => {
    const s = setup();
    s.set("expenses", expense() as never);
    await s.post("expenses", "e1", NOW);
    s.set("period_locks", { id: "2026-10" }); // allowed even in a locked month
    s.set("expenses", { ...expense(), categoryPath: ["cat_x", "cat_materials_cement"] } as never);
    const r = await s.post("expenses", "e1", NOW);
    expect(r).toEqual({ changed: false });
  });

  it("P-008 credit purchases go to the vendor payable, not an account", async () => {
    const s = setup();
    s.set("expenses", expense({ mode: "credit", accountId: null, payeeType: "vendor", payeeId: "v1" }) as never);
    await s.post("expenses", "e1", NOW);
    expect(s.get<{ payablePaise: number }>("vendor_balances", "v1")!.payablePaise).toBe(1_180_000);
    expect(s.list("account_transactions")).toHaveLength(0);
    expect(sumCost([roll(s, "co_2026-10")]).expensePaidPaise).toBe(0);
  });
});

describe("wages and generated expenses (D-16)", () => {
  const pay = (over: Partial<WorkerPayment>): WorkerPayment => ({
    id: "wp1", workerId: "w1", workerName: "Suresh Pal", projectId: "pA", date: "2026-10-24", monthKey: "2026-10", fy: "2026-27",
    type: "wage", grossPaise: 300_000, advanceRecoveredPaise: 50_000, tdsPaise: 0, netPaidPaise: 250_000, mode: "cash", accountId: "cash",
    approvalStatus: "pending", ...over,
  });

  it("P-010 a wage expenses the GROSS; cash moves the NET; the advance falls by the amount recovered", async () => {
    const s = setup();
    s.set("workers", { id: "w1", name: "Suresh Pal", role: "mistri", isThekedar: false, active: true });
    s.set("worker_payments", pay({ type: "advance", id: "wp0", grossPaise: 200_000, advanceRecoveredPaise: 0, netPaidPaise: 200_000 }) as never);
    await approveWorkerPayment(s, "wp0", { uid: "owner", nowIso: NOW });
    s.set("worker_payments", pay({}) as never);
    await approveWorkerPayment(s, "wp1", { uid: "owner", nowIso: NOW });
    const exp = s.get<Expense>("expenses", "wage_wp1")!;
    expect(exp).toMatchObject({ amountPaise: 300_000, categoryId: "cat_labour_mistri", accountId: null, source: "wage" });
    expect(s.get("expenses", "wage_wp0")).toBeNull(); // advances are not expense
    expect(sumCost([roll(s, "co_2026-10")]).expenseTotalPaise).toBe(300_000);
    expect(s.get<{ balancePaise: number }>("accounts", "cash")!.balancePaise).toBe(-450_000); // 2,000 advance + 2,500 net
    expect(s.list("account_transactions")).toHaveLength(2); // the generated expense owns none
    expect(s.get("worker_balances", "w1_pA")).toMatchObject({ paidPaise: 300_000, advanceGivenPaise: 200_000, advanceRecoveredPaise: 50_000 });
  });

  it("P-011 a thekedar bill posts TDS deducted (194C) and books Thekedar payments", async () => {
    const s = setup();
    s.set("workers", { id: "t1", name: "Mohan Lal", role: "thekedar", isThekedar: true, active: true });
    s.set("worker_payments", pay({ id: "wp2", workerId: "t1", workerName: "Mohan Lal", type: "thekedar_bill", grossPaise: 1_000_000, advanceRecoveredPaise: 0, tdsPaise: 10_000, netPaidPaise: 990_000, mode: "bank", accountId: "bank" }) as never);
    await approveWorkerPayment(s, "wp2", { uid: "owner", nowIso: NOW });
    expect(s.get<Expense>("expenses", "wage_wp2")!.categoryId).toBe("cat_labour_thekedar");
    expect(sumFinance([s.get("finance_rollups", "co_2026-10") as never]).tdsDeductedPaise).toBe(10_000);
    expect(s.get<{ balancePaise: number }>("accounts", "bank")!.balancePaise).toBe(-990_000);
  });

  it("P-012 approving twice creates one expense (deterministic ID)", async () => {
    const s = setup();
    s.set("workers", { id: "w1", name: "A", role: "labour", isThekedar: false, active: true });
    s.set("worker_payments", pay({ advanceRecoveredPaise: 0, netPaidPaise: 300_000 }) as never);
    await approveWorkerPayment(s, "wp1", { uid: "owner", nowIso: NOW });
    await approveWorkerPayment(s, "wp1", { uid: "owner", nowIso: NOW });
    expect(s.list("expenses")).toHaveLength(1);
    expect(sumCost([roll(s, "co_2026-10")]).expenseTotalPaise).toBe(300_000);
  });
});

describe("category re-parenting (§7.4)", () => {
  it("P-020 moving a category re-rolls totals with nothing lost, and rewrites no stored amount", async () => {
    const s = setup();
    for (const [i, cat] of ["cat_materials_aggregate_gitti", "cat_materials_aggregate_balu", "cat_materials_cement"].entries()) {
      s.set("expenses", expense({ id: `e${i}`, categoryId: cat, amountPaise: (i + 1) * 100_000, cgstPaise: 0, sgstPaise: 0 }) as never);
      await s.post("expenses", `e${i}`, NOW);
    }
    const before = JSON.stringify(s.snapshot().rollups);
    const posted = sumCost([roll(s, "co_2026-10")]).expense.approvedPaise;
    const tree = new CategoryTree(seedCategories());
    const moved = tree.withParent("cat_materials_aggregate", "cat_machinery"); // deliberately odd move
    expect(tree.total("cat_materials", posted)).toBe(600_000);
    expect(moved.total("cat_materials", posted)).toBe(300_000);
    expect(moved.total("cat_machinery", posted)).toBe(300_000);
    // Nothing lost: the grand total across roots is unchanged.
    const grand = (t: CategoryTree) => t.roots().reduce((x, r) => x + t.total(r.id, posted), 0);
    expect(grand(moved)).toBe(grand(tree));
    expect(JSON.stringify(s.snapshot().rollups)).toBe(before);
  });
});
