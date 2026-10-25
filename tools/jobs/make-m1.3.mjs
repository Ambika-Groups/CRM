// Builds tools/jobs/m1.3.json: the M1.3 labour screens by role, width, theme and language; interactive checks for the
// M1.3 brief (3 taps per worker, offline and sync, the lock, mark paid, approvals, no ₹ for site roles, 4G timing);
// the QA N1 persistence checks (save → reload → still there) for every create, edit, delete and approve flow; and the
// QA N2–N13 fixes. Jobs share one browser profile, so the demo data carries over from job to job in this order.
// Usage: node tools/jobs/make-m1.3.mjs
import { writeFileSync } from "node:fs";

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=6000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const byLabel=(txt)=>{const root=document.querySelector('[role=dialog]')||document;const l=[...root.querySelectorAll('label,legend')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim()===txt)||[...root.querySelectorAll('label')].find(x=>x.textContent.trim().startsWith(txt));if(!l)throw new Error('no label: '+txt);return l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea');};
const fill=(txt,v)=>{const el=byLabel(txt);const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const btn=(txt)=>{const d=document.querySelector('[role=dialog]');const pool=d?[...d.querySelectorAll('button,a')]:[...document.querySelectorAll('button,a')];return pool.find(x=>x.textContent.trim().startsWith(txt)&&!x.disabled);};
const click=async(txt)=>{const b=await until(()=>btn(txt));if(!b)throw new Error('no button: '+txt);b.click();await sleep(400);};
const main=()=>document.querySelector('main').innerText;
`;
const act = (body) => H + body;
const exp = (body) => H + body;

// ---------- QA N1: save → reload → still there (run first, on fresh demo data) ----------
add("/clients/edit/", "n1-client-create", 1280, { reload: true, shot: true,
  action: act(`fill('Client name','QA Persist Client');fill('Phone','0522 2345678');await click('Save');await until(()=>location.pathname.includes('/clients/view/'));await sleep(300);`),
  expect: exp(`await until(()=>document.querySelector('h1')?.textContent.includes('QA Persist Client'));return (location.pathname.includes('/clients/view/')&&document.querySelector('h1').textContent.includes('QA Persist Client')&&main().includes('0522 2345678'))||main().slice(0,200);`) });
add("/clients/edit/?id=clNagarNigam", "n1-client-edit", 1280, { shot: false, reload: true,
  action: act(`await until(()=>byLabel('Notes')?.value!==undefined&&byLabel('Client name').value);fill('Notes','Edited by QA check');await click('Save');await until(()=>location.pathname.includes('/clients/view/'));`),
  expect: exp(`await until(()=>main().includes('Edited by QA check'));return main().includes('Edited by QA check')||main().slice(0,200);`) });
add("/labour/workers/edit/", "n1-worker-create", 1280, { shot: false, reload: true,
  action: act(`fill('Name','QA Persist Worker');fill('Mobile number','98390 77777');await click('Save');await until(()=>location.pathname.includes('/workers/view/'));`),
  expect: exp(`await until(()=>document.querySelector('h1')?.textContent.includes('QA Persist Worker'));return document.querySelector('h1')?.textContent.includes('QA Persist Worker')||main().slice(0,200);`) });
add("/labour/workers/edit/?id=w001", "n1-worker-edit", 1280, { shot: false, reload: true,
  action: act(`await until(()=>byLabel('Name').value);fill('Emergency contact','QA wife 98390 11111');await click('Save');await until(()=>location.pathname.includes('/workers/view/'));`),
  expect: exp(`await until(()=>main().includes('QA wife'));return main().includes('QA wife 98390 11111')||main().slice(0,200);`) });
const newProject = (name, kind = 'drain') => `fill('Project name','${name}');fill('Project type','government');await until(()=>[...byLabel('Kind of work').options].some(o=>o.value==='${kind}'));fill('Kind of work','${kind}');fill('Client','clNagarNigam');fill('Start date','01/11/2026');fill('Expected end date','31/03/2027');await click('Next');await until(()=>main().includes('Step 2 of 3'));fill('Department / office','PWD Lucknow');await click('Next');await until(()=>main().includes('Step 3 of 3'));`;
add("/projects/new/", "n1-project-create", 1280, { reload: true, shot: true,
  action: act(`${newProject("QA Persist Drain")}window.__n7=main().includes('Not entered')&&!/Budget\\s*₹0/.test(main());await click('Create project');await until(()=>location.pathname.includes('/projects/view/'));`),
  expect: exp(`await until(()=>document.querySelector('h1')?.textContent.includes('QA Persist Drain'));return (document.querySelector('h1')?.textContent.includes('QA Persist Drain')&&main().includes('AG-P-0004'))||main().slice(0,200);`) });
add("/projects/new/", "n7-not-entered", 1280, { shot: true, viewport: true,
  action: act(newProject('QA Check Step', 'road')),
  expect: exp(`return (main().includes('Not entered')&&!/₹0(?![\\d,])/.test(main()))||main().slice(0,300);`) });
add("/projects/edit/?id=projSharma", "n1-project-edit", 1280, { shot: false, reload: true,
  action: act(`await until(()=>byLabel('Project name').value);fill('Project name','Sharma Villa, Indira Nagar (QA)');await click('Next');await click('Next');await click('Save');await until(()=>location.pathname.includes('/projects/view/'));`),
  expect: exp(`await until(()=>document.querySelector('h1')?.textContent.includes('(QA)'));return document.querySelector('h1')?.textContent.includes('Sharma Villa, Indira Nagar (QA)')||main().slice(0,200);`) });
add("/projects/new/", "n1-project-delete", 1280, { shot: false, reload: true,
  action: act(`${newProject("QA Delete Me")}await click('Create project');await until(()=>location.pathname.includes('/projects/view/')&&document.querySelector('h1')?.textContent.includes('QA Delete Me'));await click('Delete');await until(()=>document.querySelector('[role=dialog]'));[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Delete').click();await until(()=>location.pathname==='/projects/');await sleep(300);`),
  expect: exp(`await sleep(800);return (location.pathname==='/projects/'&&!main().includes('QA Delete Me'))||main().slice(0,300);`) });
add("/projects/view/?id=projGomti", "n1-project-archive", 1280, { shot: false, reload: true,
  action: act(`await click('Archive');await until(()=>document.querySelector('[role=dialog]'));[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Archive').click();await sleep(800);`),
  expect: exp(`await until(()=>main().includes('Archived'));return main().includes('Archived')||main().slice(0,200);`) });
add("/projects/view/?id=projGomti", "n1-project-restore", 1280, { shot: false, reload: true,
  action: act(`await click('Restore');await sleep(800);`),
  expect: exp(`await sleep(800);return !main().includes('Archived')||'still archived';`) });

// ---------- M1.3 screens ----------
const ATT = "/labour/attendance/";
add(ATT, "attendance", 390, { role: "uSupShivNagar", lang: "en", state: "supervisor" });
add(ATT, "attendance", 360, { role: "uSupShivNagar", state: "supervisor-hi" });
add(ATT, "attendance", 390, { role: "uSupShivNagar", theme: "dark", lang: "en", state: "supervisor" });
add(ATT, "attendance", 768, { role: "uPm", state: "pm" });
add(ATT, "attendance", 1280);
add(`${ATT}?site=projShivNagar&date=2026-10-24`, "attendance", 1280, { state: "marked" });
add("/labour/attendance/sheet/?site=projShivNagar&month=2026-10", "sheet", 1280);
add("/labour/attendance/sheet/?site=projShivNagar&month=2026-10", "sheet", 390, { role: "uSupShivNagar", state: "supervisor" });
add("/labour/attendance/sheet/?site=projShivNagar&month=2026-10", "sheet", 768, { theme: "dark" });
add("/labour/payments/", "payments", 1280);
add("/labour/payments/", "payments", 390);
add("/labour/payments/", "payments", 1280, { theme: "dark" });
add("/labour/payments/new/?worker=w003", "payment-new", 1280);
add("/labour/payments/new/?worker=wMohanLal", "payment-new", 390, { state: "thekedar" });
add("/labour/payout/?site=projShivNagar", "payout", 1280);
add("/labour/payout/?site=projShivNagar", "payout", 390);
add("/labour/payout/?site=projShivNagar", "payout", 1280, { lang: "hi", state: "hi" });
add("/labour/workers/view/?id=w003", "worker-ledger", 1280);
add("/labour/workers/view/?id=w003", "worker-ledger", 390);
add("/labour/workers/view/?id=wMohanLal", "thekedar-contracts", 1280);
add("/labour/workers/view/?id=wMohanLal", "thekedar-contracts", 768, { theme: "dark" });
const WF = "/projects/view/?id=projShivNagar&tab=workforce";
add(WF, "workforce", 1280, { state: "owner" });
add(WF, "workforce", 390, { state: "owner" });
add(WF, "workforce", 1280, { role: "uPm", state: "pm" });
add(WF, "workforce", 390, { role: "uSupShivNagar", state: "supervisor" });
add("/projects/view/?id=projShivNagar", "project-overview", 1280, { state: "workers-today" });
add("/projects/edit/?id=projShivNagar", "project-edit", 1280, { state: "checkin-options" });
add("/labour/", "labour", 1280);
add("/labour/", "labour", 390, { role: "uSupShivNagar", state: "supervisor" });

// ---------- M1.3 interactive checks ----------
// 3 taps or fewer per worker (§4A.10): count every click per worker row and outside rows.
const tapCounter = `window.__taps={rows:{},global:0};document.addEventListener('click',(e)=>{const r=e.target.closest('[data-worker]');if(r){window.__taps.rows[r.dataset.worker]=(window.__taps.rows[r.dataset.worker]||0)+1;}else{window.__taps.global++;}},true);`;
add(`${ATT}?site=projShivNagar`, "m13-three-taps", 390, { role: "uSupShivNagar", lang: "en", viewport: true,
  action: act(`await until(()=>document.querySelectorAll('[data-worker]').length>5);${tapCounter}
const rows=[...document.querySelectorAll('[data-worker]')];
document.querySelector('[data-all-present]').click();await sleep(150);
rows[0].querySelector('[data-set=absent]').click();await sleep(100);
rows[1].querySelector('[data-set=half_day]').click();await sleep(100);
rows[2].querySelector('[data-set=overtime]').click();await sleep(150);
rows[2].querySelector('[data-ot-more]').click();await sleep(100);
rows[3].querySelector('[data-set=leave]').click();await sleep(100);
window.__ids=rows.slice(0,4).map(r=>r.dataset.worker);
document.querySelector('[data-save]').click();await until(()=>document.querySelector('[data-save]')?.disabled,15000);await sleep(600);`),
  expect: exp(`const t=window.__taps;const per=Object.values(t.rows);const max=Math.max(...per);const rows=[...document.querySelectorAll('[data-worker]')];
const st=(i)=>rows[i].dataset.status;
return (max<=3&&t.global<=2&&st(0)==='absent'&&st(1)==='half_day'&&st(2)==='overtime'&&st(4)==='present'&&rows[2].querySelector('.ot-val').textContent.includes('3'))||JSON.stringify({t,s:rows.slice(0,5).map(r=>r.dataset.status)});`) });
add(`${ATT}?site=projShivNagar`, "m13-attendance-saved", 390, { role: "uSupShivNagar", lang: "en", shot: false, reload: true,
  expect: exp(`await until(()=>document.querySelectorAll('[data-worker]').length>5);await sleep(400);const rows=[...document.querySelectorAll('[data-worker]')];return (rows[0].dataset.status==='absent'&&rows[2].dataset.status==='overtime'&&rows.slice(4).every(r=>r.dataset.status==='present'))||rows.slice(0,6).map(r=>r.dataset.status).join(',');`) });
// Offline: the save is kept on the phone, the indicator shows it waiting; back online it syncs (§6.3, rule 11).
add(`${ATT}?site=projShivNagar&date=2026-10-24`, "m13-offline-queued", 390, { role: "uSupShivNagar", lang: "en", offline: "action", viewport: true,
  action: act(`await until(()=>document.querySelectorAll('[data-worker]').length>5);const rows=[...document.querySelectorAll('[data-worker]')];rows[5].querySelector('[data-set=absent]').click();await sleep(150);document.querySelector('[data-save]').click();await sleep(800);`),
  expect: exp(`const q=JSON.parse(localStorage.getItem('ag-queue')||'[]');const strip=document.querySelector('[data-offline-strip]');return (q.length===1&&!!strip&&document.querySelector('[data-sync-state]')?.dataset.syncState!=='synced')||JSON.stringify({q:q.length,strip:!!strip});`) });
add(`${ATT}?site=projShivNagar&date=2026-10-24`, "m13-offline-synced", 1280, { role: "uSupShivNagar", lang: "en", offline: "action-then-online", shot: false,
  action: act(`await until(()=>document.querySelectorAll('[data-worker]').length>5);const rows=[...document.querySelectorAll('[data-worker]')];window.__wid=rows[6].dataset.worker;rows[6].querySelector('[data-set=leave]').click();await sleep(150);document.querySelector('[data-save]').click();await sleep(800);window.__queued=JSON.parse(localStorage.getItem('ag-queue')||'[]').length;`),
  expect: exp(`await until(()=>JSON.parse(localStorage.getItem('ag-queue')||'[]').length===0,5000);await sleep(500);const r=document.querySelector('[data-worker="'+window.__wid+'"]');return (window.__queued>=1&&JSON.parse(localStorage.getItem('ag-queue')||'[]').length===0&&document.querySelector('[data-sync-state]')?.dataset.syncState==='synced'&&r.dataset.status==='leave')||JSON.stringify({q:window.__queued,left:localStorage.getItem('ag-queue'),s:r?.dataset.status});`) });
// The lock: a supervisor can't change a day older than the window, and is told what to do (D-25).
add(`${ATT}?site=projShivNagar&date=2026-10-20`, "m13-locked", 390, { role: "uSupShivNagar", lang: "en", viewport: true,
  expect: exp(`await until(()=>document.querySelectorAll('[data-worker]').length>5);const b=document.querySelector('[data-locked]');return (!!b&&!document.querySelector('[data-unlock]')&&document.querySelector('[data-set=absent]').disabled)||(b?.innerText??'no lock banner');`) });
add(`${ATT}?site=projShivNagar&date=2026-10-20`, "m13-owner-unlock", 1280, { reload: true, viewport: true,
  action: act(`await until(()=>document.querySelector('[data-unlock]'));document.querySelector('[data-unlock]').click();await until(()=>document.querySelector('[role=dialog]'));fill('Reason','Marks entered late');await click('Unlock this day');await sleep(800);`),
  expect: exp(`await until(()=>main().includes('Unlocked by the owner'));return (main().includes('Unlocked by the owner')&&!document.querySelector('[data-locked]'))||main().slice(0,300);`) });
add(`${ATT}?site=projShivNagar&date=2026-10-20`, "m13-unlocked-sup", 390, { role: "uSupShivNagar", lang: "en", shot: false,
  expect: exp(`await until(()=>document.querySelectorAll('[data-worker]').length>5);return (!document.querySelector('[data-locked]')&&!document.querySelector('[data-set=absent]').disabled)||'still locked';`) });
// Payments: an accountant's bonus above the limit waits; the owner approves it (D13, D-30); both survive a reload.
add("/labour/payments/new/?worker=w001", "m13-payment-pending", 1280, { role: "uAccountant", reload: true, shot: false,
  action: act(`await until(()=>document.querySelector('.picked'));await until(()=>byLabel('Project').value);fill('Type','bonus');await sleep(150);fill('Amount','30000');fill('Note','QA bonus');await click('Save payment');await until(()=>location.pathname==='/labour/payments/');await sleep(400);`),
  expect: exp(`await until(()=>document.querySelector('[data-pending]')?.innerText.includes('Suresh Pal'));return document.querySelector('[data-pending]').innerText.includes('Suresh Pal')||document.querySelector('[data-pending]')?.innerText.slice(0,300);`) });
add("/labour/payments/", "m13-payment-approve", 1280, { reload: true,
  action: act(`await until(()=>document.querySelector('[data-pending] [data-approve]'));const n=document.querySelectorAll('[data-pending] [data-payment]').length;window.__n=n;document.querySelector('[data-pending] [data-approve]').click();await sleep(1000);`),
  expect: exp(`await sleep(800);const left=document.querySelectorAll('[data-pending] [data-payment]').length;return (left===0)||('pending left: '+left);`) });
// Mark paid on the payout sheet (§6.4): after a reload nobody on the sheet is due anything.
add("/labour/payout/?site=projShivNagar", "m13-mark-paid", 1280, { reload: true, viewport: true,
  action: act(`await until(()=>document.querySelector('[data-mark-paid]'));document.querySelector('[data-mark-paid]').click();await until(()=>document.querySelector('[role=dialog]'));await sleep(200);[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim().startsWith('Mark')).click();await sleep(2500);`),
  expect: exp(`await until(()=>document.querySelector('[data-payout]'));await sleep(500);return (!document.querySelector('[data-mark-paid]')&&[...document.querySelectorAll('[data-row] input[type=checkbox]')].every(c=>c.disabled))||document.querySelector('[data-payout]')?.innerText.slice(0,300);`) });
add("/labour/workers/view/?id=wMohanLal", "m13-contract-new", 1280, { reload: true, shot: false,
  action: act(`await click('New contract');await until(()=>document.querySelector('[role=dialog]'));fill('Project','projShivNagar');fill('Scope of work','QA kerb stone fixing');fill('Paid','per_unit');fill('Unit','rmt');fill('Rate per unit','50');fill('Quantity in the scope','1000');await click('Save');await sleep(1000);`),
  expect: exp(`await until(()=>main().includes('QA kerb stone fixing'));return main().includes('QA kerb stone fixing')||main().slice(0,300);`) });
// Role scoping: no ₹ figure anywhere for the supervisor or the PM on labour screens (D-32, D-45, QA F1).
const noRupee = exp(`await sleep(1200);const t=main();return !/₹\\s?[0-9]/.test(t)||t.match(/.{0,40}₹\\s?[0-9].{0,20}/)[0];`);
add(WF, "m13-no-money-supervisor", 390, { role: "uSupShivNagar", shot: false, expect: noRupee });
add(WF, "m13-no-money-pm", 1280, { role: "uPm", shot: false, expect: noRupee });
add(ATT, "m13-no-money-attendance", 390, { role: "uPm", shot: false, expect: noRupee });
add("/labour/payments/", "m13-pm-payments", 1280, { role: "uPm", shot: false, expect: exp(`return !!document.querySelector('[data-no-access]')||main().slice(0,200);`) });
add("/labour/payout/", "m13-sup-payout", 390, { role: "uSupShivNagar", shot: false, expect: exp(`return !!document.querySelector('[data-no-access]')||main().slice(0,200);`) });
add(WF, "m13-workforce-summary", 1280, {
  expect: exp(`await until(()=>document.querySelector('[data-summary]'));const t=document.querySelector('[data-workforce]').innerText;return (t.includes('Mistri')&&t.includes('Through thekedar')&&t.includes('Balance due'))||t.slice(0,300);`) });

// ---------- QA N2–N13 ----------
add("/clients/edit/?id=clAwadh", "n2-sample-client-saves", 1280, { shot: false, reload: true,
  action: act(`await until(()=>byLabel('Client name').value);await click('Save');await until(()=>location.pathname.includes('/clients/view/'),4000);`),
  expect: exp(`return (location.pathname.includes('/clients/view/')&&main().includes('09AAACA1234B1ZG'))||main().slice(0,300);`) });
add(WF, "n5-role-labels", 1280, { shot: false,
  expect: exp(`await sleep(1200);const t=main();return (!/\\b(mistri|labour|helper)\\b/.test(t))||t.match(/.{0,30}\\b(mistri|labour|helper)\\b.{0,30}/)[0];`) });
add("/projects/view/?id=projSharma", "n6-dialog-focus", 1280, { shot: false,
  action: act(`await until(()=>btn('Archive'));const b=btn('Archive');b.focus();b.click();await until(()=>document.querySelector('[role=dialog]'));document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(500);window.__back=document.activeElement===b;`),
  expect: exp(`return window.__back===true||('focus is on '+document.activeElement?.tagName+' '+document.activeElement?.textContent?.slice(0,30));`) });
add("/projects/view/?id=projGomti", "n8-areas", 1280, { shot: false, expect: exp(`await until(()=>main().includes('sq ft'));return main().includes('28,800 sq ft')||main().slice(0,400);`) });
add("/projects/view/?id=projShivNagar", "n9-two-figures", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('.two-figures'));const d=[...document.querySelectorAll('.two-figures dt')].map(x=>x.textContent);return (d.join('|')==='Billed|Received')||d.join('|');`) });
add("/labour/workers/view/?id=wMohanLal", "n10-pm-thekedar", 1280, { role: "uPm",
  expect: exp(`await until(()=>document.querySelector('[data-contract-scopes]'));const t=main();return (t.includes('Mohan Lal')&&t.includes('square metre')===false&&t.includes('measured')&&!/₹\\s?[0-9]/.test(t))||t.slice(0,400);`) });
add("/", "n11-supervisor-search", 390, { role: "uSupShivNagar", lang: "en", viewport: true,
  action: act(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));await sleep(400);const i=document.querySelector('[data-palette] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'ajay');i.dispatchEvent(new Event('input',{bubbles:true}));await sleep(900);`),
  expect: exp(`const t=document.querySelector('[data-palette]')?.innerText??'';return t.includes('Ajay Yadav')||t.slice(0,200);`) });
