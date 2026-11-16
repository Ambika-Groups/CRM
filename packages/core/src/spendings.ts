/**
 * Total Spendings (spec §7.3, §7.4) as pure functions over rollup documents (D-09) and the live category tree (D-10).
 * Nothing here reads the expenses collection: every figure is a sum of what posting.ts wrote into `rollups`, so the
 * screen equals the dashboard and the reports to the paisa. A parent's amount is its own posted amount plus its
 * descendants' (D-10), which is why moving a head needs no rewrite of any total.
 * Also the types and words of the expense-head editor (§7.1); the commands are in commands/categories.ts.
 */
import { SUMMARY_HEADS, type Category, type CategoryTree, type SummaryHead } from "./categories";
import { toCsv } from "./csv";
import { csvAmount } from "./money";
import { rollupMeta, sumCost, type CostRollup } from "./rollups";

/** All approved spending (D-20), only what is already paid, or only what is still to be paid (credit). */
export type SpendView = "all" | "paid" | "unpaid";
export type HeadKey = SummaryHead | "all";

/** Percentages are kept as tenths of a percent, so 1000 is the whole. */
export const WHOLE = 1000;
const UNLISTED = "__unlisted";
const ownId = (categoryId: string) => `${categoryId}__own`;

export interface SpendNode {
  /** The category id; `<id>__own` for what was entered on a parent itself; `__unlisted` for ids not in the tree. */
  id: string;
  categoryId: string | null;
  kind: "category" | "own" | "unlisted";
  name: string;
  nameHi?: string;
  level: number;
  active: boolean;
  /** In the chosen view: own posted amount plus everything under it. */
  amountPaise: number;
  /** GST inside the approved amount (always of all approved entries, whatever the view). */
  gstPaise: number;
  /** Approved entries (always all of them, whatever the view). */
  count: number;
  /** Tenths of a percent of the grand total. Siblings add up exactly to their parent; the top level to 1000. */
  permille: number;
  children: SpendNode[];
}

export interface HeadTotal { head: SummaryHead; amountPaise: number; permille: number; count: number }

export interface Spendings {
  view: SpendView;
  /** The rollup headline figure for the view (the same number the dashboard shows). */
  totalPaise: number;
  gstPaise: number;
  count: number;
  /** Top-level heads, largest first. */
  nodes: SpendNode[];
  /** Labour, Materials, Commission, Machinery, Other (§7.3), in that order. */
  heads: HeadTotal[];
  /** True when the heads add up to the headline figure (always, unless a total was damaged outside the posting engine). */
  balanced: boolean;
}

/** Rollup documents to read: the company months, or each chosen project's months (D-09). */
export function spendingsRollupIds(projectIds: string[] | null, months: string[]): string[] {
  if (!projectIds) return months.map((m) => `co_${m}`);
  return projectIds.flatMap((p) => months.map((m) => `p_${p}_${m}`));
}

/**
 * Share `units` among `amounts` in proportion, as whole numbers that add up to exactly `units` (largest remainder).
 * With a zero total everything gets zero.
 */
export function shareOut(amounts: number[], units: number): number[] {
  const total = amounts.reduce((s, x) => s + x, 0);
  if (total <= 0 || units <= 0) return amounts.map(() => 0);
  const base = amounts.map((a) => Math.floor((a * units) / total));
  let left = units - base.reduce((s, x) => s + x, 0);
  const order = amounts.map((a, i) => ({ i, rem: (a * units) % total })).sort((x, y) => y.rem - x.rem || x.i - y.i);
  for (const o of order) {
    if (left <= 0) break;
    base[o.i]! += 1;
    left -= 1;
  }
  return base;
}

