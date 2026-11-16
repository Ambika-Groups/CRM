// Total Spendings and the expense-head editor (spec §7.1, §7.3, §7.4; decisions D-09, D-10, D-20). IDs SP-xx (the
// screen's figures) and CT-xx (the head commands) are cited in docs/prd-traceability.md. Money is checked to the paisa.
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CategoryTree, CommandError, monthsBetween, parseCsv, periodRange, rollupMeta, seedDemo, sumCost, totalExpense,
  type Category, type CommandCtx, type CostRollup, type Expense, type MemoryStore,
} from "../src";
import {
  addCategory, archiveCategory, CATEGORY_COMMANDS, continueCategoryMove, moveCategory, renameCategory,
} from "../src/commands/categories";
import {
  buildSpendings, CATEGORY_REFUSALS, categoryRefusalKey, drillLevel, findNode, formatPermille, headNodes, monthSeries, pathTo, selectionAmount,
  shareOut, spendingsCsv, spendingsCsvRows, spendingsRollupIds, WHOLE, type CategoryMove, type SpendNode, type Spendings,
} from "../src/spendings";

const TODAY = "2026-10-25";
const NOW = "2026-10-25T09:00:00.000Z";
const G = "projShivNagar";
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const others: CommandCtx[] = [
  { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW },
  { uid: "uPm", role: "pm", projectIds: [G], nowIso: NOW },
  { uid: "uSupShivNagar", role: "supervisor", projectIds: [G], nowIso: NOW },
  { uid: "uViewer", role: "viewer", projectIds: [], nowIso: NOW },
  { uid: "uCa", role: "ca", projectIds: [], nowIso: NOW },
];

let store: MemoryStore;
const tree = () => new CategoryTree(store.list<Category>("expense_categories"));
const rollups = () => store.list<CostRollup>("rollups");
const companyDocs = () => rollups().filter((d) => d.id.startsWith("co_"));
const companyMonths = () => companyDocs().map((d) => rollupMeta(d.id).period).sort();
const docsFor = (ids: string[]) => ids.map((id) => store.get<CostRollup>("rollups", id));
/** Approved, not deleted entries (D-20), straight from the records: the cross-check for the rollup figures. */
const counted = (f: (e: Expense) => boolean = () => true) => store.list<Expense>("expenses", (e) => !e.isDeleted && e.approvalStatus === "approved" && f(e));
const sum = (list: { amountPaise: number }[]) => list.reduce((s, x) => s + x.amountPaise, 0);
const whole = (): Spendings => buildSpendings(tree(), companyDocs());
const each = (nodes: SpendNode[], fn: (n: SpendNode) => void) => nodes.forEach((n) => { fn(n); each(n.children, fn); });
const refusal = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (e) { if (e instanceof CommandError) return e.message; throw e; }
};
/** Runs `fn` and returns the collections it wrote to. */
function written(fn: () => unknown): string[] {
  store.beginJournal();
  fn();
  return [...new Set(store.endJournal().map((c) => c.collection))].sort();
}

