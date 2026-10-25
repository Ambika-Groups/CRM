/**
 * List queries (spec §3.1 rule 9: "No page may download a whole collection"; lists are paginated with
 * cursors, 25 to 50 per page). Every list query states a limit, enforced here; the same spec maps onto a
 * Firestore query in Firebase mode (where / orderBy / limit / startAfter).
 * Only the small, bounded collections in SMALL_COLLECTIONS may be read whole.
 */

export type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains" | "array-contains-any";

export interface Where {
  field: string;
  op: Op;
  value: unknown;
}

export interface QuerySpec {
  where?: Where[];
  orderBy?: { field: string; dir?: "asc" | "desc" }[];
  /** 1–50 (rule 9). */
  limit: number;
  /** Cursor from the previous page (the last document's id). */
  after?: string | null;
}

export interface Page<T> {
  items: T[];
  /** Pass as `after` for the next page; null on the last page. */
  next: string | null;
  /** Total matching (an aggregation count in Firebase mode). */
  total: number;
}

export const PAGE_SIZES = [25, 50] as const;
export const MAX_PAGE = 50;

/** Bounded collections that may be read in full (category tree ~35, settings, users, roles, roster per site). */
export const SMALL_COLLECTIONS: ReadonlySet<string> = new Set([
  "expense_categories", "settings", "users", "accounts", "counters", "period_locks", "meta",
]);

export class QueryLimitError extends Error {}

export function assertLimit(spec: QuerySpec): void {
  if (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > MAX_PAGE) {
    throw new QueryLimitError(`List queries need a limit from 1 to ${MAX_PAGE} (spec §3.1 rule 9); got ${spec.limit}`);
  }
}

function getField(doc: unknown, path: string): unknown {
  let o: unknown = doc;
  for (const k of path.split(".")) {
    if (o === null || typeof o !== "object") return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return o;
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true });
}

export function matches(doc: unknown, w: Where): boolean {
  const v = getField(doc, w.field);
  switch (w.op) {
    case "==": return v === w.value;
    case "!=": return v !== w.value;
    case "<": return cmp(v, w.value) < 0;
    case "<=": return cmp(v, w.value) <= 0;
    case ">": return cmp(v, w.value) > 0;
    case ">=": return cmp(v, w.value) >= 0;
    case "in": return Array.isArray(w.value) && w.value.includes(v);
    case "array-contains": return Array.isArray(v) && v.includes(w.value);
    case "array-contains-any": return Array.isArray(v) && Array.isArray(w.value) && w.value.some((x) => v.includes(x));
  }
}

/** Apply a query to in-memory documents (demo mode, tests). Throws without a valid limit. */
export function runQuery<T extends { id: string }>(docs: T[], spec: QuerySpec): Page<T> {
  assertLimit(spec);
  let rows = docs.filter((d) => (spec.where ?? []).every((w) => matches(d, w)));
  const order = spec.orderBy?.length ? spec.orderBy : [{ field: "id", dir: "asc" as const }];
  rows = [...rows].sort((a, b) => {
    for (const o of order) {
      const c = cmp(getField(a, o.field), getField(b, o.field));
      if (c) return o.dir === "desc" ? -c : c;
    }
    return a.id.localeCompare(b.id);
  });
  const start = spec.after ? rows.findIndex((r) => r.id === spec.after) + 1 : 0;
  const items = rows.slice(start, start + spec.limit);
  const next = start + spec.limit < rows.length ? items[items.length - 1]?.id ?? null : null;
  return { items, next, total: rows.length };
}

/** Count matching documents (aggregation count in Firebase mode). */
export function runCount<T>(docs: T[], where: Where[] = []): number {
  return docs.filter((d) => where.every((w) => matches(d, w))).length;
}

/** Sum a numeric field over matching documents (aggregation sum in Firebase mode). */
export function runSum<T>(docs: T[], field: string, where: Where[] = []): number {
  return docs.filter((d) => where.every((w) => matches(d, w))).reduce((s, d) => s + (Number(getField(d, field)) || 0), 0);
}
