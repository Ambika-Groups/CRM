/**
 * Write-behind persistence for the demo store (QA N1). Changes are saved shortly after they happen, and
 * `flush()` saves immediately and resolves only when the save is done. Every command awaits `flush()`, so
 * nothing the user saved can be lost by navigating or reloading straight afterwards. Saves never overlap:
 * a change made during a save is written by the next one.
 */
export class Persister {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly save: () => Promise<void>, private readonly delayMs = 400) {}

  /** Mark the data changed; it is saved within `delayMs` unless flushed sooner. */
  schedule(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
  }

  /** Save now if anything changed; resolves when every change so far is saved. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.dirty) {
      this.dirty = false;
      this.chain = this.chain.then(() => this.save(), () => this.save());
    }
    return this.chain;
  }

  /** True while a change hasn't been handed to a save yet. */
  get pending(): boolean {
    return this.dirty;
  }
}
