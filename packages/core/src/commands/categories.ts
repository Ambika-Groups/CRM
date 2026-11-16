/**
 * Expense-head commands (spec §7.1 "editable by admin", §7.4, decision D-10): add, rename, move under another head,
 * archive and restore. Only the owner may run them (the same as firestore.rules).
 *
 * No command here writes a total. Rollups are keyed by the category id an entry was posted to, and a parent's total is
 * worked out on read from the tree, so a rename or a move changes names and `parentId` only and every total stays
 * exact (D-10). A move also brings `categoryPath` on the entries up to date, a page at a time: `category_moves/{id}`
 * keeps the status and the cursor, so the job can be picked up again after a break. That rewrite changes no money
 * field, so it makes no posting call and is allowed in a closed month (D-10 a, c). The audit trail gets one entry when
 * a move is asked for and one when it is finished, on the head, never one per entry (D-10 b).
 * A head is never deleted: one that is no longer wanted is archived, and its past entries keep counting (D-10).
 */
import { CategoryTree, seedCategories, type Category } from "../categories";
import {
  CATEGORY_MOVE_PAGE, CATEGORY_REFUSALS as R, MAX_CATEGORY_LEVELS, moveRefusal, nameTaken, type CategoryMove,
} from "../spendings";
import type { Doc, MemoryStore } from "../store";
import { CommandError, newId, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx, type CommandFn } from "./common";

const COL = "expense_categories";
const MOVES = "category_moves";

function ownerOnly(ctx: CommandCtx): void {
  if (ctx.role !== "owner") throw new CommandError(R.ownerOnly);
}

/** The saved tree. Built-in heads that were never saved are saved first, so the stored tree is always whole. */
function savedTree(store: MemoryStore, ctx: CommandCtx): CategoryTree {
  const have = new Set(store.list<Category>(COL).map((c) => c.id));
  for (const c of seedCategories()) if (!have.has(c.id)) store.set(COL, { ...c, ...stampCreate(ctx) } as unknown as Doc);
  return new CategoryTree(store.list<Category>(COL));
}

function audit(store: MemoryStore, ctx: CommandCtx, command: string, id: string, action: string, before: unknown, after: unknown, note: string | null = null) {
  store.set("audit_log", { id: newId(), entity: COL, entityId: id, projectId: null, action, command, before: before ?? null, after: after ?? null, note, by: ctx.uid, at: ctx.nowIso } as Doc);
}

function nameOf(v: unknown, field: "name" | "nameHi", required: boolean): string {
  const name = trimOrEmpty(v).replace(/\s+/g, " ");
  if (required && name.length < 2) throw new CommandError(R.nameShort, { [field]: R.nameShort });
  if (name.length > 60) throw new CommandError(R.nameLong, { [field]: R.nameLong });
  return name;
}

function need(tree: CategoryTree, id: string): Category {
  const c = tree.byId.get(id);
  if (!c) throw new CommandError(R.notFound);
  return c;
}

const nextOrder = (tree: CategoryTree, parentId: string | null) =>
  (parentId ? tree.childrenOf(parentId) : tree.roots()).reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;

// ───────────────────────── Add, rename, archive ─────────────────────────

export interface AddCategoryArgs { name: string; nameHi?: string; parentId: string | null }

/** Add a head at the top level or under another head. Entries already made on that head stay on it (D-10). */
export function addCategory(store: MemoryStore, args: AddCategoryArgs, ctx: CommandCtx): { id: string } {
  ownerOnly(ctx);
  const tree = savedTree(store, ctx);
  const name = nameOf(args.name, "name", true);
  const nameHi = nameOf(args.nameHi, "nameHi", false);
  const parentId = args.parentId || null;
  if (parentId) {
    const parent = tree.byId.get(parentId);
    if (!parent) throw new CommandError(R.parentMissing, { parentId: R.parentMissing });
    if (parent.active === false) throw new CommandError(R.parentArchived, { parentId: R.parentArchived });
    if (tree.level(parentId) + 1 > MAX_CATEGORY_LEVELS) throw new CommandError(R.tooDeep, { parentId: R.tooDeep });
  }
  if (nameTaken(tree, parentId, name)) throw new CommandError(R.nameTaken, { name: R.nameTaken });
  const cat: Category = { id: `cat_${newId()}`, name, ...(nameHi ? { nameHi } : {}), parentId, sortOrder: nextOrder(tree, parentId), active: true, isSystem: false };
  store.set(COL, { ...cat, ...stampCreate(ctx) } as unknown as Doc);
  audit(store, ctx, "addCategory", cat.id, "create", null, { name, nameHi: nameHi || null, parentId });
  return { id: cat.id };
}

