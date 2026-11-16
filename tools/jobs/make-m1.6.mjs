// Builds tools/jobs/m1.6.json: the supervisor's owner-dashboard fixes at the start of M1.6 (no KPI truncates, GST
// credit, donut labels, spending wording, the empty "workers today" state), the charts that load as they scroll into
// view, and the §11.1 timing (KPIs under 2 s, first screen under 3 s on throttled 4G). Demo mode; the same jobs run
// against a Firebase build once the user has deployed (DEPLOY.md, smoke test).
// Usage: node tools/jobs/make-m1.6.mjs
import { writeFileSync } from "node:fs";

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, ...o });

const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=6000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const main=()=>document.querySelector('main').innerText;
const byLabel=(txt,root=document)=>{const l=[...root.querySelectorAll('label,legend')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim()===txt)||[...root.querySelectorAll('label')].find(x=>x.textContent.trim().startsWith(txt));if(!l)throw new Error('no label: '+txt);return l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea');};
const fill=(txt,v,root=document)=>{const el=byLabel(txt,root);const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const item=(id)=>document.querySelector('[data-setup-item='+id+']');
const ready=async()=>{await until(()=>document.querySelector('[data-setup-summary]'),10000);await sleep(300);};
`;
const act = (body) => H + body;
const exp = (body) => H + body;

// 1. No KPI truncates at any width: every figure fits its card and none ends in an ellipsis.
const fits = `await until(()=>document.querySelector('[data-kpi=net] [title]'),10000);await sleep(300);
const bad=[...document.querySelectorAll('.kpi .value')].filter(v=>v.scrollWidth>v.clientWidth+1||/…$/.test(v.textContent.trim())||v.getBoundingClientRect().right>v.closest('.kpi').getBoundingClientRect().right+0.5).map(v=>v.closest('[data-kpi]')?.dataset.kpi+': '+v.textContent);
const net=document.querySelector('[data-kpi=net] .value [aria-hidden]').textContent.trim();
return (bad.length===0&&/^−?₹[0-9.,]+( L| Cr)?$/.test(net))||JSON.stringify({bad,net});`;
for (const w of [360, 390, 768, 1024, 1280, 1440]) for (const theme of ["light", "dark"]) {
  add("/", "fix1-kpis-fit", w, { theme, shot: w === 1280 || w === 390, viewport: true, expect: exp(fits) });
}
add("/", "fix1-kpis-fit", 1280, { lang: "hi", state: "hi", viewport: true, expect: exp(fits) });
add("/", "fix1-net-title", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-kpi=net] [title]'),10000);const e=document.querySelector('[data-kpi=net] [title]').getAttribute('title');return /^−?₹[0-9,]+(\\.[0-9]{2})?$/.test(e.replace('-','−'))||e;`) });

// 2. GST: input above output is a credit, never a negative "to pay".
add("/", "fix2-gst-credit", 1280, { clip: "[data-widget=gst]",
  expect: exp(`await until(()=>document.querySelector('[data-widget=gst] [data-gst]'),10000);const w=document.querySelector('[data-widget=gst]');const g=w.querySelector('[data-gst]');const t=w.innerText;
return (!/[−-]\\s?₹/.test(t)&&(g.dataset.gst==='to-pay'||t.includes('GST credit')))||t;`) });

// 3. Donut: no label on a slice under 3%, and no two labels overlap.
add("/", "fix3-donut-labels", 1280, { clip: "[data-chart=chart-expense]",
  expect: exp(`const svg=await until(()=>document.querySelector('[data-chart=chart-expense] .echart svg'),10000);await sleep(1200);
const labels=[...svg.querySelectorAll('text')].filter(t=>/%/.test(t.textContent));
const pcts=labels.map(t=>parseFloat(t.textContent.match(/([0-9.]+)%/)[1]));
const boxes=labels.map(t=>t.getBoundingClientRect());let overlap=0;
for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)overlap++;}
return (labels.length>0&&pcts.every(p=>p>=3)&&overlap===0)||JSON.stringify({pcts,overlap});`) });

// 4. Spending: "Up 114.9% on last month" in words with an arrow; no ₹ on a percentage.
add("/", "fix4-spend-words", 1280, { clip: "[data-widget=spend]",
  expect: exp(`const d=await until(()=>document.querySelector('[data-spend-change]'),10000);if(!d)return 'no change line';const t=d.textContent.trim();
return ((/^(Up|Down) [0-9]+\\.[0-9]% on last month$/.test(t)&&!!d.querySelector('svg'))||t==='Same as last month')&&!t.includes('₹')||t;`) });

