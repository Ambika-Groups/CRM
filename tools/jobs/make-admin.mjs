// Builds tools/jobs/admin.json: the admin screens (staff accounts in Settings > Users, the activity log, usage meters
// and the backup) by role, width, theme and language, and the interactive checks: add a person and see it in the
// activity log, the log's filters, who is refused, the password simulation, switching a person off and on, the usage
// meters, and a backup download whose generated object is checked (not the file on disk).
// Jobs share one browser profile, so the demo data carries over from job to job in this order.
// Needs the routes /settings/audit/ and /settings/data/ and StaffAccountsPanel mounted in the Settings Users tab.
// Usage: node tools/jobs/make-admin.mjs
import { writeFileSync } from "node:fs";

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, lang: "en", ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const q=(s)=>document.querySelector(s);
const qa=(s)=>[...document.querySelectorAll(s)];
const setVal=(el,v)=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const field=(root,txt)=>{const l=[...root.querySelectorAll('label')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim().startsWith(txt));if(!l)throw new Error('no label: '+txt);return l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea');};
const main=()=>document.querySelector('main').innerText;
const rows=()=>qa('tr[data-audit]');
const istDay=(plus)=>{const d=new Date(Date.now()+19800000+plus*86400000);const p=(n)=>String(n).padStart(2,'0');return p(d.getUTCDate())+'/'+p(d.getUTCMonth()+1)+'/'+d.getUTCFullYear();};
const dialog=()=>document.querySelector('[role=dialog]');
`;
const act = (body) => H + body;
const exp = (body) => H + body;

const USERS = "/settings/?tab=users";
const AUDIT = "/settings/audit/";
const DATA = "/settings/data/";

// ---------- screens: 360 and 1280, light and dark, Hindi ----------
const seen = (sel) => exp(`return !!(await until(()=>q('${sel}')))||main().slice(0,200);`);
add(USERS, "admin-staff", 1280, { expect: seen("[data-staff-accounts] tr[data-staff]") });
add(USERS, "admin-staff", 360, { expect: seen("[data-staff-accounts] tr[data-staff]") });
add(USERS, "admin-staff", 1280, { theme: "dark", expect: seen("[data-staff-accounts] tr[data-staff]") });
add(USERS, "admin-staff", 360, { theme: "dark", lang: "hi", state: "hi", expect: exp(`return !!(await until(()=>main().includes('साइन-इन, प्रोजेक्ट और पहुँच')))||main().slice(0,200);`) });
add(DATA, "admin-data", 1280, { expect: seen("[data-usage-panel] [data-meter]") });
add(DATA, "admin-data", 360, { expect: seen("[data-usage-panel] [data-meter]") });
add(DATA, "admin-data", 1280, { theme: "dark", expect: seen("[data-usage-panel] [data-meter]") });
add(DATA, "admin-data", 360, { theme: "dark", expect: seen("[data-usage-panel] [data-meter]") });
add(DATA, "admin-data", 360, { lang: "hi", state: "hi", expect: exp(`return !!(await until(()=>main().includes('डेटा और बैकअप')&&main().includes('मुफ़्त प्लान का उपयोग')&&!!q('[data-meter]')))||main().slice(0,200);`) });

// ---------- the backup reminder shows before any backup was made ----------
add(DATA, "ad-backup-due-first", 1280, { shot: false,
  expect: exp(`await until(()=>q('[data-backup-panel]'));const d=await until(()=>q('[data-backup-due]'));return (!!d&&d.innerText.includes('No backup has been downloaded yet'))||main().slice(0,300);`) });

// ---------- usage meters: four meters, the two that can be measured show a bar, the other two say so ----------
add(DATA, "ad-usage-meters", 1280, { viewport: true,
  expect: exp(`await until(()=>qa('[data-meter]').length===4);const m=Object.fromEntries(qa('[data-meter]').map(x=>[x.dataset.meter,x]));const docs=Number(q('[data-usage-documents]')?.dataset.usageDocuments||0);const ok=['storage','photos','reads','writes'].every(k=>!!m[k])&&m.storage.dataset.measured==='true'&&m.photos.dataset.measured==='true'&&!!m.storage.querySelector('[role=meter]')&&!!m.photos.querySelector('[data-state]')&&m.reads.dataset.measured==='false'&&!!m.reads.querySelector('[data-not-measured]')&&docs>0&&qa('[data-usage-counts] tr').length>3;return ok||JSON.stringify({n:qa('[data-meter]').length,docs,levels:qa('[data-meter]').map(x=>x.dataset.meter+':'+x.dataset.level+':'+x.dataset.measured)});`) });

// ---------- add a person with a project and a first password (a simulation in the demo), then find it in the log ----------
// (No "reload" here: the expect reads what the action noted on the page. The next jobs open fresh pages and find the person saved.)
add(USERS, "ad-add-person", 1280, { viewport: true,
  action: act(`const f=await until(()=>q('[data-add-person]'));if(!f)throw new Error('no add-person form');setVal(field(f,'Name'),'QA Site Person');setVal(field(f,'Email or mobile number'),'98123 45678');await sleep(200);const tick=await until(()=>f.querySelector('[data-project-ticks] input'));if(tick)tick.click();setVal(field(f,'First password'),'gitti-2026');await sleep(200);q('[data-add-person-save]').click();await until(()=>q('[data-handover]'),10000);window.__line=q('[data-handover-line]')?.textContent||'';window.__sim=q('[data-handover]')?.dataset.simulated;const b=q('[data-handover-done]');if(b)b.click();await sleep(500);`),
  expect: exp(`const r=await until(()=>qa('tr[data-staff]').find(x=>x.innerText.includes('QA Site Person')));return (!!r&&r.querySelector('[data-sign-in]').innerText.includes('98123 45678')&&r.innerText.includes('1 project')&&window.__sim==='true'&&window.__line==='Sign in with: 9812345678 and the password you set')||JSON.stringify({row:!!r,text:r?.innerText?.slice(0,120),line:window.__line,sim:window.__sim});`) });
add(USERS, "ad-add-person-saved", 1280, { shot: false,
  expect: exp(`const r=await until(()=>qa('tr[data-staff]').find(x=>x.innerText.includes('QA Site Person')));return (!!r&&r.dataset.active==='true'&&r.innerText.includes('Supervisor')&&r.innerText.includes('1 project'))||main().slice(0,300);`) });
add(USERS, "ad-add-person-bad-contact", 1280, { shot: false,
  action: act(`const f=await until(()=>q('[data-add-person]'));setVal(field(f,'Name'),'QA Nobody');setVal(field(f,'Email or mobile number'),'12345');await sleep(200);q('[data-add-person-save]').click();await sleep(800);`),
  expect: exp(`return (q('[data-add-person]').innerText.includes('Enter a 10-digit mobile number')&&!qa('tr[data-staff]').some(x=>x.innerText.includes('QA Nobody')))||q('[data-add-person]').innerText.slice(0,300);`) });
add(AUDIT, "ad-audit-lists-change", 1280, { viewport: true,
  expect: exp(`await until(()=>rows().length>0);const r=rows().find(x=>x.dataset.entity==='users'&&x.dataset.action==='create');return (!!r&&r.querySelector('[data-line]').innerText.includes("added a person's access")&&(r.querySelector('[data-open]')?.getAttribute('href')||'').includes('/settings/?tab=users')&&rows().length<=25)||main().slice(0,400);`) });
add(AUDIT, "admin-audit", 360, { expect: seen("tr[data-audit]") });
add(AUDIT, "admin-audit", 1280, { theme: "dark", expect: seen("tr[data-audit]") });
add(AUDIT, "admin-audit", 360, { theme: "dark", expect: seen("tr[data-audit]") });
add(AUDIT, "admin-audit", 1280, { lang: "hi", state: "hi", expect: exp(`return !!(await until(()=>main().includes('गतिविधि लॉग')&&rows().some(x=>x.innerText.includes('नया रिकॉर्ड जोड़ा'))))||main().slice(0,300);`) });

// ---------- filters: what, who, dates ----------
add(AUDIT, "ad-audit-filter-entity", 1280, { shot: false,
  action: act(`await until(()=>rows().length>0);setVal(q('[data-filter=entity]'),'users');await sleep(900);`),
  expect: exp(`await until(()=>rows().length>0&&rows().every(x=>x.dataset.entity==='users'));return (rows().length>0&&rows().every(x=>x.dataset.entity==='users')&&!!q('[data-clear]'))||rows().map(x=>x.dataset.entity).join(',');`) });
add(AUDIT, "ad-audit-filter-person", 1280, { shot: false,
  action: act(`await until(()=>rows().length>0);setVal(q('[data-filter=by]'),'uOwner');await sleep(900);window.__mine=rows().length>0&&rows().every(x=>x.dataset.by==='uOwner');setVal(q('[data-filter=by]'),'uViewer');await sleep(900);`),
  expect: exp(`await until(()=>rows().length===0);return (window.__mine===true&&rows().length===0&&main().includes('Nothing matches'))||JSON.stringify({mine:window.__mine,left:rows().length});`) });
add(AUDIT, "ad-audit-filter-dates", 1280, { shot: false,
  action: act(`await until(()=>rows().length>0);setVal(q('[data-filter=from]'),istDay(1));await sleep(900);window.__future=rows().length;setVal(q('[data-filter=from]'),istDay(0));setVal(q('[data-filter=to]'),istDay(0));await sleep(900);`),
  expect: exp(`await until(()=>rows().length>0);return (window.__future===0&&rows().length>0&&rows().some(x=>x.dataset.entity==='users'))||JSON.stringify({future:window.__future,today:rows().length});`) });

// ---------- who may open what ----------
const refused = exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-audit-table]')&&!q('[data-backup-panel]')&&!q('[data-usage-panel]'))||main().slice(0,200);`);
add(AUDIT, "ad-audit-viewer-refused", 1280, { role: "uViewer", shot: false, expect: refused });
add(AUDIT, "ad-audit-pm-refused", 768, { role: "uPm", shot: false, expect: refused });
add(AUDIT, "ad-audit-supervisor-refused", 360, { role: "uSupShivNagar", shot: false, expect: refused });
add(AUDIT, "ad-audit-accountant-reads", 1280, { role: "uAccountant", state: "accountant", expect: exp(`await until(()=>rows().length>0);return (rows().length>0&&!q('[data-no-access]'))||main().slice(0,200);`) });
add(AUDIT, "ad-audit-ca-reads", 1280, { role: "uCa", shot: false, expect: exp(`await until(()=>rows().length>0);return (rows().length>0&&!q('[data-no-access]'))||main().slice(0,200);`) });
add(DATA, "ad-data-accountant-refused", 1280, { role: "uAccountant", shot: false, expect: refused });
add(DATA, "ad-data-viewer-refused", 1280, { role: "uViewer", shot: false, expect: refused });
add(DATA, "ad-data-pm-refused", 768, { role: "uPm", shot: false, expect: refused });
add(DATA, "ad-data-supervisor-refused", 360, { role: "uSupShivNagar", shot: false, expect: refused });
add(USERS, "ad-staff-accountant-no-panel", 1280, { role: "uAccountant", shot: false,
  expect: exp(`await until(()=>q('.tabs'));await sleep(800);return (!q('[data-staff-accounts]')&&!q('[data-add-person]'))||'the accountant sees the staff accounts panel';`) });

