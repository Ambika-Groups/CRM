// Builds tools/jobs/billing.json: the quotation and bill screens (spec §8.2, §8.3) by role, width, theme and language,
// and the interactive checks: make a draft bill, issue it and see its number, reload and it is still there; IGST for
// another state; a credit note; cancel with a reason; a locked bill can't be edited; quotations: send, revise, make a
// bill; the viewer and site roles are refused; the CA reads bills only.
// Jobs share one browser profile, so the demo data carries over from job to job in this order.
// Every job states its language: "en" unless it is a Hindi job ("hi"), and Hindi jobs wait for Hindi text with until().
// Usage: node tools/jobs/make-billing.mjs
import { writeFileSync } from "node:fs";

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", lang: o.lang ?? "en", shot: o.shot ?? true, ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const byLabel=(txt)=>{const root=document.querySelector('[role=dialog]')||document;const l=[...root.querySelectorAll('label,legend')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim()===txt)||[...root.querySelectorAll('label')].find(x=>x.textContent.trim().startsWith(txt));if(!l)throw new Error('no label: '+txt);return l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea');};
const setVal=(el,v)=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const fill=(txt,v)=>setVal(byLabel(txt),v);
const q=(s)=>document.querySelector(s);
const press=async(s)=>{const b=await until(()=>{const x=q(s);return x&&!x.disabled?x:null;});if(!b)throw new Error('no button: '+s);b.click();await sleep(400);};
const main=()=>document.querySelector('main').innerText;
const rows=(s)=>[...document.querySelectorAll(s+' table.data tbody tr')];
const line=async()=>{await until(()=>byLabel('Project').value==='projSharma');fill('What it is for','QA extra plaster');fill('Quantity','2.5');fill('Rate','1234.56');await until(()=>q('[data-total=total]')&&q('[data-total=total]').textContent.includes('3,642'));};
`;
const act = (body) => H + body;
const exp = (body) => H + body;

const BILLS = "/billing/";
const QUOTES = "/billing/quotations/";
const NEW = "/billing/invoices/new/";
const BILL = (id) => `/billing/invoices/view/?id=${id}`;
const QUOTE = (id) => `/billing/quotations/view/?id=${id}`;

// ---------- screens: 360 and 1280, light and dark, Hindi ----------
add(BILLS, "billing-bills", 1280);
add(BILLS, "billing-bills", 360);
add(BILLS, "billing-bills", 1280, { theme: "dark" });
add(BILLS, "billing-bills", 360, { theme: "dark" });
add(BILLS, "billing-bills", 360, { lang: "hi", state: "hi", expect: exp(`return !!(await until(()=>main().includes('नया बिल')&&rows('[data-invoice-list]').length>0))||main().slice(0,200);`) });
add(QUOTES, "billing-quotations", 1280);
add(QUOTES, "billing-quotations", 360);
add(QUOTES, "billing-quotations", 360, { theme: "dark" });
add(NEW, "billing-bill-new", 1280);
add(NEW, "billing-bill-new", 360);
add(NEW, "billing-bill-new", 360, { theme: "dark" });
add(NEW, "billing-bill-new", 1280, { lang: "hi", state: "hi", expect: exp(`return !!(await until(()=>main().includes('ड्राफ़्ट सेव करें')&&main().includes('लाइन 1')))||main().slice(0,200);`) });
add(BILL("invRa2"), "billing-bill", 1280, { state: "ra-part-paid" });
add(BILL("invRa2"), "billing-bill", 360, { state: "ra-part-paid" });
add(BILL("invGrSlab1"), "billing-bill", 360, { theme: "dark", state: "overdue" });
add(BILL("invRa3"), "billing-bill", 1280, { theme: "dark", state: "draft" });
add("/billing/quotations/new/", "billing-quotation-new", 360);
add("/billing/quotations/new/", "billing-quotation-new", 1280, { theme: "dark" });
add(QUOTE("qtnDemo05"), "billing-quotation", 1280, { state: "rev2" });
add(QUOTE("qtnDemo05"), "billing-quotation", 360, { state: "rev2" });
add(QUOTE("qtnDemo03"), "billing-quotation", 360, { theme: "dark", state: "accepted" });
add(QUOTE("qtnDemo03"), "billing-quotation", 360, { lang: "hi", state: "hi", expect: exp(`return !!(await until(()=>main().includes('बिल बनाएँ')&&main().includes('कुल')))||main().slice(0,200);`) });

// ---------- the lists: rows, filters, older versions hidden ----------
add(BILLS, "bl-list-rows", 1280, { shot: false,
  expect: exp(`await until(()=>rows('[data-invoice-list]').length>=10);return (rows('[data-invoice-list]').length>=10&&/AG\\/\\d{4}-\\d{2}\\/\\d{4}/.test(main())&&main().includes('Still to receive'))||main().slice(0,300);`) });
add(`${BILLS}?f.status=draft`, "bl-filter-draft", 1280, { shot: false,
  expect: exp(`await until(()=>rows('[data-invoice-list]').length>0);await sleep(500);const r=rows('[data-invoice-list]');return (r.length>0&&r.every(x=>x.querySelector('[data-status=draft]')))||r.length+' rows';`) });
add(`${BILLS}?f.client=clSharma`, "bl-filter-client", 1280, { shot: false,
  expect: exp(`await until(()=>rows('[data-invoice-list]').length>0);await sleep(500);const r=rows('[data-invoice-list]');return (r.length>0&&r.every(x=>x.innerText.includes('Rajesh Sharma')))||r.length+' rows';`) });
add(QUOTES, "bl-quotations-latest-only", 1280, { shot: false,
  expect: exp(`await until(()=>rows('[data-quotation-list]').length>0);await sleep(500);const r=rows('[data-quotation-list]');return (r.length===4&&main().includes('(Rev 2)')&&!main().includes('Older version'))||r.length+' rows';`) });

// ---------- a bill: IGST for another state; make a draft, issue it, see the number, reload ----------
add(`${NEW}?project=projSharma`, "bl-igst-other-state", 1280, { viewport: true,
  action: act(`await line();fill('Place of supply (state code)','07');await sleep(400);`),
  expect: exp(`await until(()=>q('[data-total=igst]'));return (!!q('[data-total=igst]')&&!q('[data-total=cgst]')&&q('[data-tax-kind]').textContent.includes('IGST'))||main().slice(0,300);`) });
add(`${NEW}?project=projSharma`, "bl-draft-then-issue", 1280, { reload: true, viewport: true,
  action: act(`await line();await press('[data-save]');await until(()=>location.pathname.includes('/billing/invoices/view/'));await until(()=>q('[data-draft]'));window.__draft=q('[data-bill-number]').textContent;await press('[data-issue]');await until(()=>q('[role=dialog]'));await press('[role=dialog] .btn-primary');await until(()=>/^AG\\//.test(q('[data-bill-number]').textContent),10000);await sleep(500);`),
  expect: exp(`await until(()=>q('[data-bill-number]'));const n=q('[data-bill-number]').textContent;return (/^AG\\/\\d{4}-\\d{2}\\/\\d{4}$/.test(n)&&!!q('[data-locked]')&&!q('[data-issue]')&&!q('[data-edit]')&&q('[data-money=due]').textContent.includes('3,642'))||n+' '+main().slice(0,200);`) });
