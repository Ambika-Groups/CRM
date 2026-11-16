"use client";
// Settings > Data and backup (owner only): the backup download with its 7-day reminder, the free plan's usage
// meters, and the way into the activity log.
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { useSession } from "@/data/DataProvider";
import { BackupPanel } from "./BackupPanel";
import { UsagePanel } from "./UsagePanel";

export function AdminToolsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const title = t("admin.tools.title");
  const crumbs = [{ label: t("settings.title"), href: "/settings/" }, { label: title }];
  if (session && session.role !== "owner") return <AppShell nav="settings" title={title} crumbs={crumbs}><NoAccess name={title} /></AppShell>;
  return (
    <AppShell nav="settings" title={title} crumbs={crumbs}>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      <BackupPanel />
      <UsagePanel />
      <section className="card section" data-audit-link>
        <h2 className="card-title">{t("admin.tools.auditTitle")}</h2>
        <p className="muted">{t("admin.tools.auditBody")}</p>
        <div className="form-actions admin-actions"><Link className="btn btn-secondary" href="/settings/audit/">{t("admin.tools.auditLink")}</Link></div>
      </section>
    </AppShell>
  );
}
