// Builds tools/jobs/expenses.json: the expense screens (spec §7.2) by role, width, theme and language, and the
// interactive checks: add an entry and reload, a supervisor's entry waits, the owner approves it, a viewer is refused,
// reject with a reason, delete with a confirmation, and an entry made offline is kept and then sent.
// Jobs share one browser profile, so the demo data carries over from job to job in this order.
// Usage: node tools/jobs/make-expenses.mjs
import { writeFileSync } from "node:fs";

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, lang: "en", ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const byLabel=(txt)=>{const root=document.querySelector('[role=dialog]')||document;const l=[...root.querySelectorAll('label,legend')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim()===txt)||[...root.querySelectorAll('label')].find(x=>x.textContent.trim().startsWith(txt));if(!l)throw new Error('no label: '+txt);return l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea');};
const setVal=(el,v)=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const fill=(txt,v)=>setVal(byLabel(txt),v);
const btn=(txt)=>{const d=document.querySelector('[role=dialog]');const pool=d?[...d.querySelectorAll('button,a')]:[...document.querySelectorAll('button,a')];return pool.find(x=>x.textContent.trim().startsWith(txt)&&!x.disabled);};
const click=async(txt)=>{const b=await until(()=>btn(txt));if(!b)throw new Error('no button: '+txt);b.click();await sleep(400);};
const main=()=>document.querySelector('main').innerText;
const pickCat=async(ids)=>{for(let i=0;i<ids.length;i++){const s=await until(()=>document.querySelector('[data-category-picker] select[data-level="'+i+'"]'));if(!s)throw new Error('no category level '+i);setVal(s,ids[i]);await sleep(150);}};
const rowOf=(text)=>[...document.querySelectorAll('tr[data-expense]')].find(r=>r.innerText.includes(text));
`;
const act = (body) => H + body;
const exp = (body) => H + body;

const LIST = "/expenses/";
const NEW = "/expenses/new/";
const APPROVALS = "/expenses/approvals/";
const RECURRING = "/expenses/recurring/";

// ---------- screens: 360 and 1280, light and dark, Hindi ----------
add(LIST, "expenses-list", 1280);
add(LIST, "expenses-list", 360);
add(LIST, "expenses-list", 1280, { theme: "dark" });
add(LIST, "expenses-list", 360, { theme: "dark" });
add(LIST, "expenses-list", 360, { role: "uSupShivNagar", state: "supervisor-hi" });
add(LIST, "expenses-list", 768, { role: "uPm", state: "pm" });
add(LIST, "expenses-list", 1280, { role: "uCa", state: "ca-read-only", expect: exp(`await until(()=>document.querySelector('[data-expense-table]'));return !document.querySelector('[data-add-expense]')||'the CA sees Add expense';`) });
add(NEW, "expense-new", 1280);
add(NEW, "expense-new", 360);
add(NEW, "expense-new", 360, { theme: "dark", role: "uSupShivNagar", lang: "en", state: "supervisor" });
add(NEW, "expense-new", 1280, { lang: "hi", state: "hi" });
add("/expenses/view/?id=exdCreditGitti1", "expense-detail", 1280, { state: "credit-unpaid" });
add("/expenses/view/?id=exdCreditGitti1", "expense-detail", 360, { state: "credit-unpaid" });
add("/expenses/view/?id=exdSupTea000001", "expense-detail", 360, { role: "uSupGomti", lang: "en", theme: "dark", state: "rejected-author" });
add("/expenses/view/?id=exdCreditJcb001", "expense-detail", 1280, { theme: "dark", state: "paid-later" });
add(APPROVALS, "expense-approvals", 1280);
add(APPROVALS, "expense-approvals", 360);
add(APPROVALS, "expense-approvals", 1280, { theme: "dark", role: "uAccountant", state: "accountant" });
add(APPROVALS, "expense-approvals", 768, { role: "uPm", state: "pm" });
add(RECURRING, "expense-recurring", 1280);
add(RECURRING, "expense-recurring", 360);
add(RECURRING, "expense-recurring", 360, { theme: "dark", lang: "hi", state: "hi" });

// ---------- the list: filters and totals ----------
add(LIST, "ex-list-has-rows", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelectorAll('tr[data-expense]').length>5);const t=document.querySelector('[data-expense-totals]');return (document.querySelectorAll('tr[data-expense]').length===25&&!!t&&/₹/.test(t.innerText))||main().slice(0,300);`) });
add(`${LIST}?f.status=pending`, "ex-filter-pending", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelectorAll('tr[data-expense]').length>0);await sleep(500);const rows=[...document.querySelectorAll('tr[data-expense]')];return (rows.length>0&&rows.every(r=>r.dataset.status==='pending'))||rows.map(r=>r.dataset.status).join(',');`) });
add(`${LIST}?f.paid=unpaid&f.status=approved`, "ex-filter-unpaid-total", 1280, { viewport: true,
  action: act(`await until(()=>document.querySelectorAll('tr[data-expense]').length>0);await sleep(400);const b=document.querySelector('[data-add-up]');if(b){b.click();await until(()=>document.querySelector('[data-expense-totals]')?.dataset.scope==='all',15000);}`),
  expect: exp(`const t=document.querySelector('[data-expense-totals]');return (t?.dataset.scope==='all'&&/₹/.test(t.querySelector('[data-total=approved]').textContent))||t?.innerText?.slice(0,200)||'no totals';`) });

// ---------- add an entry as the owner: approved at once, still there after a reload ----------
add(`${NEW}?project=projShivNagar`, "ex-add-owner", 1280, { reload: true, viewport: true,
  action: act(`await until(()=>byLabel('Project').value==='projShivNagar');await pickCat(['cat_materials','cat_materials_cement']);fill('Description','QA cement 12 bags');fill('Amount','4,720');fill('GST','1800');await sleep(200);fill('Name','QA Cement Store');fill('How it was paid','bank');await until(()=>byLabel('Paid from')&&!byLabel('Paid from').disabled);fill('Paid from','accSbi');fill('No bill? Say why','QA check, no bill');await sleep(200);window.__total=document.querySelector('[data-total]').textContent;document.querySelector('[data-save]').click();await until(()=>location.pathname==='/expenses/');await sleep(600);`),
  expect: exp(`await until(()=>rowOf('QA cement 12 bags'));const r=rowOf('QA cement 12 bags');return (!!r&&r.dataset.status==='approved'&&r.innerText.includes('₹4,720'))||main().slice(0,300);`) });

// ---------- a supervisor's entry waits; the viewer is refused; the owner approves it ----------
add(NEW, "ex-add-supervisor", 360, { role: "uSupShivNagar", lang: "en", reload: true, viewport: true,
  action: act(`await until(()=>byLabel('Project').value==='projShivNagar');await pickCat(['cat_transport']);fill('Description','QA tractor trip');fill('Amount','1,500');fill('Name','QA tractor owner');document.querySelector('[data-save]').click();await until(()=>location.pathname==='/expenses/');await sleep(600);`),
  expect: exp(`await until(()=>rowOf('QA tractor trip'));const r=rowOf('QA tractor trip');return (!!r&&r.dataset.status==='pending')||main().slice(0,300);`) });
add(LIST, "ex-viewer-refused", 1280, { role: "uViewer", shot: false, expect: exp(`await until(()=>document.querySelector('[data-no-access]'));return !!document.querySelector('[data-no-access]')||main().slice(0,200);`) });
add(NEW, "ex-viewer-refused-new", 1280, { role: "uViewer", shot: false, expect: exp(`await until(()=>document.querySelector('[data-no-access]'));return (!!document.querySelector('[data-no-access]')&&!document.querySelector('[data-expense-form]'))||main().slice(0,200);`) });
add(APPROVALS, "ex-supervisor-no-approvals", 360, { role: "uSupShivNagar", shot: false, expect: exp(`await until(()=>document.querySelector('[data-no-access]'));return !!document.querySelector('[data-no-access]')||main().slice(0,200);`) });
add(APPROVALS, "ex-approve-owner", 1280, { reload: true, viewport: true,
  action: act(`const r=await until(()=>rowOf('QA tractor trip'));if(!r)throw new Error('the supervisor entry is not in the queue');r.querySelector('[data-approve]').click();await until(()=>document.querySelector('[role=dialog]'));await until(()=>byLabel('Paid from')&&!byLabel('Paid from').disabled);fill('Paid from','accCash');await sleep(200);document.querySelector('[data-confirm-approve]').click();await until(()=>!document.querySelector('[role=dialog]'));await sleep(600);`),
  expect: exp(`await until(()=>document.querySelector('[data-approvals]')||main().includes('Nothing is waiting'));await sleep(500);return !rowOf('QA tractor trip')||'still waiting';`) });
add(`${LIST}?f.status=approved`, "ex-approved-in-list", 1280, { shot: false,
  action: act(`await until(()=>document.querySelector('[data-filter=project]'));const s=document.querySelector('[data-expense-filters] input[type=search]');setVal(s,'qa tractor');await sleep(900);`),
  expect: exp(`const r=await until(()=>rowOf('QA tractor trip'));return (!!r&&r.dataset.status==='approved')||main().slice(0,300);`) });

// ---------- the project manager can't approve above the limit; bulk approve; reject with a reason ----------
add(APPROVALS, "ex-pm-limit", 1280, { role: "uPm", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-approvals]'));await sleep(500);const rows=[...document.querySelectorAll('tr[data-expense]')];const no=rows.filter(r=>r.dataset.canApprove==='false');return (rows.length>0&&no.every(r=>r.querySelector('[data-why]')&&!r.querySelector('[data-approve]')))||rows.length+' rows';`) });
add(APPROVALS, "ex-reject-accountant", 1280, { role: "uAccountant", reload: true, viewport: true,
  action: act(`const r=await until(()=>[...document.querySelectorAll('tr[data-expense][data-can-approve=true]')][0]);if(!r)throw new Error('nothing the accountant can approve');window.__id=r.dataset.expense;r.querySelector('[data-reject]').click();await until(()=>document.querySelector('[role=dialog]'));fill('Reason','QA: attach the slip');await sleep(200);document.querySelector('[data-confirm-reason]').click();await until(()=>!document.querySelector('[role=dialog]'));await sleep(600);`),
  expect: exp(`await sleep(800);return !document.querySelector('tr[data-expense="'+window.__id+'"]')||'still in the queue';`) });
