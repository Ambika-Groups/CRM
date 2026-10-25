"use client";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";

/** Branded "page not found" in English and Hindi, inside the app shell (QA F13). Built as 404.html. */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <AppShell nav="home" title={t("notFound.title")} crumbs={[{ label: t("notFound.title") }]}>
      <div className="page-head"><div className="heading"><h1>{t("notFound.title")}</h1></div></div>
      <div className="empty" data-not-found>
        <Icon name="search" size={24} />
        <p>{t("notFound.body")}</p>
        <Link className="btn btn-primary" href="/">{t("notFound.home")}</Link>
      </div>
    </AppShell>
  );
}
