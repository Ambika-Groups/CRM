"use client";
import { BOTTOM_NAV, navFor, type NavKey } from "@ag/core";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useAuthState, useData, useOnline, useSession } from "@/data/DataProvider";
import { DemoBanner } from "./DemoBanner";
import { Icon } from "./Icon";
import { LangToggle } from "./LangToggle";
import { CommandPalette, openPalette } from "./CommandPalette";
import { Notifications } from "./Notifications";
import { PhoneProfile, ProfileMenu } from "./ProfileMenu";
import { SyncState, SyncStrip } from "./SyncState";
import { ThemeSwitch } from "./ThemeSwitch";

export interface Crumb { label: string; href?: string }

interface Props {
  /** Which sidebar item is active. */
  nav: NavKey | "more";
  /** Phone top-bar title. */
  title: string;
  crumbs: Crumb[];
  children: ReactNode;
  /** Pages with a pinned main action on phones (design-tokens §5.2). */
  actionBar?: boolean;
}

const NAV_KEY = "ag-nav-collapsed";

/** Sidebar collapsed to icons only (spec §4A.5), remembered on this device. Expanded by default. */
function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem(NAV_KEY) === "1"); } catch { /* private mode */ } }, []);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(NAV_KEY, c ? "0" : "1"); } catch { /* private mode */ }
    return !c;
  });
  return [collapsed, toggle];
}

/**
 * Navigation by screen size (spec §4A.5, design-tokens §5.3): bottom navigation below 600 px, a rail with
 * labels from 600 to 1023 px, the full sidebar from 1024 px. Role-based visibility from core/roles.
 */
export function AppShell({ nav, title, crumbs, children, actionBar }: Props) {
  const { t, i18n } = useTranslation();
  const { source, status, error } = useData();
  const session = useSession();
  const authState = useAuthState();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsed();
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    document.body.classList.toggle("has-action-bar", !!actionBar);
  }, [actionBar]);

  // The browser tab title follows the page title in the user's language (QA N13; the static export's title is English).
  useEffect(() => {
    document.title = `${title} · ${t("app.crm")}`;
  }, [title, t, i18n.language]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  if (status === "error") {
    return (
      <main className="content" id="main">
        <div className="banner error" role="alert"><Icon name="alert" /><span className="text"><b>The CRM can't start.</b> {error}</span></div>
      </main>
    );
  }

  // Firebase mode: nobody sees the app until a person with a role is signed in.
  if (authState && authState.kind !== "ready") return <AuthScreen state={authState} />;

  const items = session ? navFor(session.role) : [];
  const visibleBottom = BOTTOM_NAV.filter((b) => b.key === "more" || items.some((i) => i.href === b.href || (b.key === "attendance" && i.key === "labour")));

  return (
    <>
      <a className="sr-only" href="#main">{t("app.skip")}</a>
      {status === "ready" && source.mode === "demo" && <DemoBanner />}
      <div className={collapsed ? "app nav-collapsed" : "app"}>
        <nav className="sidenav" aria-label={t("nav.main")}>
          <div className="brand-mark"><span className="ag">AG</span><span className="name">{t("app.name")}</span></div>
          <ul>
            {items.map((n) => (
              <li key={n.key}>
                <Link href={n.href} aria-current={n.key === nav ? "page" : undefined} title={collapsed ? t(`nav.${n.key}`) : undefined}>
                  <Icon name={n.icon} />
                  <span className="nav-label">{t(`nav.${n.key}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" className="nav-collapse" onClick={toggleCollapsed} aria-pressed={collapsed} data-nav-collapse
            title={collapsed ? t("nav.expand") : undefined}>
            <Icon name={collapsed ? "panel-open" : "panel-close"} />
            <span className="nav-label">{collapsed ? t("nav.expand") : t("nav.collapse")}</span>
          </button>
        </nav>
        <div className="main">
          <header className="topbar">
            <span className="title">{title}</span>
            <nav className="crumbs" aria-label={t("nav.breadcrumb")}>
              {crumbs.map((c, i) =>
                i === crumbs.length - 1 ? (
                  <span key={i} aria-current="page">{c.label}</span>
                ) : (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Link href={c.href ?? "#"}>{c.label}</Link>
                    <Icon name="chevron-right" size={16} className="icon icon-sm" />
                  </span>
                ),
              )}
            </nav>
            <button type="button" className="search-field tb-wide" onClick={openPalette} aria-keyshortcuts="Control+K Meta+K" data-search>
              <Icon name="search" />
              <span className="search-text">{t("top.search")}</span>
              <kbd aria-hidden="true">Ctrl K</kbd>
            </button>
            <LangToggle className="tb-desk" />
            <SyncState className="tb-desk" />
            <Notifications />
            <ThemeSwitch className="tb-wide" />
            <ProfileMenu />
            <span className="overflow-wrap tb-narrow" ref={menuRef}>
              <button className="icon-btn" type="button" aria-label={t("top.moreMenu")} aria-expanded={menuOpen} aria-controls="top-overflow" data-overflow
                onClick={() => setMenuOpen((o) => !o)}>
                <Icon name="more-v" />
              </button>
              {menuOpen && (
                <div className="overflow-menu" id="top-overflow" role="group" aria-label={t("top.moreMenu")}>
                  <div className="om-row om-phone"><ThemeSwitch /></div>
                  <button className="om-row" type="button" onClick={() => { setMenuOpen(false); openPalette(); }}><Icon name="search" />{t("top.searchShort")}</button>
                  <div className="om-row"><Icon name="info" />{t("top.language")}<LangToggle className="ml-auto" /></div>
                  <div className="om-row om-tablet"><SyncState long /></div>
                  <PhoneProfile />
                </div>
              )}
            </span>
          </header>
          <SyncStrip />
          <main className="content" id="main" tabIndex={-1}>
            {status === "loading" ? <p className="muted" role="status">{t("demo.loading")}</p> : children}
          </main>
        </div>
      </div>
      <CommandPalette />
      <nav className="bottom-nav" aria-label={t("nav.main")}>
        {visibleBottom.map((b) => (
          <Link key={b.key} href={b.href} aria-current={b.key === nav || (b.key === "attendance" && nav === "labour") ? "page" : undefined}>
            <Icon name={b.icon} />
            <span>{t(`nav.${b.key === "attendance" ? "attendance" : b.key}`)}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
