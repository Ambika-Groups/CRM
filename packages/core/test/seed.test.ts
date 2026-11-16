// The spec §17 test data, and consistency of everything the posting engine derived from it.
// IDs S-xxx are referenced from docs/prd-traceability.md.
import { beforeAll, describe, expect, it } from "vitest";
import {
  fyOf, isValidGstSerial, navFor, seedDemo, sumCost, sumFinance, type AccountTxn, type Attendance, type Expense, type Invoice,
  type MemoryStore, type Project, type WorkerPayment,
} from "../src";

const ANCHOR = "2026-10-25";
let store: MemoryStore;
let summary: Awaited<ReturnType<typeof seedDemo>>["summary"];

beforeAll(async () => {
  ({ store, summary } = await seedDemo(ANCHOR));
});

describe("spec §17 test data", () => {
  it("S-001 has 3 projects (2 residential, 1 government), 50 workers, 30 days of attendance, 200 expenses, 10 invoices", () => {
    const projects = store.list<Project>("projects");
    expect(projects).toHaveLength(3);
    expect(projects.filter((p) => p.type === "residential")).toHaveLength(2);
    expect(projects.filter((p) => p.type === "government")).toHaveLength(1);
    expect(store.list("workers")).toHaveLength(50);
    expect(new Set(store.list<Attendance>("attendance").map((a) => a.date)).size).toBe(30);
    expect(store.list<Expense>("expenses", (e) => e.source === "manual" && /^exp\d{4}$/.test(e.id))).toHaveLength(200);
    expect(store.list("invoices")).toHaveLength(10);
    expect(summary).toMatchObject({ projects: 3, workers: 50, attendanceDays: 30, expensesManual: 200, invoices: 10 });
  });

  it("S-002 is deterministic for the same anchor", async () => {
    const again = await seedDemo(ANCHOR);
    expect(JSON.stringify(again.store.snapshot().rollups)).toBe(JSON.stringify(store.snapshot().rollups));
  });

  it("S-003 one attendance doc per worker per project per day, with the deterministic ID (D-13)", () => {
    for (const a of store.list<Attendance>("attendance")) expect(a.id).toBe(`${a.projectId}_${a.workerId}_${a.date}`);
  });

  it("S-004 issued invoice numbers are gapless, in date order, and valid GST serials (D-12)", () => {
    const issued = store.list<Invoice>("invoices", (i) => i.number !== null).sort((a, b) => a.number!.localeCompare(b.number!));
    issued.forEach((inv, i) => {
      expect(inv.number).toBe(`AG/${fyOf(inv.date)}/${String(i + 1).padStart(4, "0")}`);
      expect(isValidGstSerial(inv.number!)).toBe(true);
      if (i) expect(inv.date >= issued[i - 1]!.date).toBe(true);
    });
    expect(store.list<Invoice>("invoices", (i) => i.status === "draft").every((i) => i.number === null)).toBe(true);
  });
});

describe("posted figures agree with the raw records (§7.4, §11A.7 groundwork)", () => {
  it("S-010 company expense total = sum of approved, non-deleted expenses, to the paisa", () => {
    const raw = store.list<Expense>("expenses", (e) => e.approvalStatus === "approved" && !e.isDeleted).reduce((s, e) => s + e.amountPaise, 0);
    const rolled = sumCost(store.list("rollups", (d) => (d as { id: string }).id.startsWith("co_")) as never).expenseTotalPaise;
    expect(rolled).toBe(raw);
  });

  it("S-011 per-project lifetime rollup = sum of that project's monthly rollups", () => {
    for (const p of store.list<Project>("projects")) {
      const all = sumCost([store.get("rollups", `p_${p.id}_all`) as never]);
      const months = sumCost(store.list("rollups", (d) => /^p_.+_\d{4}-\d{2}$/.test((d as { id: string }).id) && (d as { id: string }).id.startsWith(`p_${p.id}_`)) as never);
      expect(all.expenseTotalPaise).toBe(months.expenseTotalPaise);
      expect(all.wagesEarnedPaise).toBe(months.wagesEarnedPaise);
    }
  });

  it("S-012 each account balance = opening + its account rows; every money movement has exactly one row", () => {
    const txns = store.list<AccountTxn>("account_transactions");
    for (const a of store.list<{ id: string; openingBalancePaise: number; balancePaise: number }>("accounts")) {
      const net = txns.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.directionSign * t.amountPaise, 0);
      expect(a.balancePaise).toBe(a.openingBalancePaise + net);
    }
    const ids = txns.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Generated (wage) expenses own no account row; the payments do.
    expect(txns.some((t) => t.linkedEntity === "expenses" && t.linkedId.startsWith("wage_"))).toBe(false);
  });

  it("S-013 wages expensed = gross of approved wage-type payments; wages due is positive (last week unpaid)", () => {
    const gross = store.list<WorkerPayment>("worker_payments", (p) => p.approvalStatus === "approved" && ["wage", "bonus", "thekedar_bill"].includes(p.type))
      .reduce((s, p) => s + p.grossPaise, 0);
    const c = sumCost(store.list("rollups", (d) => (d as { id: string }).id.startsWith("co_")) as never);
    expect(c.wagesExpensedPaise).toBe(gross);
    expect(c.wagesEarnedPaise - c.wagesExpensedPaise).toBeGreaterThan(0);
    const generated = store.list<Expense>("expenses", (e) => e.source === "wage").reduce((s, e) => s + e.amountPaise, 0);
    expect(generated).toBe(gross);
  });

  it("S-014 billed excludes drafts; received matches receipts (D-20)", () => {
    const f = sumFinance(store.list("finance_rollups", (d) => (d as { id: string }).id.startsWith("co_")) as never);
    const billed = store.list<Invoice>("invoices", (i) => i.status !== "draft" && i.status !== "cancelled").reduce((s, i) => s + i.totals!.totalPaise, 0);
    expect(f.billedPaise).toBe(billed);
    const received = store.list<{ amountPaise: number; isAdvance?: boolean }>("payments_received").reduce((s, r) => s + r.amountPaise, 0);
    expect(f.receivedPaise).toBe(received);
  });

  it("S-015 cash in hand never goes negative in the demo", () => {
    expect(store.get<{ balancePaise: number }>("accounts", "accCash")!.balancePaise).toBeGreaterThanOrEqual(0);
  });
});

describe("roles and navigation (§2, §4A.5)", () => {
  it("S-020 all 14 items for the owner; supervisors never see billing or accounts", () => {
    expect(navFor("owner")).toHaveLength(14);
    const sup = navFor("supervisor").map((n) => n.key);
    expect(sup).not.toContain("billing");
    expect(sup).not.toContain("accounts");
    expect(sup).toContain("labour");
    expect(navFor("ca").map((n) => n.key)).not.toContain("labour");
  });
});
