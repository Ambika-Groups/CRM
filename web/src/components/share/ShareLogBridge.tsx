"use client";
// Connects shareDocument() to the `logShare` command. Mounted once inside the data layer (Providers), so a page that
// only calls shareDocument() still gets its share logged; DocumentActions also uses the hook itself.
import { useEffect } from "react";
import { useRun } from "@/data/DataProvider";
import { registerShareLogger, type ShareLogRow } from "./index";

export function useShareLogger(): void {
  const run = useRun();
  useEffect(() => {
    // Named loosely so this file reads the same before and after the command is added to the registry.
    const call = run as unknown as (name: string, args: ShareLogRow) => Promise<unknown>;
    return registerShareLogger((row) => call("logShare", row));
  }, [run]);
}

export function ShareLogBridge() {
  useShareLogger();
  return null;
}
