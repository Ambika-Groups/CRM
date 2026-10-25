// Builds tools/jobs/m1.2.json: the M1.2 screens (clients, projects, workers, settings) at 360/390/768/1280, light
// and dark, English and Hindi, by role; plus interactive checks ("expect") for the QA findings F1–F13.
// Usage: node tools/jobs/make-m1.2.mjs
import { writeFileSync } from "node:fs";

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, ...o });
const click = (txt) => `[...document.querySelectorAll("button,a")].find(b=>b.textContent.trim().startsWith(${JSON.stringify(txt)}))?.click();await new Promise(r=>setTimeout(r,400));`;
const press = (sel) => `const b=document.querySelector(${JSON.stringify(sel)});b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));await new Promise(r=>setTimeout(r,500));`;
const type = (txt) => `const i=document.querySelector('[data-palette] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(txt)});i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,900));`;
const ctrlK = `window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,400));`;
const main = `document.querySelector('main').innerText`;
const menu = `[...document.querySelectorAll('.sidenav a')].map(a=>a.getAttribute('href')).join(' ')`;
const noAccess = `return !!document.querySelector('[data-no-access]')||${main}.slice(0,200);`;

// ---------- M1.2 screens ----------
for (const w of [360, 768, 1280]) add("/clients/", "clients", w);
add("/clients/", "clients", 390, { theme: "dark" });
add("/clients/", "clients", 390, { lang: "hi", state: "hi" });
add("/clients/view/?id=clSharma", "client", 1280);
add("/clients/view/?id=clNagarNigam", "client", 390, { state: "gov" });
add("/clients/edit/", "client-new", 390);
add("/clients/edit/", "client-new", 1280, { state: "errors", action: click("Save"), expect: `return document.querySelectorAll('[aria-invalid="true"]').length>0||'no field errors';` });
for (const w of [360, 768, 1280]) add("/projects/", "projects", w);
add("/projects/", "projects", 1280, { theme: "dark" });
add("/projects/", "projects", 390, { role: "uSupShivNagar", state: "supervisor" });
add("/projects/", "projects", 1280, { role: "uPm", state: "pm" });
add("/projects/", "projects", 1280, { role: "uViewer", state: "viewer", expect: `const t=${main};return (!t.includes('Billed')&&t.includes('Shiv Nagar'))||t.slice(0,300);` });
add("/projects/", "projects", 390, { lang: "hi", state: "hi" });
add("/projects/new/", "project-new", 390);
add("/projects/new/", "project-new", 1280);
add("/projects/new/", "project-new", 1280, { state: "errors", action: click("Next"), expect: `return document.querySelectorAll('[aria-invalid="true"]').length>0||'no field errors';` });
const P = "/projects/view/?id=";
for (const tab of ["overview", "workforce", "billing", "documents", "schedule", "pnl", "expenses"]) add(`${P}projShivNagar&tab=${tab}`, `project-gov-${tab}`, 1280);
for (const tab of ["overview", "billing", "schedule"]) add(`${P}projShivNagar&tab=${tab}`, `project-gov-${tab}`, 390);
for (const tab of ["overview", "billing", "documents"]) add(`${P}projGomti&tab=${tab}`, `project-apt-${tab}`, 1280);
add(`${P}projGomti&tab=billing`, "project-apt-billing", 390);
add(`${P}projGomti&tab=billing`, "project-apt-billing", 1280, { theme: "dark" });
for (const tab of ["overview", "billing", "pnl"]) add(`${P}projSharma&tab=${tab}`, `project-house-${tab}`, 1280);
add(`${P}projSharma&tab=overview`, "project-house-overview", 1280, { state: "delete", action: click("Delete"), viewport: true,
  expect: `const d=document.querySelector('[role=dialog]');return (!!d&&d.innerText.includes("can't be deleted"))||(d?d.innerText:'no dialog');` });
