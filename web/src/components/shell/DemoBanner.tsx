"use client";
import { ROLE_LABELS } from "@ag/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useData, useSession } from "@/data/DataProvider";
import { Icon } from "./Icon";

/**
 * Permanent demo banner with the role switcher (decisions D-37). Shown only in demo mode, on every page,
 * at every width. Switching role changes what the whole app shows, using the same role matrix as the
 * Firestore rules.
 */
export function DemoBanner() {
  const { t, i18n } = useTranslation();
  const { source } = useData();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const users = source.demoUsers?.() ?? [];
  const lang = i18n.language === "hi" ? "hi" : "en";

  return (
    <div className="demo-banner" role="region" aria-label={t("demo.banner")}>
      <span className="demo-text"><Icon name="info" /><b>{t("demo.banner")}</b><span className="demo-hint">{t("demo.bannerHint")}</span></span>
      <label className="demo-role">
        <span>{t("demo.role")}</span>
        <select value={session?.uid ?? ""} onChange={(e) => void source.switchUser?.(e.target.value)} data-role-switcher>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role][lang]}</option>
          ))}
        </select>
      </label>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="text" size="sm" data-open-reset><Icon name="reset" />{t("demo.reset")}</Button>
        </DialogTrigger>
        <DialogContent title={t("demo.resetConfirmTitle")} description={t("demo.resetConfirmBody")}>
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("demo.keep")}</Button></DialogClose>
            <Button variant="destructive" disabled={busy}
              onClick={async () => { setBusy(true); await source.reset?.(); setBusy(false); setOpen(false); }}>
              <Icon name="reset" />{busy ? t("demo.resetting") : t("demo.reset")}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}
