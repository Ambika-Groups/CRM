/**
 * What the device may answer from its own copy instead of asking the server (D-51: the free plan allows 50,000 reads a
 * day, and a read answered from the device costs nothing). Something that came from the server is "fresh" for a
 * while; after this person's own save, only the collections that save changed are forgotten.
 */
export class FreshMap<V = true> {
  private items = new Map<string, { at: number; col: string; value: V }>();
  constructor(private ttlMs: number, private now: () => number = Date.now) {}

  /** Remember that `key` (a document or a query in collection `col`) just came from the server. */
  set(key: string, col: string, value: V): void {
    this.items.set(key, { at: this.now(), col, value });
  }

  /** The remembered value while it is still fresh; otherwise undefined. */
  get(key: string): V | undefined {
    const it = this.items.get(key);
    if (!it) return undefined;
    if (this.now() - it.at >= this.ttlMs) { this.items.delete(key); return undefined; }
    return it.value;
  }

  has(key: string): boolean { return this.get(key) !== undefined; }

  /**
   * Forget everything in these collections ("*": everything). A collection matches itself, anything under it
   * ("projects" forgets "projects/p1/roster") and its parents ("projects/p1/roster" forgets "projects").
   */
  forget(collections: readonly string[] | "*"): void {
    if (collections === "*" || collections.includes("*")) { this.items.clear(); return; }
    for (const [k, v] of this.items) {
      if (collections.some((t) => v.col === t || v.col.startsWith(`${t}/`) || t.startsWith(`${v.col}/`))) this.items.delete(k);
    }
  }

  get size(): number { return this.items.size; }
}
