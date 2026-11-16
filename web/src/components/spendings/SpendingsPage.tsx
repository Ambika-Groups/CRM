"use client";
// Total Spendings (spec §7.3, §7.4): the total at the top, then the same money three ways: the five summary heads, a
// bar chart of one level that goes deeper when a bar is tapped (with the path back), and the whole tree with amounts
// and shares, ending at the entries. Every figure is added up from the monthly totals (rollups, D-09) with the live
// tree (D-10): no expense records are downloaded here, so the total is the dashboard's figure to the paisa.
import {
  buildSpendings, drillLevel, findNode, formatMonth, formatPermille, headNodes, isFinanceReader, monthSeries, pathTo, seesAllProjects, spendingsCsv,
  spendingsCsvRows, spendingsRollupIds, SUMMARY_HEADS, toInputDate, todayIST,
  type CostRollup, type HeadKey, type Project, type SpendNode, type SpendView,
} from "@ag/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentFy, fyChoices, makePeriod } from "@/components/dashboard/data";
import { ExpenseTabs, useCategoryTree, useLang } from "@/components/expenses/common";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton, useToast } from "@/components/ui/feedback";
import { useDocs, useRead, useSession } from "@/data/DataProvider";
import { money, rupees } from "@/lib/fmt";
import { useSpendingsTabs } from "./tabs";

type Kind = "month" | "fy" | "custom";
const KINDS: readonly Kind[] = ["month", "fy", "custom"];
const VIEWS: readonly SpendView[] = ["all", "paid", "unpaid"];
const HEADS: readonly HeadKey[] = ["all", ...SUMMARY_HEADS];
const VIEW_LABEL = { all: "viewAll", paid: "viewPaid", unpaid: "viewUnpaid" } as const;

