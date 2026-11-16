"use client";
// The two tabs this feature adds to the expense pages (ExpenseTabs `extra`): Total spendings for everyone who may
// read totals there, Expense heads for the owner (who edits them) and the accountant (who reads them).
import { useTranslation } from "react-i18next";
import { useSession } from "@/data/DataProvider";

export const SPENDINGS_HREF = "/expenses/spendings/";
export const CATEGORIES_HREF = "/expenses/categories/";

export function useSpendingsTabs(): { key: string; href: string; label: string }[] {
  const { t } = useTranslation();
  const role = useSession()?.role;
  const tabs: { key: string; href: string; label: string }[] = [];
  if (role && role !== "supervisor") tabs.push({ key: "spendings", href: SPENDINGS_HREF, label: t("spendings.tabs.spendings") });
  if (role === "owner" || role === "accountant") tabs.push({ key: "categories", href: CATEGORIES_HREF, label: t("spendings.tabs.categories") });
  return tabs;
}
