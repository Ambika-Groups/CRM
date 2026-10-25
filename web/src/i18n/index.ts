"use client";
// i18next + react-i18next (spec §3 allows next-intl or i18next). Client-side language switch without a
// URL change, which suits the static export (decisions D-38).
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en, hi } from "./strings";

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
    resources: { en: { translation: en }, hi: { translation: hi } },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
  document.documentElement.lang = lang;
  void i18n.changeLanguage(lang);
}

export default i18n;
