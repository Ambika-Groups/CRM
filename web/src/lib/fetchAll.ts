import type { Page, QuerySpec } from "@ag/core";
import type { DataSource } from "@/data/types";

/**
 * Pages through a bounded query 50 at a time (spec §3.1 rule 9: never a whole collection). Used for one site's
 * day or month of attendance, which is bounded by workers × days. Stops at `maxPages` as a safety net.
 */
export async function fetchAll<T extends { id: string }>(s: DataSource, collection: string, spec: Omit<QuerySpec, "limit" | "after">, maxPages = 40): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const pg: Page<T> = await s.query<T>(collection, { ...spec, limit: 50, after });
    out.push(...pg.items);
    if (!pg.next) break;
    after = pg.next;
  }
  return out;
}
