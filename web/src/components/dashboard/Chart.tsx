"use client";
import { toCsv } from "@ag/core";
import type * as EC from "echarts/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { MiniWrap } from "@/components/ui/feedback";
import { THEME_EVENT } from "@/lib/theme";

// Only what the dashboard draws is bundled (R3-3: tree-shaken ECharts), and it loads after the first paint.
let loading: Promise<typeof EC> | null = null;
function loadECharts(): Promise<typeof EC> {
  loading ??= Promise.all([import("echarts/core"), import("echarts/charts"), import("echarts/components"), import("echarts/renderers")]).then(([core, charts, comps, renderers]) => {
    core.use([charts.BarChart, charts.LineChart, charts.PieChart, comps.GridComponent, comps.TooltipComponent, comps.LegendComponent, comps.AriaComponent, renderers.SVGRenderer]);
    return core;
  });
  return loading;
}

/** Chart colours and text from the theme tokens (design-tokens §4), read at draw time so dark and light both work. */
export function chartTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return {
    series: [v("--chart-1"), v("--chart-2"), v("--chart-3"), v("--chart-4"), v("--chart-5")],
    outline: v("--chart-outline") || "transparent",
    grid: v("--chart-grid"), axis: v("--chart-axis"), text: v("--color-text"), surface: v("--color-surface"),
    good: v("--color-success"), bad: v("--color-error"), warn: v("--color-warning"),
    font: v("--font-sans") || "Inter, sans-serif",
  };
}
export type ChartTheme = ReturnType<typeof chartTheme>;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * An ECharts chart (SVG) that redraws on theme change and resize. Animates once on first draw (600 ms),
 * never under reduced motion (brand.md v4.1). `onSelect` receives the clicked item's name or data id.
 */
export function EChart({ option, height = 260, label, onSelect }: { option: (t: ChartTheme) => EC.EChartsCoreOption; height?: number; label: string; onSelect?: (p: { name: string; id?: string; dataIndex: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EC.ECharts | null>(null);
  const [lib, setLib] = useState<typeof EC | null>(null);
  useEffect(() => { let live = true; void loadECharts().then((m) => { if (live) setLib(m); }); return () => { live = false; }; }, []);
  const first = useRef(true);
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const on = () => setThemeTick((x) => x + 1);
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  useEffect(() => {
    if (!ref.current || !lib) return;
    chart.current ??= lib.init(ref.current, undefined, { renderer: "svg" });
    const t = chartTheme();
    const animate = first.current && !reducedMotion();
    first.current = false;
    chart.current.setOption({
      animation: animate, animationDuration: 600, animationEasing: "cubicOut",
      aria: { enabled: true, label: { description: label } },
      textStyle: { fontFamily: t.font, color: t.text },
      color: t.series,
      tooltip: { trigger: "item", backgroundColor: t.surface, borderColor: t.grid, textStyle: { color: t.text, fontFamily: t.font } },
      ...option(t),
    }, true);
    chart.current.off("click");
    if (onSelect) chart.current.on("click", (p) => onSelect({ name: String(p.name), id: (p.data as { id?: string } | undefined)?.id, dataIndex: p.dataIndex }));
  }, [option, label, onSelect, themeTick, lib]);
  useEffect(() => {
    const ro = new ResizeObserver(() => chart.current?.resize());
    if (ref.current) ro.observe(ref.current);
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  return <div ref={ref} className="echart" style={{ height }} role="img" aria-label={label} />;
}

// The KPI gate: the dashboard opens it when its KPI figures have arrived (2.5 s at most), and closes it when it
// mounts again. Cards wait for it, so on a slow phone the KPIs never share the line with the charts' reads.
let kpisReady = false;
const KPI_EVENT = "ag-kpis-ready";
export function resetKpiGate() { kpisReady = false; }
export function openKpiGate() { if (!kpisReady) { kpisReady = true; window.dispatchEvent(new Event(KPI_EVENT)); } }
function useKpiGate() {
  const [open, setOpen] = useState(kpisReady);
  useEffect(() => {
    if (open) return;
    if (kpisReady) { setOpen(true); return; }
    const on = () => setOpen(true);
    window.addEventListener(KPI_EVENT, on);
    const timer = setTimeout(openKpiGate, 2500);
    return () => { window.removeEventListener(KPI_EVENT, on); clearTimeout(timer); };
  }, [open]);
  return open;
}

/**
 * Mounts its card after the KPIs, and only when it comes within 300 px of the view, so the charts' reads and the
 * ECharts code wait until they are needed (§11.1: KPIs first, dashboard under 3 s). Until then a quiet placeholder
 * holds the space. `eager` cards (above the fold) wait only for the KPIs.
 */
export function Later({ children, eager = false, placeholder = "card dash-card lazy-card" }: { children: ReactNode; eager?: boolean; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const gate = useKpiGate();
  const [near, setNear] = useState(eager);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: "300px 0px" });
    io.observe(el);
    // A KPI that links to a chart (#chart-expense) mounts every card, then scrolls to the one it names.
    const onHash = () => { if (location.hash.startsWith("#chart-")) { openKpiGate(); setNear(true); setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }), 50); } };
    window.addEventListener("hashchange", onHash);
    return () => { io.disconnect(); window.removeEventListener("hashchange", onHash); };
  }, [near]);
  return gate && near ? <>{children}</> : <div ref={ref} className={placeholder} data-lazy-pending="" aria-hidden="true" />;
}

export interface TableColumn<R> { header: string; value: (r: R) => string | number; num?: boolean }

/**
 * A dashboard chart card: title, optional controls, the chart, and "Show as table" with the same numbers
 * (design-tokens §4: colour is never the only cue) plus a CSV download of them.
 */
export function ChartCard<R>({ title, id, children, rows, columns, controls, exportName, empty }: {
  title: string; id: string; children: ReactNode; rows: R[]; columns: TableColumn<R>[]; controls?: ReactNode; exportName: string; empty?: ReactNode;
}) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  const download = () => {
    const csv = toCsv(columns.map((c) => ({ header: c.header, value: (r: R) => c.value(r) })), rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${exportName}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="card dash-card" aria-labelledby={`${id}-title`} id={id} data-chart={id}>
      <div className="dash-card-head">
        <h2 className="card-title" id={`${id}-title`}>{title}</h2>
        <div className="dash-card-tools">
          {controls}
          {rows.length > 0 && <>
            <Button size="sm" variant="secondary" aria-pressed={asTable} onClick={() => setAsTable((x) => !x)} data-as-table>
              <Icon name={asTable ? "bar-chart" : "file-text"} size={16} />{asTable ? t("dash.showChart") : t("dash.showTable")}
            </Button>
            <Button size="sm" variant="secondary" onClick={download} aria-label={`${t("table.export")}: ${title}`}><Icon name="download" size={16} /></Button>
          </>}
        </div>
      </div>
      {rows.length === 0 ? (empty ?? <p className="muted">{t("dash.noData")}</p>) : asTable ? (
        <MiniWrap label={title}><table className="mini-table">
          <caption className="sr-only">{title}</caption>
          <thead><tr>{columns.map((c) => <th key={c.header} className={c.num ? "num" : ""}>{c.header}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.header} className={c.num ? "num" : ""}>{c.value(r)}</td>)}</tr>)}</tbody>
        </table></MiniWrap>
      ) : children}
    </section>
  );
}