/** The spendings tree with totals and percentages for a set of rollup documents (a period and a scope). */
export function buildSpendings(tree: CategoryTree, docs: (CostRollup | null | undefined)[], opts: { view?: SpendView } = {}): Spendings {
  const view = opts.view ?? "all";
  const cost = sumCost(docs);
  const approved = cost.expense.approvedPaise, paid = cost.expense.paidPaise;
  const posted = (id: string) => (view === "all" ? approved[id] ?? 0 : view === "paid" ? paid[id] ?? 0 : (approved[id] ?? 0) - (paid[id] ?? 0));
  const gst = (id: string) => cost.expense.gstPaise[id] ?? 0;
  const count = (id: string) => cost.expense.count[id] ?? 0;
  const bySize = (a: SpendNode, b: SpendNode) => b.amountPaise - a.amountPaise;

  const build = (c: Category, level: number): SpendNode => {
    const kids = tree.childrenOf(c.id).map((k) => build(k, level + 1)).filter((k) => k.amountPaise !== 0);
    const node: SpendNode = {
      id: c.id, categoryId: c.id, kind: "category", name: c.name, nameHi: c.nameHi, level, active: c.active !== false,
      amountPaise: posted(c.id), gstPaise: gst(c.id), count: count(c.id), permille: 0, children: kids,
    };
    if (kids.length) {
      // Entries made on a head before it had heads under it stay on it and show as "Other" under it (D-10).
      if (node.amountPaise !== 0) {
        kids.push({ id: ownId(c.id), categoryId: c.id, kind: "own", name: c.name, nameHi: c.nameHi, level: level + 1, active: node.active,
          amountPaise: node.amountPaise, gstPaise: node.gstPaise, count: node.count, permille: 0, children: [] });
      }
      node.amountPaise = kids.reduce((s, k) => s + k.amountPaise, 0);
      node.gstPaise = kids.reduce((s, k) => s + k.gstPaise, 0);
      node.count = kids.reduce((s, k) => s + k.count, 0);
      kids.sort(bySize);
    }
    return node;
  };

  const nodes = tree.roots().map((c) => build(c, 1)).filter((n) => n.amountPaise !== 0);
  // An id that is in the totals but not in the tree is still money spent: keep it, so the tree equals the rollups.
  const strays = [...new Set([...Object.keys(approved), ...Object.keys(paid)])].filter((id) => !tree.byId.has(id));
  const stray = { amountPaise: 0, gstPaise: 0, count: 0 };
  for (const id of strays) { stray.amountPaise += posted(id); stray.gstPaise += gst(id); stray.count += count(id); }
  if (stray.amountPaise !== 0) {
    nodes.push({ id: UNLISTED, categoryId: null, kind: "unlisted", name: "Not under any head", level: 1, active: true, ...stray, permille: 0, children: [] });
  }
  nodes.sort(bySize);

  const give = (list: SpendNode[], units: number) => {
    const parts = shareOut(list.map((n) => Math.max(0, n.amountPaise)), units);
    list.forEach((n, i) => { n.permille = parts[i]!; give(n.children, n.permille); });
  };
  give(nodes, WHOLE);

  const heads: HeadTotal[] = SUMMARY_HEADS.map((head) => ({ head, amountPaise: 0, permille: 0, count: 0 }));
  for (const n of nodes) {
    const h = heads.find((x) => x.head === headOf(n))!;
    h.amountPaise += n.amountPaise; h.permille += n.permille; h.count += n.count;
  }
  const totalPaise = view === "all" ? cost.expenseTotalPaise : view === "paid" ? cost.expensePaidPaise : cost.expenseTotalPaise - cost.expensePaidPaise;
  return {
    view, totalPaise, gstPaise: cost.expenseGstPaise, count: nodes.reduce((s, n) => s + n.count, 0), nodes, heads,
    balanced: nodes.reduce((s, n) => s + n.amountPaise, 0) === totalPaise,
  };
}

/** Which summary tab a top-level node belongs to. */
function headOf(top: SpendNode): SummaryHead {
  return (SUMMARY_HEADS as readonly string[]).includes(top.id) ? (top.id as SummaryHead) : "other";
}

/** The top-level heads of one summary tab ("all" gives every head). */
export function headNodes(s: Spendings, head: HeadKey = "all"): SpendNode[] {
  return head === "all" ? s.nodes : s.nodes.filter((n) => headOf(n) === head);
}