// 5. Workers today: a plain empty state when nothing is marked yet, still with the per-site links.
add("/", "fix5-workers-today", 1280, { clip: "[data-chart=chart-workers]",
  expect: exp(`const c=await until(()=>document.querySelector('[data-chart=chart-workers] .link-list'),10000);if(!c)return 'no card';const card=document.querySelector('[data-chart=chart-workers]');
const empty=card.querySelector('[data-empty=workers-today]');const unmarked=card.innerText.split('not marked yet').length-1;const sites=card.querySelectorAll('.link-list li').length;
return (sites>0&&(unmarked===sites?(!!empty&&empty.textContent.includes('No attendance marked yet today')&&!card.querySelector('.echart')):!empty))||JSON.stringify({sites,unmarked,empty:!!empty});`) });

// Charts load as they scroll into view: on a phone, cards far below the fold have not mounted and ECharts is not loaded yet.
add("/", "perf-lazy-cards", 390, { shot: false, viewport: true, noReveal: true,
  expect: exp(`await until(()=>document.querySelector('[data-kpi=expense] [title]'),10000);await sleep(500);
const pending=document.querySelectorAll('[data-lazy-pending]').length;const loaded=performance.getEntriesByType('resource').some(r=>/echarts/i.test(r.name));
window.scrollTo(0,document.body.scrollHeight);await sleep(1500);const after=document.querySelectorAll('[data-lazy-pending]').length;
return (pending>=6&&!loaded&&after<pending)||JSON.stringify({pending,loaded,after});`) });
add("/", "perf-kpi-hash", 390, { shot: false, viewport: true, noReveal: true,
  action: H + `await until(()=>document.querySelector('[data-kpi=outstanding] [title]'),10000);document.querySelector('[data-kpi=outstanding]').click();await sleep(1500);`,
  expect: exp(`const a=document.getElementById('chart-ageing');if(!a)return 'ageing not mounted';const r=a.getBoundingClientRect();return (r.top<innerHeight&&r.bottom>0)||'ageing not in view: '+Math.round(r.top);`) });

// §11.1 timing on throttled 4G (cold load, no cache): KPIs under 2 s; the first screen (KPIs plus the cards in view) under 3 s.
const timing = (kpiSel, firstSel) => exp(`await until(()=>document.querySelector('${kpiSel}'),20000);const k=Math.round(performance.now());
const inView=()=>[...document.querySelectorAll('${firstSel}')].filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;});
await until(()=>{const v=inView();return v.length>0&&v.every(e=>!e.querySelector('.skeleton')&&(!e.matches('[data-chart]')||e.querySelector('svg')||e.querySelector('[data-empty],p.muted')));},20000);
const f=Math.round(performance.now());window.__timing={k,f};return (k<=2000&&f<=3000)||('KPIs at '+k+' ms; first screen at '+f+' ms');`);
for (const run of ["a", "b", "c"]) {
  add("/", "perf-4g-owner", 1280, { throttle: "4g", keepThrottle: true, noReveal: true, shot: false, state: run, expect: timing("[data-kpi=net] [title]", ".dash-kpis .kpi, [data-chart], .dash-card:not([data-lazy-pending])") });
  add("/", "perf-4g-owner", 390, { throttle: "4g", keepThrottle: true, noReveal: true, shot: false, state: run, expect: timing("[data-kpi=expense] [title]", ".dash-kpis .kpi, [data-chart], .dash-card:not([data-lazy-pending])") });
}
add("/", "perf-4g-supervisor", 390, { throttle: "4g", keepThrottle: true, noReveal: true, role: "uSupShivNagar", shot: false,
  expect: timing("[data-widget=site-today] .st-stats", "[data-widget=site-today] .site-today") });

// ---------- Settings > Setup & integrations (D-48, D-49): demo mode, a labelled simulation ----------
const SETUP = "/settings/setup/";
const ITEMS = ["firebaseConfig", "firestore", "storage", "storageR2", "storageCloudinary", "storageFirebase", "signIn", "functions", "appCheck", "push", "email", "websiteLink", "maps", "whatsapp", "company"];
const summaryText = `document.querySelector('[data-setup-summary] .setup-count').textContent.trim()`;