// ---------- set a password: a weak one is refused in plain words; a good one shows what to hand over (demo: a simulation) ----------
add(USERS, "ad-password-simulation", 1280, { viewport: true,
  action: act(`const b=await until(()=>q('[data-set-password="uSupShivNagar"]'));if(!b)throw new Error('no Set password for the supervisor');b.click();await until(()=>q('[data-password-form]'));setVal(field(dialog(),'New password'),'abc');await sleep(150);q('[data-save-password]').click();await sleep(700);window.__weak=dialog().innerText.includes('Use at least 8 letters or numbers');setVal(field(dialog(),'New password'),'gitti-2026');await sleep(150);q('[data-save-password]').click();await until(()=>q('[data-handover]'));`),
  expect: exp(`const h=q('[data-handover]');return (window.__weak===true&&!!h&&h.dataset.simulated==='true'&&h.innerText.includes('Sign in with:')&&h.innerText.includes('and the password you set')&&!h.innerText.includes('gitti-2026')&&h.innerText.includes('simulation'))||JSON.stringify({weak:window.__weak,text:h?.innerText?.slice(0,200)});`) });
add(USERS, "ad-password-not-for-self", 1280, { shot: false,
  expect: exp(`await until(()=>q('[data-staff="uOwner"]'));return (!q('[data-set-password="uOwner"]')&&q('[data-active-switch="uOwner"]').disabled===true)||'the owner can set their own password or switch themselves off';`) });

