// Builds tools/jobs/accounts.json: the Accounts screens (list, cash book and bank book, transfer, other entry, entries,
// month lock, export for the CA) by role, width, theme and language, and the interactive checks: a transfer changes
// both books and survives a reload, the book's pages join up, roles that may not open Accounts are refused, the month
// lock refuses in plain words, and the export file's totals agree with the dashboard. Demo mode. Jobs share one browser
// profile, so the demo data carries over from job to job in this order.
// Usage: node tools/jobs/make-accounts.mjs
import { writeFileSync } from "node:fs";

// The month lock check uses last month, so the jobs keep working as days go by.
const ist = new Date(Date.now() + 5.5 * 3600e3);
const lastMonthDate = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 15));
const LAST_MONTH = lastMonthDate.toISOString().slice(0, 7);
const LAST_MONTH_15 = `15/${LAST_MONTH.slice(5, 7)}/${LAST_MONTH.slice(0, 4)}`;

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const byLabel=(txt)=>{const root=document.querySelector('[role=dialog]')||document;const l=[...root.querySelectorAll('label,legend')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim()===txt)||[...root.querySelectorAll('label')].find(x=>x.textContent.trim().startsWith(txt));if(!l)throw new Error('no label: '+txt);return l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea');};
const fill=(txt,v)=>{const el=byLabel(txt);const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const btn=(txt)=>{const d=document.querySelector('[role=dialog]');const pool=d?[...d.querySelectorAll('button,a')]:[...document.querySelectorAll('main button,main a')];return pool.find(x=>x.textContent.trim().startsWith(txt)&&!x.disabled);};
const click=async(txt)=>{const b=await until(()=>btn(txt));if(!b)throw new Error('no button: '+txt);b.click();await sleep(400);};
const main=()=>document.querySelector('main').innerText;
const rs=(s)=>Math.round(Number(String(s).replace(/[₹,\\s]/g,'').replace('−','-'))*100);
const rowBal=(id)=>rs(document.querySelector('[data-account="'+id+'"] [data-balance] b').textContent);
const accountsReady=()=>until(()=>document.querySelectorAll('[data-account]').length>=3);
`;
const act = (body) => H + body;
const exp = (body) => H + body;
const denied = exp(`await until(()=>document.querySelector('[data-no-access]')||document.querySelector('[data-accounts]')||document.querySelector('form'));return !!document.querySelector('[data-no-access]')||main().slice(0,200);`);

// ---------- screens: 360 and 1280, light and dark, Hindi, the CA's read-only view ----------
const HOME = "/accounts/";
const listed = exp(`await accountsReady();return document.querySelectorAll('[data-account]').length>=3||main().slice(0,200);`);
for (const w of [360, 1280]) for (const theme of ["light", "dark"]) add(HOME, "accounts", w, { theme, expect: listed });
add(HOME, "accounts", 768, { expect: listed });
add(HOME, "accounts", 1440, { expect: listed });
add(HOME, "accounts", 360, { lang: "hi", state: "hi", expect: exp(`await accountsReady();return main().includes('हिसाब-किताब')&&main().includes('हाथ में नकद')||main().slice(0,200);`) });
add(HOME, "accounts", 1280, { role: "uAccountant", state: "accountant", expect: exp(`await accountsReady();return !!document.querySelector('[data-move-money]')||'accountant has no Move money';`) });
add(HOME, "accounts", 1280, { role: "uCa", state: "ca", expect: exp(`await accountsReady();return (!document.querySelector('[data-move-money]')&&main().includes('Only the owner and the accountant can change them'))||main().slice(0,300);`) });
const BOOK = "/accounts/book/?id=";
const bookReady = exp(`await until(()=>document.querySelector('[data-book] [data-edge=closing]')||document.querySelector('[data-book] [data-edge=carried]'));return !!document.querySelector('[data-book] [data-edge=opening]')||main().slice(0,300);`);
for (const w of [360, 1280]) for (const theme of ["light", "dark"]) add(`${BOOK}accSbi`, "bank-book", w, { theme, expect: bookReady });
add(`${BOOK}accCash`, "cash-book", 1280, { expect: bookReady });
add(`${BOOK}accCash`, "cash-book", 360, { lang: "hi", state: "hi", expect: exp(`await until(()=>document.querySelector('[data-book] [data-edge=opening]'));return main().includes('नकद बही')||main().slice(0,200);`) });
for (const [path, name] of [["/accounts/transfer/", "transfer"], ["/accounts/entry/", "entry"], ["/accounts/entries/", "entries"], ["/accounts/lock/", "month-lock"], ["/accounts/export/", "export"], ["/accounts/edit/", "account-add"], ["/accounts/edit/?id=accSbi", "account-edit"]]) {
  add(path, name, 1280);
  add(path, name, 360);
  add(path, name, 360, { theme: "dark" });
}
add("/accounts/transfer/", "transfer", 1280, { theme: "dark" });
add("/accounts/export/", "export", 1280, { lang: "hi", state: "hi" });

// ---------- totals: the three cards add up to the rows ----------
add(HOME, "acc-totals-add-up", 1280, { shot: false,
  expect: exp(`await accountsReady();const rows=[...document.querySelectorAll('[data-account]')];const sum=rows.reduce((s,r)=>s+rs(r.querySelector('[data-balance] b').textContent),0);
const t=(k)=>rs(document.querySelector('[data-total='+k+'] .value').textContent);
return (t('all')===sum&&t('cash')+t('bank')===t('all')&&t('cash')===rowBal('accCash'))||JSON.stringify({sum,all:t('all'),cash:t('cash'),bank:t('bank')});`) });

// ---------- a transfer: confirm first, both balances move, and it is still there after a reload ----------
add("/accounts/transfer/", "acc-transfer-saved", 1280, { reload: true, viewport: true,
  action: act(`await until(()=>byLabel('From account').options.length>3);
const bal=(id)=>rs([...byLabel('From account').options].find(o=>o.value===id).textContent.split('·').pop());
sessionStorage.setItem('acc-before',JSON.stringify({sbi:bal('accSbi'),cash:bal('accCash')}));
fill('From account','accSbi');await sleep(150);fill('To account','accCash');fill('Amount','12,345');fill('Note','QA transfer');
await click('Move money');const d=await until(()=>document.querySelector('[role=dialog]'));
window.__asked=!!d&&d.innerText.includes('₹12,345')&&d.innerText.includes('SBI current account');sessionStorage.setItem('acc-asked',String(window.__asked));
await click('Yes, move it');await until(()=>location.pathname==='/accounts/');await sleep(500);`),
  expect: exp(`await accountsReady();const b=JSON.parse(sessionStorage.getItem('acc-before'));
return (sessionStorage.getItem('acc-asked')==='true'&&rowBal('accSbi')===b.sbi-1234500&&rowBal('accCash')===b.cash+1234500)||JSON.stringify({b,sbi:rowBal('accSbi'),cash:rowBal('accCash'),asked:sessionStorage.getItem('acc-asked')});`) });
// The transfer is dated today, so it is on the last page of this month's book: walk to it.
const toLastPage = `for(let i=0;i<12;i++){await until(()=>document.querySelector('[data-book] [data-edge=closing]')||document.querySelector('[data-book] [data-edge=carried]'),12000);if(document.querySelector('[data-book] [data-edge=closing]'))break;document.querySelector('[data-next-page]').click();await sleep(700);}`;
const inBook = (side) => exp(`${toLastPage}
const row=[...document.querySelectorAll('[data-book] tr[data-row]')].find(r=>r.innerText.includes('QA transfer'));
const cells=row?[...row.querySelectorAll('td')].map(c=>c.innerText.trim()):[];
const closing=document.querySelector('[data-edge=closing] td.num').innerText.trim();const now=document.querySelector('[data-balance-now]').innerText.trim();
return (!!row&&cells[${side === "in" ? 2 : 3}]==='₹12,345'&&cells[${side === "in" ? 3 : 2}]==='—'&&closing===now&&document.querySelector('[data-closing]').innerText.trim()===now)||JSON.stringify({cells,closing,now});`);
add(`${BOOK}accSbi`, "acc-transfer-in-bank-book", 1280, { shot: true, state: "after-transfer", expect: inBook("out") });
add(`${BOOK}accCash`, "acc-transfer-in-cash-book", 360, { shot: true, state: "after-transfer", expect: inBook("in") });

// ---------- the book: pages of 50 join up (the balance carried is the balance brought forward) ----------
add(`${BOOK}accCash`, "acc-book-pages", 1280, { shot: false,
  action: act(`await until(()=>document.querySelector('[data-book] [data-edge=opening]'));await click('This financial year');
const c=await until(()=>document.querySelector('[data-book] [data-edge=carried] td.num'),12000);window.__carried=c?c.innerText.trim():null;window.__rows=document.querySelectorAll('[data-book] tr[data-row]').length;
document.querySelector('[data-next-page]').click();await until(()=>document.querySelector('[data-book] [data-edge=brought] td.num'),12000);await sleep(300);`),
  expect: exp(`const b=document.querySelector('[data-book] [data-edge=brought] td.num');return (window.__rows===50&&!!b&&b.innerText.trim()===window.__carried&&/^₹/.test(window.__carried))||JSON.stringify({rows:window.__rows,carried:window.__carried,brought:b?.innerText});`) });

// ---------- other entries: an owner's drawing, saved after a confirmation; then cancelled with a reason ----------
add("/accounts/entry/", "acc-entry-saved", 1280, { reload: true, shot: false,
  action: act(`await until(()=>byLabel('Paid from').options.length>2);fill('What is it?','drawing');await sleep(150);fill('Paid from','accHdfc');fill('Taken by','QA Owner');fill('Amount','5,000');
await click('Save entry');await until(()=>document.querySelector('[role=dialog]'));await click('Yes, save it');await until(()=>location.pathname==='/accounts/entries/');await sleep(500);`),
  expect: exp(`await until(()=>main().includes('QA Owner'));return (main().includes("Owner's drawings: QA Owner")&&main().includes('₹5,000'))||main().slice(0,400);`) });
add("/accounts/entries/", "acc-entry-cancelled", 1280, { reload: true, viewport: true,
  action: act(`const row=await until(()=>[...document.querySelectorAll('table.data tbody tr')].find(r=>r.innerText.includes('QA Owner')));
const t=row.querySelector('.icon-btn');t.focus();t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));
const item=await until(()=>document.querySelector('[role=menuitem]'));item.click();await until(()=>document.querySelector('[role=dialog]'));
fill('Reason','QA entered by mistake');await sleep(150);await click('Cancel the entry');await sleep(1200);`),
  expect: exp(`const row=await until(()=>[...document.querySelectorAll('table.data tbody tr')].find(r=>r.innerText.includes('QA Owner')));return (!!row&&row.innerText.includes('Cancelled'))||main().slice(0,400);`) });

// ---------- a new account, with its opening balance ----------
add("/accounts/edit/", "acc-account-added", 1280, { reload: true, shot: false,
  action: act(`await until(()=>byLabel('Account name'));fill('Account name','QA Petty cash');fill('Kind of account','cash');await sleep(150);fill('Opening balance','2,500');
