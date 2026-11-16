// Builds tools/jobs/spendings.json: Total Spendings (spec §7.3, §7.4) and the expense heads editor (§7.1) by role,
// width, theme and language, and the interactive checks: the total equals the dashboard's expense figure, the tree
// and the summary heads add up, drill-down, filters, the roles, rename / add / move / archive with a reload, and the
// total staying the same after a head with entries is moved.
// Jobs share one browser profile, so the demo data and localStorage carry over from job to job in this order.
// Usage: node tools/jobs/make-spendings.mjs
import { writeFileSync } from "node:fs";

const J = [];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const byLabel=(txt)=>{const root=document.querySelector('[role=dialog]')||document;const l=[...root.querySelectorAll('label,legend')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim()===txt)||[...root.querySelectorAll('label')].find(x=>x.textContent.trim().startsWith(txt));if(!l)throw new Error('no label: '+txt);return l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea');};
const setVal=(el,v)=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const fill=(txt,v)=>setVal(byLabel(txt),v);
const btn=(txt)=>{const d=document.querySelector('[role=dialog]');const pool=d?[...d.querySelectorAll('button,a')]:[...document.querySelectorAll('button,a')];return pool.find(x=>x.textContent.trim().startsWith(txt)&&!x.disabled);};
const click=async(txt)=>{const b=await until(()=>btn(txt));if(!b)throw new Error('no button: '+txt);b.click();await sleep(400);};
const main=()=>document.querySelector('main').innerText;
const q=(s)=>document.querySelector(s);
const qa=(s)=>[...document.querySelectorAll(s)];
const paise=(el)=>Number(el.dataset.paise);
const total=()=>until(()=>q('[data-spend-total]'));
const sumOf=(els)=>els.reduce((s,e)=>s+paise(e),0);
const topNodes=()=>qa('[data-spend-tree] .sp-tree > ul > li');
const pickCat=async(id)=>{const b=await until(()=>q('li[data-cat="'+id+'"] > button.cat-row'));if(!b)throw new Error('no head: '+id);if(b.getAttribute('aria-pressed')!=='true')b.click();await until(()=>q('[data-cat-selected="'+id+'"]'));};
const catByName=(name)=>qa('li[data-cat]').find(x=>x.dataset.name===name);
const closed=()=>until(()=>!q('[role=dialog]'));
`;
const act = (body) => H + body;
const exp = (body) => H + body;

const SPEND = "/expenses/spendings/";
const CATS = "/expenses/categories/";

// ---------- screens: 360 and 1280, light and dark, Hindi ----------
add(SPEND, "spendings", 1280);
add(SPEND, "spendings", 360);
add(SPEND, "spendings", 1280, { theme: "dark" });
add(SPEND, "spendings", 360, { theme: "dark" });
add(SPEND, "spendings", 1440, { state: "wide" });
add(SPEND, "spendings", 360, { lang: "hi", state: "hi",
  expect: exp(`const ok=await until(()=>q('[data-spend-total]')&&main().includes('कुल खर्च')&&main().includes('पैसा कहाँ गया'));return !!ok||main().slice(0,300);`) });
add(SPEND, "spendings", 768, { role: "uPm", state: "pm" });
add(SPEND, "spendings", 1280, { role: "uViewer", state: "viewer" });
add(CATS, "expense-heads", 1280);
add(CATS, "expense-heads", 360);
add(CATS, "expense-heads", 1280, { theme: "dark" });
add(CATS, "expense-heads", 360, { theme: "dark" });
add(CATS, "expense-heads", 360, { lang: "hi", state: "hi",
  expect: exp(`const ok=await until(()=>q('li[data-cat]')&&main().includes('खर्च के मद')&&main().includes('मुख्य मद जोड़ें'));return !!ok||main().slice(0,300);`) });
add(CATS, "expense-heads", 1280, { role: "uAccountant", state: "accountant-read-only" });

// ---------- the total equals the dashboard's expense figure for the same period (this financial year) ----------
add("/", "sp-dashboard-figure", 1280, { shot: false,
  action: act(`const b=await until(()=>q('[data-period=fy]'));if(!b)throw new Error('no period buttons on the dashboard');b.click();await sleep(1500);const v=await until(()=>{const e=q('[data-kpi=expense] .sr-only');return e&&/₹/.test(e.textContent)?e.textContent.trim():null;},15000);localStorage.setItem('qa-spend-fy',v||'');`),
  expect: exp(`return /₹/.test(localStorage.getItem('qa-spend-fy')||'')||'the dashboard showed no expense figure';`) });
add(SPEND, "sp-total-equals-dashboard", 1280, { shot: false,
  expect: exp(`const el=await total();if(!el)return main().slice(0,300);const want=localStorage.getItem('qa-spend-fy');return (el.dataset.rupees===want&&paise(el)>0)||('spendings '+el.dataset.rupees+' vs dashboard '+want);`) });

// ---------- the tree, the summary heads and the percentages add up ----------
add(SPEND, "sp-tree-adds-up", 1280, { shot: false,
  expect: exp(`const el=await total();await until(()=>topNodes().length>2);const t=paise(el);const tops=topNodes();const pm=tops.reduce((s,e)=>s+Number(e.dataset.permille),0);const heads=qa('[data-head]').filter(b=>b.dataset.head!=='all');return (sumOf(tops)===t&&pm===1000&&sumOf(heads)===t&&heads.length===5&&!q('[data-spend-mismatch]'))||JSON.stringify({total:t,tree:sumOf(tops),permille:pm,heads:sumOf(heads)});`) });

// ---------- drill-down: a bar opens the level under it, the level adds up to its parent, the path leads back ----------
add(SPEND, "sp-drill-down", 1280, { viewport: true,
  action: act(`await total();const b=await until(()=>q('[data-bar="cat_materials"] button'));if(!b)throw new Error('Materials is not a bar that opens');b.click();await until(()=>q('[data-spend-chart]').dataset.level==='cat_materials');await sleep(300);`),
  expect: exp(`const c=q('[data-spend-chart]');const bars=qa('[data-spend-bars] > li');const node=q('[data-spend-node="cat_materials"]');const ok=c.dataset.level==='cat_materials'&&sumOf(bars)===paise(c)&&paise(node)===paise(c)&&node.querySelector('.sp-toggle').getAttribute('aria-expanded')==='true'&&q('[data-spend-path]').innerText.includes('Materials');if(!ok)return JSON.stringify({level:c.dataset.level,bars:sumOf(bars),chart:paise(c),node:paise(node)});q('[data-crumb=top]').click();await sleep(400);return q('[data-spend-chart]').dataset.level===''||'the path did not lead back to the top';`) });
add(SPEND, "sp-drill-two-levels", 360, { viewport: true,
  action: act(`await total();(await until(()=>q('[data-bar="cat_materials"] button'))).click();await until(()=>q('[data-spend-chart]').dataset.level==='cat_materials');const b=await until(()=>q('[data-bar="cat_materials_aggregate"] button'));if(!b)throw new Error('Aggregate is not a bar that opens');window.__agg=paise(q('[data-bar="cat_materials_aggregate"]'));b.click();await until(()=>q('[data-spend-chart]').dataset.level==='cat_materials_aggregate');await sleep(300);`),
  expect: exp(`const c=q('[data-spend-chart]');const bars=qa('[data-spend-bars] > li');return (c.dataset.level==='cat_materials_aggregate'&&sumOf(bars)===window.__agg&&bars.every(b=>b.dataset.drillable==='false')&&qa('[data-crumb]').length===3)||JSON.stringify({level:c.dataset.level,bars:sumOf(bars),want:window.__agg,crumbs:qa('[data-crumb]').length});`) });
add(SPEND, "sp-head-tab", 1280, { viewport: true,
  action: act(`await total();const b=await until(()=>q('[data-head=cat_labour]'));b.click();await until(()=>q('[data-spend-chart]').dataset.level==='cat_labour');await sleep(300);`),
  expect: exp(`const c=q('[data-spend-chart]');const tab=q('[data-head=cat_labour]');return (tab.getAttribute('aria-pressed')==='true'&&paise(c)===paise(tab)&&topNodes().length===1&&topNodes()[0].dataset.spendNode==='cat_labour')||JSON.stringify({chart:paise(c),tab:paise(tab),tops:topNodes().length});`) });

// ---------- filters: one project, this month, paid and still to pay ----------
add(SPEND, "sp-project-filter", 1280, { viewport: true,
  action: act(`const el=await total();window.__all=paise(el);setVal(q('[data-filter=project]'),'projShivNagar');await until(()=>q('[data-spend-total]')?.dataset.scope==='project');await sleep(400);`),
  expect: exp(`const el=await total();const p=paise(el);return (el.dataset.scope==='project'&&p>0&&p<window.__all&&sumOf(topNodes())===p)||JSON.stringify({all:window.__all,project:p,tree:sumOf(topNodes())});`) });
add(SPEND, "sp-month-filter", 360, { viewport: true,
  action: act(`const el=await total();window.__fy=paise(el);q('[data-period=month]').click();await sleep(800);await total();`),
  expect: exp(`const el=await total();const m=paise(el);return (q('[data-period=month]').getAttribute('aria-pressed')==='true'&&m<=window.__fy&&(!topNodes().length||sumOf(topNodes())===m)&&!q('[data-spend-months]'))||JSON.stringify({fy:window.__fy,month:m});`) });
add(SPEND, "sp-paid-and-unpaid", 1280, { shot: false,
  action: act(`const el=await total();window.__all=paise(el);setVal(q('[data-filter=view]'),'paid');await until(()=>q('[data-spend-total]')?.dataset.view==='paid');await sleep(300);window.__paid=paise(q('[data-spend-total]'));setVal(q('[data-filter=view]'),'unpaid');await until(()=>q('[data-spend-total]')?.dataset.view==='unpaid');await sleep(300);`),
  expect: exp(`const u=paise(q('[data-spend-total]'));return (window.__paid+u===window.__all&&u>0)||JSON.stringify({all:window.__all,paid:window.__paid,unpaid:u});`) });

// ---------- the last level links to its entries; the level on screen downloads as CSV ----------
add(SPEND, "sp-leaf-links-to-entries", 1280, { shot: false,
  action: act(`await total();const t=await until(()=>q('[data-spend-node="cat_materials"] .sp-toggle'));t.click();await until(()=>q('[data-spend-node="cat_materials"] [data-entries]'));`),
  expect: exp(`const a=q('[data-spend-node="cat_materials"] [data-entries]');if(!a)return 'no See entries link under Materials';const href=a.getAttribute('href');return (href.startsWith('/expenses/?')&&href.includes('f.category='+a.dataset.entries)&&href.includes('f.status=approved'))||href;`) });
add(SPEND, "sp-download-csv", 1280, { shot: false,
  action: act(`await total();const b=await until(()=>q('[data-spend-csv]')&&!q('[data-spend-csv]').disabled&&q('[data-spend-csv]'));b.click();await until(()=>q('[data-spend-csv]').dataset.exported);`),
  expect: exp(`return Number(q('[data-spend-csv]').dataset.exported)>5||'nothing was downloaded';`) });

// ---------- roles: viewer and CA read totals, a project manager reads assigned projects, a supervisor is refused ----------
add(SPEND, "sp-viewer-totals-only", 1280, { role: "uViewer", shot: false,
  action: act(`await total();for(const t of qa('[data-spend-tree] .sp-toggle'))t.click();await sleep(500);`),
  expect: exp(`const el=await total();if(!el)return main().slice(0,200);return (paise(el)>0&&el.dataset.scope==='company'&&!q('[data-entries]')&&!q('nav.tabs'))||'the viewer sees entry links or expense tabs';`) });
add(SPEND, "sp-ca-reads-totals", 1280, { role: "uCa", shot: false,
  expect: exp(`const el=await total();return (!!el&&paise(el)>0&&el.dataset.scope==='company')||main().slice(0,200);`) });
add(SPEND, "sp-pm-own-projects", 768, { role: "uPm", shot: false,
  expect: exp(`const el=await total();if(!el)return main().slice(0,200);const opts=qa('[data-filter=project] option').map(o=>o.textContent);return (el.dataset.scope==='projects'&&paise(el)>0&&opts[0]==='All my projects'&&!opts.includes('All projects and office')&&sumOf(topNodes())===paise(el))||JSON.stringify({scope:el.dataset.scope,opts});`) });
add(SPEND, "sp-supervisor-refused", 360, { role: "uSupShivNagar", lang: "en", shot: false,
  expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-spend-total]'))||main().slice(0,200);`) });

