"use client";
import type { Attendance, Expense } from "@ag/core";
import { useTranslation } from "react-i18next";
import { Dashboard } from "@/components/dashboard/Dashboard";
import Link from "next/link";
import { useData, useRead, useSession } from "@/data/DataProvider";
import { Icon } from "./shell/Icon";
import type { DemoSource } from "@/data/demo/demoSource";
import { AppShell } from "./shell/AppShell";

/**
 * Home: the role's dashboard (spec §11.1, §11.1a). In the demo, a folded panel below shows what the sample
 * data contains, counted from the dataset itself (§17).
 */
export function HomePage() {
  const { t } = useTranslation();
  const { source } = useData();
  const session = useSession();
  const demo = source.mode === "demo" ? (source as DemoSource) : null;
  const finance = session?.role === "owner" || session?.role === "accountant";
  // A real, empty project: say so, and say what to do first. Sample data is for a super user to load on purpose.
  const counts = useRead(`home-empty:${session?.uid}`, async (s) => (finance ? { projects: await s.count("projects"), clients: await s.count("clients"), workers: await s.count("workers") } : null));
  const empty = !!counts && counts.projects + counts.clients + counts.workers === 0;
  const sample = useRead(`home-sample:${session?.uid}`, async (s) => (s.sample && session?.superUser ? s.sample.status().catch(() => null) : null));
  return (
    <AppShell nav="home" title={t("nav.home")} crumbs={[{ label: t("nav.home") }]}>
      {empty && !demo && (
        <section className="card empty-welcome" data-empty-welcome aria-labelledby="ew-title">
          <h2 id="ew-title" className="card-title">{t("home.welcomeTitle")}</h2>
          <p>{t("home.welcomeBody")}</p>
          <ol className="empty-steps">
            <li><Link href="/clients/edit/">{t("home.stepClient")}</Link></li>
            <li><Link href="/projects/new/">{t("home.stepProject")}</Link></li>
            <li><Link href="/labour/workers/edit/">{t("home.stepWorker")}</Link></li>
          </ol>
          {session?.superUser && <p className="small muted">{t("home.sampleHint")} <Link href="/settings/setup/#sample-data" data-sample-link>{t("home.sampleLink")}</Link></p>}
        </section>
      )}
      {sample?.loaded && (
        <div className="banner info" role="note" data-sample-banner><Icon name="info" /><span className="text">{t("home.sampleLoaded")} <Link href="/settings/setup/#sample-data">{t("home.sampleRemove")}</Link></span></div>
      )}
      {session && <Dashboard />}
      {demo && session && (session.role === "owner" || session.role === "accountant") && (
        <details className="card section demo-data" data-demo-data>
          <summary><b>{t("home.dataCheck")}</b></summary>
          <p className="muted" style={{ margin: "var(--space-3) 0" }}>{t("home.dataCheckBody")}</p>
          <div className="stat-grid">
            <div><b>{demo.rawCount("projects")}</b><span>{t("home.projects")}</span></div>
            <div><b>{demo.rawCount("workers")}</b><span>{t("home.workers")}</span></div>
            <div><b>{demo.rawDistinct<Attendance>("attendance", (a) => a.date)}</b><span>{t("home.attendanceDays")}</span></div>
            <div><b>{demo.rawCount<Expense>("expenses", (e) => e.source === "manual")}</b><span>{t("home.expenses")}</span></div>
            <div><b>{demo.rawCount("invoices")}</b><span>{t("home.invoices")}</span></div>
          </div>
        </details>
      )}
    </AppShell>
  );
}
