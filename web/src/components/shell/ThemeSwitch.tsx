"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useData, useSession } from "@/data/DataProvider";
import { applyTheme, resolveTheme, storedTheme, THEME_EVENT } from "@/lib/theme";
import { Icon } from "./Icon";

/**
 * The visible "Dark mode" switch (brand.md 2.2): top bar on tablet and desktop, first row of the ⋮ menu on
 * phones. Toggling sets Light or Dark explicitly; System is chosen in the profile menu. Saved on the user
 * (users.theme) and cached on the device.
 */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { source } = useData();
  const session = useSession();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // The user's saved choice wins over the device cache on sign-in (design-tokens §6).
    const pref = session?.theme && session.theme !== storedTheme() ? session.theme : storedTheme();
    setDark(applyTheme(pref) === "dark");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (storedTheme() === "system") setDark(applyTheme("system") === "dark"); };
    mq.addEventListener("change", onChange);
    const onTheme = () => setDark(resolveTheme(storedTheme()) === "dark");
    window.addEventListener(THEME_EVENT, onTheme);
    return () => { mq.removeEventListener("change", onChange); window.removeEventListener(THEME_EVENT, onTheme); };
  }, [session?.theme]);

  const toggle = () => {
    const next = resolveTheme(storedTheme()) === "dark" ? "light" : "dark";
    setDark(applyTheme(next) === "dark");
    void source.setPreference({ theme: next });
  };

  return (
    <button type="button" role="switch" aria-checked={dark} className={`theme-switch ${className}`} onClick={toggle} data-theme-switch>
      <span className="ts-icon"><Icon name={dark ? "moon" : "sun"} /></span>
      <span className="ts-label">{t("top.darkMode")}</span>
      <span className="track"><span className="thumb" /></span>
    </button>
  );
}