// Role gating: only the super user opens it; everyone else sees "You don't have access" and no item.
for (const [uid, role] of [["uAccountant", "accountant"], ["uPm", "pm"], ["uSupShivNagar", "supervisor"], ["uViewer", "viewer"], ["uCa", "ca"]]) {
  add(SETUP, "setup-gate", role === "supervisor" ? 390 : 1280, { role: uid, state: role, shot: role === "pm",
    expect: exp(`await until(()=>document.querySelector('[data-no-access]')||document.querySelector('[data-setup-item]'),10000);return (!!document.querySelector('[data-no-access]')&&!document.querySelector('[data-setup-item]')&&!document.body.innerText.includes('Resend'))||main().slice(0,200);`) });
}
add("/settings/", "setup-link-owner", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-setup-link]'),10000);return !!document.querySelector('[data-setup-link] a[href*="/settings/setup/"]')||main().slice(0,200);`) });
add("/settings/", "setup-link-accountant", 1280, { role: "uAccountant", shot: false,
  expect: exp(`await until(()=>document.querySelector('h1'),10000);await sleep(800);return (!document.querySelector('[data-setup-link]')&&!!document.querySelector('.tabs'))||main().slice(0,200);`) });
add("/", "setup-demo-link", 1280, { shot: false,
  action: act(`await until(()=>document.querySelector('[data-connect-link]'),10000);document.querySelector('[data-connect-link]').click();await until(()=>location.pathname==='/settings/setup/',10000);`),
  expect: exp(`await ready();return location.pathname==='/settings/setup/'||location.pathname;`) });

// A clean start, then all fifteen items and the summary row.
add(SETUP, "setup-fresh", 1280, { shot: false, reload: true,
  action: act(`await until(()=>document.querySelector('[data-setup-summary]'),10000);localStorage.removeItem('ag-demo-setup');localStorage.removeItem('ag-firebase-config');`),
  expect: exp(`await ready();const n=document.querySelectorAll('[data-setup-item]').length;const t=${summaryText};return (n===15&&t==='0 of 10 verified'&&!!document.querySelector('[data-simulation]'))||JSON.stringify({n,t});`) });
for (const w of [390, 1280]) for (const theme of ["light", "dark"]) {
  add(SETUP, "setup-owner", w, { theme, expect: exp(`await ready();return document.querySelectorAll('[data-setup-item]').length===15||'not 15 items';`) });
}
add(SETUP, "setup-owner", 390, { lang: "hi", state: "hi", expect: exp(`await ready();await until(()=>document.querySelector('h1')?.textContent.includes('सेटअप'),10000);return (document.querySelector('h1').textContent.includes('सेटअप')&&document.querySelectorAll('[data-setup-item]').length===15)||main().slice(0,120);`) });

// Every item that can be tested has its own Test button, and every Test gives Pass or Fail in plain words.
add(SETUP, "setup-test-all", 1280, { shot: false,
  action: act(`await ready();for(const b of [...document.querySelectorAll('[data-test]')]){b.click();await until(()=>document.querySelector('[data-test-result='+b.dataset.test+'] p'),8000);await sleep(150);}`),
  expect: exp(`const ids=[...document.querySelectorAll('[data-test]')].map(b=>b.dataset.test);const ok=Object.fromEntries(ids.map(i=>[i,document.querySelector('[data-test-result='+i+']').dataset.ok]));
const passed=ids.filter(i=>ok[i]==='true').sort().join();const text=document.querySelector('[data-test-result=firestore]').innerText;
return (ids.length===12&&passed==='firestore,functions,signIn,storage'&&${summaryText}==='4 of 10 verified'&&/Simulation/.test(text)&&!document.querySelector('[data-test=whatsapp]'))||JSON.stringify({ids,ok,s:${summaryText}});`) });

// A wrong value is named in plain words and nothing is saved.
add(SETUP, "setup-invalid", 1280, { shot: false,
  action: act(`await ready();const c=item('email');fill('Resend API key','nope',c);fill('Send from','alerts',c);c.querySelector('[data-save=email]').click();await sleep(800);`),
  expect: exp(`const t=item('email').innerText;return (t.includes('re_')&&t.includes('alerts@')&&!t.includes('Saved:'))||t.slice(0,300);`) });

// Save, mask, test. The secret is never shown again and never kept (D-49).
add(SETUP, "setup-email-save", 1280, { shot: false, reload: true,
  action: act(`await ready();const c=item('email');fill('Resend API key','re_abcdefghijklmnop1234',c);fill('Send from','alerts@ambika.in',c);c.querySelector('[data-save=email]').click();await until(()=>item('email').innerText.includes('••••1234'),8000);
c.querySelector('[data-test=email]').click();await until(()=>item('email').querySelector('[data-test-result=email] p'),8000);await sleep(300);`),
  expect: exp(`await ready();const c=item('email');const store=JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
const inputs=[...c.querySelectorAll('input')].map(i=>i.value).join('|');
return (c.innerText.includes('••••1234')&&c.querySelector('[data-setup-badge]').dataset.setupBadge==='verified'&&${summaryText}==='5 of 10 verified'
&&!document.body.innerText.includes('re_abcdefghijklmnop1234')&&!store.includes('re_abcdefghijklmnop1234')&&!inputs.includes('re_abcdefghijklmnop')&&inputs.includes('alerts@ambika.in'))||JSON.stringify({t:c.innerText.slice(0,200),s:${summaryText}});`) });
// Changing a setting clears the old result, so "verified" never outlives the change.
add(SETUP, "setup-change-clears", 1280, { shot: false,
  action: act(`await ready();const c=item('email');fill('Send from','billing@ambika.in',c);c.querySelector('[data-save=email]').click();await sleep(1200);`),
  expect: exp(`const c=item('email');return (c.querySelector('[data-setup-badge]').dataset.setupBadge==='untested'&&${summaryText}==='4 of 10 verified')||c.innerText.slice(0,200);`) });

