"use client";
import type { TOptions } from "i18next";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/data/DataProvider";
import type { FilesApi } from "@/data/files/types";
import { en } from "@/i18n/features/files.en";

/**
 * The files adapter of the data source in use (demo or Firebase); null until the app has started.
 * The same thing as `useFiles()` in DataProvider; kept here so the file components do not depend on when that hook lands.
 */
export function useFilesApi(): FilesApi | null {
  const { source, status } = useData();
  return status === "ready" ? ((source as { files?: FilesApi }).files ?? null) : null;
}

/** True in Firebase mode, where a file added offline waits on the phone to be sent. */
export function useFilesWaitOffline(): boolean {
  return useData().source.mode === "firebase";
}

function lookup(key: string): string | undefined {
  let o: unknown = en;
  for (const k of key.split(".")) o = o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined;
  return typeof o === "string" ? o : undefined;
}

/** t("files.<key>"), falling back to the English text in files.en.ts if the strings are not registered yet. */
export function useFilesT(): (key: string, vars?: Record<string, unknown>) => string {
  const { t } = useTranslation();
  return useCallback((key: string, vars?: Record<string, unknown>) => t(`files.${key}`, { defaultValue: lookup(key) ?? key, ...vars } as TOptions), [t]);
}