// ---------- switch a person off with a confirmation, then on again ----------
add(USERS, "ad-switch-off-on", 1280, { viewport: true,
  action: act(`const s=await until(()=>q('[data-active-switch="uSupGomti"]'));if(!s)throw new Error('no switch');s.click();const d=await until(()=>dialog());window.__asked=!!d&&d.innerText.includes('Switch off');const go=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()==='Switch off');go.click();await until(()=>q('[data-staff="uSupGomti"]')?.dataset.active==='false');window.__off=q('[data-staff="uSupGomti"]')?.dataset.active;await sleep(400);q('[data-active-switch="uSupGomti"]').click();await until(()=>q('[data-staff="uSupGomti"]')?.dataset.active==='true');await sleep(400);`),
  expect: exp(`const r=await until(()=>q('[data-staff="uSupGomti"]'));return (window.__asked===true&&window.__off==='false'&&r.dataset.active==='true')||JSON.stringify({asked:window.__asked,off:window.__off,now:r?.dataset.active});`) });

// ---------- choose a person's projects ----------
add(USERS, "ad-assign-projects", 1280, { viewport: true,
  action: act(`const b=await until(()=>q('[data-assign="uSupGomti"]'));if(!b)throw new Error('no Change projects');b.click();await until(()=>q('[data-assign-dialog] input'));const boxes=qa('[data-assign-dialog] input');window.__before=boxes.filter(x=>x.checked).length;const free=boxes.find(x=>!x.checked);if(free)free.click();await sleep(200);q('[data-save-assign]').click();await until(()=>!dialog());await sleep(600);`),
  expect: exp(`const b=await until(()=>q('[data-assign="uSupGomti"]'));b.click();await until(()=>q('[data-assign-dialog] input'));const n=qa('[data-assign-dialog] input').filter(x=>x.checked).length;return n===window.__before+1||JSON.stringify({before:window.__before,now:n});`) });