// N12: the first screen under 2 s on throttled 4G (cold, no cache), for the owner and a supervisor on a phone.
add("/", "n12-4g-home", 390, { throttle: "4g", maxReadyMs: 2000, shot: false });
add("/", "n12-4g-home", 390, { throttle: "4g", maxReadyMs: 2000, role: "uSupShivNagar", shot: false, state: "supervisor" });
add(ATT, "n12-4g-attendance", 390, { throttle: "4g", maxReadyMs: 2000, role: "uSupShivNagar", shot: false });
add("/no-such-page/", "n13-hindi-404-title", 390, { mainStatus: 404, role: "uSupShivNagar", shot: false,
  expect: exp(`await sleep(400);return document.title.includes('पेज नहीं मिला')||document.title;`) });

// ---------- Dashboards (spec §11.1, §11.1a): one designed dashboard per role, 390 and 1280, light and dark ----------
const ROLES = [["uOwner", "owner"], ["uAccountant", "accountant"], ["uPm", "pm"], ["uSupShivNagar", "supervisor"], ["uViewer", "viewer"], ["uCa", "ca"]];
for (const [uid, role] of ROLES) for (const w of [390, 1280]) for (const theme of ["light", "dark"]) {
  add("/", `dashboard-${role}`, w, { role: uid, theme, lang: "en", expect: exp(`await until(()=>document.querySelector('[data-dashboard="${role}"]'));return true;`) });
}
add("/", "dashboard-owner", 390, { lang: "hi", state: "hi", role: "uSupShivNagar" });
const exact = (sel) => `(document.querySelector('${sel} [title]')?.getAttribute('title')||'')`;
// Totals agree across widgets computed separately from the rollups (core functions are checked to the paisa in DB-001…DB-007).
add("/", "dash-consistency", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-chart=chart-expense] .muted b')&&document.querySelector('[data-kpi=expense] [title]')&&document.querySelector('[data-chart=chart-ageing] .muted b'),10000);
const kpiExp=${exact("[data-kpi=expense]")};const drill=document.querySelector('[data-chart=chart-expense] .muted b').textContent;
const kpiOut=${exact("[data-kpi=outstanding]")};const age=document.querySelector('[data-chart=chart-ageing] .muted b').textContent;
const recv=document.querySelector('[data-kpi=to-receive] .value').textContent;
return (kpiExp===drill&&kpiOut===age&&recv===age)||JSON.stringify({kpiExp,drill,kpiOut,age,recv});`) });
// Every KPI opens its records: the filtered list matches the count.
add("/", "dash-click-active", 1280, { shot: false,
  action: act(`await until(()=>/\d/.test(document.querySelector('[data-kpi=active] .value')?.textContent||''));window.__n=document.querySelector('[data-kpi=active] .value').textContent.trim();document.querySelector('[data-kpi=active]').click();await until(()=>location.pathname==='/projects/');await sleep(1500);`),
  expect: exp(`const rows=document.querySelectorAll('table.data tbody tr');return (location.search.includes('f.status=in_progress')&&String(rows.length)===window.__n)||JSON.stringify({n:window.__n,rows:rows.length,url:location.search});`) });
add("/", "dash-click-delayed", 1280, { shot: false,
  action: act(`await until(()=>/\d/.test(document.querySelector('[data-kpi=delayed] .value')?.textContent||''));window.__n=document.querySelector('[data-kpi=delayed] .value').textContent.trim();document.querySelector('[data-kpi=delayed]').click();await until(()=>location.pathname==='/projects/');await sleep(1500);`),
  expect: exp(`const rows=document.querySelectorAll('table.data tbody tr');return String(rows.length)===window.__n||JSON.stringify({n:window.__n,rows:rows.length});`) });
add("/", "dash-drilldown", 1280, { viewport: false,
  action: act(`await until(()=>document.querySelector('[data-chart=chart-expense] svg'),10000);await sleep(800);const ch=document.querySelector('[data-chart=chart-expense] [data-as-table]');ch.click();await sleep(400);`),
  expect: exp(`const t=document.querySelector('[data-chart=chart-expense] table');return (!!t&&t.innerText.includes('Materials'))||'no table';`) });
// Role scoping: each dashboard shows only what the role may read.
const has = (sel) => `!!document.querySelector('${sel}')`;
add("/", "dash-scope-pm", 1280, { role: "uPm", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-dashboard=pm]'));await sleep(1500);return (!${has("[data-kpi=billed]")}&&!${has("[data-kpi=received]")}&&!${has("[data-kpi=outstanding]")}&&!${has("[data-chart=chart-ageing]")}&&!${has("[data-widget=balances]")}&&${has("[data-chart=chart-projects]")})||'pm sees billing';`) });
add("/", "dash-scope-supervisor", 390, { role: "uSupShivNagar", lang: "en", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-widget=site-today]'));await sleep(1500);const t=main();return (!/₹\s?[0-9]/.test(t)&&!${has("[data-kpi]")})||t.match(/.{0,40}₹.{0,20}/)?.[0];`) });
add("/", "dash-scope-viewer", 1280, { role: "uViewer", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-dashboard=viewer]'));await sleep(1500);return (!${has("[data-kpi=outstanding]")}&&!${has("[data-widget=balances]")}&&!${has("[data-widget=activity]")}&&!${has("[data-widget=approvals]")}&&${has("[data-chart=chart-expense]")})||'viewer sees too much';`) });
add("/", "dash-scope-ca", 1280, { role: "uCa", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-dashboard=ca]'));await sleep(1500);return (!${has("[data-kpi=active]")}&&!${has("[data-widget=projects]")}&&${has("[data-widget=exports]")}&&${has("[data-chart=chart-ageing]")})||'ca scope wrong';`) });
add("/", "dash-period", 1280, { shot: false,
  action: act(`await until(()=>document.querySelector('[data-kpi=expense] [title]'));window.__m=${exact("[data-kpi=expense]")};document.querySelector('[data-period=fy]').click();await sleep(1500);`),
  expect: exp(`const fy=${exact("[data-kpi=expense]")};return (fy!==window.__m&&document.querySelector('[data-period=fy]').getAttribute('aria-pressed')==='true')||JSON.stringify({m:window.__m,fy});`) });
// §11.1: the dashboard under 3 s on throttled 4G (cold, no cache), charts drawn.
add("/", "dash-4g-owner", 1280, { throttle: "4g", keepThrottle: true, shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-kpi=expense] [title]'),20000);const k=Math.round(performance.now());await until(()=>document.querySelectorAll('[data-chart] svg').length>=6,20000);const ms=Math.round(performance.now());return ms<=3000||('KPIs at '+k+' ms; all charts drawn at '+ms+' ms');`) });
add("/", "dash-4g-supervisor", 390, { throttle: "4g", keepThrottle: true, role: "uSupShivNagar", shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-widget=site-today] .st-stats'),20000);const ms=Math.round(performance.now());return ms<=3000||('site card after '+ms+' ms');`) });

// QA note after N1: a missing record says "Not found"; a real permission block still says "no access".
add("/clients/view/?id=noSuchClient", "nf-missing-client", 1280, { expect: exp(`await until(()=>document.querySelector("[data-not-found-record]")||document.querySelector("[data-no-access]"));return (!!document.querySelector("[data-not-found-record]")&&!document.querySelector("[data-no-access]"))||main().slice(0,200);`) });
add("/projects/view/?id=noSuchProject", "nf-missing-project", 390, { shot: false, expect: exp(`await until(()=>document.querySelector("[data-not-found-record]")||document.querySelector("[data-no-access]"));return !!document.querySelector("[data-not-found-record]")||main().slice(0,200);`) });
add("/projects/view/?id=projGomti", "nf-denied-project", 1280, { role: "uPm", shot: false, expect: exp(`await until(()=>document.querySelector("[data-not-found-record]")||document.querySelector("[data-no-access]"));return !!document.querySelector("[data-no-access]")||main().slice(0,200);`) });

writeFileSync(new URL("./m1.3.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