describe("Total Spendings from rollups (§7.3, §7.4)", () => {
  beforeAll(async () => { ({ store } = await seedDemo(TODAY)); });

  it("SP-01 the whole demo: the total and every level equal the rollups and the approved entries, to the paisa", () => {
    const s = whole();
    const cost = sumCost(companyDocs());
    expect(s.totalPaise).toBeGreaterThan(0);
    expect(s.totalPaise).toBe(totalExpense(cost));
    expect(s.totalPaise).toBe(sum(counted()));
    expect(s.balanced).toBe(true);
    expect(sum(s.nodes)).toBe(s.totalPaise);
    expect(s.gstPaise).toBe(cost.expenseGstPaise);
    expect(s.count).toBe(counted().length);
    // Every head: its amount is exactly the entries posted on it and on everything under it.
    const t = tree();
    each(s.nodes, (n) => {
      if (n.kind === "category") expect(n.amountPaise, n.id).toBe(sum(counted((e) => t.descendantsAndSelf(n.id).includes(e.categoryId))));
      if (n.kind === "own") expect(n.amountPaise, n.id).toBe(sum(counted((e) => e.categoryId === n.categoryId)));
      if (n.children.length) expect(sum(n.children), n.id).toBe(n.amountPaise);
    });
  });

  it("SP-02 one project: its monthly documents, its lifetime document and its entries agree", () => {
    const months = companyMonths();
    const monthly = buildSpendings(tree(), docsFor(spendingsRollupIds([G], months)));
    const lifetime = buildSpendings(tree(), docsFor([`p_${G}_all`]));
    expect(monthly.totalPaise).toBeGreaterThan(0);
    expect(monthly.totalPaise).toBe(sum(counted((e) => e.projectId === G)));
    expect(lifetime.totalPaise).toBe(monthly.totalPaise);
    expect(lifetime.nodes.map((n) => [n.id, n.amountPaise])).toEqual(monthly.nodes.map((n) => [n.id, n.amountPaise]));
    expect(monthly.totalPaise).toBeLessThan(whole().totalPaise);
  });

  it("SP-03 one month, and several projects together, equal their rollups", () => {
    const month = "2026-10";
    const s = buildSpendings(tree(), docsFor(spendingsRollupIds(null, [month])));
    expect(s.totalPaise).toBe(store.get<CostRollup>("rollups", `co_${month}`)!.expenseTotalPaise);
    expect(s.totalPaise).toBe(sum(counted((e) => e.date.startsWith(month))));
    expect(s.balanced).toBe(true);
    const projects = [...new Set(counted((e) => !!e.projectId).map((e) => e.projectId!))];
    const all = buildSpendings(tree(), docsFor(spendingsRollupIds(projects, companyMonths())));
    expect(all.totalPaise).toBe(sum(counted((e) => !!e.projectId)));
    expect(spendingsRollupIds(null, ["2026-04"])).toEqual(["co_2026-04"]);
    expect(spendingsRollupIds(["a", "b"], ["2026-04", "2026-05"])).toEqual(["p_a_2026-04", "p_a_2026-05", "p_b_2026-04", "p_b_2026-05"]);
  });

  it("SP-04 percentages add up to exactly 100 at the top, and to the parent at every level", () => {
    const s = whole();
    expect(s.nodes.reduce((p, n) => p + n.permille, 0)).toBe(WHOLE);
    each(s.nodes, (n) => { if (n.children.length) expect(n.children.reduce((p, k) => p + k.permille, 0), n.id).toBe(n.permille); });
    expect(s.heads.reduce((p, h) => p + h.permille, 0)).toBe(WHOLE);
    expect(shareOut([1, 1, 1], 1000)).toEqual([334, 333, 333]);
    expect(shareOut([0, 0], 1000)).toEqual([0, 0]);
    expect(shareOut([5], 1000)).toEqual([1000]);
    expect(formatPermille(1000)).toBe("100.0%");
    expect(formatPermille(123)).toBe("12.3%");
    expect(formatPermille(4)).toBe("0.4%");
  });

  it("SP-05 the five summary heads add up to the total; Other is everything outside the four named heads", () => {
    const s = whole();
    expect(s.heads.map((h) => h.head)).toEqual(["cat_labour", "cat_materials", "cat_commission", "cat_machinery", "other"]);
    expect(sum(s.heads)).toBe(s.totalPaise);
    const t = tree();
    for (const h of s.heads.filter((x) => x.head !== "other")) expect(h.amountPaise, h.head).toBe(sum(counted((e) => t.summaryHead(e.categoryId) === h.head)));
    expect(s.heads[4]!.amountPaise).toBe(sum(counted((e) => t.summaryHead(e.categoryId) === "other")));
    expect(sum(headNodes(s, "other"))).toBe(s.heads[4]!.amountPaise);
    expect(headNodes(s, "all")).toBe(s.nodes);
    expect(selectionAmount(s, "cat_materials")).toBe(s.heads[1]!.amountPaise);
    expect(selectionAmount(s)).toBe(s.totalPaise);
  });

  it("SP-06 drill-down: a level adds up to its parent, shares add to 100, and the breadcrumb leads back", () => {
    const s = whole();
    const top = drillLevel(s, null);
    expect(top.parent).toBeNull();
    expect(top.totalPaise).toBe(s.totalPaise);
    expect(sum(top.items)).toBe(s.totalPaise);
    expect(top.items.reduce((p, i) => p + i.sharePermille, 0)).toBe(WHOLE);
    expect(Math.max(...top.items.map((i) => i.barPct))).toBe(100);
    const mat = drillLevel(s, "cat_materials");
    expect(mat.parent!.id).toBe("cat_materials");
    expect(sum(mat.items)).toBe(findNode(s, "cat_materials")!.amountPaise);
    expect(mat.totalPaise).toBe(findNode(s, "cat_materials")!.amountPaise);
    expect(mat.items.reduce((p, i) => p + i.sharePermille, 0)).toBe(WHOLE);
    const agg = mat.items.find((i) => i.id === "cat_materials_aggregate")!;
    expect(agg.drillable).toBe(true);
    const deep = drillLevel(s, "cat_materials_aggregate");
    expect(deep.path.map((n) => n.id)).toEqual(["cat_materials", "cat_materials_aggregate"]);
    expect(sum(deep.items)).toBe(agg.amountPaise);
    expect(deep.items.every((i) => !i.drillable)).toBe(true);
    expect(sum(drillLevel(s, null, "cat_labour").items)).toBe(s.heads[0]!.amountPaise);
    expect(pathTo(s, "no_such_head")).toEqual([]);
  });

  it("SP-07 month by month: the months add up to the period, for everything and for one head", () => {
    const months = periodRange("fy", TODAY).months;
    const docs = docsFor(spendingsRollupIds(null, months));
    const s = buildSpendings(tree(), docs);
    const series = monthSeries(tree(), docs, months);
    expect(series.map((p) => p.month)).toEqual(monthsBetween("2026-04-01", TODAY));
    expect(sum(series)).toBe(s.totalPaise);
    for (const p of series) expect(p.amountPaise, p.month).toBe(store.get<CostRollup>("rollups", `co_${p.month}`)?.expenseTotalPaise ?? 0);
    expect(sum(monthSeries(tree(), docs, months, { nodeId: "cat_materials_aggregate" }))).toBe(findNode(s, "cat_materials_aggregate")!.amountPaise);
    expect(sum(monthSeries(tree(), docs, months, { head: "cat_labour" }))).toBe(s.heads[0]!.amountPaise);
    // A lifetime document mixed in is not a month and is left out.
    expect(sum(monthSeries(tree(), [...docs, store.get<CostRollup>("rollups", `p_${G}_all`)], months))).toBe(s.totalPaise);
  });

  it("SP-08 paid and still to pay: the two views add up to all approved spending, head by head (D-20)", () => {
    const docs = companyDocs();
    const all = buildSpendings(tree(), docs), paid = buildSpendings(tree(), docs, { view: "paid" }), unpaid = buildSpendings(tree(), docs, { view: "unpaid" });
    expect(paid.totalPaise).toBe(sumCost(docs).expensePaidPaise);
    expect(paid.totalPaise).toBe(sum(counted((e) => e.mode !== "credit")));
    expect(unpaid.totalPaise).toBeGreaterThan(0);
    expect(paid.totalPaise + unpaid.totalPaise).toBe(all.totalPaise);
    expect(paid.balanced && unpaid.balanced).toBe(true);
    each(all.nodes, (n) => expect((findNode(paid, n.id)?.amountPaise ?? 0) + (findNode(unpaid, n.id)?.amountPaise ?? 0), n.id).toBe(n.amountPaise));
    expect(unpaid.nodes.reduce((p, n) => p + n.permille, 0)).toBe(WHOLE);
  });

  it("SP-09 CSV rows: one row per head that holds entries, adding up to the level on screen", () => {
    const s = whole();
    const rows = spendingsCsvRows(s);
    expect(sum(rows)).toBe(s.totalPaise);
    expect(rows.reduce((p, r) => p + r.permille, 0)).toBe(WHOLE);
    expect(rows.reduce((p, r) => p + r.count, 0)).toBe(s.count);
    const gitti = rows.find((r) => r.levels[2] === "Gitti (by size)")!;
    expect(gitti.levels).toEqual(["Materials", "Aggregate", "Gitti (by size)", ""]);
    expect(gitti.amountPaise).toBe(findNode(s, "cat_materials_aggregate_gitti")!.amountPaise);
    const sub = spendingsCsvRows(s, { nodeId: "cat_materials_aggregate" });
    expect(sum(sub)).toBe(findNode(s, "cat_materials_aggregate")!.amountPaise);
    expect(sub.every((r) => r.levels[0] === "Materials" && r.levels[1] === "Aggregate")).toBe(true);
    expect(sum(spendingsCsvRows(s, { head: "cat_machinery" }))).toBe(s.heads[3]!.amountPaise);
    expect(spendingsCsvRows(s, { lang: "hi" }).some((r) => r.levels[0] === "सामान")).toBe(true);
    const parsed = parseCsv(spendingsCsv(rows));
    expect(parsed[0]).toEqual(["Head", "Level 2", "Level 3", "Level 4", "Amount", "GST inside", "Entries", "% of total"]);
    expect(parsed.length).toBe(rows.length + 1);
    expect(parsed.slice(1).every((r) => /^\d+\.\d{2}$/.test(r[4]!))).toBe(true);
    expect(Math.round(parsed.slice(1).reduce((p, r) => p + Number(r[4]) * 100, 0))).toBe(s.totalPaise);
  });

  it("SP-10 an id in the totals that is not in the tree is still counted, under its own line", () => {
    const s = whole();
    const leaf = spendingsCsvRows(s).length ? s.nodes.flatMap((n) => (n.children.length ? n.children : [n])).find((n) => n.kind === "category" && !n.children.length)! : null;
    expect(leaf).toBeTruthy();
    const cut = new CategoryTree(store.list<Category>("expense_categories").filter((c) => c.id !== leaf!.id));
    const t = buildSpendings(cut, companyDocs());
    expect(t.totalPaise).toBe(s.totalPaise);
    expect(t.balanced).toBe(true);
    expect(findNode(t, "__unlisted")!.amountPaise).toBe(leaf!.amountPaise);
    expect(t.nodes.reduce((p, n) => p + n.permille, 0)).toBe(WHOLE);
  });

  it("SP-11 the figures come from rollups only: the module takes no store and names no expense records", () => {
    const src = readFileSync(new URL("../src/spendings.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/MemoryStore|store\.|"expenses"/);
    expect(buildSpendings(tree(), []).totalPaise).toBe(0);
    expect(buildSpendings(tree(), [null, undefined]).nodes).toEqual([]);
  });
});

describe("Expense heads: add, rename, move, archive (§7.1, §7.4, D-10)", () => {
  beforeEach(async () => { ({ store } = await seedDemo(TODAY)); });
  const cat = (id: string) => store.get<Category>("expense_categories", id)!;
  const audits = (id: string, action?: string) => store.list<{ entity: string; entityId: string; action: string }>("audit_log", (a) => a.entity === "expense_categories" && a.entityId === id && (!action || a.action === action));
  /** A head under Materials that holds entries itself and has nothing under it. */
  const usedLeaf = () => findNode(whole(), "cat_materials")!.children.find((k) => k.kind === "category" && !k.children.length)!;

  it("CT-01 add: a new head goes last at its place, with audit stamps; bad names and places are refused in plain words", () => {
    const before = whole().totalPaise;
    const { id } = addCategory(store, { name: "  Shuttering   plates ", nameHi: "शटरिंग प्लेट", parentId: "cat_materials" }, owner);
    const c = cat(id) as Category & { createdBy: string; createdAt: string };
    expect(c).toMatchObject({ name: "Shuttering plates", nameHi: "शटरिंग प्लेट", parentId: "cat_materials", active: true, isSystem: false, createdBy: "uOwner", createdAt: NOW });
    expect(c.sortOrder).toBeGreaterThan(Math.max(...tree().childrenOf("cat_materials").filter((x) => x.id !== id).map((x) => x.sortOrder)));
    expect(tree().pathOf(id)).toEqual(["cat_materials", id]);
    expect(audits(id, "create")).toHaveLength(1);
    expect(whole().totalPaise).toBe(before);
    const top = addCategory(store, { name: "Land and legal", parentId: null }, owner);
    expect(cat(top.id).parentId).toBeNull();
    expect(refusal(() => addCategory(store, { name: "x", parentId: null }, owner))).toBe(CATEGORY_REFUSALS.nameShort);
    expect(refusal(() => addCategory(store, { name: "a".repeat(61), parentId: null }, owner))).toBe(CATEGORY_REFUSALS.nameLong);
    expect(refusal(() => addCategory(store, { name: "shuttering PLATES", parentId: "cat_materials" }, owner))).toBe(CATEGORY_REFUSALS.nameTaken);
    expect(refusal(() => addCategory(store, { name: "Anything", parentId: "cat_nowhere" }, owner))).toBe(CATEGORY_REFUSALS.parentMissing);
    // Six levels at most.
    let parent = id;
    for (let level = 3; level <= 6; level++) parent = addCategory(store, { name: `Level ${level}`, parentId: parent }, owner).id;
    expect(tree().level(parent)).toBe(6);
    expect(refusal(() => addCategory(store, { name: "Level 7", parentId: parent }, owner))).toBe(CATEGORY_REFUSALS.tooDeep);
    expect(categoryRefusalKey(CATEGORY_REFUSALS.tooDeep)).toBe("tooDeep");
    expect(categoryRefusalKey("something else")).toBeNull();
  });

  it("CT-02 a head added under a head that already has entries: those entries stay on it and show as its own line (D-10)", () => {
    const leaf = usedLeaf();
    const before = whole();
    const wrote = written(() => addCategory(store, { name: "Special grade", parentId: leaf.id }, owner));
    expect(wrote).toEqual(["audit_log", "expense_categories"]);
    const after = whole();
    expect(after.totalPaise).toBe(before.totalPaise);
    const node = findNode(after, leaf.id)!;
    expect(node.amountPaise).toBe(leaf.amountPaise);
    // The new head has no spending yet, so the parent still reads as one line; its entries are all its own.
    expect(node.children).toEqual([]);
    const child = tree().childrenOf(leaf.id)[0]!;
    store.increment(`rollups/co_2026-10`, `expense.approvedPaise.${child.id}`, 500);
    store.increment(`rollups/co_2026-10`, "expenseTotalPaise", 500);
    const split = findNode(whole(), leaf.id)!;
    expect(split.children.map((k) => k.kind).sort()).toEqual(["category", "own"]);
    expect(split.children.find((k) => k.kind === "own")!.amountPaise).toBe(leaf.amountPaise);
    expect(split.amountPaise).toBe(leaf.amountPaise + 500);
    expect(whole().balanced).toBe(true);
  });

  it("CT-03 rename keeps every total: only the name changes, nothing is written to a total", () => {
    const before = whole();
    const wrote = written(() => renameCategory(store, { id: "cat_materials_cement", name: "Cement (OPC / PPC)", nameHi: "सीमेंट (ओपीसी)" }, owner));
    expect(wrote).toEqual(["audit_log", "expense_categories"]);
    expect(cat("cat_materials_cement")).toMatchObject({ name: "Cement (OPC / PPC)", nameHi: "सीमेंट (ओपीसी)", parentId: "cat_materials", updatedBy: "uOwner", updatedAt: NOW });
    const after = whole();
    expect(after.totalPaise).toBe(before.totalPaise);
    expect(findNode(after, "cat_materials_cement")!.amountPaise).toBe(findNode(before, "cat_materials_cement")!.amountPaise);
    expect(findNode(after, "cat_materials_cement")!.name).toBe("Cement (OPC / PPC)");
    expect(after.nodes.map((n) => [n.id, n.amountPaise, n.permille])).toEqual(before.nodes.map((n) => [n.id, n.amountPaise, n.permille]));
    expect(spendingsCsvRows(after).some((r) => r.levels[1] === "Cement (OPC / PPC)")).toBe(true);
    expect(audits("cat_materials_cement", "update")).toHaveLength(1);
    // Hindi name kept when not given; same name again writes nothing; a taken name is refused.
    renameCategory(store, { id: "cat_materials_cement", name: "Cement" }, owner);
    expect(cat("cat_materials_cement").nameHi).toBe("सीमेंट (ओपीसी)");
    expect(written(() => renameCategory(store, { id: "cat_materials_cement", name: "Cement" }, owner))).toEqual([]);
    expect(refusal(() => renameCategory(store, { id: "cat_materials_cement", name: "steel (sariya)" }, owner))).toBe(CATEGORY_REFUSALS.nameTaken);
    expect(refusal(() => renameCategory(store, { id: "cat_materials_cement", name: " " }, owner))).toBe(CATEGORY_REFUSALS.nameShort);
    expect(refusal(() => renameCategory(store, { id: "cat_gone", name: "Anything" }, owner))).toBe(CATEGORY_REFUSALS.notFound);
  });

  it("CT-04 move: the grand total stays, both parents change by the head's amount, and no total is rewritten (§7.4)", () => {
    const leaf = usedLeaf();
    const before = whole();
    const amount = leaf.amountPaise;
    expect(amount).toBeGreaterThan(0);
    const entries = store.list<Expense>("expenses", (e) => e.categoryId === leaf.id);
    expect(entries.length).toBeGreaterThan(0);
    let result!: ReturnType<typeof moveCategory>;
    const wrote = written(() => { result = moveCategory(store, { id: leaf.id, parentId: "cat_machinery" }, owner); });
    expect(wrote).toEqual(["audit_log", "category_moves", "expense_categories", "expenses"]);
    expect(result).toMatchObject({ done: true, rewritten: entries.length });
    const after = whole();
    expect(after.totalPaise).toBe(before.totalPaise);
    expect(after.balanced).toBe(true);
    expect(findNode(after, "cat_materials")!.amountPaise).toBe(findNode(before, "cat_materials")!.amountPaise - amount);
    expect(findNode(after, "cat_machinery")!.amountPaise).toBe(findNode(before, "cat_machinery")!.amountPaise + amount);
    expect(findNode(after, leaf.id)!.amountPaise).toBe(amount);
    expect(pathTo(after, leaf.id).map((n) => n.id)).toEqual(["cat_machinery", leaf.id]);
    expect(after.heads[1]!.amountPaise).toBe(before.heads[1]!.amountPaise - amount);
    expect(after.heads[3]!.amountPaise).toBe(before.heads[3]!.amountPaise + amount);
    expect(after.nodes.reduce((p, n) => p + n.permille, 0)).toBe(WHOLE);
    // Only the path changed on the entries; the amounts and the audit stamps are as they were.
    for (const e of entries) {
      const now = store.get<Expense>("expenses", e.id)!;
      expect(now.categoryPath).toEqual(["cat_machinery", leaf.id]);
      expect({ ...now, categoryPath: undefined }).toEqual({ ...e, categoryPath: undefined });
    }
    // One entry in the audit trail when asked for and one when finished, on the head; none per entry.
    expect(audits(leaf.id).map((a) => a.action).sort()).toEqual(["move_finished", "move_requested"]);
    expect(store.list("audit_log", (a: { entity?: string; command?: string }) => a.entity === "expenses" && a.command === "moveCategory")).toEqual([]);
    const move = store.get<CategoryMove>("category_moves", result.moveId)!;
    expect(move).toMatchObject({ status: "done", categoryId: leaf.id, fromParentId: "cat_materials", toParentId: "cat_machinery", rewritten: entries.length, requestedBy: "uOwner", finishedAt: NOW });
    // Back to the top level and back under Materials: the totals return exactly.
    moveCategory(store, { id: leaf.id, parentId: null }, owner);
    expect(whole().totalPaise).toBe(before.totalPaise);
    expect(whole().heads[4]!.amountPaise).toBe(before.heads[4]!.amountPaise + amount);
    moveCategory(store, { id: leaf.id, parentId: "cat_materials" }, owner);
    expect(whole().nodes.map((n) => [n.id, n.amountPaise])).toEqual(before.nodes.map((n) => [n.id, n.amountPaise]));
  });

  it("CT-05 move with everything under it, a page at a time: it can be picked up again, and works in a closed month (D-10 c, d)", () => {
    const before = whole();
    const ids = tree().descendantsAndSelf("cat_materials_aggregate");
    const entries = store.list<Expense>("expenses", (e) => ids.includes(e.categoryId));
    expect(entries.length).toBeGreaterThan(4);
    for (const m of companyMonths()) store.set("period_locks", { id: m, monthKey: m, lockedBy: "uOwner", lockedAt: NOW });
    const first = moveCategory(store, { id: "cat_materials_aggregate", parentId: "cat_transport", pageSize: 2 }, owner);
    expect(first.done).toBe(false);
    expect(first.rewritten).toBe(2);
    expect(store.get<CategoryMove>("category_moves", first.moveId)!.status).toBe("running");
    // The totals are already right: they never depended on the path.
    const mid = whole();
    expect(mid.totalPaise).toBe(before.totalPaise);
    expect(findNode(mid, "cat_transport")!.amountPaise).toBe((findNode(before, "cat_transport")?.amountPaise ?? 0) + findNode(before, "cat_materials_aggregate")!.amountPaise);
    // Another move waits until this one is finished.
    expect(refusal(() => moveCategory(store, { id: "cat_materials_cement", parentId: "cat_misc" }, owner))).toBe(CATEGORY_REFUSALS.moveRunning);
    let last = first, pages = 1;
    while (!last.done) {
      const wrote = written(() => { last = continueCategoryMove(store, { moveId: first.moveId, pageSize: 2 }, owner); });
      expect(wrote.filter((c) => c === "rollups" || c === "finance_rollups" || c === "postings")).toEqual([]);
      pages += 1;
      expect(pages).toBeLessThan(500);
    }
    expect(pages).toBeGreaterThanOrEqual(Math.ceil(entries.length / 2));
    expect(last.rewritten).toBe(entries.length);
    const t = tree();
    for (const e of entries) expect(store.get<Expense>("expenses", e.id)!.categoryPath, e.id).toEqual(t.pathOf(e.categoryId));
    expect(t.pathOf("cat_materials_aggregate_gitti")).toEqual(["cat_transport", "cat_materials_aggregate", "cat_materials_aggregate_gitti"]);
    expect(audits("cat_materials_aggregate").map((a) => a.action).sort()).toEqual(["move_finished", "move_requested"]);
    expect(continueCategoryMove(store, { moveId: first.moveId }, owner)).toEqual({ moveId: first.moveId, done: true, rewritten: entries.length });
    expect(whole().totalPaise).toBe(before.totalPaise);
    expect(refusal(() => continueCategoryMove(store, { moveId: "nope" }, owner))).toBe(CATEGORY_REFUSALS.moveMissing);
  });

  it("CT-06 move refusals: under itself, the same place, a missing or archived place, too deep, a taken name", () => {
    expect(refusal(() => moveCategory(store, { id: "cat_materials", parentId: "cat_materials_aggregate_gitti" }, owner))).toBe(CATEGORY_REFUSALS.underItself);
    expect(refusal(() => moveCategory(store, { id: "cat_materials", parentId: "cat_materials" }, owner))).toBe(CATEGORY_REFUSALS.underItself);
    expect(refusal(() => moveCategory(store, { id: "cat_materials_cement", parentId: "cat_materials" }, owner))).toBe(CATEGORY_REFUSALS.sameParent);
    expect(refusal(() => moveCategory(store, { id: "cat_materials", parentId: null }, owner))).toBe(CATEGORY_REFUSALS.sameParent);
    expect(refusal(() => moveCategory(store, { id: "cat_materials_cement", parentId: "cat_nowhere" }, owner))).toBe(CATEGORY_REFUSALS.parentMissing);
    expect(refusal(() => moveCategory(store, { id: "cat_nowhere", parentId: null }, owner))).toBe(CATEGORY_REFUSALS.notFound);
    archiveCategory(store, { id: "cat_misc", archived: true }, owner);
    expect(refusal(() => moveCategory(store, { id: "cat_materials_cement", parentId: "cat_misc" }, owner))).toBe(CATEGORY_REFUSALS.parentArchived);
    let parent = "cat_commission";
    for (let level = 2; level <= 4; level++) parent = addCategory(store, { name: `Level ${level}`, parentId: parent }, owner).id;
    expect(refusal(() => moveCategory(store, { id: "cat_materials", parentId: parent }, owner))).toBe(CATEGORY_REFUSALS.tooDeep);
    addCategory(store, { name: "Cement", parentId: "cat_machinery" }, owner);
    expect(refusal(() => moveCategory(store, { id: "cat_materials_cement", parentId: "cat_machinery" }, owner))).toBe(CATEGORY_REFUSALS.nameTaken);
    expect(store.list("category_moves")).toEqual([]);
  });

  it("CT-07 archive: the head stays in the totals but is no longer active; restore brings it back; nothing is deleted", () => {
    const before = whole();
    const count = store.list("expense_categories").length;
    expect(archiveCategory(store, { id: "cat_materials_cement", archived: true }, owner)).toEqual({ id: "cat_materials_cement", active: false });
    expect(cat("cat_materials_cement").active).toBe(false);
    const after = whole();
    expect(after.totalPaise).toBe(before.totalPaise);
    expect(findNode(after, "cat_materials_cement")).toMatchObject({ active: false, amountPaise: findNode(before, "cat_materials_cement")!.amountPaise });
    expect(store.list("expense_categories").length).toBe(count);
    expect(audits("cat_materials_cement", "archive")).toHaveLength(1);
    expect(written(() => archiveCategory(store, { id: "cat_materials_cement", archived: true }, owner))).toEqual([]);
    // A head with active heads under it, or one a running recurring expense uses, is not archived.
    expect(refusal(() => archiveCategory(store, { id: "cat_materials", archived: true }, owner))).toBe(CATEGORY_REFUSALS.hasActiveChildren);
    store.set("expense_templates", { id: "tplQa", name: "QA", categoryId: "cat_transport", active: true, isDeleted: false });
    expect(refusal(() => archiveCategory(store, { id: "cat_transport", archived: true }, owner))).toBe(CATEGORY_REFUSALS.usedByRecurring);
    store.merge("expense_templates", "tplQa", { active: false });
    expect(archiveCategory(store, { id: "cat_transport", archived: true }, owner).active).toBe(false);
    // Restore; a head under an archived head waits for its parent.
    for (const k of tree().childrenOf("cat_machinery")) archiveCategory(store, { id: k.id, archived: true }, owner);
    archiveCategory(store, { id: "cat_machinery", archived: true }, owner);
    expect(refusal(() => archiveCategory(store, { id: "cat_machinery_fuel", archived: false }, owner))).toBe(CATEGORY_REFUSALS.parentArchived);
    expect(refusal(() => addCategory(store, { name: "Crane", parentId: "cat_machinery" }, owner))).toBe(CATEGORY_REFUSALS.parentArchived);
    archiveCategory(store, { id: "cat_machinery", archived: false }, owner);
    expect(archiveCategory(store, { id: "cat_machinery_fuel", archived: false }, owner).active).toBe(true);
    expect(audits("cat_machinery", "restore")).toHaveLength(1);
    expect(whole().totalPaise).toBe(before.totalPaise);
  });

  it("CT-08 only the owner changes the heads: every other role is refused in plain words and nothing is written", () => {
    for (const ctx of others) {
      const tries: (() => unknown)[] = [
        () => addCategory(store, { name: "New head", parentId: null }, ctx),
        () => renameCategory(store, { id: "cat_misc", name: "Other things" }, ctx),
        () => moveCategory(store, { id: "cat_materials_cement", parentId: "cat_misc" }, ctx),
        () => continueCategoryMove(store, { moveId: "any" }, ctx),
        () => archiveCategory(store, { id: "cat_misc", archived: true }, ctx),
      ];
      for (const run of tries) {
        let message: string | null = null;
        const wrote = written(() => { message = refusal(run); });
        expect(message, ctx.role).toBe("Only the owner can change the expense heads.");
        expect(wrote, ctx.role).toEqual([]);
      }
    }
    expect(Object.keys(CATEGORY_COMMANDS).sort()).toEqual(["addCategory", "archiveCategory", "continueCategoryMove", "moveCategory", "renameCategory"]);
    expect(store.list("category_moves")).toEqual([]);
  });

  it("CT-09 built-in heads that were never saved are saved with the first change, so the stored tree stays whole", () => {
    for (const c of store.list<Category>("expense_categories")) store.delete("expense_categories", c.id);
    expect(store.list("expense_categories")).toEqual([]);
    const { id } = addCategory(store, { name: "Land and legal", parentId: null }, owner);
    const t = tree();
    expect(t.byId.has("cat_materials_aggregate_gitti")).toBe(true);
    expect(t.byId.has(id)).toBe(true);
    expect(whole().balanced).toBe(true);
  });
});
