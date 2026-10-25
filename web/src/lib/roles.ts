"use client";
import { useTranslation } from "react-i18next";
import { useSmall } from "@/data/DataProvider";

/** Worker role key → its label from Settings, in English or Hindi (QA N5: never show "mistri" or "labour" keys). */
export function useRoleLabel(): (key: string | null | undefined) => string {
  const { i18n } = useTranslation();
  const roles = (useSmall<{ id: string; workerRoles?: { key: string; label: string; labelHi?: string }[] }>("settings") ?? []).find((s) => s.id === "operations")?.workerRoles ?? [];
  return (key) => {
    if (!key) return "";
    const r = roles.find((x) => x.key === key);
    return r ? (i18n.language === "hi" && r.labelHi ? r.labelHi : r.label) : key;
  };
}
