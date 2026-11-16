// Short voucher numbers (D-54, PRD 11A.2 "Voucher No (auto)"). IDs VN-xx are cited in docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { MemoryStore, nextVoucherNo, runCommand, seedDemo, type CommandCtx, type Doc } from "../src";

const NOW = "2026-11-16T09:00:00.000Z";
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW, superUser: true };

describe("voucher numbers", () => {
  it("VN-01 numbers are short, in order, one series per financial year, and follow the format in Settings", () => {
    const s = new MemoryStore();
    expect(nextVoucherNo(s, "2026-11-16")).toBe("V/2026-27/00001");
    expect(nextVoucherNo(s, "2026-11-17")).toBe("V/2026-27/00002");
    expect(nextVoucherNo(s, "2026-03-31")).toBe("V/2025-26/00001");
    expect(nextVoucherNo(s, "2026-12-01")).toBe("V/2026-27/00003");
    s.set("settings", { id: "numbering", formats: { voucher: "VCH/{fy}/{seq4}" } } as Doc);
    expect(nextVoucherNo(s, "2026-12-02")).toBe("VCH/2026-27/0004");
  });

  it("VN-02 a new expense, a transfer and another money entry each get the next number; a refused save takes none", async () => {
    const { store } = await seedDemo("2026-11-16");
    const before = store.get<{ next?: number }>("counters", "voucher_2026-27")?.next ?? 1;
    const exp = await runCommand(store, "createExpense", { projectId: "projShivNagar", date: "2026-11-16", categoryId: "cat_materials_cement", description: "Cement, OPC 53", amountPaise: 100_000, mode: "cash", accountId: "accCash" } as never, owner);
    const expId = (exp.result as { id: string }).id;
    const e = store.get<{ voucherNo?: string }>("expenses", expId)!;
    expect(e.voucherNo).toMatch(/^V\/2026-27\/\d{5}$/);
    await runCommand(store, "createTransfer", { fromAccountId: "accSbi", toAccountId: "accCash", amountPaise: 100_000, date: "2026-11-16" } as never, owner);
    const transfers = store.list<{ voucherNo?: string; createdAt: string }>("account_transfers", (t) => t.createdAt === NOW);
    expect(transfers.at(-1)!.voucherNo).toMatch(/^V\/2026-27\/\d{5}$/);
    expect(transfers.at(-1)!.voucherNo).not.toBe(e.voucherNo);
    const after = store.get<{ next?: number }>("counters", "voucher_2026-27")!.next!;
    expect(after).toBe(before + 2);
    await expect(runCommand(store, "createTransfer", { fromAccountId: "accSbi", toAccountId: "accSbi", amountPaise: 100_000, date: "2026-11-16" } as never, owner)).rejects.toThrow();
    expect(store.get<{ next?: number }>("counters", "voucher_2026-27")!.next).toBe(after);
  });
});