await click('Save account');await until(()=>location.pathname==='/accounts/');await sleep(500);`),
  expect: exp(`await accountsReady();const row=[...document.querySelectorAll('[data-account]')].find(r=>r.innerText.includes('QA Petty cash'));return (!!row&&rs(row.querySelector('[data-balance] b').textContent)===250000)||main().slice(0,400);`) });

// ---------- who may open Accounts: the viewer and site roles are refused; the CA reads but can't move money ----------
add(HOME, "acc-viewer-refused", 1280, { role: "uViewer", shot: true, state: "viewer", expect: denied });
add(HOME, "acc-supervisor-refused", 360, { role: "uSupShivNagar", lang: "en", shot: true, state: "supervisor", expect: denied });
add(`${BOOK}accCash`, "acc-supervisor-book-refused", 360, { role: "uSupShivNagar", lang: "en", shot: false, expect: denied });
add(HOME, "acc-pm-refused", 1280, { role: "uPm", shot: false, expect: denied });
add("/accounts/transfer/", "acc-pm-transfer-refused", 1280, { role: "uPm", shot: false, expect: denied });
add("/accounts/export/", "acc-viewer-export-refused", 1280, { role: "uViewer", shot: false, expect: denied });
add("/accounts/transfer/", "acc-ca-transfer-refused", 1280, { role: "uCa", shot: false, expect: denied });
add("/accounts/edit/", "acc-ca-edit-refused", 1280, { role: "uCa", shot: false, expect: denied });
add(`${BOOK}accSbi`, "acc-ca-reads-book", 1280, { role: "uCa", shot: true, state: "ca", expect: bookReady });

// ---------- export for the CA: the file's totals agree with the dashboard ----------
const exported = (preset) => ({
  action: act(`await until(()=>document.querySelector('[data-prepare]')&&!document.querySelector('[data-prepare]').disabled);${preset ? `document.querySelector('[data-preset=${preset}]').click();await sleep(200);` : ""}
