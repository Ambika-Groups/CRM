// Builds tools/jobs/documents.json: printable documents and sharing (spec §8.4, §8.5). A demo bill as a page at 360 and
// 1280, light and dark, without sideways overflow; the print-only view holds the number, the client, the GST summary
// and the same totals as the bill; the WhatsApp link has the client's number and the message (the link is read, never
// opened); a share is logged and still listed after a reload; Hindi; who may open the page.
// Jobs share one browser profile, so the demo data carries over from job to job in this order.
// Usage: node tools/jobs/make-documents.mjs
import { writeFileSync } from "node:fs";

const J = [];
// Every job names its language: English unless the job says "hi" (some demo users are set to Hindi).
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", lang: o.lang ?? "en", shot: o.shot ?? true, ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const main=()=>document.querySelector('main').innerText;
const sheet=()=>document.querySelector('[data-document-sheet] .ag-doc');
const sheetText=()=>sheet()?.textContent||'';
const printRoot=()=>document.querySelector('body > .ag-print-root');
const number=()=>document.querySelector('[data-document-sheet]')?.dataset.docNumber||'';
const message=()=>document.querySelector('[data-share-message]')?.textContent||'';
const fits=()=>{const vw=document.documentElement.clientWidth;const s=document.querySelector('[data-document-sheet]');return document.documentElement.scrollWidth<=vw&&!!s&&s.getBoundingClientRect().right<=vw+1&&s.getBoundingClientRect().left>=-1;};
const printRules=()=>{const out=[];const walk=(rules)=>{for(const r of rules){if(r.media&&/print/.test(r.media.mediaText)&&r.cssText.includes('ag-has-print-root'))out.push(r.cssText);if(r.cssRules)walk(r.cssRules);}};for(const s of document.styleSheets){try{walk(s.cssRules);}catch(e){}}return out;};
`;
const act = (body) => H + body;
const exp = (body) => H + body;

// The house project's "Brickwork" stage bill: sent, 15% of ₹48,50,000 plus 18% GST, to Rajesh Sharma (+91 94150 00020).
const BILL = "/billing/document/?type=invoice&id=invShBrickwork";
const RA = "/billing/document/?type=invoice&id=invRa2";
const DRAFT = "/billing/document/?type=invoice&id=invRa3";
const TAXABLE = "₹7,27,500.00", HALF_GST = "₹65,475.00", GST = "₹1,30,950.00", TOTAL = "₹8,58,450.00";
const whitePaper = `const s=await until(sheet);if(!s)return main().slice(0,200);const cs=getComputedStyle(s);return (cs.backgroundColor==='rgb(255, 255, 255)'&&cs.color==='rgb(26, 18, 6)'&&fits())||JSON.stringify({bg:cs.backgroundColor,ink:cs.color,fits:fits()});`;

// ---------- the page: 360 and 1280, light and dark ----------
add(BILL, "document-bill", 1280, { expect: exp(whitePaper) });
add(BILL, "document-bill", 360, { expect: exp(whitePaper) });
add(BILL, "document-bill", 1280, { theme: "dark", expect: exp(whitePaper) });
add(BILL, "document-bill", 360, { theme: "dark", expect: exp(whitePaper) });
add(BILL, "document-bill", 768, { role: "uAccountant", state: "accountant", expect: exp(whitePaper) });
add(RA, "document-running-bill", 1280, { expect: exp(`await until(sheet);const t=sheetText();return (fits()&&t.includes('Running bill')&&t.includes('Nagar Nigam Lucknow')&&t.includes('Net receivable')&&t.includes('Balance due')&&t.includes('Less: Retention'))||t.slice(0,300);`) });
add(RA, "document-running-bill", 360, { theme: "dark", expect: exp(`await until(sheet);return fits()||'the page is wider than the phone';`) });
add(DRAFT, "document-draft", 360, { state: "draft", expect: exp(`await until(sheet);return (!!document.querySelector('[data-draft-note]')&&!!document.querySelector('.ag-doc-mark[data-mark="DRAFT"]')&&sheetText().includes('Draft, no number yet')&&fits())||sheetText().slice(0,200);`) });

// ---------- what is on the page equals the bill ----------
add(BILL, "doc-sheet-figures", 1280, { shot: false,
  expect: exp(`await until(sheet);const t=sheetText();const n=number();const need=['Ambika Groups','Tax invoice',n,'Billed to','Rajesh Sharma','Project / Site','Brickwork stage','GST summary','18%','${TAXABLE}','${HALF_GST}','${GST}','${TOTAL}','Grand total','Amount in words','Rupees Eight Lakh Fifty-Eight Thousand Four Hundred Fifty Only','Authorised signatory'];const miss=need.filter(x=>!t.includes(x));return (/^AG\\/2\\d{3}-\\d{2}\\/\\d{4}$/.test(n)&&miss.length===0&&!t.includes('to be confirmed'))||('missing: '+miss.join(' | ')+' number: '+n);`) });
add(BILL, "doc-items-in-a-table", 360, { shot: false,
  expect: exp(`await until(sheet);const box=document.querySelector('[data-doc-items]').parentElement;const cs=getComputedStyle(box);return (/(auto|scroll)/.test(cs.overflowX)&&box.tabIndex===0&&!!box.getAttribute('aria-label')&&document.querySelectorAll('[data-doc-items] tbody tr').length===1&&document.querySelectorAll('[data-doc-tax] tbody tr').length===1&&document.querySelectorAll('[data-doc-totals] tr').length>=4)||'the item table does not scroll inside the page';`) });

// ---------- print: a print-only copy with the same content, and the three actions with words on them ----------
add(BILL, "doc-print-view", 1280, { shot: false,
  expect: exp(`const p=await until(()=>printRoot()&&printRoot().querySelector('.ag-doc')&&printRoot());if(!p)return 'no print view';const t=p.querySelector('.ag-doc').textContent;const n=number();const need=[n,'Rajesh Sharma','GST summary','${TAXABLE}','${HALF_GST}','${GST}','${TOTAL}'];const miss=need.filter(x=>!x||!t.includes(x));const rules=printRules().join(' ');return (miss.length===0&&getComputedStyle(p).display==='none'&&document.documentElement.classList.contains('ag-has-print-root')&&rules.includes(':not(.ag-print-root)')&&/display:\\s*block/.test(rules))||JSON.stringify({miss,display:getComputedStyle(p).display,rules:rules.slice(0,200)});`) });
add(BILL, "doc-actions-have-words", 360, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-print]'));const txt=(s)=>document.querySelector(s)?.textContent.trim();const hint=document.querySelector('[data-document-actions]').innerText;return (txt('[data-print]')==='Print or save as PDF'&&txt('[data-whatsapp]')==='Share on WhatsApp'&&txt('[data-copy]')==='Copy message'&&hint.includes('Save as PDF')&&hint.includes('94150 00020'))||hint.slice(0,300);`) });
add(BILL, "doc-print-button-prints", 1280, { shot: false,
  action: act(`window.__printed=0;window.print=()=>{window.__printed++;};const b=await until(()=>document.querySelector('[data-print]'));b.click();await sleep(200);`),
  expect: exp(`return window.__printed===1||('print was called '+window.__printed+' times');`) });

