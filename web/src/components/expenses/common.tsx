"use client";
// Pieces shared by the expense screens (spec §7.2): the limits from Settings, the category tree and its cascading
// picker, project lists by role, status badges and the tabs across the expense pages.
import {
  CategoryTree, expenseLimits, isFinanceRole, isUnpaidCredit, seedCategories,
  type Category, type ExpenseLimits, type ExpenseRecord, type Project, type Vendor,
} from "@ag/core";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { StatusBadge } from "@/components/ui/feedback";
import { useDocs, useRead, useSession, useSmall } from "@/data/DataProvider";
import type { Session } from "@/data/types";

export const OFFICE = "__office";
export const PAID_MODES = ["cash", "upi", "bank", "cheque"] as const;
export const ALL_MODES = ["cash", "upi", "bank", "cheque", "credit"] as const;

export function useLang(): "en" | "hi" {
  const { i18n } = useTranslation();
  return i18n.language === "hi" ? "hi" : "en";
}

/** The approval and bill limits from Settings (defaults when not set). */
export function useExpenseLimits(): ExpenseLimits {
  const ops = (useSmall<{ id: string }>("settings") ?? []).find((s) => s.id === "operations");
  return useMemo(() => expenseLimits(ops as Record<string, unknown> | undefined), [ops]);
}

/** The expense heads as a tree; the built-in heads when none are saved yet. Undefined while loading. */
export function useCategoryTree(): CategoryTree | undefined {
  const cats = useSmall<Category>("expense_categories");
  return useMemo(() => (cats ? new CategoryTree(cats.length ? cats : seedCategories()) : undefined), [cats]);
}

export function categoryLabel(tree: CategoryTree | undefined, id: string | null | undefined, lang: "en" | "hi", full = false): string {
  if (!id || !tree?.byId.has(id)) return "";
  const name = (x: string) => { const c = tree.byId.get(x)!; return lang === "hi" && c.nameHi ? c.nameHi : c.name; };
  return full ? tree.pathOf(id).map(name).join(" › ") : name(id);
}

/** Who is asking, in the shape the core rules take. */
export function who(session: Session) {
  return { role: session.role, uid: session.uid, projectIds: session.projectIds };
}

/** Projects this person can enter expenses on: every open project for the owner and accountant, their own for site roles. */
export function useMyProjects(): Project[] | undefined {
  const session = useSession();
  const finance = !!session && isFinanceRole(session.role);
  const all = useRead(`exp-projects:${finance}`, (s) => (finance
    ? s.query<Project>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 })
    : Promise.resolve({ items: [] as Project[], next: null, total: 0 })));
  const mine = useDocs<Project>("projects", !session || finance ? [] : session.projectIds.slice(0, 30));
  if (!session) return undefined;
  if (finance) return all?.items;
  return mine?.filter((p): p is Project => !!p && !p.isArchived);
}

/** Suppliers for the paid-to picker (the owner and accountant only; site roles type the name). */
export function useVendors(enabled: boolean): Vendor[] {
  const r = useRead(`exp-vendors:${enabled}`, (s) => (enabled
    ? s.query<Vendor>("vendors", { orderBy: [{ field: "name" }], limit: 50 })
    : Promise.resolve({ items: [] as Vendor[], next: null, total: 0 })));
  return (r?.items ?? []).filter((v) => !v.isDeleted);
}

/**
 * Cascading category picker (spec §7.2 "leaf selected via cascading dropdown"): choose the head, then each level
 * under it, until the last one. `onChange` gets the last level's id, or "" while a level is still to be chosen.
 */
