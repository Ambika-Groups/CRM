"use client";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData, useSession } from "@/data/DataProvider";
import { setLang, storedLang, type Lang } from "@/i18n";

/** EN / हिं toggle (spec §4A.5 top bar). Saved on the user and on the device. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const { source } = useData();
  const session = useSession();

  useEffect(() => {
    const lang: Lang = session?.language ?? storedLang();
    if (lang !== i18n.language) setLang(lang);
  }, [session?.language, i18n]);

  const choose = (lang: Lang) => {
    setLang(lang);
    void source.setPreference({ language: lang });
  };

  return (
    <span className={`lang-toggle ${className}`} role="group" aria-label={t("top.language")}>
      <button type="button" aria-pressed={i18n.language === "en"} onClick={() => choose("en")}>EN</button>
      <button type="button" aria-pressed={i18n.language === "hi"} className="hi" lang="hi" onClick={() => choose("hi")}>हिं</button>
    </span>
  );
}