// ---------- WhatsApp: the link has the client's number and the message (read, not opened) ----------
add(BILL, "doc-whatsapp-link", 1280, { shot: false,
  expect: exp(`const a=await until(()=>document.querySelector('a[data-whatsapp]'));await until(()=>a.href.includes('919415000020'));const u=new URL(a.href);const text=u.searchParams.get('text')||'';const n=number();return (u.origin+u.pathname==='https://wa.me/919415000020'&&text===message()&&text.startsWith('Namaste Rajesh Sharma,')&&text.includes(n)&&text.includes('₹8,58,450')&&text.includes('Ambika Groups')&&!/[{}]/.test(text))||a.href;`) });

// ---------- a share is logged, and is still listed after a reload ----------
add(BILL, "doc-share-logged", 1280, { reload: true, viewport: true,
  action: act(`window.__opened=[];window.open=(u)=>{window.__opened.push(String(u));return null;};const a=await until(()=>document.querySelector('a[data-whatsapp]'));await until(()=>a.href.includes('919415000020'));const log=await until(()=>{const l=document.querySelector('[data-share-log]');return l&&l.dataset.count!==''&&l;});const before=Number(log.dataset.count);a.click();const ok=await until(()=>Number(document.querySelector('[data-share-log]').dataset.count)===before+1);if(!ok)throw new Error('the share was not logged');if(window.__opened.length!==1||!window.__opened[0].startsWith('https://wa.me/919415000020?text='))throw new Error('opened: '+window.__opened.join(' , '));await sleep(400);`),
  expect: exp(`const row=await until(()=>document.querySelector('[data-share-log] li[data-channel=whatsapp]'));return (!!row&&row.innerText.includes('WhatsApp')&&row.innerText.includes('94150 00020')&&row.innerText.includes('Anil Mishra'))||(document.querySelector('[data-share-log]')?.innerText||main().slice(0,200));`) });

