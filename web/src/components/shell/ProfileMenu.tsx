"use client";
import { ROLE_LABELS } from "@ag/core";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useData, useSession } from "@/data/DataProvider";
import { setLang, type Lang } from "@/i18n";
import { applyTheme, storedTheme, THEME_EVENT, type ThemePref } from "@/lib/theme";
import { Icon } from "./Icon";

const THEMES: ThemePref[] = ["light", "dark", "system"];

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** The theme the user chose (Light, Dark or System), kept in step with the quick switch. */
function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const { source } = useData();
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    setPref(storedTheme());
    const on = () => setPref(storedTheme());
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  const choose = (p: ThemePref) => { applyTheme(p); setPref(p); void source.setPreference({ theme: p }); };
  return [pref, choose];
}

/** Sign out in Firebase mode; in the demo, open the "Viewing as" switcher instead (D-37). */
function useLeave() {
  const { source } = useData();
  const { t } = useTranslation();
  if (source.mode === "demo") {
    return { label: t("profile.switchPerson"), icon: "switch", run: () => {
      const sel = document.querySelector<HTMLSelectElement>("[data-role-switcher]");
      sel?.scrollIntoView({ block: "nearest" });
      sel?.focus();
    } };
  }
  return { label: t("profile.signOut"), icon: "logout", run: () => void (source as { signOut?: () => Promise<void> }).signOut?.() };
}

/**
 * Profile menu (spec §4A.4, §4A.5): name and role, Light / Dark / System, language, and sign out.
 * The quick "Dark mode" switch stays in the top bar (brand.md 2.2). Desktop and tablet.
 */
export function ProfileMenu() {
  const { t, i18n } = useTranslation();
  const { source } = useData();
  const session = useSession();
  const [pref, choose] = useThemePref();
  const leave = useLeave();
  if (!session) return null;
  const lang = i18n.language === "hi" ? "hi" : "en";
  const roleLabel = ROLE_LABELS[session.role][lang];
  const pickLang = (l: Lang) => { setLang(l); void source.setPreference({ language: l }); };
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button className="avatar-btn tb-wide" type="button" data-profile-menu>
          <span className="avatar" aria-hidden="true">{initials(session.name)}</span>
          <span className="who"><b>{session.name}</b>{roleLabel}</span>
          <span className="sr-only">{session.name}, {roleLabel}: {t("top.profile")}</span>
          <Icon name="chevron-down" size={16} className="icon icon-sm" />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="menu profile-menu" align="end" sideOffset={4}>
          <div className="menu-head"><b>{session.name}</b><span>{roleLabel}</span></div>
          <DM.Separator className="menu-sep" />
          <DM.Label className="menu-label">{t("top.theme")}</DM.Label>
          <DM.RadioGroup value={pref} onValueChange={(v) => choose(v as ThemePref)}>
            {THEMES.map((th) => (
              <DM.RadioItem key={th} value={th} className="menu-item" data-theme-choice={th}>
                <DM.ItemIndicator className="menu-check"><Icon name="check" size={16} /></DM.ItemIndicator>
                {t(`top.${th}`)}
              </DM.RadioItem>
            ))}
          </DM.RadioGroup>
          <DM.Separator className="menu-sep" />
          <DM.Label className="menu-label">{t("top.language")}</DM.Label>
          <DM.RadioGroup value={lang} onValueChange={(v) => pickLang(v as Lang)}>
            <DM.RadioItem value="en" className="menu-item"><DM.ItemIndicator className="menu-check"><Icon name="check" size={16} /></DM.ItemIndicator>English</DM.RadioItem>
            <DM.RadioItem value="hi" className="menu-item" lang="hi"><DM.ItemIndicator className="menu-check"><Icon name="check" size={16} /></DM.ItemIndicator>हिंदी</DM.RadioItem>
          </DM.RadioGroup>
          <DM.Separator className="menu-sep" />
          <DM.Item className="menu-item" onSelect={leave.run}><span className="menu-check"><Icon name={leave.icon} size={16} /></span>{leave.label}</DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** The same choices inside the phone's ⋮ panel, as plain buttons (the panel is a disclosure, not a menu). */
export function PhoneProfile() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const [pref, choose] = useThemePref();
  const leave = useLeave();
  const [open, setOpen] = useState(false);
  if (!session) return null;
  const roleLabel = ROLE_LABELS[session.role][i18n.language === "hi" ? "hi" : "en"];
  return (
    <>
      <button className="om-row" type="button" aria-expanded={open} aria-controls="om-profile" onClick={() => setOpen((o) => !o)} data-phone-profile>
        <span className="avatar" aria-hidden="true">{initials(session.name)}</span>
        <span className="grow"><b>{session.name}</b><br /><span className="caption">{roleLabel} · {t("top.themeSettings")}</span></span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
      </button>
      {open && (
        <div id="om-profile" className="om-sub">
          <div className="om-label" id="om-theme-label">{t("top.theme")}</div>
          <div className="segmented" role="group" aria-labelledby="om-theme-label">
            {THEMES.map((th) => (
              <button key={th} type="button" aria-pressed={pref === th} onClick={() => choose(th)} data-theme-choice={th}>{t(`top.${th}`)}</button>
            ))}
          </div>
          <button className="om-row" type="button" onClick={leave.run}><Icon name={leave.icon} />{leave.label}</button>
        </div>
      )}
    </>
  );
}
