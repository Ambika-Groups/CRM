import type { PrintDocSpec } from "@ag/core";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The printable HTML of a document spec: A4, the brand's red and white, tables that don't split mid-row. */
export function printDocHtml(d: PrintDocSpec): string {
  const sections = d.sections.map((s) => {
    const h = s.heading ? `<h2>${esc(s.heading)}</h2>` : "";
    if (s.kind === "text") return h + s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");
    if (s.kind === "pairs") return h + `<table class="pairs">${s.rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join("")}</table>`;
    return h + `<table><thead><tr>${s.head.map((c, i) => `<th class="${s.align?.[i] ?? "left"}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${s.align?.[i] ?? "left"}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }).join("");
  const meta = (d.meta ?? []).map((m) => `<div><span>${esc(m.label)}</span> <b>${esc(m.value)}</b></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
@page{size:A4;margin:16mm}body{font:13px/1.45 system-ui,sans-serif;color:#1a1a1a}header{display:flex;justify-content:space-between;border-bottom:3px solid #C62828;padding-bottom:8px;margin-bottom:12px}
h1{margin:0;font-size:20px;color:#C62828}h2{font-size:15px;margin:16px 0 6px}table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border:1px solid #ccc;padding:5px 7px;vertical-align:top}th{background:#f5f5f5;text-align:left}
.right{text-align:right}tr{break-inside:avoid}.pairs th{width:32%}footer{margin-top:18px;color:#666;font-size:11px}</style></head><body>
<header><div><h1>${esc(d.title)}</h1>${d.subtitle ? `<div>${esc(d.subtitle)}</div>` : ""}</div><div style="text-align:right">${meta}</div></header>${sections}${d.footerNote ? `<footer>${esc(d.footerNote)}</footer>` : ""}</body></html>`;
}

/** Open the document in a print window (the browser's "Save as PDF" makes the PDF). Lane C's renderer replaces the body. */
export function openPrintDoc(d: PrintDocSpec): void {
  const w = window.open("", "_blank", "noopener=no,width=900,height=1000");
  if (!w) return;
  w.document.open();
  w.document.write(printDocHtml(d));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
