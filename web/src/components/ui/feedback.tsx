"use client";
// Feedback components (spec §4A.2, §4A.8; design-tokens §5.5): toasts, skeleton loaders, status badges,
// empty states and confirmation dialogs for destructive actions.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "./button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "./dialog";

// ---------- toasts ----------
type Toast = { id: number; text: string; tone: "success" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-stack" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === "success" ? "check-circle" : "alert"} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------- skeletons ----------
export function Skeleton({ lines = 3, label }: { lines?: number; label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="skeleton" role="status" aria-label={label ?? t("common.loading")}>
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

// ---------- status badges: the nine named in spec §4A.8, plus project statuses ----------
export type BadgeKind =
  | "active" | "completed" | "delayed" | "pending_approval" | "paid" | "partially_paid" | "overdue" | "draft" | "signed"
  | "planned" | "on_hold" | "cancelled" | "archived" | "inactive" | "rejected" | "approved";

const BADGE: Record<BadgeKind, { tone: "success" | "warning" | "error" | "neutral"; icon: string }> = {
  active: { tone: "success", icon: "check-circle" }, completed: { tone: "neutral", icon: "check" }, delayed: { tone: "error", icon: "alert" },
  pending_approval: { tone: "warning", icon: "clock" }, paid: { tone: "success", icon: "check-circle" }, partially_paid: { tone: "warning", icon: "clock" },
  overdue: { tone: "error", icon: "alert" }, draft: { tone: "neutral", icon: "file-text" }, signed: { tone: "success", icon: "check-circle" },
  planned: { tone: "neutral", icon: "calendar" }, on_hold: { tone: "warning", icon: "clock" }, cancelled: { tone: "neutral", icon: "x" },
  archived: { tone: "neutral", icon: "lock" }, inactive: { tone: "neutral", icon: "x" },
  rejected: { tone: "error", icon: "x" }, approved: { tone: "success", icon: "check-circle" },
};

export function StatusBadge({ kind }: { kind: BadgeKind }) {
  const { t } = useTranslation();
  const b = BADGE[kind];
  return <span className={`badge ${b.tone}`}><Icon name={b.icon} size={14} />{t(`status.${kind}`)}</span>;
}

// ---------- empty state ----------
export function EmptyState({ icon = "info", title, body, action }: { icon?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={24} />
      <b>{title}</b>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

// ---------- confirmation (destructive actions, design-tokens §5.5) ----------
export function ConfirmDialog({
  open, onOpenChange, title, body, confirmLabel, onConfirm, destructive = true,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; confirmLabel: string; onConfirm: () => Promise<void> | void; destructive?: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={body}>
        <DialogActions>
          <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
          <Button variant={destructive ? "destructive" : "primary"} disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); } }}>
            {busy ? t("common.working") : confirmLabel}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** A table that may scroll sideways on a phone: a named, keyboard-focusable region (axe scrollable-region-focusable). */
export function MiniWrap({ children, label }: { children: ReactNode; label: string }) {
  return <div className="mini-wrap" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