// Website key: shown once, then only the masked tail.
add(SETUP, "setup-website-key", 1280, { shot: false, reload: true,
  action: act(`await ready();item('websiteLink').querySelector('[data-make-key]').click();await until(()=>item('websiteLink').querySelector('[data-fresh-key]'),8000);window.__k=item('websiteLink').querySelector('[data-fresh-key] code').textContent.trim();await sleep(300);`),
  expect: exp(`await ready();const c=item('websiteLink');const store=JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
return (!c.querySelector('[data-fresh-key]')&&/Current key: ••••/.test(c.innerText)&&!!c.querySelector('[data-endpoint]')&&/cloudfunctions\\.net\\/submitEnquiry/.test(c.querySelector('[data-endpoint]').textContent)&&!store.includes('agw_demo_'))||c.innerText.slice(0,300);`) });

// Pasting the console's block fills the six fields and prints the exact Netlify lines.
add(SETUP, "setup-config-paste", 1280, { shot: false,
  action: act(`await ready();const c=item('firebaseConfig');fill('Paste the whole block','const firebaseConfig = { apiKey: "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q", authDomain: "crm.ambika.in", projectId: "ambika-crm", storageBucket: "ambika-crm.firebasestorage.app", messagingSenderId: "123456789012", appId: "1:123456789012:web:abc123def456" };',c);c.querySelector('[data-read-config]').click();await sleep(500);`),
  expect: exp(`const c=item('firebaseConfig');const pre=c.querySelector('pre').textContent;
return (c.innerText.includes('Found 6 of 6')&&byLabel('Project ID',c).value==='ambika-crm'&&pre.includes('NEXT_PUBLIC_FIREBASE_PROJECT_ID=ambika-crm')&&pre.split('\\n').length>=6)||c.innerText.slice(0,300);`) });

// The owner's users list shows who is a super user, and the owner can change it.
add("/settings/?tab=users", "setup-users-superuser", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-super-user]'),10000);const box=document.querySelector('[data-super-user=uOwner]');return (!!box&&box.checked)||main().slice(0,200);`) });

// One picture per item, at phone and desktop widths, in both themes.
for (const id of ITEMS) for (const w of [390, 1280]) for (const theme of ["light", "dark"]) {
  add(SETUP, "setup-item", w, { theme, state: id, clip: `[data-setup-item=${id}]`, expect: exp(`await ready();return !!item('${id}')||'missing ${id}';`) });
}

// Pasted Firebase settings on this device flip the site to Firebase mode; the sign-in page then offers the way back to the demo.
const FAKE = JSON.stringify({ apiKey: 'AIza' + 'D'.repeat(35), authDomain: 'demo-device-check.firebaseapp.com', projectId: 'demo-device-check', storageBucket: 'demo-device-check.firebasestorage.app', messagingSenderId: '123456789012', appId: '1:123456789012:web:abc123def456' });
add("/", "device-config-forget", 1280, { shot: false, noShell: true, reload: true, allowFailed: ["googleapis.com", "cloudfunctions.net", "google.com", "firebaseapp.com"],
  action: act(`await until(()=>document.querySelector('[data-connect-link]'),10000);localStorage.setItem('ag-firebase-config',${JSON.stringify(FAKE)});`),
  expect: exp(`await until(()=>document.querySelector('[data-google]'),15000);const had=!!document.querySelector('[data-device-config]')&&!document.querySelector('.demo-banner');
const b=document.querySelector('[data-forget-device]');if(!had||!b)return 'device-config note missing: '+JSON.stringify({had,b:!!b});b.click();await sleep(400);
const confirm=[...document.querySelectorAll('[role=dialog] button')].find(x=>/Forget this device/.test(x.textContent));if(!confirm)return 'no confirm button';confirm.click();
await until(()=>document.querySelector('.demo-banner'),15000);return (!!document.querySelector('.demo-banner')&&!localStorage.getItem('ag-firebase-config'))||'did not return to the demo';`) });

writeFileSync(new URL("./m1.6.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(J.length, "jobs");