export interface RenameCategoryArgs { id: string; name: string; nameHi?: string }

/** Change the name of a head (English, and Hindi when given). Totals are kept by id, so they don't change. */
export function renameCategory(store: MemoryStore, args: RenameCategoryArgs, ctx: CommandCtx): { id: string } {
  ownerOnly(ctx);
  const tree = savedTree(store, ctx);
  const c = need(tree, args.id);
  const name = nameOf(args.name, "name", true);
  const nameHi = args.nameHi === undefined ? c.nameHi ?? "" : nameOf(args.nameHi, "nameHi", false);
  if (nameTaken(tree, c.parentId ?? null, name, c.id)) throw new CommandError(R.nameTaken, { name: R.nameTaken });
  if (name === c.name && nameHi === (c.nameHi ?? "")) return { id: c.id };
  store.merge(COL, c.id, { name, nameHi, ...stampUpdate(ctx) });
  audit(store, ctx, "renameCategory", c.id, "update", { name: c.name, nameHi: c.nameHi ?? null }, { name, nameHi: nameHi || null });
  return { id: c.id };
}

export interface ArchiveCategoryArgs { id: string; archived: boolean }

/**
 * Archive a head (it is no longer offered for new entries; its past entries keep counting) or restore it. A head with
 * entries can be archived but nothing is ever deleted (D-10).
 */
export function archiveCategory(store: MemoryStore, args: ArchiveCategoryArgs, ctx: CommandCtx): { id: string; active: boolean } {
  ownerOnly(ctx);
  const tree = savedTree(store, ctx);
  const c = need(tree, args.id);
  const active = !args.archived;
  if ((c.active !== false) === active) return { id: c.id, active };
  if (!active) {
    if (tree.childrenOf(c.id).some((k) => k.active !== false)) throw new CommandError(R.hasActiveChildren);
    const used = store.list<{ categoryId?: string; isDeleted?: boolean }>("expense_templates", (t) => !t.isDeleted && t.categoryId === c.id, { field: "active", value: true });
    if (used.length) throw new CommandError(R.usedByRecurring);
  } else if (c.parentId && tree.byId.get(c.parentId)?.active === false) {
    throw new CommandError(R.parentArchived);
  }
  store.merge(COL, c.id, { active, ...stampUpdate(ctx) });
  audit(store, ctx, "archiveCategory", c.id, active ? "restore" : "archive", { active: !active }, { active });
  return { id: c.id, active };
}

// ───────────────────────── Move (re-parent, §7.4, D-10) ─────────────────────────

export interface MoveResult { moveId: string; done: boolean; rewritten: number }

/**
 * One page of the path rewrite: up to `pageSize` entries of the moved heads, from the cursor on, get the path of the
 * live tree. Only `categoryPath` is written (no stamp, no posting). The last page closes the move and writes the
 * "finished" audit entry.
 */