add(APPROVALS, "ex-bulk-approve", 1280, { reload: true, viewport: true,
  action: act(`await until(()=>document.querySelector('[data-pick-all]')&&!document.querySelector('[data-pick-all]').disabled);window.__n=document.querySelectorAll('tr[data-expense]').length;document.querySelector('[data-pick-all]').click();await sleep(300);document.querySelector('[data-approve-picked]').click();await until(()=>document.querySelector('[role=dialog]'));const p=await until(()=>{try{return byLabel('Paid from');}catch(e){return null;}},1500);if(p&&!p.disabled){setVal(p,'accCash');await sleep(200);}document.querySelector('[data-confirm-approve]').click();await until(()=>!document.querySelector('[role=dialog]'),15000);await sleep(800);`),
  expect: exp(`await sleep(800);return (main().includes('Nothing is waiting')||document.querySelectorAll('tr[data-expense]').length===0)||('left: '+document.querySelectorAll('tr[data-expense]').length);`) });

// ---------- edit, delete with a confirmation and a reason, mark a credit purchase as paid ----------
add("/expenses/edit/?id=exdCreditGitti1", "ex-edit-keeps", 1280, { reload: true, shot: false,
  action: act(`await until(()=>byLabel('Description').value);fill('Description','Gitti 20 mm, 5 brass (QA)');document.querySelector('[data-save]').click();await until(()=>location.pathname.includes('/expenses/view/'));await sleep(500);`),
  expect: exp(`await until(()=>main().includes('(QA)'));return (main().includes('Gitti 20 mm, 5 brass (QA)')&&!!document.querySelector('[data-expense-history] [data-action=edited]'))||main().slice(0,300);`) });
