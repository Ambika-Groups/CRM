"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnline, useRun } from "@/data/DataProvider";
import { discardQueued, flushQueue, sendingCount, useQueue } from "@/lib/queue";
import { Icon } from "./Icon";
import { useToast } from "@/components/ui/feedback";

/** Top-bar sync indicator (spec §4A.5): Synced, Offline, or how many changes are waiting on this device. */
export function SyncState({ className = "", long = false }: { className?: string; long?: boolean }) {
  const { t } = useTranslation();
  const online = useOnline();
  const queue = useQueue();
  const waiting = queue.length;
  const sending = online ? sendingCount(queue) : 0;
  const saving = sending > 0 && sending === waiting;
  const warn = !online || (waiting > 0 && !saving);
  const text = !online
    ? (waiting ? t("sync.offlineWaiting", { n: waiting }) : t("top.offline"))
    : saving ? t("sync.saving", { n: sending }) : waiting ? t("sync.waiting", { n: waiting }) : long ? t("top.syncedLong") : t("top.synced");
  return (
    <span className={`sync-state ${className}`} style={warn ? { color: "var(--color-warning)" } : undefined} role="status" data-sync-state={!online ? "offline" : saving ? "saving" : waiting ? "waiting" : "synced"}>
      <Icon name={!online ? "wifi-off" : saving ? "refresh" : waiting ? "clock" : "check-circle"} size={16} className="icon icon-sm" />
      {text}
    </span>
  );
}

/**
 * The offline strip and the queue flusher: when the connection returns, queued changes are sent in order.
 * One the server refuses (for example a day that locked meanwhile, D-25) stays, with its reason and a way to discard it.
 */
export function SyncStrip() {
  const { t } = useTranslation();
  const online = useOnline();
  const run = useRun();
  const toast = useToast();
  const queue = useQueue();
  const busy = useRef(false);
  const pending = queue.filter((q) => !q.error).length - sendingCount(queue);
  const [tick, setTick] = useState(0);

  // Something is waiting (no connection to the server a moment ago, or a send that never came back): try again every half minute.
  useEffect(() => {
    if (!queue.some((q) => !q.error)) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [queue]);

  useEffect(() => {
    if (!online || !pending || busy.current) return;
    busy.current = true;
    void flushQueue(run as never).then((n) => { if (n) toast(t("sync.sent", { n })); }).finally(() => { busy.current = false; });
  }, [online, pending, run, toast, t, tick]);

  const failed = queue.filter((q) => q.error);
  if (online && !failed.length) return null;
  return (
    <div className="offline-strip" role="status" data-offline-strip>
      <Icon name={online ? "alert" : "wifi-off"} />
      <span className="grow">
        {!online && <>{t("top.offlineStrip")}{queue.length ? ` ${t("sync.waitingHere", { n: queue.length })}` : ""}</>}
        {failed.map((q) => (
          <span key={q.id} className="queued-error">
            <b>{q.label}:</b> {q.error} <button type="button" className="link-btn" onClick={() => discardQueued(q.id)}>{t("sync.discard")}</button>
          </span>
        ))}
      </span>
    </div>
  );
}