/** The last day of a month given as YYYY-MM. */
function endOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function SpendingsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const toast = useToast();
  const tree = useCategoryTree();
  const tabs = useSpendingsTabs();
  const [kind, setKind] = useState<Kind>("fy");
  const [fy, setFy] = useState(currentFy());
  const [custom, setCustom] = useState(() => ({ from: todayIST().slice(0, 7), to: todayIST().slice(0, 7) }));
  const [project, setProject] = useState("");
  const [view, setView] = useState<SpendView>("all");
  const [head, setHead] = useState<HeadKey>("all");
  const [drill, setDrill] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [exported, setExported] = useState<number | null>(null);

  const role = session?.role;
  // Owner, accountant, CA and viewer read the company totals; a project manager reads the totals of assigned projects.
  const company = !!role && seesAllProjects(role);
  const pm = role === "pm";
  const allowed = company || pm;
  const period = useMemo(() => makePeriod(kind, fy, kind === "custom" ? { from: `${custom.from}-01`, to: endOfMonth(custom.to) } : null), [kind, fy, custom]);

  const listed = useRead(`spend-projects:${company}`, (s) => (company
    ? s.query<Project>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 }).then((p) => p.items)
    : Promise.resolve([] as Project[])));
  const myIds = pm && session ? session.projectIds.slice(0, 30) : [];
  const assigned = useDocs<Project>("projects", myIds);
  const projects = company ? listed : assigned?.filter((p): p is Project => !!p);
  const scopeIds = project ? [project] : pm ? myIds : null;
  const ids = allowed ? spendingsRollupIds(scopeIds, period.months) : [];
  const docs = useRead(`spend:${ids.join(",")}`, (s) => (ids.length ? s.getMany<CostRollup>("rollups", ids) : Promise.resolve([] as (CostRollup | null)[])));

  const s = useMemo(() => (tree && docs ? buildSpendings(tree, docs, { view }) : null), [tree, docs, view]);
  // A named summary tab (Labour, Materials…) opens straight into that head when it has heads under it.
  const rootId = s && head !== "all" && head !== "other" && findNode(s, head)?.children.length ? head : null;
  const at = drill ?? rootId;
  const level = useMemo(() => (s ? drillLevel(s, at, head) : null), [s, at, head]);
  const levelId = level?.parent?.id ?? null;
  const series = useMemo(
    () => (tree && docs && period.months.length > 1 ? monthSeries(tree, docs, period.months, { view, head, nodeId: levelId }) : []),
    [tree, docs, period.months, view, head, levelId],
  );

  const title = t("spendings.title");
  const crumbs = role === "viewer" ? [{ label: title }] : [{ label: t("nav.expenses"), href: "/expenses/" }, { label: title }];
  if (session && !allowed) return <AppShell nav="expenses" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;

  const label = (n: Pick<SpendNode, "kind" | "name" | "nameHi">) => {
    const name = lang === "hi" && n.nameHi ? n.nameHi : n.name;
    return n.kind === "own" ? t("spendings.tree.own", { name }) : n.kind === "unlisted" ? t("spendings.tree.unlisted") : name;
  };
  const pct = (permille: number, amountPaise: number) => (permille === 0 && amountPaise > 0 ? t("spendings.tree.tiny") : formatPermille(permille));
  const headName = (h: HeadKey) => t(`spendings.heads.${h}`);

  const pickHead = (h: HeadKey) => {
    setHead(h);
    setDrill(null);
    setOpen(h === "all" || h === "other" ? new Set() : new Set([h]));
  };
  const goTo = (id: string | null) => {
    setDrill(id);
    if (id && s) setOpen((o) => new Set([...o, ...pathTo(s, id).map((n) => n.id)]));
  };
  const toggle = (n: SpendNode) => {
    const wasOpen = open.has(n.id);
    setOpen((o) => { const next = new Set(o); if (wasOpen) next.delete(n.id); else next.add(n.id); return next; });
    if (!s) return;
    const trail = pathTo(s, n.id);
    setDrill(wasOpen ? trail[trail.length - 2]?.id ?? null : n.id);
  };

  // Entries are for the roles that may read them (not the viewer, who reads totals only).
  const canSeeEntries = !!role && (isFinanceReader(role) || pm);
  const entriesHref = (categoryId: string) => {
    const q = new URLSearchParams({ "f.category": categoryId, "f.status": "approved" });
    if (project) q.set("f.project", project);
    if (view !== "all") q.set("f.paid", view);
    q.set("f.from", toInputDate(period.from));
    q.set("f.to", toInputDate(period.to));
    return `/expenses/?${q.toString()}`;
  };

  const download = () => {
    if (!s) return;
    const rows = spendingsCsvRows(s, { nodeId: levelId, head, lang, ownLabel: (name) => t("spendings.tree.own", { name }) });
    const csv = spendingsCsv(rows, {
      level1: t("spendings.csv.level1"), level2: t("spendings.csv.level2"), level3: t("spendings.csv.level3"), level4: t("spendings.csv.level4"),
      amount: t("spendings.csv.amount"), gst: t("spendings.csv.gst"), entries: t("spendings.csv.entries"), percent: t("spendings.csv.percent"),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "total-spendings.csv";
    a.click();
    URL.revokeObjectURL(url);
    setExported(rows.length);
    toast(t("spendings.csv.done", { n: rows.length }));
  };

  const months = period.months;
  const periodLabel = months.length === 1 ? formatMonth(months[0]!, lang) : t("spendings.total.range", { from: formatMonth(months[0]!, lang), to: formatMonth(months[months.length - 1]!, lang) });
  const scopeName = project ? projects?.find((p) => p.id === project)?.name ?? "" : company ? t("spendings.filters.allProjects") : t("spendings.filters.myProjects");
  const maxMonth = series.reduce((m, p) => Math.max(m, p.amountPaise), 0);

  const renderNodes = (list: SpendNode[]) => (
    <ul>
      {list.map((n) => {
        const kids = n.children.length > 0, isOpen = open.has(n.id), name = label(n);
        return (
          <li key={n.id} data-spend-node={n.id} data-level={n.level} data-kind={n.kind} data-paise={n.amountPaise} data-permille={n.permille}>
            <div className="sp-row" data-current={at === n.id ? "true" : undefined}>
              <div className="sp-row-name">
                {kids ? (
                  <button type="button" className="sp-toggle" aria-expanded={isOpen} onClick={() => toggle(n)}>
                    <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={16} /><span>{name}</span>
                  </button>
                ) : <span className="sp-leaf">{name}</span>}
                {!n.active && <span className="badge neutral">{t("spendings.tree.archived")}</span>}
                {!kids && n.kind === "category" && canSeeEntries && (
                  <Link className="sp-entries" href={entriesHref(n.id)} data-entries={n.id}>{t("spendings.tree.entries")}<span className="sr-only">: {name}</span></Link>
                )}
              </div>
              <span className="sp-amt">{money(n.amountPaise)}</span>
              <span className="sp-pct">{pct(n.permille, n.amountPaise)}</span>
            </div>
            {kids && isOpen ? renderNodes(n.children) : null}
          </li>
        );
      })}
    </ul>
  );

  const trail = level ? [
    { id: null as string | null, name: head === "all" ? t("spendings.chart.top") : headName(head) },
    ...level.path.filter((n) => n.id !== rootId).map((n) => ({ id: n.id as string | null, name: label(n) })),
  ] : [];
  const levelName = trail[trail.length - 1]?.name ?? "";

  return (
    <AppShell nav="expenses" title={title} crumbs={crumbs}>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1></div>
        <div className="page-actions">
          <Button onClick={download} disabled={!s || !level?.items.length} data-spend-csv data-exported={exported ?? undefined}><Icon name="download" />{t("spendings.csv.download")}</Button>
        </div>
      </div>
      {role !== "viewer" && <ExpenseTabs current="spendings" extra={tabs} />}

      <div className="period-bar sp-filters" role="group" aria-label={t("spendings.filters.label")} data-spend-filters>
        <div className="segmented" role="group" aria-label={t("spendings.filters.period")}>
          {KINDS.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} data-period={k}>{t(`spendings.filters.${k}`)}</button>)}
        </div>
        {kind === "fy" && (
          <label className="filter-inline"><span>{t("spendings.filters.fyLabel")}</span>
            <select className="input" value={fy} onChange={(e) => setFy(e.target.value)} data-filter="fy">{fyChoices().map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        )}
        {kind === "custom" && (
          <span className="period-custom">
            <label className="filter-inline"><span>{t("spendings.filters.from")}</span>
              <input className="input" type="month" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} data-filter="from" /></label>
            <label className="filter-inline"><span>{t("spendings.filters.to")}</span>
              <input className="input" type="month" value={custom.to} min={custom.from} max={todayIST().slice(0, 7)} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} data-filter="to" /></label>
          </span>
        )}
        <label className="filter-inline"><span>{t("spendings.filters.project")}</span>
          <select className="input" value={project} onChange={(e) => setProject(e.target.value)} data-filter="project">
            <option value="">{company ? t("spendings.filters.allProjects") : t("spendings.filters.myProjects")}</option>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="filter-inline"><span>{t("spendings.filters.view")}</span>
          <select className="input" value={view} onChange={(e) => setView(e.target.value as SpendView)} data-filter="view">
            {VIEWS.map((v) => <option key={v} value={v}>{t(`spendings.filters.${VIEW_LABEL[v]}`)}</option>)}
          </select></label>
      </div>

      {!session || !tree || !docs || !s || !level ? <Skeleton lines={8} /> : pm && myIds.length === 0 ? (
        <EmptyState icon="info" title={t("spendings.empty.noProject")} body={t("spendings.empty.noProjectBody")} />
      ) : (
        <>
          <section className="kpi sp-total" aria-labelledby="sp-total-label" data-spend-total data-paise={s.totalPaise} data-rupees={rupees(s.totalPaise)}
            data-view={view} data-scope={project ? "project" : company ? "company" : "projects"}>
            <div className="label" id="sp-total-label">{t(`spendings.total.${view}`)}</div>
            <div className="value">{money(s.totalPaise)}</div>
            <div className="trend">{scopeName} · {periodLabel}</div>
            {view === "all" && <div className="trend">{t("spendings.total.entries", { n: s.count })} · {t("spendings.total.gst", { amount: money(s.gstPaise) })}</div>}
            <p className="hint small"><Icon name="info" size={16} /><span>{t("spendings.total.note")}</span></p>
          </section>
          {!s.balanced && <div className="banner warning" role="status" data-spend-mismatch><Icon name="alert" /><span className="text">{t("spendings.total.mismatch")}</span></div>}

          {s.nodes.length === 0 ? (
            <EmptyState icon="receipt" title={t("spendings.empty.title")} body={t("spendings.empty.body")} />
          ) : (
            <>
              <div className="sp-heads" role="group" aria-label={t("spendings.heads.label")} data-spend-heads>
                {HEADS.map((h) => {
                  const total = h === "all" ? { amountPaise: s.totalPaise, permille: s.nodes.reduce((p, n) => p + n.permille, 0) } : s.heads.find((x) => x.head === h)!;
                  return (
                    <button key={h} type="button" aria-pressed={head === h} onClick={() => pickHead(h)} data-head={h} data-paise={total.amountPaise}>
                      <span className="sp-head-name">{headName(h)}</span>
                      <span className="sp-head-amt">{money(total.amountPaise)}</span>
                      <span className="sp-head-pct">{pct(total.permille, total.amountPaise)}</span>
                    </button>
                  );
                })}
              </div>

              <div className="sp-grid">
                <section className="card" aria-labelledby="sp-chart-title" data-spend-chart data-level={levelId ?? ""} data-paise={level.totalPaise}>
                  <h2 className="card-title" id="sp-chart-title">{t("spendings.chart.title")}</h2>
                  <nav className="sp-path" aria-label={t("spendings.chart.path")} data-spend-path>
                    {trail.map((c, i) => (
                      <span key={c.id ?? "top"}>
                        {i > 0 && <span aria-hidden="true"> › </span>}
                        <button type="button" className="link-btn" onClick={() => setDrill(c.id)} aria-current={i === trail.length - 1 ? "page" : undefined} data-crumb={c.id ?? "top"}>{c.name}</button>
                      </span>
                    ))}
                  </nav>
                  {level.items.length === 0 ? <p className="muted">{t("spendings.chart.none")}</p> : (
                    <ol className="sp-bars" data-spend-bars>
                      {level.items.map((i) => {
                        const name = label(i);
                        const share = formatPermille(i.sharePermille);
                        const body = (
                          <>
                            <span className="sp-bar-name">{name}</span>
                            <span className="sp-bar-amt">{money(i.amountPaise)}</span>
                            <span className="sp-bar-pct">{share}</span>
                            <span className="sp-bar-track" aria-hidden="true"><span style={{ width: `${i.barPct}%` }} /></span>
                          </>
                        );
                        const tip = `${name}: ${money(i.amountPaise)}, ${t("spendings.chart.share", { pct: share, name: levelName })}`;
                        return (
                          <li key={i.id} data-bar={i.id} data-paise={i.amountPaise} data-drillable={i.drillable}>
                            {i.drillable
                              ? <button type="button" className="sp-bar" title={tip} onClick={() => goTo(i.id)}>{body}<span className="sr-only">. {t("spendings.chart.open")}</span></button>
                              : <div className="sp-bar" title={tip}>{body}</div>}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {level.items.some((i) => i.drillable) && <p className="hint small"><Icon name="info" size={16} /><span>{t("spendings.chart.hint")}</span></p>}

                  {series.length > 1 && (
                    <>
                      <h3 className="sp-h3">{levelId || head !== "all" ? t("spendings.chart.monthsOf", { name: levelName }) : t("spendings.chart.months")}</h3>
                      <ol className="sp-bars sp-months" data-spend-months>
                        {series.map((p) => (
                          <li key={p.month} data-month={p.month} data-paise={p.amountPaise}>
                            <div className="sp-bar" title={`${formatMonth(p.month, lang)}: ${money(p.amountPaise)}`}>
                              <span className="sp-bar-name">{formatMonth(p.month, lang)}</span>
                              <span className="sp-bar-amt">{money(p.amountPaise)}</span>
                              <span className="sp-bar-track" aria-hidden="true"><span style={{ width: `${maxMonth > 0 ? Math.round((p.amountPaise * 100) / maxMonth) : 0}%` }} /></span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </section>

                <section className="card" aria-labelledby="sp-tree-title" data-spend-tree>
                  <h2 className="card-title" id="sp-tree-title">{t("spendings.tree.title")}</h2>
                  <div className="sp-tree">
                    <div className="sp-row sp-row-head" aria-hidden="true"><span /><span className="sp-amt">{t("spendings.tree.amount")}</span><span className="sp-pct">{t("spendings.tree.percent")}</span></div>
                    {renderNodes(headNodes(s, head))}
                  </div>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
