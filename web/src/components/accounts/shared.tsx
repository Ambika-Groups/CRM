"use client";
// Shared pieces for the Accounts screens: who may see and change them, the page frame, and small helpers.
import { formatDate, isDateStr, isFinanceReader, isFinanceRole, parseInputDate, type Account, type AccountTxn, type Page, type QuerySpec } from "@ag/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { useSession } from "@/data/DataProvider";
import type { DataSource } from "@/data/types";

/**
 * Accounts are for the owner and the accountant; the CA may look and download (D-43). Everyone else is refused
 * (D-42: the viewer sees totals only; site roles never see accounts, spec §3.1 rule 1). The commands check again.
 */
export function useAccountsAccess() {
  const session = useSession();
  return {
    session,
    loading: !session,
    canSee: !session || isFinanceReader(session.role),
    canWrite: !!session && isFinanceRole(session.role),
    isOwner: session?.role === "owner",
  };
}

/** The frame of every Accounts page: menu highlight, breadcrumb, and the refusal for roles that may not open it. */
export function AccountsShell({ title, parent, children, actionBar }: { title: string; parent?: { label: string; href: string }[]; children: ReactNode; actionBar?: boolean }) {
  const { t } = useTranslation();
  const { canSee } = useAccountsAccess();
  const root = t("accounts.title");
  const crumbs = title === root && !parent?.length ? [{ label: root }] : [{ label: root, href: "/accounts/" }, ...(parent ?? []), { label: title }];
  return (
    <AppShell nav="accounts" title={title} crumbs={crumbs} actionBar={actionBar && canSee}>
      {canSee ? children : <NoAccess name={title} />}
    </AppShell>
  );
}

export const useLang = (): "en" | "hi" => (useTranslation().i18n.language === "hi" ? "hi" : "en");

/** A typed date for a sentence: "25 Oct 2026", or the text as typed while it isn't a full date yet (never throws). */
export const showDate = (typed: string, lang: "en" | "hi"): string => {
  const iso = parseInputDate(typed) ?? typed;
  return isDateStr(iso) ? formatDate(iso, lang) : typed;
};

export const balanceOf =(a: Pick<Account, "balancePaise" | "openingBalancePaise">) => a.balancePaise ?? a.openingBalancePaise;

/**
 * Where the record behind an account row opens. Routes owned by other features are kept in this one place, so they
 * can be corrected without touching the book. A missing entry simply shows no link.
 */
export const SOURCE_ROUTES: Record<string, (row: Pick<AccountTxn, "linkedId">) => string> = {
  expenses: (r) => `/expenses/view/?id=${encodeURIComponent(r.linkedId)}`,
  worker_payments: () => "/labour/payments/",
  account_transfers: () => "/accounts/entries/",
  // payments_received: add the receipt page here when Billing has one.
};

export function sourceHref(row: Pick<AccountTxn, "linkedEntity" | "linkedId">): string | null {
  return SOURCE_ROUTES[row.linkedEntity]?.(row) ?? null;
}

/** Read a date-bounded list 50 at a time (spec §3.1 rule 9), and say whether the safety cap cut it short. */
export async function fetchRange<T extends { id: string }>(s: DataSource, collection: string, spec: Omit<QuerySpec, "limit" | "after">, maxPages = 400): Promise<{ items: T[]; cut: boolean }> {
  const items: T[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const pg: Page<T> = await s.query<T>(collection, { ...spec, limit: 50, after });
    items.push(...pg.items);
    if (!pg.next) return { items, cut: false };
    after = pg.next;
  }
  return { items, cut: true };
}

/** Hand a text file to the browser to save. */
export function downloadText(fileName: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