function stepMove(store: MemoryStore, ctx: CommandCtx, move: CategoryMove, pageSize: number): MoveResult {
  // The move record is touched first, so an in-between page is logged against the move, never against an entry.
  store.merge(MOVES, move.id, stampUpdate(ctx));
  const tree = new CategoryTree(store.list<Category>(COL));
  let { index, afterId } = move.cursor;
  let rewritten = move.rewritten;
  let budget = Math.min(CATEGORY_MOVE_PAGE, Math.max(1, Math.floor(pageSize) || 1));
  while (index < move.categoryIds.length && budget > 0) {
    const cid = move.categoryIds[index]!;
    const path = tree.byId.has(cid) ? tree.pathOf(cid) : null;
    const from = afterId;
    const rows = path
      ? store.list<{ id: string; categoryPath?: string[] }>("expenses", (e) => from === null || e.id > from, { field: "categoryId", value: cid }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      : [];
    const page = rows.slice(0, budget);
    for (const e of page) {
      if (JSON.stringify(e.categoryPath ?? null) === JSON.stringify(path)) continue;
      store.merge("expenses", e.id, { categoryPath: path });
      rewritten += 1;
    }
    budget -= page.length;
    if (page.length < rows.length) afterId = page[page.length - 1]!.id;
    else { index += 1; afterId = null; }
  }
  const done = index >= move.categoryIds.length;
  store.merge(MOVES, move.id, { cursor: { index, afterId }, rewritten, status: done ? "done" : "running", finishedAt: done ? ctx.nowIso : null, ...stampUpdate(ctx) });
  if (done) {
    audit(store, ctx, "moveCategory", move.categoryId, "move_finished", { parentId: move.fromParentId }, { parentId: move.toParentId }, `${rewritten} entries updated (move ${move.id})`);
  }
  return { moveId: move.id, done, rewritten };
}

export interface MoveCategoryArgs { id: string; parentId: string | null; pageSize?: number }

/**
 * Move a head (with everything under it) to the top level or under another head. Only `parentId` changes: no total is
 * rewritten, and both parents' totals follow on the next read. Then the first page of the path rewrite runs; when
 * `done` comes back false the caller runs `continueCategoryMove` until it is true.
 */
export function moveCategory(store: MemoryStore, args: MoveCategoryArgs, ctx: CommandCtx): MoveResult {
  ownerOnly(ctx);
  const tree = savedTree(store, ctx);
  const parentId = args.parentId || null;
  const refusal = moveRefusal(tree, args.id, parentId);
  if (refusal) throw new CommandError(refusal, refusal === R.notFound ? {} : { parentId: refusal });
  if (store.list<CategoryMove>(MOVES, undefined, { field: "status", value: "running" }).length) throw new CommandError(R.moveRunning);
  const c = need(tree, args.id);
  const fromParentId = c.parentId ?? null;
  store.merge(COL, c.id, { parentId, sortOrder: nextOrder(tree, parentId), ...stampUpdate(ctx) });
  const move: CategoryMove = {
    id: newId(), categoryId: c.id, categoryIds: tree.descendantsAndSelf(c.id), fromParentId, toParentId: parentId, status: "running",
    cursor: { index: 0, afterId: null }, rewritten: 0, requestedBy: ctx.uid, requestedAt: ctx.nowIso, finishedAt: null,
  };
  store.set(MOVES, { ...move, ...stampCreate(ctx) } as unknown as Doc);
  audit(store, ctx, "moveCategory", c.id, "move_requested", { parentId: fromParentId }, { parentId }, `move ${move.id}`);
  return stepMove(store, ctx, move, args.pageSize ?? CATEGORY_MOVE_PAGE);
}

export interface ContinueCategoryMoveArgs { moveId: string; pageSize?: number }

/** The next page of a move that is still running (safe to call again: a finished move is left as it is). */
export function continueCategoryMove(store: MemoryStore, args: ContinueCategoryMoveArgs, ctx: CommandCtx): MoveResult {
  ownerOnly(ctx);
  const move = store.get<CategoryMove>(MOVES, args.moveId);
  if (!move) throw new CommandError(R.moveMissing);
  if (move.status === "done") return { moveId: move.id, done: true, rewritten: move.rewritten };
  return stepMove(store, ctx, move, args.pageSize ?? CATEGORY_MOVE_PAGE);
}

// ───────────────────────── The command map ─────────────────────────

export const CATEGORY_COMMANDS = {
  addCategory: (s, a: AddCategoryArgs, c) => addCategory(s, a, c),
  renameCategory: (s, a: RenameCategoryArgs, c) => renameCategory(s, a, c),
  archiveCategory: (s, a: ArchiveCategoryArgs, c) => archiveCategory(s, a, c),
  moveCategory: (s, a: MoveCategoryArgs, c) => moveCategory(s, a, c),
  continueCategoryMove: (s, a: ContinueCategoryMoveArgs, c) => continueCategoryMove(s, a, c),
} satisfies Record<string, CommandFn>;
