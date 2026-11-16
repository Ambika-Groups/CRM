"use client";
import { i18nHydrated } from "@/i18n";
import { useEffect, type ReactNode } from "react";
import { LetterheadBridge } from "@/components/documents/LetterheadBridge";
import { ShareLogBridge } from "@/components/share/ShareLogBridge";
import { ToastProvider } from "@/components/ui/feedback";
import { DataProvider } from "@/data/DataProvider";

/** Client providers: i18n, data layer, toasts, and the PWA service worker (spec §3 Mobile: installable PWA). */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => { i18nHydrated(); }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is best effort */ });
    }
  }, []);
  return <DataProvider><ToastProvider><ShareLogBridge /><LetterheadBridge />{children}</ToastProvider></DataProvider>;
}
