"use client";
// A document model as a page (spec §8.4). The HTML and the stylesheet come from core (`documentBodyHtml`,
// `DOCUMENT_CSS`), the same ones the print window uses, so the screen, the print view and the PDF never differ.
// Every value is escaped by the renderer. The paper is white in the light and the dark theme: it shows what prints.
import { DOCUMENT_CSS, documentBodyHtml, type DocumentModel } from "@ag/core";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

function Page({ model }: { model: DocumentModel }) {
  const html = useMemo(() => documentBodyHtml(model), [model]);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DOCUMENT_CSS }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

/** The page on screen, inside the app. Tables scroll sideways inside the sheet on a phone; the screen never does. */
export function DocumentSheet({ model, label }: { model: DocumentModel; label?: string }) {
  return (
    <div className="doc-sheet" role="document" aria-label={label ?? model.title} data-document-sheet data-doc-number={model.number ?? ""}>
      <Page model={model} />
    </div>
  );
}

const PRINT_CLASS = "ag-has-print-root";

/**
 * The print-only copy: placed directly under <body> and hidden on screen. While it is there, printing shows only this
 * page (styles/documents.css hides everything else in print), black on white whatever the theme.
 */
export function PrintOnly({ model }: { model: DocumentModel }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.className = "ag-print-root";
    el.setAttribute("data-print-view", "");
    document.body.appendChild(el);
    document.documentElement.classList.add(PRINT_CLASS);
    setHost(el);
    return () => {
      el.remove();
      if (!document.querySelector(".ag-print-root")) document.documentElement.classList.remove(PRINT_CLASS);
    };
  }, []);
  return host ? createPortal(<Page model={model} />, host) : null;
}
