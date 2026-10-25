/**
 * Light / dark / system theme (spec §4A.4, brand.md 2.2, design-tokens §6). The inline head script in
 * app/layout.tsx applies the stored theme before first paint; these helpers keep it in sync afterwards.
 */
export type ThemePref = "light" | "dark" | "system";
const KEY = "ag-theme";
/** Fired on window whenever the theme changes, so the quick switch and the profile menu stay in step. */
export const THEME_EVENT = "ag-theme-change";

export const NO_FLASH_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem('ag-theme');}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var d=document.documentElement;d.setAttribute('data-theme',t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#0B0B0C':'#FFFDF9');try{var l=localStorage.getItem('ag-lang');if(l==='hi')d.lang='hi';}catch(e){}})();`;

export function storedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePref): "light" | "dark" {
  try { localStorage.setItem(KEY, pref); } catch { /* private mode */ }
  const t = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0B0B0C" : "#FFFDF9");
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: pref }));
  return t;
}