/** The path from the top down to a node (empty when it is not in the tree, for example when it has no spending). */
export function pathTo(s: Spendings, id: string): SpendNode[] {
  const walk = (list: SpendNode[], trail: SpendNode[]): SpendNode[] | null => {
    for (const n of list) {
      if (n.id === id) return [...trail, n];
      const found = walk(n.children, [...trail, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(s.nodes, []) ?? [];
}

export function findNode(s: Spendings, id: string): SpendNode | null {
  const p = pathTo(s, id);
  return p[p.length - 1] ?? null;
}

export interface DrillItem {
  id: string;
  categoryId: string | null;
  kind: SpendNode["kind"];
  name: string;
  nameHi?: string;
  amountPaise: number;
  /** Tenths of a percent of this level (the items add up to 1000). */
  sharePermille: number;
  /** Tenths of a percent of the grand total. */
  permille: number;
  /** Bar length, 0 to 100, against the largest item of the level. */
  barPct: number;
  /** Has heads under it, so tapping it goes one level deeper. */
  drillable: boolean;
}

export interface DrillLevel {
  /** The chosen head; null at the top. */
  parent: SpendNode | null;
  /** Breadcrumb from the top down to the chosen head. */
  path: SpendNode[];
  /** The level's total: the parent's amount, or the tab's total at the top. */
  totalPaise: number;
  items: DrillItem[];
}

/** One level of the drill-down chart: the heads under `parentId`, or the top heads of a summary tab. */
export function drillLevel(s: Spendings, parentId: string | null, head: HeadKey = "all"): DrillLevel {
  const path = parentId ? pathTo(s, parentId) : [];
  const parent = path[path.length - 1] ?? null;
  const list = parent ? parent.children : headNodes(s, head);
  const shares = shareOut(list.map((n) => Math.max(0, n.amountPaise)), WHOLE);
  const max = list.reduce((m, n) => Math.max(m, n.amountPaise), 0);
  return {
    parent, path, totalPaise: list.reduce((t, n) => t + n.amountPaise, 0),
    items: list.map((n, i) => ({
      id: n.id, categoryId: n.categoryId, kind: n.kind, name: n.name, nameHi: n.nameHi, amountPaise: n.amountPaise, sharePermille: shares[i]!,
      permille: n.permille, barPct: max > 0 ? Math.max(0, Math.round((n.amountPaise * 100) / max)) : 0, drillable: n.children.length > 0,
    })),
  };
}

/** The amount of what is selected: a node, else a summary tab, else everything. */
export function selectionAmount(s: Spendings, head: HeadKey = "all", nodeId: string | null = null): number {
  if (nodeId) return findNode(s, nodeId)?.amountPaise ?? 0;
  return head === "all" ? s.totalPaise : s.heads.find((h) => h.head === head)!.amountPaise;
}

export interface MonthPoint { month: string; amountPaise: number }

/** Month-by-month amounts of the selection, from the monthly rollup documents (lifetime documents are ignored). */
export function monthSeries(tree: CategoryTree, docs: (CostRollup | null | undefined)[], months: string[], opts: { view?: SpendView; head?: HeadKey; nodeId?: string | null } = {}): MonthPoint[] {
  const byMonth = new Map<string, CostRollup[]>();
  for (const d of docs) {
    if (!d) continue;
    const m = rollupMeta(d.id).period;
    byMonth.set(m, [...(byMonth.get(m) ?? []), d]);
  }
  return months.map((month) => ({ month, amountPaise: selectionAmount(buildSpendings(tree, byMonth.get(month) ?? [], { view: opts.view }), opts.head, opts.nodeId ?? null) }));
}

/** Tenths of a percent as words: "12.3%". */
export function formatPermille(p: number): string {
  return `${Math.floor(p / 10)}.${p % 10}%`;
}

export interface SpendCsvRow {
  /** Head names from the top down; the fourth holds every deeper level, joined. */
  levels: [string, string, string, string];
  amountPaise: number;
  gstPaise: number;
  count: number;
  permille: number;
}

/**
 * Rows for an export of the level on screen: one row per head that holds entries itself (the last level, and the
 * "Other" part of a parent), so the rows add up to the level's total and nothing is counted twice (§11A.2: no totals
 * row inside the data). Level names come from the live tree (D-10).
 */
export function spendingsCsvRows(s: Spendings, opts: { nodeId?: string | null; head?: HeadKey; lang?: "en" | "hi"; ownLabel?: (parentName: string) => string } = {}): SpendCsvRow[] {
  const label = (n: SpendNode) => {
    const name = opts.lang === "hi" && n.nameHi ? n.nameHi : n.name;
    return n.kind === "own" ? (opts.ownLabel ? opts.ownLabel(name) : `Other ${name}`) : name;
  };
  const start = opts.nodeId ? pathTo(s, opts.nodeId) : [];
  const from = start.length ? [start[start.length - 1]!] : headNodes(s, opts.head ?? "all");
  const rows: SpendCsvRow[] = [];
  const walk = (n: SpendNode, trail: string[]) => {
    const names = [...trail, label(n)];
    if (n.children.length) { for (const k of n.children) walk(k, names); return; }
    rows.push({ levels: [names[0] ?? "", names[1] ?? "", names[2] ?? "", names.slice(3).join(" › ")], amountPaise: n.amountPaise, gstPaise: n.gstPaise, count: n.count, permille: n.permille });
  };
  const above = start.slice(0, -1).map(label);
  for (const n of from) walk(n, above);
  return rows;
}

export interface SpendCsvHeaders { level1: string; level2: string; level3: string; level4: string; amount: string; gst: string; entries: string; percent: string }

export const SPEND_CSV_HEADERS: SpendCsvHeaders = {
  level1: "Head", level2: "Level 2", level3: "Level 3", level4: "Level 4", amount: "Amount", gst: "GST inside", entries: "Entries", percent: "% of total",
};

/** The export as CSV text (amounts with two decimals and no separators, as every export here). */
export function spendingsCsv(rows: SpendCsvRow[], h: SpendCsvHeaders = SPEND_CSV_HEADERS): string {
  return toCsv<SpendCsvRow>([
    { header: h.level1, value: (r) => r.levels[0] },
    { header: h.level2, value: (r) => r.levels[1] },
    { header: h.level3, value: (r) => r.levels[2] },
    { header: h.level4, value: (r) => r.levels[3] },
    { header: h.amount, value: (r) => csvAmount(r.amountPaise) },
    { header: h.gst, value: (r) => csvAmount(r.gstPaise) },
    { header: h.entries, value: (r) => r.count },
    { header: h.percent, value: (r) => formatPermille(r.permille).replace("%", "") },
  ], rows);
}

// ───────────────────────── Expense heads (§7.1, D-10) ─────────────────────────

/** How deep the tree may go (the spec asks for at least 4). */
export const MAX_CATEGORY_LEVELS = 6;
/** Entries whose path is rewritten in one go after a move (D-10 d). */
export const CATEGORY_MOVE_PAGE = 400;

/** The record of one move: the paged job that brings `categoryPath` on the entries up to date (D-10). */
export interface CategoryMove {
  id: string;
  categoryId: string;
  /** The moved head and every head under it: the entries of these get a new path. */
  categoryIds: string[];
  fromParentId: string | null;
  toParentId: string | null;
  status: "running" | "done";
  /** Where the next page starts: the position in `categoryIds` and the last entry id done there. */
  cursor: { index: number; afterId: string | null };
  /** Entries whose path was rewritten so far. */
  rewritten: number;
  requestedBy: string;
  requestedAt: string;
  finishedAt: string | null;
}

/** What the head editor says when it refuses, in plain words. The screens show these in Hindi by their key. */
export const CATEGORY_REFUSALS = {
  ownerOnly: "Only the owner can change the expense heads.",
  notFound: "This expense head is no longer in the list. Reload the page and try again.",
  nameShort: "Enter a name of at least 2 letters.",
  nameLong: "Keep the name under 60 letters.",
  nameTaken: "There is already a head with this name at this place. Choose another name.",
  parentMissing: "Choose where the head should go.",
  parentArchived: "That head is archived. Restore it first.",
  tooDeep: "Heads can go 6 levels deep at most. Choose a place higher up.",
  sameParent: "The head is already there. Choose a different place.",
  underItself: "A head can't be moved under itself or under one of its own heads.",
  moveRunning: "The last move is still finishing. Let it finish, then try again.",
  moveMissing: "This move is no longer in the list. Reload the page.",
  hasActiveChildren: "Archive or move the heads under it first.",
  usedByRecurring: "A recurring expense uses this head. Pause or change that recurring expense first.",
} as const;
export type CategoryRefusal = keyof typeof CATEGORY_REFUSALS;

/** The key of a refusal message, so a screen can show it in the person's language. */
export function categoryRefusalKey(message: string): CategoryRefusal | null {
  return (Object.keys(CATEGORY_REFUSALS) as CategoryRefusal[]).find((k) => CATEGORY_REFUSALS[k] === message) ?? null;
}

/** The longest chain of heads from this one down (1 for a head with nothing under it). */
export function subtreeHeight(tree: CategoryTree, id: string): number {
  return 1 + tree.childrenOf(id).reduce((m, c) => Math.max(m, subtreeHeight(tree, c.id)), 0);
}

/** Why a head can't be moved under `parentId` (null = top level), or null when it can. */
export function moveRefusal(tree: CategoryTree, id: string, parentId: string | null): string | null {
  const c = tree.byId.get(id);
  if (!c) return CATEGORY_REFUSALS.notFound;
  if (parentId !== null && !tree.byId.has(parentId)) return CATEGORY_REFUSALS.parentMissing;
  if ((c.parentId ?? null) === parentId) return CATEGORY_REFUSALS.sameParent;
  if (parentId !== null && tree.descendantsAndSelf(id).includes(parentId)) return CATEGORY_REFUSALS.underItself;
  if (parentId !== null && tree.byId.get(parentId)!.active === false) return CATEGORY_REFUSALS.parentArchived;
  if ((parentId ? tree.level(parentId) : 0) + subtreeHeight(tree, id) > MAX_CATEGORY_LEVELS) return CATEGORY_REFUSALS.tooDeep;
  if (nameTaken(tree, parentId, c.name, id)) return CATEGORY_REFUSALS.nameTaken;
  return null;
}

/** Whether another head at this place already has the name (capital letters and spaces don't count). */
export function nameTaken(tree: CategoryTree, parentId: string | null, name: string, exceptId: string | null = null): boolean {
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const siblings = parentId ? tree.childrenOf(parentId) : tree.roots();
  return siblings.some((s) => s.id !== exceptId && key(s.name) === key(name));
}