// ---------- the backup: the generated object holds the expected collections; the reminder goes; the log says so ----------
add(DATA, "ad-backup-download", 1280, { viewport: true,
  action: act(`const b=await until(()=>q('[data-backup-download]'));if(!b)throw new Error('no Download backup');b.click();await until(()=>q('[data-backup-done]')||q('[data-backup-error]'),60000);await sleep(500);`),
  expect: exp(`const o=window.__agLastBackup;if(!o)return 'no backup object: '+main().slice(0,200);const want=['settings','users','expense_categories','accounts','clients','projects','workers','expenses','attendance','worker_payments','audit_log'];const missing=want.filter(c=>!o.collections.includes(c));const never=['file_blobs','private_config','integrations','command_requests'].filter(c=>o.collections.includes(c));const d=q('[data-backup-done]');const ok=missing.length===0&&never.length===0&&o.meta.app==='ambika-crm'&&o.meta.total>50&&o.meta.failed.length===0&&o.meta.counts.users>0&&o.meta.counts.expenses>0&&o.collections.some(c=>/^projects\\/.+\\/roster$/.test(c))&&/^ambika-crm-backup-\\d{4}-\\d{2}-\\d{2}\\.json$/.test(o.fileName)&&o.bytes>1000&&!!d&&d.dataset.complete==='true'&&!q('[data-backup-due]')&&!!q('[data-backup-last]');return ok||JSON.stringify({missing,never,total:o.meta.total,failed:o.meta.failed,file:o.fileName,done:d?.dataset.complete,due:!!q('[data-backup-due]')});`) });
add(DATA, "ad-backup-reminder-gone", 1280, { shot: false,
  expect: exp(`await until(()=>q('[data-backup-last]'));await sleep(500);return (!!q('[data-backup-last]')&&!q('[data-backup-due]')&&q('[data-backup-last]').innerText.includes('today'))||main().slice(0,300);`) });
add(DATA, "ad-backup-hi", 360, { lang: "hi", state: "after-backup-hi", theme: "dark",
  expect: exp(`return !!(await until(()=>main().includes('पिछला बैकअप: आज')&&main().includes('बैकअप डाउनलोड करें')))||main().slice(0,300);`) });
add(AUDIT, "ad-backup-in-log", 1280, { shot: false,
  expect: exp(`await until(()=>rows().length>0);const r=rows().find(x=>x.dataset.action==='backup');return (!!r&&r.querySelector('[data-line]').innerText.includes('downloaded a backup'))||main().slice(0,300);`) });

writeFileSync(new URL("./admin.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
