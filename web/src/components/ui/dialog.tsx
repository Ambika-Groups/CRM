"use client";
// shadcn/ui-style Dialog on Radix: focus trap, Escape to close, focus returned to the trigger.
// Bottom sheet on phones, centred on larger screens (design-tokens §5.5).
import * as D from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, children, description }: { title: string; description?: string; children: ReactNode }) {
  // Remember what had focus when the dialog opened, and return focus there on Escape or close (QA N6).
  // Radix does this only for its own Trigger; most of our dialogs open from state.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <D.Portal>
      <D.Overlay className="scrim" />
      <D.Content className="dialog dialog-fixed" aria-describedby={description ? undefined : undefined}
        onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement | null; }}
        onCloseAutoFocus={(e) => { const o = opener.current; if (o && o !== document.body && o.isConnected) { e.preventDefault(); o.focus(); } }}>
        <D.Title asChild><h2>{title}</h2></D.Title>
        {description ? <D.Description asChild><p>{description}</p></D.Description> : null}
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="dialog-actions">{children}</div>;
}