export function CategoryPicker({ value, onChange, label, error, required }: { value: string; onChange: (leafId: string) => void; label: string; error?: string; required?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const tree = useCategoryTree();
  const id = useId();
  const [path, setPath] = useState<string[]>([]);
  useEffect(() => {
    if (value && tree?.byId.has(value) && path[path.length - 1] !== value) setPath(tree.pathOf(value));
    if (!value && path.length && tree && tree.isLeaf(path[path.length - 1]!)) setPath([]);
  }, [value, tree]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (c: Category) => (lang === "hi" && c.nameHi ? c.nameHi : c.name);
  const levels: { parent: string | null; options: Category[] }[] = [];
  if (tree) {
    levels.push({ parent: null, options: tree.roots() });
    for (const chosen of path) {
      const kids = tree.childrenOf(chosen);
      if (kids.length) levels.push({ parent: chosen, options: kids });
    }
  }
  const pick = (level: number, catId: string) => {
    const next = catId ? [...path.slice(0, level), catId] : path.slice(0, level);
    setPath(next);
    onChange(catId && tree?.isLeaf(catId) ? catId : "");
  };
  return (
    <div className={`field${error ? " has-error" : ""}`} data-category-picker>
      <label htmlFor={`${id}-0`}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <div className="exp-cat-levels">
        {!tree ? <select className="input" id={`${id}-0`} disabled><option>{t("common.loading")}</option></select> : levels.map((lv, i) => {
          const chosen = path[i] ?? "";
          const parentName = lv.parent ? name(tree.byId.get(lv.parent)!) : "";
          return (
            <select key={lv.parent ?? "root"} className="input" id={`${id}-${i}`} value={chosen} aria-invalid={!!error} data-level={i}
              aria-label={i === 0 ? undefined : t("expenses.form.categoryUnder", { name: parentName })}
              aria-describedby={error ? `${id}-err` : undefined} onChange={(e) => pick(i, e.target.value)}>
              <option value="">{i === 0 ? t("expenses.form.chooseCategory") : t("expenses.form.chooseUnder", { name: parentName })}</option>
              {lv.options.filter((c) => c.active !== false || c.id === chosen).map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}
            </select>
          );
        })}
      </div>
      {error ? <span className="field-error" id={`${id}-err`}><Icon name="alert" size={16} />{error}</span> : null}
    </div>
  );
}

/** Status of an entry in words and colour: deleted, waiting, approved or rejected, and "to pay" for an unpaid credit purchase. */
export function ExpenseBadges({ e }: { e: Pick<ExpenseRecord, "approvalStatus" | "isDeleted" | "mode" | "paidStatus"> }) {
  const { t } = useTranslation();
  if (e.isDeleted) return <span className="badge neutral"><Icon name="trash" size={14} />{t("expenses.status.deleted")}</span>;
  return (
    <span className="exp-badges">
      <StatusBadge kind={e.approvalStatus === "approved" ? "approved" : e.approvalStatus === "rejected" ? "rejected" : "pending_approval"} />
      {isUnpaidCredit(e) && <span className="badge warning"><Icon name="clock" size={14} />{t("expenses.status.toPay")}</span>}
    </span>
  );
}

/** The tabs across the expense pages. Other expense screens (total spendings) add their own entry through `extra`. */
export function ExpenseTabs({ current, extra = [] }: { current: "all" | "approvals" | "recurring" | string; extra?: { key: string; href: string; label: string }[] }) {
  const { t } = useTranslation();
  const session = useSession();
  const role = session?.role;
  const tabs = [
    { key: "all", href: "/expenses/", label: t("expenses.tabs.all"), show: true },
    { key: "approvals", href: "/expenses/approvals/", label: t("expenses.tabs.approvals"), show: role === "owner" || role === "accountant" || role === "pm" },
    { key: "recurring", href: "/expenses/recurring/", label: t("expenses.tabs.recurring"), show: role === "owner" || role === "accountant" },
    ...extra.map((x) => ({ ...x, show: true })),
  ].filter((x) => x.show);
  if (tabs.length < 2) return null;
  return (
    <nav className="tabs" aria-label={t("expenses.tabs.label")}>
      {tabs.map((x) => <Link key={x.key} href={x.href} aria-current={x.key === current ? "page" : undefined}>{x.label}</Link>)}
    </nav>
  );
}

/** The person's name for a history line: the name saved with it, else from the people list. */
export function usePersonName(): (uid: string | null | undefined, saved?: string) => string {
  const { t } = useTranslation();
  const users = useSmall<{ id: string; name: string }>("users");
  return (uid, saved) => saved || (uid === "system" ? t("expenses.system") : users?.find((u) => u.id === uid)?.name ?? "");
}

/** A stable key for the refusals the core rules give, so they can be shown in Hindi too. */
export function refusalKey(message: string): string {
  if (message.includes("deleted")) return "deleted";
  if (message.includes("automatically")) return "generated";
  if (message.includes("approved")) return "approved";
  if (message.includes("only the entries you made")) return "notYours";
  if (message.includes("aren't assigned")) return "notAssigned";
  return "role";
}

/** A stable key for why this person can't approve an entry, so the reason can be shown in Hindi too. */
export function approvalKey(message: string): string {
  if (message.includes("yourself")) return "own";
  if (message.includes("only the owner")) return "ownerOnly";
  if (message.includes("above your approval limit")) return "aboveLimit";
  if (message.includes("aren't assigned")) return "notAssigned";
  if (message.includes("automatically")) return "generated";
  return "role";
}