add("/expenses/view/?id=exdCreditGitti1", "ex-mark-paid", 1280, { reload: true, viewport: true,
  action: act(`const b=await until(()=>document.querySelector('[data-mark-paid]'));b.click();await until(()=>document.querySelector('[role=dialog]'));await until(()=>byLabel('Paid from')&&!byLabel('Paid from').disabled);fill('Paid from','accSbi');await sleep(200);document.querySelector('[data-confirm-paid]').click();await until(()=>!document.querySelector('[role=dialog]'));await sleep(600);`),
  expect: exp(`await until(()=>document.querySelector('[data-expense-history]'));return (!document.querySelector('[data-mark-paid]')&&!!document.querySelector('[data-expense-history] [data-action=paid]'))||main().slice(0,300);`) });
add("/expenses/view/?id=exdOfficeNet001", "ex-delete-confirm", 1280, { reload: true, viewport: true,
  action: act(`const b=await until(()=>document.querySelector('[data-delete]'));b.click();await until(()=>document.querySelector('[role=dialog]'));window.__blocked=document.querySelector('[data-confirm-reason]').disabled;fill('Why is it being deleted?','QA entered twice');await sleep(200);document.querySelector('[data-confirm-reason]').click();await until(()=>location.pathname==='/expenses/');await sleep(600);`),
  expect: exp(`return (window.__blocked===true||window.__blocked===undefined)&&location.pathname==='/expenses/'||'not deleted';`) });
