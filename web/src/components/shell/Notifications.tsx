"use client";
import { isFinanceRole, type Where } from "@ag/core";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useRead, useSession } from "@/data/DataProvider";
import { Icon } from "./Icon";

interface Item { key: string; count: number; href: string; icon: string }

/**
 * The bell (spec §4A.5, §14). Until the §14 alerts arrive it lists what is really waiting for this person:
 * entries to approve, rate proposals, their own pending entries. Otherwise a plain "nothing waiting".
 */
export function Notifications() {
  const { t } = useTranslation();
  const session = useSession();
  const router = useRouter();
  const items = useRead(`bell:${session?.uid}:${session?.role}`, async (s): Promise<Item[]> => {
    if (!session) return [];
    const r = session.role;
    const pending: Where = { field: "approvalStatus", op: "==", value: "pending" };
    const out: Item[] = [];
    if (isFinanceRole(r)) {
      out.push({ key: "approveExpenses", count: await s.count("expenses", [pending, { field: "isDeleted", op: "==", value: false }]), href: "/expenses/", icon: "receipt" });
      out.push({ key: "rateProposals", count: await s.count("rate_change_requests", [pending]), href: "/labour/", icon: "users" });
    } else if (r === "pm" && session.projectIds.length) {
      // A PM approves entries on their projects (D-21: pinned to their projects).
      out.push({ key: "approveExpenses", count: await s.count("expenses", [pending, { field: "projectId", op: "in", value: session.projectIds.slice(0, 30) }]), href: "/expenses/", icon: "receipt" });
    } else if (r === "supervisor" && session.projectIds.length) {
      out.push({ key: "myPending", count: await s.count("expenses", [pending, { field: "enteredBy", op: "==", value: session.uid }, { field: "projectId", op: "in", value: session.projectIds.slice(0, 30) }]), href: "/expenses/", icon: "receipt" });
    }
    return out.filter((i) => i.count > 0);
  });
  const total = (items ?? []).reduce((n, i) => n + i.count, 0);
  const label = total ? t("bell.labelCount", { n: total }) : t("top.notifications");

  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button className="icon-btn bell" type="button" aria-label={label} data-bell>
          <Icon name="bell" />
          {total > 0 && <span className="bell-dot" aria-hidden="true">{total > 99 ? "99+" : total}</span>}
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="menu bell-menu" align="end" sideOffset={4} data-bell-panel>
          <DM.Label className="menu-label">{t("top.notifications")}</DM.Label>
          {items === undefined ? <div className="menu-empty">{t("common.loading")}</div>
            : items.length === 0 ? <div className="menu-empty"><Icon name="check-circle" size={18} /><span>{t("bell.none")}</span></div>
            : items.map((i) => (
              <DM.Item key={i.key} className="menu-item" onSelect={() => router.push(i.href)}>
                <span className="menu-check"><Icon name={i.icon} size={16} /></span>{t(`bell.${i.key}`, { n: i.count })}
              </DM.Item>
            ))}
          <DM.Separator className="menu-sep" />
          <div className="menu-note">{t("bell.note")}</div>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
