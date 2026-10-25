"use client";
import { navFor, ROLE_LABELS, type NavKey } from "@ag/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useSession } from "@/data/DataProvider";
import { AppShell } from "./shell/AppShell";
import { Icon } from "./shell/Icon";

/** A module that isn't built yet, in plain words (no section or milestone numbers on screen). Role access is enforced here too. */
export function ModulePage({ navKey, sub }: { navKey: NavKey; sub?: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const name = sub ?? t(`nav.${navKey}`);
  const allowed = !session || navFor(session.role).some((n) => n.key === navKey);
  return (
    <AppShell nav={navKey} title={name} crumbs={[{ label: name }]}>
      <div className="page-head"><div className="heading"><h1>{name}</h1></div></div>
      {allowed ? <ComingSoon name={name} /> : <NoAccess name={name} heading={false} />}
    </AppShell>
  );
}

export function ComingSoon({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <Icon name="clock" size={24} />
      <b>{t("module.notYet")}</b>
      <p>{t("module.notYetBody", { name })}</p>
      <Link className="btn btn-secondary" href="/">{t("module.backHome")}</Link>
    </div>
  );
}

/** A record that doesn't exist, or was deleted (never shown as "no access"). */
export function NotFoundRecord({ name, back, backLabel }: { name: string; back: string; backLabel: string }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="page-head"><div className="heading"><h1>{name}</h1></div></div>
      <div className="empty" role="status" data-not-found-record>
        <Icon name="search" size={24} />
        <b>{t("module.notFound")}</b>
        <p>{t("module.notFoundBody")}</p>
        <Link className="btn btn-secondary" href={back}>{backLabel}</Link>
      </div>
    </>
  );
}

export function NoAccess({ name, heading = true }: { name: string; heading?: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  return (
    <>
      {heading && <div className="page-head"><div className="heading"><h1>{name}</h1></div></div>}
      <div className="empty" role="alert" data-no-access>
        <Icon name="lock" size={24} />
        <b>{t("module.noAccess")}</b>
        <p>{t("module.noAccessBody", { role: session ? ROLE_LABELS[session.role][i18n.language === "hi" ? "hi" : "en"] : "", name })}</p>
        <Link className="btn btn-secondary" href="/">{t("module.backHome")}</Link>
      </div>
    </>
  );
}