// ---------- expense heads: rename persists after a reload; add, refusal in plain words, move, archive ----------
add(CATS, "cat-rename-persists", 1280, { reload: true, viewport: true,
  action: act(`await pickCat('cat_misc');q('[data-cat-action=rename]').click();await until(()=>q('[role=dialog]'));fill('Name in English','Miscellaneous (QA)');await sleep(200);q('[data-cat-save]').click();await closed();await sleep(500);`),
  expect: exp(`const li=await until(()=>q('li[data-cat=cat_misc]'));return (!!li&&li.dataset.name==='Miscellaneous (QA)'&&li.innerText.includes('Miscellaneous (QA)'))||main().slice(0,300);`) });
add(CATS, "cat-add-under", 1280, { reload: true, viewport: true,
  action: act(`await pickCat('cat_materials');q('[data-cat-action=add]').click();await until(()=>q('[role=dialog]'));fill('Name in English','QA shuttering');fill('Name in Hindi','क्यूए शटरिंग');await sleep(200);q('[data-cat-save]').click();await closed();await sleep(500);`),
  expect: exp(`const li=await until(()=>catByName('QA shuttering'));return (!!li&&li.dataset.parent==='cat_materials'&&li.dataset.active==='true')||main().slice(0,300);`) });
add(CATS, "cat-same-name-refused", 1280, { viewport: true,
  action: act(`await pickCat('cat_materials');q('[data-cat-action=add]').click();await until(()=>q('[role=dialog]'));fill('Name in English','qa SHUTTERING');await sleep(200);q('[data-cat-save]').click();await until(()=>q('[role=dialog] .field-error')||q('[role=dialog] [role=alert]'));`),
  expect: exp(`const d=q('[role=dialog]');return (!!d&&d.innerText.includes('already a head with this name'))||'a second head with the same name was accepted';`) });
