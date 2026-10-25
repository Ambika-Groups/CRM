"use client";
import { useEffect, useState } from "react";

const EVENT = "ag-location-change";

/**
 * Notify listeners whenever the URL changes inside the app: Next's router (pushState/replaceState), setParam,
 * and back/forward. Patched once, so a same-page navigation (another project's ?id=, a new date) re-reads.
 */
function watchHistory() {
  const w = window as Window & { __agHistoryPatched?: boolean };
  if (w.__agHistoryPatched) return;
  w.__agHistoryPatched = true;
  for (const k of ["pushState", "replaceState"] as const) {
    const orig = history[k].bind(history);
    history[k] = (...args: Parameters<History["pushState"]>) => {
      orig(...args);
      window.dispatchEvent(new Event(EVENT));
    };
  }
}

/** Reads a query-string parameter (detail pages use ?id=…, decisions D-39). Undefined until mounted. */
export function useParam(name: string): string | null | undefined {
  const [v, setV] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    watchHistory();
    const read = () => setV(new URLSearchParams(window.location.search).get(name));
    read();
    window.addEventListener("popstate", read);
    window.addEventListener(EVENT, read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener(EVENT, read); };
  }, [name]);
  return v;
}

export function setParam(name: string, value: string) {
  const u = new URL(window.location.href);
  u.searchParams.set(name, value);
  window.history.replaceState(window.history.state, "", u.toString());
}