add(`${BILLS}?f.status=unpaid&f.client=clSharma`, "bl-issued-in-list", 360, { shot: false,
  expect: exp(`await until(()=>rows('[data-invoice-list]').length>0);await sleep(500);return main().includes('₹3,642')||main().slice(0,300);`) });
add(`${NEW}?project=projSharma`, "bl-refused-without-lines", 360, { viewport: true,
  action: act(`await until(()=>byLabel('Project').value==='projSharma');await press('[data-save]');await sleep(600);`),
  expect: exp(`return (location.pathname.includes('/billing/invoices/new/')&&!!q('[data-invoice-form] [role=alert]'))||'saved an empty bill';`) });

// ---------- an issued bill is locked; credit note; cancel with a reason ----------
add("/billing/invoices/edit/?id=invRa2", "bl-locked-edit", 1280, { shot: false,
  expect: exp(`await until(()=>q('[data-edit-refused]'));return (!!q('[data-edit-refused]')&&!q('[data-invoice-form]'))||main().slice(0,200);`) });
add(BILL("invShBrickwork"), "bl-credit-note", 1280, { reload: true, viewport: true,
  action: act(`await press('[data-credit-note]');await until(()=>q('[role=dialog]'));fill('Amount before tax','1000');fill('Reason','QA rate difference');await sleep(300);await press('[data-confirm-note]');await until(()=>!q('[role=dialog]'),10000);await sleep(600);`),
  expect: exp(`await until(()=>q('[data-bill-notes]'));return (!!q('[data-bill-notes]')&&/CN\\/\\d{4}-\\d{2}\\/0001/.test(q('[data-bill-notes]').innerText)&&q('[data-money=credited]').textContent.includes('1,180'))||main().slice(0,300);`) });
