"use client";
import type { CommandArgs, CommandName } from "@ag/core";
import { useEffect, useState } from "react";

/**
 * Writes made while offline (spec §3.1 rule 11, §6.3). They are kept on this device and sent when the
 * connection returns. A write the server refuses (for example a day that locked meanwhile, D-25) stays in
 * the queue with its reason, so the values are never silently lost. In Firebase mode Firestore's own offline
 * persistence replaces this queue (M1.6); the states shown to the user stay the same.
 */
export interface QueuedWrite { id: string; name: CommandName; args: unknown; label: string; at: string; error?: string | null }

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
export async function flushQueue(run: (name: CommandName, args: never, requestId?: string) => Promise<unknown>): Promise<number> {
  let sent = 0;
  const left: QueuedWrite[] = [];
  for (const q of queuedWrites()) {
    try { await run(q.name, q.args as never, `${q.id}_${q.at}`); sent++; } catch (e) { left.push({ ...q, error: e instanceof Error ? e.message : String(e) }); }
  }
  save(left);
  return sent;
}

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