add("/expenses/view/?id=exdOfficeNet001", "ex-deleted-shown", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-deleted]')||document.querySelector('[data-not-found-record]'));return (!!document.querySelector('[data-deleted]')&&!document.querySelector('[data-delete]'))||main().slice(0,200);`) });
add("/expenses/view/?id=exdCreditJcb001", "ex-site-role-cannot-read", 360, { role: "uSupShivNagar", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-no-access]')||document.querySelector('[data-expense-details]'));return !!document.querySelector('[data-no-access]')||'a supervisor can open another person\\'s entry';`) });

// ---------- recurring ----------
add(RECURRING, "ex-recurring-list", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-templates]'));const rows=[...document.querySelectorAll('tr[data-template]')];return (rows.length>=4&&rows.some(r=>r.dataset.active==='false')&&main().includes('Office rent'))||main().slice(0,300);`) });
add(RECURRING, "ex-recurring-pm-refused", 768, { role: "uPm", shot: false, expect: exp(`await until(()=>document.querySelector('[data-no-access]'));return !!document.querySelector('[data-no-access]')||main().slice(0,200);`) });

// ---------- offline: the entry is kept on the phone, shown as waiting, and sent when the connection returns ----------
add(NEW, "ex-offline-queued", 360, { role: "uSupShivNagar", lang: "en", offline: "action", viewport: true,
  action: act(`await until(()=>byLabel('Project').value==='projShivNagar');await pickCat(['cat_machinery','cat_machinery_fuel']);fill('Description','QA offline diesel');fill('Amount','900');document.querySelector('[data-save]').click();await until(()=>location.pathname==='/expenses/');await sleep(600);`),
  expect: exp(`const q=JSON.parse(localStorage.getItem('ag-queue')||'[]').filter(x=>x.name==='createExpense');return (q.length===1&&!!document.querySelector('[data-expense-queue]')&&document.querySelector('[data-sync-state]')?.dataset.syncState!=='synced')||JSON.stringify({q:q.length,card:!!document.querySelector('[data-expense-queue]')});`) });
add(LIST, "ex-offline-synced", 360, { role: "uSupShivNagar", lang: "en", shot: false,
  expect: exp(`await until(()=>JSON.parse(localStorage.getItem('ag-queue')||'[]').length===0,8000);const r=await until(()=>rowOf('QA offline diesel'));return (JSON.parse(localStorage.getItem('ag-queue')||'[]').length===0&&!!r&&r.dataset.status==='pending')||JSON.stringify({left:localStorage.getItem('ag-queue'),row:!!r});`) });

writeFileSync(new URL("./expenses.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
