"use client";
import { sendInBackground } from "@/lib/queue";
import type { CommandArgs, CommandName, CommandResult, QuerySpec, Where } from "@ag/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { resolveConfig } from "./config";
import type { FilesApi } from "./files/types";
import { pendingSource } from "./pending";
import type { AuthState, DataSource, Session } from "./types";

interface Ctx {
  source: DataSource;
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Bumps on every data change so hooks re-read. */
  version: number;
}

const DataCtx = createContext<Ctx | null>(null);

// One source per page load. Each is its own chunk, so a demo page never downloads the Firebase code and a Firebase
// page never downloads the demo seed (the first screen is under 2 s on 4G, R15-2).
let booting: Promise<DataSource> | null = null;
function bootSource(): Promise<DataSource> {
  booting ??= (async () => {
    // Demo mode can never activate when any Firebase config is present (D-37).
    const r = resolveConfig();
    const source: DataSource = r.mode === "firebase"
      ? new (await import("./firebase/firebaseSource")).FirebaseSource()
      : new (await import("./demo/demoSource")).DemoSource();
    await source.init();
    return source;
  })();
  return booting;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<DataSource>(pendingSource);
  const [status, setStatus] = useState<Ctx["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let off = () => {};
    let live = true;
    (async () => {
      try {
        const next = await bootSource();
        if (!live) return;
        off = next.subscribe(() => setVersion((v) => v + 1));
        setSource(next);
        setStatus("ready");
        document.documentElement.dataset.ready = "1"; // used by tools/ui-check.mjs
      } catch (e) {
        booting = null;
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => { live = false; off(); };
  }, []);

  return <DataCtx.Provider value={{ source, status, error, version }}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData outside DataProvider");
  return c;
}

/** Firebase mode: where sign-in stands. Null in demo mode (there is nothing to sign in to). */
export function useAuthState(): AuthState | null {
  const { source, status, version } = useData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (status === "ready" ? source.auth?.state() ?? null : null), [source, status, version]);
}

export function useSession(): Session | null {
  const { source, status, version } = useData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (status === "ready" ? source.session() : null), [source, status, version]);
}

/** Re-runs an async read whenever data changes or the key changes. `undefined` means still loading. */
function useAsync<T>(key: string, fn: (s: DataSource) => Promise<T>, enabled = true): { data: T | undefined; error: string | null } {
  const { source, status, version } = useData();
  const [state, setState] = useState<{ key: string; data: T | undefined; error: string | null }>({ key: "", data: undefined, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (status !== "ready" || !enabled) return;
    let live = true;
    fnRef.current(source).then(
      (data) => { if (live) setState({ key, data, error: null }); },
      (e) => { if (live) setState({ key, data: undefined, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [source, status, version, key, enabled]);
  return state.key === key ? { data: state.data, error: state.error } : { data: undefined, error: null };
}

/** A composite read (several queries or counts) that re-runs on data changes. */
export function useRead<T>(key: string, fn: (s: DataSource) => Promise<T>): T | undefined {
  return useAsync(key, fn).data;
}

export function useDoc<T>(collection: string, id: string | null | undefined): T | null | undefined {
  return useAsync(`doc:${collection}/${id}`, (s) => (id ? s.get<T>(collection, id) : Promise.resolve(null))).data;
}

/** "ok", "missing" or "denied" for a record page's empty state (Not found vs no access). */
export function useDocStatus(collection: string, id: string | null | undefined): "ok" | "missing" | "denied" | undefined {
  return useAsync(`status:${collection}/${id}`, (s) => (id ? s.docStatus(collection, id) : Promise.resolve("missing" as const))).data;
}

export function useDocs<T>(collection: string, ids: string[]): (T | null)[] | undefined {
  return useAsync(`docs:${collection}:${ids.join(",")}`, (s) => s.getMany<T>(collection, ids)).data;
}

/** Small bounded collections only (rule 9). */
export function useSmall<T>(collection: string | null): T[] | undefined {
  return useAsync(`small:${collection}`, (s) => (collection ? s.listSmall<T>(collection) : Promise.resolve([])), !!collection).data;
}

export function useCount(collection: string, where: Where[] = []): number | undefined {
  return useAsync(`count:${collection}:${JSON.stringify(where)}`, (s) => s.count(collection, where)).data;
}

export interface Paged<T> {
  items: T[] | undefined;
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  hasPrev: boolean;
  next: () => void;
  prev: () => void;
  setPageSize: (n: 25 | 50) => void;
  error: string | null;
}

/** One page at a time with cursors (spec §3.1 rule 9: 25 to 50 per page). */
export function usePaged<T extends { id: string }>(collection: string, spec: Omit<QuerySpec, "limit" | "after">, initialSize: 25 | 50 = 25, enabled = true): Paged<T> {
  const [pageSize, setSize] = useState<25 | 50>(initialSize);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const specKey = JSON.stringify(spec);
  useEffect(() => setCursors([null]), [specKey, pageSize]);
  const after = cursors[cursors.length - 1] ?? null;
  const { data, error } = useAsync(`page:${collection}:${specKey}:${pageSize}:${after}`, (s) => s.query<T>(collection, { ...spec, limit: pageSize, after }), enabled);
  return {
    items: data?.items, total: data?.total ?? 0, page: cursors.length, pageSize, error,
    hasNext: !!data?.next, hasPrev: cursors.length > 1,
    next: () => { if (data?.next) setCursors((c) => [...c, data.next]); },
    prev: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
    setPageSize: setSize,
  };
}

/** Run a command; returns a function that resolves with the result or throws a CommandError. */
export function useRun() {
  const { source } = useData();
  return useCallback(<N extends CommandName>(name: N, args: CommandArgs<N>, requestId?: string): Promise<CommandResult<N>> => source.run(name, args, requestId), [source]);
}

/**
 * Save without making the person wait (lib/queue.ts `sendInBackground`): returns at once; the top bar shows "Saving",
 * then "Synced", or keeps the change with the reason if the server refused it. `label` is what the person sees in that
 * list ("Expense, 14 Nov, ₹2,400"). `key` makes a later save of the same thing replace an earlier one still waiting.
 */
export function useBackgroundRun() {
  const { source } = useData();
  return useCallback(<N extends CommandName>(name: N, args: CommandArgs<N>, label: string, key?: string): void => {
    sendInBackground((n, a, id) => source.run(n, a, id), name, args, label, key);
  }, [source]);
}

/** The files adapter (photos and documents on records). Null until the app has started. */
export function useFiles(): FilesApi | null {
  const { source, status } = useData();
  return status === "ready" ? source.files ?? null : null;
}

/** Online/offline state for the top bar indicator and the offline strip. */
export function useOnline(): boolean {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
  }, []);
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