add(BILL("invGrSlab1"), "bl-cancel-with-reason", 1280, { reload: true, viewport: true,
  action: act(`await press('[data-cancel]');await until(()=>q('[role=dialog]'));window.__blocked=q('[data-confirm-cancel]').disabled;fill('Why is it being cancelled?','QA billed twice');await sleep(300);await press('[data-confirm-cancel]');await until(()=>!q('[role=dialog]'),10000);await sleep(600);`),
  expect: exp(`await until(()=>q('[data-cancelled]'));return (!!q('[data-cancelled]')&&/^AG\\//.test(q('[data-bill-number]').textContent)&&!q('[data-cancel]')&&main().includes('QA billed twice'))||main().slice(0,300);`) });

// ---------- quotations: number on sending, a change after sending is version 2, an accepted one becomes a draft bill ----------
add(QUOTE("qtnDemo01"), "bl-quotation-send", 1280, { reload: true, viewport: true,
  action: act(`await press('[data-send]');await until(()=>q('[role=dialog]'));await press('[role=dialog] .btn-primary');await until(()=>/^AG\\/Q\\//.test(q('[data-quotation-number]').textContent),10000);await sleep(500);`),
  expect: exp(`await until(()=>q('[data-quotation-number]'));const n=q('[data-quotation-number]').textContent;return (/^AG\\/Q\\/\\d{4}-\\d{2}\\/\\d{4}$/.test(n)&&!q('[data-send]')&&!!q('[data-mark=accepted]'))||n;`) });
add("/billing/quotations/edit/?id=qtnDemo02", "bl-quotation-revise", 1280, { reload: true, viewport: true,
  action: act(`await until(()=>q('[data-revising]')&&byLabel('Subject').value);await press('[data-save]');await until(()=>location.pathname.includes('/billing/quotations/view/'));await sleep(600);`),
  expect: exp(`await until(()=>q('[data-quotation-versions]'));return (q('[data-quotation-number]').textContent.includes('(Rev 2)')&&q('[data-quotation-versions]').querySelectorAll('li').length===2&&!!q('[data-send]'))||main().slice(0,300);`) });
add(QUOTE("qtnDemo02"), "bl-quotation-old-version-read-only", 360, { shot: false,
  expect: exp(`await until(()=>q('[data-older]'));return (!!q('[data-older]')&&!q('[data-edit]')&&!q('[data-mark=accepted]'))||main().slice(0,200);`) });
add(QUOTE("qtnDemo03"), "bl-quotation-to-bill", 1280, { viewport: true,
  action: act(`await press('[data-make-bill]');await until(()=>q('[role=dialog]'));await press('[data-confirm-bill]');await until(()=>location.pathname.includes('/billing/invoices/view/'),10000);await sleep(600);`),
  expect: exp(`await until(()=>q('[data-draft]'));return (!!q('[data-draft]')&&!!q('[data-issue]')&&main().includes('Nagar Nigam Lucknow'))||main().slice(0,300);`) });

// ---------- who may see it: the viewer and site roles are refused, the CA reads bills only ----------
add(BILLS, "bl-viewer-refused", 1280, { role: "uViewer", shot: false, expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-invoice-list]'))||main().slice(0,200);`) });
add(BILLS, "bl-supervisor-refused", 360, { role: "uSupShivNagar", shot: false, expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-invoice-list]'))||main().slice(0,200);`) });
add(NEW, "bl-pm-refused-new", 768, { role: "uPm", shot: false, expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-invoice-form]'))||main().slice(0,200);`) });
add(BILL("invRa2"), "bl-supervisor-refused-bill", 360, { role: "uSupShivNagar", shot: false, expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-bill-details]'))||main().slice(0,200);`) });
add(BILLS, "bl-ca-read-only-list", 1280, { role: "uCa", state: "ca-read-only",
  expect: exp(`await until(()=>rows('[data-invoice-list]').length>0);return (rows('[data-invoice-list]').length>0&&!q('[data-billing-new]')&&!!q('[data-read-only]')&&!q('[data-billing-tab]'))||main().slice(0,200);`) });
add(BILL("invRa2"), "bl-ca-read-only-bill", 1280, { role: "uCa", shot: false,
  expect: exp(`await until(()=>q('[data-bill-details]'));return (!!q('[data-bill-details]')&&!!q('[data-print]')&&!q('[data-cancel]')&&!q('[data-credit-note]')&&!q('[data-issue]'))||main().slice(0,200);`) });
add(NEW, "bl-ca-refused-new", 1280, { role: "uCa", shot: false, expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-invoice-form]'))||main().slice(0,200);`) });
add(QUOTES, "bl-ca-refused-quotations", 1280, { role: "uCa", shot: false, expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-quotation-list]'))||main().slice(0,200);`) });

writeFileSync(new URL("./billing.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