add(`${P}projSharma&tab=overview`, "project-house-overview", 390, { state: "delete", action: click("Delete"), viewport: true });
add(`${P}projSharma&tab=overview`, "project-house-overview", 768, { theme: "dark" });
add(`${P}projShivNagar&tab=overview`, "project-gov-overview", 390, { role: "uSupShivNagar", lang: "hi", state: "hi" });
add("/projects/edit/?id=projShivNagar", "project-edit", 1280);
for (const w of [360, 768, 1280]) add("/labour/", "workers", w);
add("/labour/", "workers", 390, { theme: "dark" });
add("/labour/", "workers", 390, { lang: "hi", state: "hi" });
add("/labour/", "workers", 390, { role: "uSupShivNagar", state: "supervisor" });
add("/labour/workers/view/?id=w001", "worker", 1280);
add("/labour/workers/view/?id=w001", "worker", 390);
add("/labour/workers/view/?id=wMohanLal", "worker", 1280, { state: "thekedar" });
add("/labour/workers/edit/?id=w001", "worker-edit", 390);
add("/labour/workers/edit/?id=w001", "worker-edit", 1280, { role: "uPm", state: "pm", expect: `return !document.querySelector('main').innerText.includes('Daily rate')||'rate field shown to PM';` });
add("/labour/workers/edit/", "worker-new", 1280, { state: "errors", action: click("Save"), expect: `return document.querySelectorAll('[aria-invalid="true"]').length>0||'no field errors';` });
for (const tab of ["company", "users", "roles", "operations", "numbering"]) add(`/settings/?tab=${tab}`, `settings-${tab}`, 1280);
add("/settings/?tab=users", "settings-users", 390);
add("/settings/?tab=roles", "settings-roles", 360);
add("/settings/?tab=company", "settings-company", 768, { theme: "dark" });
add("/settings/?tab=company", "settings-company", 1280, { role: "uAccountant", state: "accountant" });
add("/settings/?tab=operations", "settings-operations", 390, { lang: "hi", state: "hi" });
add("/", "home", 390);
add("/", "home", 1280, { theme: "dark" });
add("/more/", "more", 390);
for (const path of ["/expenses/", "/billing/", "/reports/"]) add(path, "soon" + path.replace(/\//g, "-").replace(/-$/, ""), 390);

// ---------- QA findings (F1–F13) ----------
// F1: the PM sees only workers on their sites, and never a rate.
add("/labour/", "qa-f1-pm-workers", 1280, { role: "uPm", expect: `const t=${main};return (!t.includes('Daily rate')&&!t.includes('Gomti'))||t.slice(0,300);` });
add("/labour/", "qa-f1-pm-workers", 390, { role: "uPm" });
add("/labour/workers/view/?id=w031", "qa-f1-pm-other-site-worker", 1280, { role: "uPm", expect: noAccess });
add("/labour/workers/view/?id=w001", "qa-f1-pm-worker", 1280, { role: "uPm", expect: `const t=${main};return (t.includes('Suresh Pal')&&!t.includes('Daily rate')&&!/₹ ?[0-9]/.test(t))||t.slice(0,300);` });
// F2: Light / Dark / System in the profile menu (desktop) and the ⋮ panel (phone).
add("/", "qa-f2-profile-menu", 1280, { viewport: true, action: press("[data-profile-menu]"),
  expect: `const m=document.querySelector('.profile-menu');if(!m)return 'no menu';return [...m.querySelectorAll('[data-theme-choice]')].map(e=>e.dataset.themeChoice).join(',')==='light,dark,system'||'choices missing';` });
// F3: the sidebar collapses to icons, with labels as tooltips, and stays collapsed.
add("/", "qa-f3-collapse", 1280, { viewport: true, action: `document.querySelector('[data-nav-collapse]').click();await new Promise(r=>setTimeout(r,300));`,
  expect: `const n=document.querySelector('.sidenav');return (document.querySelector('.app').classList.contains('nav-collapsed')&&n.getBoundingClientRect().width<100&&n.querySelector('a').title.length>0&&localStorage.getItem('ag-nav-collapsed')==='1')||'not collapsed';` });
add("/projects/", "qa-f3-collapsed-remembered", 1280, { collapsed: true, viewport: true,
  expect: `return document.querySelector('.sidenav').getBoundingClientRect().width<100||'not remembered';` });
// F4: search opens the palette (button and Ctrl/Cmd+K) and finds only what the role can read.
add("/", "qa-f4-search", 1280, { viewport: true, action: `document.querySelector('[data-search]').click();await new Promise(r=>setTimeout(r,300));${type("shiv")}`,
  expect: `const t=document.querySelector('[data-palette]')?.innerText??'';return (t.includes('Shiv Nagar CC Road')&&t.includes('Shiv Saini'))||t.slice(0,300);` });
add("/", "qa-f4-ctrl-k", 390, { viewport: true, action: `${ctrlK}${type("add")}`,
  expect: `const t=document.querySelector('[data-palette]')?.innerText??'';return (t.includes('Add expense')&&t.includes('Add worker'))||t.slice(0,300)||'palette did not open';` });
add("/", "qa-f4-pm-scope", 1280, { role: "uPm", shot: false, action: `${ctrlK}${type("gomti")}`,
  expect: `const t=document.querySelector('[data-palette]')?.innerText??'';return !t.includes('Gomti Residency')||'PM found an unassigned project';` });
add("/", "qa-f4-viewer-scope", 1280, { role: "uViewer", shot: false, action: `${ctrlK}${type("sharma")}`,
  expect: `const t=document.querySelector('[data-palette]')?.innerText??'';return (t.includes('Sharma Villa')&&!t.includes('Rajesh Sharma')&&!t.includes('Add expense'))||t.slice(0,300);` });
// F5: no failed requests (checked on every job; Home named here).
add("/", "qa-f5-home-requests", 1280, { shot: false });
add("/", "qa-f5-home-requests", 390, { shot: false, role: "uSupShivNagar" });
// F6, F7, F9: menus by role.
add("/", "qa-f6-viewer-menu", 1280, { role: "uViewer", expect: `return ${menu}==='/ /projects/ /reports/'||${menu};` });
add("/clients/", "qa-f6-viewer-clients", 1280, { role: "uViewer", expect: noAccess });
add("/", "qa-f7-ca-menu", 1280, { role: "uCa", expect: `return ${menu}==='/ /accounts/ /reports/'||${menu};` });
add("/projects/", "qa-f7-ca-projects", 1280, { role: "uCa", expect: noAccess });
add("/clients/", "qa-f7-ca-clients", 390, { role: "uCa", expect: noAccess });
add("/", "qa-f9-pm-menu", 1280, { role: "uPm", shot: false, expect: `return !${menu}.includes('/clients/')||${menu};` });
add(`${P}projShivNagar`, "qa-f9-pm-tabs", 1280, { role: "uPm",
  expect: `const tabs=[...document.querySelectorAll('.tabs a')].map(a=>a.getAttribute('href'));return (!tabs.some(h=>/tab=(billing|pnl|contracts)/.test(h))&&tabs.length===9)||tabs.join(' ');` });
add(`${P}projShivNagar&tab=billing`, "qa-f9-pm-billing-url", 1280, { role: "uPm", expect: noAccess });
add(`${P}projShivNagar`, "qa-f9-supervisor-tabs", 390, { role: "uSupShivNagar", shot: false,
  expect: `const tabs=[...document.querySelectorAll('.tabs a')].map(a=>a.getAttribute('href'));return !tabs.some(h=>/tab=(billing|pnl)/.test(h))||tabs.join(' ');` });
add(`${P}projShivNagar`, "qa-f9-viewer-tabs", 1280, { role: "uViewer",
  expect: `const tabs=document.querySelectorAll('.tabs a').length;const t=${main};return (tabs===1&&!t.includes('Billed')&&!t.includes('94150'))||(tabs+' '+t.slice(0,200));` });
// F8: restricted pages say so in plain words, never a misleading empty state.
add("/labour/", "qa-f8-viewer-workers", 1280, { role: "uViewer", expect: `const t=${main};return (!!document.querySelector('[data-no-access]')&&!t.includes('No workers yet'))||t.slice(0,200);` });
add("/labour/", "qa-f8-ca-workers", 390, { role: "uCa", expect: noAccess });
// F10: no false zeros; the supervisor sees the site's day.
add(`${P}projShivNagar`, "qa-f10-supervisor-overview", 390, { role: "uSupShivNagar", lang: "hi",
  expect: `const t=${main};return (!!document.querySelector('[data-site-day]')&&!t.includes('₹'))||t.slice(0,300);` });
add(`${P}projShivNagar`, "qa-f10-supervisor-overview", 1280, { role: "uSupShivNagar", lang: "hi" });
// F12: the bell opens a panel.
add("/", "qa-f12-bell", 1280, { viewport: true, action: press("[data-bell]"),
  expect: `const m=document.querySelector('[data-bell-panel]');return (!!m&&/waiting|Nothing/.test(m.innerText))||'no panel';` });
add("/", "qa-f12-bell", 390, { viewport: true, role: "uSupShivNagar", action: press("[data-bell]"),
  expect: `return !!document.querySelector('[data-bell-panel]')||'no panel';` });
// F13: a branded 404 in English and Hindi.
add("/no-such-page/", "qa-f13-not-found", 1280, { mainStatus: 404, expect: `return (!!document.querySelector('[data-not-found]')&&document.title.length>0)||'no 404 page';` });
add("/no-such-page/", "qa-f13-not-found", 390, { mainStatus: 404, role: "uSupShivNagar", lang: "hi", expect: `return document.body.innerText.includes('पेज नहीं मिला')||'not Hindi';` });

// Jobs that change the saved theme of the demo user run last, because the demo store persists across jobs.
add("/", "qa-f2-choose-system", 1280, { theme: "dark", shot: false,
  action: `document.querySelector('[data-theme-switch]').click();await new Promise(r=>setTimeout(r,200));${press("[data-profile-menu]")}document.querySelector('.profile-menu [data-theme-choice=system]').click();await new Promise(r=>setTimeout(r,300));`,
  expect: `return (localStorage.getItem('ag-theme')==='system'&&document.documentElement.dataset.theme==='dark')||('stored '+localStorage.getItem('ag-theme')+' shown '+document.documentElement.dataset.theme);` });
add("/", "qa-f2-phone-profile", 390, { viewport: true, expectTheme: "dark",
  action: `document.querySelector('[data-overflow]').click();await new Promise(r=>setTimeout(r,200));document.querySelector('[data-phone-profile]').click();await new Promise(r=>setTimeout(r,200));document.querySelector('#om-profile [data-theme-choice=dark]').click();await new Promise(r=>setTimeout(r,200));`,
  expect: `return (document.documentElement.dataset.theme==='dark'&&localStorage.getItem('ag-theme')==='dark'&&document.querySelectorAll('#om-profile [data-theme-choice]').length===3)||'phone theme choice failed';` });

writeFileSync(new URL("./m1.2.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
