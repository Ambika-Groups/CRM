"use client";
// Add or edit one project detail record (units, payment stages, approvals, BOQ, MB, EOT, hindrances) in a
// dialog: a bottom sheet on phones (spec §4A.2). Validation runs in the core command; errors appear by field.
import type { ProjectChild } from "@ag/core";
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/feedback";
import { DateField, ErrorSummary, fromBp, fromDate, fromMilli, fromPaise, MoneyField, SelectField, TextField, toBp, toDate, toInt, toMilli, toPaise, useForm } from "@/components/ui/form";
import { useRun } from "@/data/DataProvider";

export type FieldKind = "text" | "date" | "money" | "qty" | "int" | "pct" | "select";
export interface ChildField { key: string; label: string; kind: FieldKind; options?: { value: string; label: string }[]; hint?: string }

function toText(kind: FieldKind, v: unknown): string {
  if (v === null || v === undefined) return "";
  switch (kind) {
    case "date": return fromDate(v as string);
    case "money": return fromPaise(v as number);
    case "qty": return fromMilli(v as number);
    case "pct": return fromBp(v as number);
    default: return String(v);
  }
}

function fromText(kind: FieldKind, s: string): unknown {
  switch (kind) {
    case "date": return toDate(s) || null;
    case "money": return toPaise(s);
    case "qty": return toMilli(s);
    case "int": return toInt(s) ?? null;
    case "pct": return toBp(s) ?? 0;
    default: return s.trim();
  }
}

export function ChildEditor({
  projectId, kind, fields, title, trigger, initial, saved, extra,
}: { projectId: string; kind: ProjectChild; fields: ChildField[]; title: string; trigger: ReactElement; initial?: Record<string, unknown> & { id?: string }; saved: string; extra?: Record<string, unknown> }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const start = () => Object.fromEntries(fields.map((f) => [f.key, toText(f.kind, initial?.[f.key])]));
  const form = useForm<Record<string, string>>(start());

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { form.setAll(start()); form.setErrors({}); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title}>
        <form noValidate onSubmit={(e) => {
          e.preventDefault();
          void form.submit(async (v) => {
            const doc: Record<string, unknown> & { id?: string } = { ...(initial ?? {}), ...(extra ?? {}) };
            for (const f of fields) doc[f.key] = fromText(f.kind, v[f.key] ?? "");
            await run("saveProjectChild", { projectId, kind, doc });
            toast(saved);
            setOpen(false);
          });
        }}>
          <ErrorSummary summary={form.summary} errors={form.errors} />
          <div className="form-grid" style={{ marginTop: "var(--space-4)" }}>
            {fields.map((f) => {
              const p = { label: f.label, hint: f.hint, error: form.errors[f.key], value: form.values[f.key] ?? "", onChange: (x: string) => form.set(f.key, x) };
              if (f.kind === "date") return <DateField key={f.key} {...p} />;
              if (f.kind === "money") return <MoneyField key={f.key} {...p} />;
              if (f.kind === "select") return <SelectField key={f.key} {...p} options={f.options ?? []} placeholder="—" />;
              return <TextField key={f.key} {...p} inputMode={f.kind === "text" ? undefined : "decimal"} />;
            })}
          </div>
          <DialogActions>
            <DialogClose asChild><Button>{t("common.cancel")}</Button></DialogClose>
            <Button variant="primary" type="submit" disabled={form.submitting}>{form.submitting ? t("common.saving") : t("common.save")}</Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
