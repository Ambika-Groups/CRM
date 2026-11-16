"use client";
// Gives openPrintDoc() the company letterhead from Settings, so every page that prints a simple document (stock,
// purchases, reports) gets the same heading as the invoices without reading settings itself. Mounted once in Providers.
import type { CompanyInfo } from "@ag/core";
import { useEffect } from "react";
import { setPrintCompany } from "@/components/shared/printDoc";
import { useDoc, useSession } from "@/data/DataProvider";

export function LetterheadBridge() {
  const session = useSession();
  const company = useDoc<CompanyInfo>("settings", session ? "company" : null);
  useEffect(() => { setPrintCompany(company ?? null); }, [company]);
  return null;
}
