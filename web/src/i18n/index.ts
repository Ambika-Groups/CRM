"use client";
// i18next + react-i18next (spec §3 allows next-intl or i18next). Client-side language switch without a
// URL change, which suits the static export (decisions D-38). Only English ships with the first screen; the Hindi
// strings are their own file, fetched when Hindi is chosen (so the first screen stays light, R15-2).
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./strings";

export type Lang = "en" | "hi";

const STORAGE_KEY = "ag-lang";

export function storedLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

let hindi: Promise<void> | null = null;
function ensureHindi(): Promise<void> {
  hindi ??= import("./strings-hi").then((m) => { i18n.addResourceBundle("hi", "translation", m.hi, true, true); });
  return hindi;
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
  document.documentElement.lang = lang;
  // The language switches when its strings have arrived, so nothing flashes half translated.
  void (lang === "hi" ? ensureHindi() : Promise.resolve()).then(() => i18n.changeLanguage(lang));
}

export default i18n;

// A device that saved Hindi starts fetching it at once, in parallel with the data, so the first screen arrives in Hindi.
if (typeof window !== "undefined" && storedLang() === "hi") setLang("hi");
