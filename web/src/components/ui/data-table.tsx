"use client";
// The core list component (spec §4A.8 "Tables (core component)", §4 "search, filter, sort and pagination on
// every list; export to Excel/CSV"): sticky header, prefix search on searchKeywords (§3.1 rule 10),
// filters, sorting, server-side cursor pagination at 25 or 50 (rule 9), column visibility, a row-action
// menu, CSV export of everything matching (paged 50 at a time), and cards on phones.
import { runQuery, searchTerm, toCsv, type QuerySpec, type Where } from "@ag/core";
import * as DM from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { useData, usePaged, useRead, type Paged } from "@/data/DataProvider";
import type { DataSource } from "@/data/types";
import { Button } from "./button";
import { EmptyState, Skeleton, useToast } from "./feedback";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T, extra: Record<string, unknown>) => ReactNode;
  /** CSV value; defaults to the cell's text when it is a string or number. */
  csv?: (row: T, extra: Record<string, unknown>) => string | number | null | undefined;
  sortField?: string;
  align?: "right";
  /** Shown as the card title on phones. */
  cardHead?: boolean;
  defaultHidden?: boolean;
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** Builds the where clause(s) for a chosen value. */
  where: (value: string) => Where | Where[];
}

export interface RowAction<T> {
  label: string;
  onSelect: (row: T) => void;
  destructive?: boolean;
  hidden?: (row: T) => boolean;
}

interface Props<T extends { id: string }> {
  id: string;
  collection: string;
  columns: Column<T>[];
  /** Always-applied clauses (role scoping, archive state). */
  baseWhere?: Where[];
  filters?: FilterDef[];
  defaultSort: { field: string; dir: "asc" | "desc" };
  searchable?: boolean;
  rowHref?: (row: T) => string;
  rowActions?: RowAction<T>[];
  exportName: string;
  empty: { title: string; body?: string; action?: ReactNode };
  caption: string;
  /**
   * A bounded set already in memory (for example the rosters of a PM's sites, which are small collections).
   * Search, filters, sort, paging and export then run locally through the same runQuery as the demo store.
   */
  rows?: T[];
  /** Extra per-row data for the visible page only (e.g. rollups), keyed by row id. Never the whole collection. */
  extra?: (s: DataSource, rows: T[]) => Promise<Record<string, Record<string, unknown>>>;
}

function useStoredColumns(id: string, cols: { key: string; defaultHidden?: boolean }[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(cols.filter((c) => c.defaultHidden).map((c) => c.key)));
  useEffect(() => {
    try {
      const v = localStorage.getItem(`ag-cols-${id}`);
      if (v) setHidden(new Set(JSON.parse(v) as string[]));
    } catch { /* ignore */ }
  }, [id]);
  const toggle = (k: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem(`ag-cols-${id}`, JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });
  return { hidden, toggle };
}

/** Paging over an in-memory bounded set, with the same cursor behaviour as usePaged. */
function useLocalPaged<T extends { id: string }>(rows: T[] | undefined, spec: Omit<QuerySpec, "limit" | "after">): Paged<T> {
  const [pageSize, setSize] = useState<25 | 50>(25);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const specKey = JSON.stringify(spec);
  useEffect(() => setCursors([null]), [specKey, pageSize, rows]);
  const after = cursors[cursors.length - 1] ?? null;
  const data = useMemo(() => (rows ? runQuery(rows, { ...spec, limit: pageSize, after }) : undefined), [rows, specKey, pageSize, after]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    items: data?.items, total: data?.total ?? 0, page: cursors.length, pageSize, error: null,
    hasNext: !!data?.next, hasPrev: cursors.length > 1,
    next: () => { if (data?.next) setCursors((c) => [...c, data.next]); },
    prev: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
    setPageSize: setSize,
  };
}