document.querySelector('[data-prepare]').click();await until(()=>document.querySelector('[data-export-result]'),30000);await sleep(300);`),
  expect: exp(`const r=document.querySelector('[data-export-result]');if(!r)return 'no result';const bad=[...r.querySelectorAll('[data-check-lines] tr[data-ok=false]')].map(x=>x.innerText);
return (r.dataset.check==='ok'&&bad.length===0&&r.querySelectorAll('[data-check-lines] tbody tr').length>=6&&/[0-9]+ lines/.test(r.querySelector('[data-ready]').innerText)&&!!r.querySelector('[data-download]'))||JSON.stringify({check:r.dataset.check,bad});`),
});
add("/accounts/export/", "acc-export-month", 1280, { state: "checked", viewport: false, ...exported(null) });
add("/accounts/export/", "acc-export-month", 360, { state: "checked", viewport: false, ...exported(null) });
add("/accounts/export/", "acc-export-last-month", 1280, { shot: false, ...exported("lastMonth") });
add("/accounts/export/", "acc-export-year", 1280, { theme: "dark", state: "checked-year", ...exported("fy") });
add("/accounts/export/", "acc-export-ca", 1280, { role: "uCa", shot: false, ...exported("lastMonth") });

// ---------- month lock: the owner locks last month; a transfer dated in it is refused in plain words; unlock needs a reason ----------
add("/accounts/lock/", "acc-lock-accountant", 1280, { role: "uAccountant", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-month-lock]'));return (!document.querySelector('[data-lock]')&&main().includes('Only the owner can lock or unlock a month'))||main().slice(0,300);`) });
add("/accounts/lock/", "acc-lock-month", 1280, { reload: true, viewport: true,
  action: act(`await until(()=>byLabel('Month').options.length>3);fill('Month','${LAST_MONTH}');fill('Note','QA: confirmed by the CA');await click('Lock month');
const d=await until(()=>document.querySelector('[role=dialog]'));window.__warned=!!d;await click('Yes, lock it');await until(()=>document.querySelector('[data-locked="${LAST_MONTH}"]'));await sleep(400);`),
  expect: exp(`await until(()=>document.querySelector('[data-locked="${LAST_MONTH}"]'));return (!!document.querySelector('[data-locked="${LAST_MONTH}"]')&&main().includes('QA: confirmed by the CA'))||main().slice(0,400);`) });