add(CATS, "cat-move", 1280, { reload: true, viewport: true,
  action: act(`const li=await until(()=>catByName('QA shuttering'));if(!li)throw new Error('the head added earlier is missing');await pickCat(li.dataset.cat);q('[data-cat-action=move]').click();await until(()=>q('[role=dialog]'));fill('Move it under','cat_machinery');await sleep(200);q('[data-cat-move]').click();await closed();await sleep(500);`),
  expect: exp(`const li=await until(()=>catByName('QA shuttering'));return (!!li&&li.dataset.parent==='cat_machinery'&&!q('[data-cat-unfinished]'))||main().slice(0,300);`) });
add(CATS, "cat-archive", 360, { reload: true, viewport: true,
  action: act(`const li=await until(()=>catByName('QA shuttering'));if(!li)throw new Error('the head added earlier is missing');await pickCat(li.dataset.cat);q('[data-cat-action=archive]').click();await until(()=>q('[role=dialog]'));await click('Archive');await closed();await sleep(500);`),
  expect: exp(`const li=await until(()=>catByName('QA shuttering'));return (!!li&&li.dataset.active==='false'&&li.innerText.includes('Archived'))||main().slice(0,300);`) });

// ---------- moving a head that has entries: the total stays, the head shows under its new parent, then it goes back ----------
add(CATS, "cat-move-used-head", 1280, { reload: true, shot: false,
  action: act(`await pickCat('cat_materials_cement');q('[data-cat-action=move]').click();await until(()=>q('[role=dialog]'));fill('Move it under','cat_machinery');await sleep(200);q('[data-cat-move]').click();await closed();await until(()=>!q('[data-cat-progress]'),20000);await sleep(500);`),
  expect: exp(`const li=await until(()=>q('li[data-cat=cat_materials_cement]'));return (!!li&&li.dataset.parent==='cat_machinery'&&!q('[data-cat-unfinished]'))||main().slice(0,300);`) });