export function DataTable<T extends { id: string }>(p: Props<T>) {
  const { t } = useTranslation();
  const { source } = useData();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  // Filters can arrive in the URL as ?f.<key>=<value>, so a dashboard figure opens its records already filtered.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const init: Record<string, string> = {};
    for (const f of p.filters ?? []) { const v = q.get(`f.${f.key}`); if (v && f.options.some((o) => o.value === v)) init[f.key] = v; }
    if (Object.keys(init).length) setFilterValues(init);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [sort, setSort] = useState(p.defaultSort);
  const [exporting, setExporting] = useState(false);
  const { hidden, toggle } = useStoredColumns(p.id, p.columns);
  const term = searchTerm(search);

  const spec: Omit<QuerySpec, "limit" | "after"> = useMemo(() => {
    const where: Where[] = [...(p.baseWhere ?? [])];
    for (const f of p.filters ?? []) if (filterValues[f.key]) { const w = f.where(filterValues[f.key]!); where.push(...(Array.isArray(w) ? w : [w])); }
    if (term) where.push({ field: "searchKeywords", op: "array-contains", value: term });
    return { where, orderBy: [{ field: sort.field, dir: sort.dir }] };
  }, [p.baseWhere, p.filters, filterValues, term, sort]);

  const local = !!p.rows || p.collection === "";
  const remote = usePaged<T>(p.collection, spec, 25, !local);
  const localPage = useLocalPaged<T>(p.rows, spec);
  const page = local ? localPage : remote;
  const visible = p.columns.filter((c) => !hidden.has(c.key));
  const ids = (page.items ?? []).map((r) => r.id).join(",");
  const extraMap = useRead(`extra:${p.id}:${ids}`, (s) => (p.extra && page.items?.length ? p.extra(s, page.items) : Promise.resolve({} as Record<string, Record<string, unknown>>))) ?? {};
  const ex = (r: T) => extraMap[r.id] ?? {};

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: T[] = [];
      const extras: Record<string, Record<string, unknown>> = {};
      let after: string | null = null;
      do {
        const pg: { items: T[]; next: string | null } = local ? runQuery(p.rows ?? [], { ...spec, limit: 50, after }) : await source.query<T>(p.collection, { ...spec, limit: 50, after });
        rows.push(...pg.items);
        if (p.extra && pg.items.length) Object.assign(extras, await p.extra(source, pg.items));
        after = pg.next;
      } while (after);
      const csv = toCsv(visible.map((c) => ({
        header: c.header,
        value: (r: T) => (c.csv ? c.csv(r, extras[r.id] ?? {}) : (() => { const v = c.cell(r, extras[r.id] ?? {}); return typeof v === "string" || typeof v === "number" ? v : ""; })()),
      })), rows);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${p.exportName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t("table.exported", { n: rows.length }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setExporting(false);
    }
  };

  const sortBy = (field: string) => setSort((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }));
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + (page.items?.length ?? 0) - 1;

  return (
    <section className="table-block" aria-label={p.caption}>
      <div className="table-tools">
        {p.searchable !== false && (
          <label className="table-search">
            <Icon name="search" />
            <span className="sr-only">{t("table.search")}</span>
            <input className="input" type="search" value={search} placeholder={t("table.searchHint")} onChange={(e) => setSearch(e.target.value)} />
          </label>
        )}
        {(p.filters ?? []).map((f) => (
          <label key={f.key} className="table-filter">
            <span className="sr-only">{f.label}</span>
            <select className="input" value={filterValues[f.key] ?? ""} onChange={(e) => setFilterValues((v) => ({ ...v, [f.key]: e.target.value }))}>
              <option value="">{f.label}: {t("table.all")}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        <span className="table-tools-end">
          <DM.Root>
            <DM.Trigger asChild><Button size="sm"><Icon name="settings" />{t("table.columns")}</Button></DM.Trigger>
            <DM.Portal>
              <DM.Content className="menu" align="end" sideOffset={4}>
                <DM.Label className="menu-label">{t("table.showColumns")}</DM.Label>
                {p.columns.map((c) => (
                  <DM.CheckboxItem key={c.key} className="menu-item" checked={!hidden.has(c.key)} onCheckedChange={() => toggle(c.key)}
                    onSelect={(e) => e.preventDefault()} disabled={c.cardHead}>
                    <DM.ItemIndicator className="menu-check"><Icon name="check" size={16} /></DM.ItemIndicator>
                    {c.header}
                  </DM.CheckboxItem>
                ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <Button size="sm" onClick={exportCsv} disabled={exporting}><Icon name="download" />{exporting ? t("table.exporting") : t("table.export")}</Button>
        </span>
      </div>

      {page.error ? (
        <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{page.error}</span></div>
      ) : page.items === undefined ? (
        <Skeleton lines={5} />
      ) : page.items.length === 0 ? (
        <EmptyState icon="info" title={term || Object.values(filterValues).some(Boolean) ? t("table.noMatch") : p.empty.title}
          body={term || Object.values(filterValues).some(Boolean) ? t("table.noMatchBody") : p.empty.body}
          action={term || Object.values(filterValues).some(Boolean) ? undefined : p.empty.action} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <caption className="sr-only">{p.caption}</caption>
              <thead>
                <tr>
                  {visible.map((c) => (
                    <th key={c.key} scope="col" className={c.align === "right" ? "num" : undefined}
                      aria-sort={c.sortField && sort.field === c.sortField ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                      {c.sortField ? (
                        <button type="button" className="th-sort" onClick={() => sortBy(c.sortField!)}>
                          {c.header}
                          <Icon name={sort.field === c.sortField ? (sort.dir === "asc" ? "chevron-up" : "chevron-down") : "chevrons-up-down"} size={14} />
                        </button>
                      ) : c.header}
                    </th>
                  ))}
                  {p.rowActions?.length ? <th scope="col"><span className="sr-only">{t("table.actions")}</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => (
                  <tr key={row.id}>
                    {visible.map((c) => (
                      <td key={c.key} data-label={c.header} className={[c.align === "right" ? "num" : "", c.cardHead ? "card-head" : ""].join(" ").trim() || undefined}>
                        {c.cardHead && p.rowHref ? <Link href={p.rowHref(row)} className="row-link">{c.cell(row, ex(row))}</Link> : c.cell(row, ex(row))}
                      </td>
                    ))}
                    {p.rowActions?.length ? (
                      <td data-label={t("table.actions")} className="row-actions">
                        <DM.Root>
                          <DM.Trigger asChild>
                            <button type="button" className="icon-btn" aria-label={t("table.actionsFor", { name: String((row as Record<string, unknown>).name ?? row.id) })}>
                              <Icon name="more-v" />
                            </button>
                          </DM.Trigger>
                          <DM.Portal>
                            <DM.Content className="menu" align="end" sideOffset={4}>
                              {p.rowActions.filter((a) => !a.hidden?.(row)).map((a) => (
                                <DM.Item key={a.label} className={`menu-item${a.destructive ? " destructive" : ""}`} onSelect={() => a.onSelect(row)}>{a.label}</DM.Item>
                              ))}
                            </DM.Content>
                          </DM.Portal>
                        </DM.Root>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label={t("table.pages")}>
            <span className="muted small">{t("table.showing", { first, last, total: page.total })}</span>
            <label className="pager-size">
              <span>{t("table.perPage")}</span>
              <select className="input" value={page.pageSize} onChange={(e) => page.setPageSize(Number(e.target.value) as 25 | 50)}>
                <option value={25}>25</option><option value={50}>50</option>
              </select>
            </label>
            <Button size="sm" onClick={page.prev} disabled={!page.hasPrev}>{t("table.previous")}</Button>
            <Button size="sm" onClick={page.next} disabled={!page.hasNext}>{t("table.next")}</Button>
          </nav>
        </>
      )}
    </section>
  );
}
