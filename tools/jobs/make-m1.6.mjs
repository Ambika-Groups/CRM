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
`;
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

writeFileSync(new URL("./m1.6.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(J.length, "jobs");