add("/accounts/transfer/", "acc-locked-month-refuses", 1280, { viewport: true, state: "locked",
  action: act(`await until(()=>byLabel('From account').options.length>3);fill('From account','accSbi');await sleep(150);fill('To account','accHdfc');fill('Amount','1,000');fill('Date','${LAST_MONTH_15}');
await click('Move money');await until(()=>document.querySelector('[role=dialog]'));await click('Yes, move it');await sleep(1200);`),
  expect: exp(`const t=main();return (location.pathname==='/accounts/transfer/'&&/is locked, so this transfer can't be saved/.test(t)&&t.includes('Ask the owner to unlock'))||t.slice(0,500);`) });
add("/accounts/lock/", "acc-unlock-month", 1280, { reload: true, shot: false,
  action: act(`const b=await until(()=>document.querySelector('[data-locked="${LAST_MONTH}"] [data-unlock]'));b.click();await until(()=>document.querySelector('[role=dialog]'));
window.__needsReason=document.querySelector('[data-unlock-confirm]').disabled;fill('Reason','QA: the CA asked for a correction');await sleep(150);document.querySelector('[data-unlock-confirm]').click();await sleep(1200);`),
  expect: exp(`await until(()=>document.querySelector('[data-month-lock]'));await sleep(500);return (!document.querySelector('[data-locked="${LAST_MONTH}"]'))||'still locked';`) });

writeFileSync(new URL("./accounts.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
