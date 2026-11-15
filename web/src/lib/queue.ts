"use client";
import type { CommandArgs, CommandName } from "@ag/core";
import { useEffect, useState } from "react";

/**
 * Writes made while offline (spec §3.1 rule 11, §6.3). They are kept on this device and sent when the
 * connection returns. A write the server refuses (for example a day that locked meanwhile, D-25) stays in
 * the queue with its reason, so the values are never silently lost. In Firebase mode Firestore's own offline
 * persistence replaces this queue (M1.6); the states shown to the user stay the same.
 *
 * The same list also holds saves sent in the background (`sendInBackground`): on the live database a save takes one to
 * three seconds (the server part is far from the database), so a quick entry is kept here first, sent at once, and the
 * person carries on. If it is refused it stays here with the reason; if there is no connection it is sent later.
 */
export interface QueuedWrite { id: string; name: CommandName; args: unknown; label: string; at: string; error?: string | null; /** Being sent right now (since this time, ms). */ sending?: number | null }

/** A send that has not come back after this long is treated as lost and sent again (the request id makes that safe). */
const SENDING_MS = 90_000;
const isSending = (q: QueuedWrite) => !!q.sending && Date.now() - q.sending < SENDING_MS;
const requestIdOf = (q: Pick<QueuedWrite, "id" | "at">) => `${q.id}_${q.at}`;
type Run = (name: CommandName, args: never, requestId?: string) => Promise<unknown>;
/** No connection (or the server did not answer): not a refusal, so it is tried again. */
const canRetry = (e: unknown) => (e as { retry?: boolean } | null)?.retry === true;

const KEY = "ag-queue";
const EVENT = "ag-queue-change";

export function queuedWrites(): QueuedWrite[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedWrite[]; } catch { return []; }
}

function save(items: QueuedWrite[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: nothing to keep */ }
  window.dispatchEvent(new Event(EVENT));
}

export function enqueue<N extends CommandName>(name: N, args: CommandArgs<N>, label: string, key?: string) {
  const items = queuedWrites().filter((q) => !key || q.id !== key);
  items.push({ id: key ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, args, label, at: new Date().toISOString(), error: null });
  save(items);
}

/** Sends queued writes in order; a refused one stays with its message. Returns how many were sent. */
export async function flushQueue(run: Run): Promise<number> {
  let sent = 0;
  for (const q of queuedWrites()) {
    if (isSending(q) || q.error) continue;
    patch(q.id, { sending: Date.now() });
    try {
      await run(q.name, q.args as never, requestIdOf(q));
      discardQueued(q.id);
      sent++;
    } catch (e) {
      patch(q.id, { sending: null, error: canRetry(e) ? null : e instanceof Error ? e.message : String(e) });
      if (canRetry(e)) break; // no connection: the rest wait too, in order
    }
  }
  return sent;
}

function patch(id: string, change: Partial<QueuedWrite>) {
  save(queuedWrites().map((q) => (q.id === id ? { ...q, ...change } : q)));
}

/**
 * Save without making the person wait. The change is written to this device first (so a closed tab or a lost
 * connection never loses it), sent straight away, and removed when the server has saved it. A refusal stays in the
 * list with its reason (the top bar and the strip show it); with no connection it waits and is sent later.
 * Use it for quick entries whose result the screen does not need; use `useRun` when the screen needs the answer.
 */
export function sendInBackground<N extends CommandName>(run: Run, name: N, args: CommandArgs<N>, label: string, key?: string): void {
  const q: QueuedWrite = { id: key ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, args, label, at: new Date().toISOString(), error: null, sending: navigator.onLine ? Date.now() : null };
  save([...queuedWrites().filter((x) => x.id !== q.id), q]);
  if (!navigator.onLine) return;
  run(name, args as never, requestIdOf(q)).then(
    () => discardQueued(q.id),
    (e) => patch(q.id, { sending: null, error: canRetry(e) ? null : e instanceof Error ? e.message : String(e) }),
  );
}

/** How many saves are on their way right now. */
export const sendingCount = (items: QueuedWrite[]) => items.filter(isSending).length;

export function discardQueued(id: string) {
  save(queuedWrites().filter((q) => q.id !== id));
}

export function useQueue(): QueuedWrite[] {
  const [items, setItems] = useState<QueuedWrite[]>([]);
  useEffect(() => {
    const on = () => setItems(queuedWrites());
    on();
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return items;
}
