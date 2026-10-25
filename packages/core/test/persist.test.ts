// QA N1: the demo store's write-behind saving. A command must resolve only once its change is durable.
import { describe, expect, it, vi } from "vitest";
import { Persister } from "../src";

const deferred = () => { let done!: () => void; const p = new Promise<void>((r) => { done = r; }); return { p, done }; };

describe("Persister", () => {
  it("PS-01 flush saves at once and resolves only after the save finished", async () => {
    let saved = 0;
    const gate = deferred();
    const p = new Persister(async () => { await gate.p; saved++; }, 10_000);
    p.schedule();
    let resolved = false;
    const f = p.flush().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false); // still writing
    gate.done();
    await f;
    expect(saved).toBe(1);
    expect(p.pending).toBe(false);
  });

  it("PS-02 the debounce saves once for a burst of changes", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const p = new Persister(save, 400);
    p.schedule(); p.schedule(); p.schedule();
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("PS-03 a change made during a save is written by a second save; flush waits for both", async () => {
    const order: string[] = [];
    let n = 0;
    const gate = deferred();
    const p = new Persister(async () => { const k = ++n; if (k === 1) await gate.p; order.push(`save${k}`); }, 10_000);
    p.schedule();
    const first = p.flush();
    p.schedule(); // a change while the first save is still running
    const second = p.flush();
    gate.done();
    await Promise.all([first, second]);
    expect(order).toEqual(["save1", "save2"]);
  });

  it("PS-04 flush with nothing changed does no save, and a failed save doesn't block the next", async () => {
    let calls = 0;
    const p = new Persister(async () => { calls++; if (calls === 1) throw new Error("disk full"); }, 10_000);
    await p.flush();
    expect(calls).toBe(0);
    p.schedule();
    await expect(p.flush()).rejects.toThrow("disk full");
    p.schedule();
    await p.flush();
    expect(calls).toBe(2);
  });
});
