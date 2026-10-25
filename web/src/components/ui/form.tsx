"use client";
// Forms (spec §4A.8, design-tokens §5.6): a label above every field, an example in the hint, errors next to
// the field that say how to fix it, a summary at the top of long forms, typed data never lost on failure,
// and protection against double submission.
import { CommandError, formatQty, parseQty, parseRupees, parseInputDate, toInputDate, isDateStr } from "@ag/core";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";

export interface FormState<V> {
  values: V;
  set: <K extends keyof V>(k: K, v: V[K]) => void;
  setAll: (v: V) => void;
  errors: Record<string, string>;
  summary: string | null;
  submitting: boolean;
  /** Runs the save; maps a CommandError's field messages onto the fields. Values are kept on failure. */
  submit: (fn: (v: V) => Promise<void>) => Promise<boolean>;
  setErrors: (e: Record<string, string>, summary?: string | null) => void;
}

export function useForm<V>(initial: V): FormState<V> {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrorsState] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const set = useCallback(<K extends keyof V>(k: K, v: V[K]) => {
    setValues((cur) => ({ ...cur, [k]: v }));
    setErrorsState((e) => { if (!e[k as string]) return e; const n = { ...e }; delete n[k as string]; return n; });
  }, []);
  const submit = useCallback(async (fn: (v: V) => Promise<void>) => {
    if (busy.current) return false; // double-submit protection
    busy.current = true;
    setSubmitting(true);
    setSummary(null);
    try {
      await fn(values);
      setErrorsState({});
      return true;
    } catch (e) {
      if (e instanceof CommandError) {
        setErrorsState(e.fields);
        setSummary(e.message);
      } else {
        setSummary(e instanceof Error ? e.message : String(e));
      }
      return false;
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }, [values]);
  return {
    values, set, setAll: setValues, errors, summary, submitting, submit,
    setErrors: (e, s = null) => { setErrorsState(e); setSummary(s); },
  };
}

export function ErrorSummary({ summary, errors }: { summary: string | null; errors: Record<string, string> }) {
  const { t } = useTranslation();
  if (!summary) return null;
  const list = Object.values(errors);
  return (
    <div className="banner error" role="alert" tabIndex={-1}>
      <Icon name="alert" />
      <div className="text">
        <b>{summary}</b>
        {list.length > 1 ? <span> {t("form.fixCount", { n: list.length })}</span> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, id, required }: { label: string; hint?: string; error?: string; children: (p: { id: string; describedBy?: string; invalid: boolean }) => ReactNode; id?: string; required?: boolean }) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={fid}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children({ id: fid, describedBy: [hintId, errId].filter(Boolean).join(" ") || undefined, invalid: !!error })}
      {hint ? <span className="hint-line" id={hintId}>{hint}</span> : null}
      {error ? <span className="field-error" id={errId}><Icon name="alert" size={16} />{error}</span> : null}
    </div>
  );
}

type Common = { label: string; hint?: string; error?: string; required?: boolean; disabled?: boolean };

export function TextField({ value, onChange, type = "text", autoComplete, inputMode, ...p }: Common & { value: string; onChange: (v: string) => void; type?: string; autoComplete?: string; inputMode?: "text" | "numeric" | "tel" | "email" | "decimal" }) {
  return (
    <Field {...p}>
      {(f) => <input className="input" id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} type={type} value={value}
        onChange={(e) => onChange(e.target.value)} disabled={p.disabled} required={p.required} autoComplete={autoComplete} inputMode={inputMode} />}
    </Field>
  );
}

export function TextArea({ value, onChange, rows = 3, ...p }: Common & { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <Field {...p}>
      {(f) => <textarea className="input textarea" id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} rows={rows} value={value}
        onChange={(e) => onChange(e.target.value)} disabled={p.disabled} />}
    </Field>
  );
}

export function SelectField<T extends string>({ value, onChange, options, placeholder, ...p }: Common & { value: T | ""; onChange: (v: T) => void; options: { value: T; label: string }[]; placeholder?: string }) {
  return (
    <Field {...p}>
      {(f) => (
        <select className="input" id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} value={value}
          onChange={(e) => onChange(e.target.value as T)} disabled={p.disabled} required={p.required}>
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** Money typed in rupees ("1,25,000"), held as text so nothing typed is lost; converted with toPaise(). */
export function MoneyField({ value, onChange, ...p }: Common & { value: string; onChange: (v: string) => void }) {
  return (
    <Field {...p}>
      {(f) => (
        <span className="input-affix">
          <span aria-hidden="true">₹</span>
          <input className="input" id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} inputMode="decimal" value={value}
            onChange={(e) => onChange(e.target.value)} disabled={p.disabled} />
        </span>
      )}
    </Field>
  );
}

/** Date typed as DD/MM/YYYY (D-03), held as text. */
export function DateField({ value, onChange, ...p }: Common & { value: string; onChange: (v: string) => void }) {
  return (
    <Field {...p} hint={p.hint ?? "DD/MM/YYYY, e.g. 25/10/2026"}>
      {(f) => <input className="input" id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid} inputMode="numeric" placeholder="DD/MM/YYYY"
        value={value} onChange={(e) => onChange(e.target.value)} disabled={p.disabled} />}
    </Field>
  );
}

export function CheckField({ checked, onChange, label, hint, error, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; error?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={`field check${error ? " has-error" : ""}`}>
      <label htmlFor={id} className="check-row">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled}
          aria-describedby={error ? `${id}-err` : undefined} aria-invalid={!!error} />
        <span>{label}</span>
      </label>
      {hint ? <span className="hint-line">{hint}</span> : null}
      {error ? <span className="field-error" id={`${id}-err`}><Icon name="alert" size={16} />{error}</span> : null}
    </div>
  );
}

// ---------- conversions between typed text and stored integers ----------
/** "1,25,000" → paise; "" → 0; invalid → NaN (the command reports it). */
export const toPaise = (s: string): number => (s.trim() === "" ? 0 : parseRupees(s) ?? Number.NaN);
export const fromPaise = (p: number | null | undefined): string => (p == null ? "" : (p / 100).toFixed(p % 100 ? 2 : 0));
export const toDate = (s: string): string => (s.trim() === "" ? "" : parseInputDate(s) ?? s.trim());
export const fromDate = (d: string | null | undefined): string => (d && isDateStr(d) ? toInputDate(d) : "");
export const toMilli = (s: string): number => (s.trim() === "" ? 0 : parseQty(s) ?? Number.NaN);
export const fromMilli = (m: number | null | undefined): string => (m == null ? "" : formatQty(m).replace(/,/g, ""));
export const toInt = (s: string): number | undefined => (s.trim() === "" ? undefined : /^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);
/** "18" or "2.5" percent → basis points; allows a leading minus for premiums. */
export const toBp = (s: string): number | undefined => {
  const t = s.trim().replace("%", "");
  if (t === "") return undefined;
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : Number.NaN;
};
export const fromBp = (bp: number | null | undefined): string => (bp == null ? "" : String(bp / 100));
