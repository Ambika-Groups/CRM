"use client";
import type { Attendance, Expense } from "@ag/core";
import { useTranslation } from "react-i18next";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { useData, useSession } from "@/data/DataProvider";
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
  return (
    <AppShell nav="home" title={t("nav.home")} crumbs={[{ label: t("nav.home") }]}>
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