// ---------- Hindi ----------
add(BILL, "document-bill", 360, { lang: "hi", state: "hi",
  expect: exp(`const ok=await until(()=>document.querySelector('[data-print]')?.textContent.includes('प्रिंट')&&sheet()?.querySelector('h1')?.textContent==='टैक्स इनवॉइस'&&message().startsWith('नमस्ते'));const t=sheetText();return (!!ok&&t.includes('बिल किसके नाम')&&t.includes('कुल रकम')&&t.includes('${TOTAL}')&&!/[०-९]/.test(t+message())&&fits())||t.slice(0,300);`) });
add(BILL, "doc-language-choice", 1280, { lang: "hi", shot: false,
  action: act(`await until(()=>sheet()?.querySelector('h1')?.textContent==='टैक्स इनवॉइस');document.querySelector('[data-doc-lang-en]').click();await sleep(300);`),
  expect: exp(`const ok=await until(()=>sheet()?.querySelector('h1')?.textContent==='Tax invoice'&&message().startsWith('Namaste'));return (!!ok&&document.querySelector('[data-print]').textContent.includes('प्रिंट')&&printRoot().querySelector('.ag-doc h1').textContent==='Tax invoice')||sheetText().slice(0,200);`) });

// ---------- who may open it ----------
add(BILL, "doc-ca-reads", 1280, { role: "uCa", state: "ca",
  expect: exp(`await until(sheet);const a=await until(()=>document.querySelector('a[data-whatsapp]'));return (sheetText().includes('Rajesh Sharma')&&a.href.startsWith('https://wa.me/?text=')&&!document.querySelector('[data-share-log]'))||a.href;`) });
add(BILL, "doc-viewer-refused", 1280, { role: "uViewer", shot: false, expect: exp(`await until(()=>document.querySelector('[data-no-access]'));return (!!document.querySelector('[data-no-access]')&&!sheet()&&!printRoot())||main().slice(0,200);`) });
add(BILL, "doc-supervisor-refused", 360, { role: "uSupShivNagar", shot: false, expect: exp(`await until(()=>document.querySelector('[data-no-access]'));return (!!document.querySelector('[data-no-access]')&&!sheet())||main().slice(0,200);`) });
add("/billing/document/?type=invoice&id=nothingHere", "doc-not-found", 1280, { shot: false, expect: exp(`await until(()=>document.querySelector('[data-not-found-record]'));return !!document.querySelector('[data-not-found-record]')||main().slice(0,200);`) });
add("/billing/document/?type=letter&id=invShBrickwork", "doc-unknown-kind", 360, { shot: false, expect: exp(`await until(()=>document.querySelector('[data-not-found-record]'));return (!!document.querySelector('[data-not-found-record]')&&!sheet())||main().slice(0,200);`) });

writeFileSync(new URL("./documents.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