add(SPEND, "sp-total-same-after-move", 1280, { viewport: true,
  action: act(`await total();const t=await until(()=>q('[data-spend-node="cat_machinery"] .sp-toggle'));t.click();await sleep(400);`),
  expect: exp(`const el=await total();const want=localStorage.getItem('qa-spend-fy');const moved=q('[data-spend-node="cat_machinery"] [data-spend-node="cat_materials_cement"]');return (el.dataset.rupees===want&&!!moved&&sumOf(topNodes())===paise(el)&&!q('[data-spend-node="cat_materials"] [data-spend-node="cat_materials_cement"]'))||JSON.stringify({now:el.dataset.rupees,before:want,moved:!!moved});`) });
add(CATS, "cat-move-back", 1280, { reload: true, shot: false,
  action: act(`await pickCat('cat_materials_cement');q('[data-cat-action=move]').click();await until(()=>q('[role=dialog]'));fill('Move it under','cat_materials');await sleep(200);q('[data-cat-move]').click();await closed();await until(()=>!q('[data-cat-progress]'),20000);await sleep(500);`),
  expect: exp(`const li=await until(()=>q('li[data-cat=cat_materials_cement]'));return (!!li&&li.dataset.parent==='cat_materials')||main().slice(0,300);`) });

// ---------- who may change the heads ----------
add(CATS, "cat-accountant-read-only", 1280, { role: "uAccountant", shot: false,
  expect: exp(`await until(()=>q('li[data-cat]'));return (!!q('[data-cat-read-only]')&&!q('[data-cat-actions]')&&!q('[data-cat-add-top]')&&!q('button.cat-row'))||'the accountant can change the heads';`) });
add(CATS, "cat-pm-refused", 768, { role: "uPm", shot: false,
  expect: exp(`await until(()=>q('[data-no-access]'));return (!!q('[data-no-access]')&&!q('[data-cat-list]'))||main().slice(0,200);`) });
add(CATS, "cat-viewer-refused", 1280, { role: "uViewer", shot: false,
  expect: exp(`await until(()=>q('[data-no-access]'));return !!q('[data-no-access]')||main().slice(0,200);`) });

writeFileSync(new URL("./spendings.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
