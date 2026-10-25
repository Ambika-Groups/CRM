"use client";
import { BOTTOM_NAV, navFor } from "@ag/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useSession } from "@/data/DataProvider";
import { AppShell } from "./shell/AppShell";
import { Icon } from "./shell/Icon";

/** Phone "More" screen (spec §4A.5): every item the role can open that isn't in the bottom bar. */
export function MorePage() {
  const { t } = useTranslation();
  const session = useSession();
  const inBar = new Set(BOTTOM_NAV.map((b) => b.href));
  const items = session ? navFor(session.role).filter((n) => !inBar.has(n.href)) : [];
  return (
    <AppShell nav="more" title={t("nav.more")} crumbs={[{ label: t("nav.more") }]}>
      <div className="page-head"><div className="heading"><h1>{t("nav.more")}</h1></div></div>
      <ul className="list card" style={{ padding: 0 }}>
        {items.map((n) => (
          <li key={n.key} style={{ padding: 0 }}>
            <Link href={n.href} className="more-row">
              <Icon name={n.icon} />
              <span className="grow">{t(`nav.${n.key}`)}</span>
              <Icon name="chevron-right" />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
