// Builds tools/jobs/live.json: the CRM in FIREBASE mode (the build in web/out-firebase, connected to the user's own project),
// checked in a real browser with nobody signed in. It proves the connection starts, that a project which is not fully set
// up shows plain-words "steps still to do" instead of an error, and that no screen opens without a sign-in.
// What it cannot do: sign in as the user. Google, the first-owner step, the rules and the functions are only verifiable after
// the user has done GO-LIVE-LOCAL.md.
// Usage: node tools/jobs/make-live.mjs, then:  UI_ROOT=web/out-firebase node tools/ui-check.mjs tools/jobs/live.json <outdir>
import { writeFileSync } from "node:fs";

const J = [];
const LIVE = ["googleapis.com", "cloudfunctions.net", "firebaseapp.com", "gstatic.com", "google.com", "/.netlify/functions/"];
const add = (path, name, width, o = {}) => J.push({ path, name, width, theme: o.theme ?? "light", shot: o.shot ?? true, noShell: true, allowFailed: LIVE, ...o });
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const byLabel=(txt)=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent.replace(/\\s*\\*\\s*$/,'').trim()===txt);if(!l)throw new Error('no label: '+txt);return document.getElementById(l.htmlFor);};
const fill=(txt,v)=>{const el=byLabel(txt);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
const probe=async()=>{await until(()=>document.querySelector('[data-setup-progress]:not([data-setup-progress=checking])'),20000);};
`;
const act = (b) => H + b;
const exp = (b) => H + b;

// The sign-in screen at phone and desktop widths, both themes.
for (const w of [390, 1280]) for (const theme of ["light", "dark"]) {
  add("/", "live-signin", w, { theme, expect: exp(`await until(()=>document.querySelector('[data-google]'),15000);await probe();
const bad=[];if(document.querySelector('.demo-banner')||document.querySelector('[data-role-switcher]'))bad.push('demo UI shown in Firebase mode');
if(!document.querySelector('input[type=email]'))bad.push('no email box');if(!document.querySelector('input[type=password]'))bad.push('no password box');
const lines=[...document.querySelectorAll('[data-progress]')].map(l=>l.dataset.progress);if(lines.join()!=='database,signIn,server,owner')bad.push('progress lines: '+lines.join());
return bad.length===0||bad.join('; ');`) });
}
add("/", "live-signin", 390, { lang: "hi", state: "hi", expect: exp(`await until(()=>document.querySelector('[data-google]'),15000);await sleep(800);return (document.querySelector('h1').textContent.includes('साइन इन')&&document.querySelector('[data-google]').textContent.includes('Google'))||document.querySelector('h1').textContent;`) });

// The "steps still to do" panel tells the truth about the project, in plain words, whichever state it is in.
add("/", "live-progress", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-google]'),15000);await probe();const p=document.querySelector('[data-setup-progress]');
const t=p.innerText;const state=p.dataset.setupProgress;const missing=Number(p.dataset.missing);
const lines=[...p.querySelectorAll('[data-progress][data-ok=false]')];
const plain=lines.every(l=>/Firebase console|DEPLOY\\.md/.test(l.innerText));const noJargon=!/undefined|\\[object|TypeError|FirebaseError|auth\\//.test(document.body.innerText);
return ((state==='ready'&&missing===0)||(state==='missing'&&missing===lines.length&&missing>0&&plain))&&noJargon||JSON.stringify({state,missing,t:t.slice(0,400)});`) });

// The "Saving records" line is a real check of the CRM's server part (D-51). The harness stands in for it (cookie fakeApi):
// absent on this computer (not counted as a missing step), deployed without its key (a missing step, in plain words), connected.
add("/", "live-server-line", 390, { state: "states", expect: exp(`await until(()=>document.querySelector('[data-google]'),15000);await probe();
const line=()=>document.querySelector('[data-progress=server]');const panel=()=>document.querySelector('[data-setup-progress]');const bad=[];
const recheck=async(want)=>{document.querySelector('[data-progress-recheck]').click();const ok=await until(()=>!document.querySelector('[data-progress-recheck]').disabled&&line()&&line().dataset.ok===want,15000);if(!ok)bad.push('after recheck wanted ok='+want+', got '+(line()?line().dataset.ok:'no line'));};
if(line().dataset.ok!=='null'||!/works on the Netlify site, not on this computer/.test(line().innerText))bad.push('local: '+line().dataset.ok+' '+line().innerText);
const before=Number(panel().dataset.missing);
document.cookie='fakeApi=noKey; path=/';await recheck('false');
if(!/has no key yet/.test(line().innerText)||!/DEPLOY\\.md/.test(line().innerText))bad.push('noKey text: '+line().innerText);
if(Number(panel().dataset.missing)!==before+1||panel().dataset.setupProgress!=='missing')bad.push('noKey not counted as a step: '+panel().dataset.missing);
document.cookie='fakeApi=connected; path=/';await recheck('true');
if(!/server part is connected/.test(line().innerText))bad.push('connected text: '+line().innerText);
if(Number(panel().dataset.missing)!==before)bad.push('connected still counted: '+panel().dataset.missing);
document.cookie='fakeApi=; path=/; max-age=0';
return bad.length===0||bad.join('; ');`) });

// An email sign-in against the real project: a plain message, never a raw error. (With Authentication not started the
// message says the method is not turned on; with it started and a wrong password, that the email or password is wrong.)
add("/", "live-email-attempt", 1280, { shot: false,
  action: act(`await until(()=>document.querySelector('[data-google]'),15000);fill('Email','check@example.invalid');fill('Password','not-a-real-password');
[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sign in'&&!b.disabled)?.click();await until(()=>document.querySelector('[data-signin-error]'),20000);await sleep(300);`),
  expect: exp(`const e=document.querySelector('[data-signin-error]');const code=e?.dataset.signinError;const t=document.body.innerText;
return (!!e&&['notEnabled','badLogin','tooMany','offline'].includes(code)&&!/auth\\/|FirebaseError|undefined/.test(t))||JSON.stringify({code,t:t.slice(0,300)});`) });

// Email-link sign-in and creating a password exist and read plainly; with the project's sign-in off, the plain note says so.
add("/", "live-email-and-create", 1280, { shot: false,
  expect: exp(`await until(()=>document.querySelector('[data-google]'),15000);await probe();
const bad=[];if(!document.querySelector('[data-email-link]'))bad.push('no email-link button');
if(!/sign-in link/i.test(document.querySelector('[data-email-link]')?.textContent||''))bad.push('email-link wording');
const t=document.querySelector('[data-create-toggle]');if(!t)bad.push('no create-password toggle');else{t.click();await sleep(200);
if(!/Choose a password/.test(document.body.innerText))bad.push('create form not shown');if(!/Create my account/.test(document.body.innerText))bad.push('no create button');}
const off=document.querySelector('[data-progress=signIn]')?.dataset.ok==='false';
if(off&&!document.querySelector('[data-providers-off]'))bad.push('provider note missing while sign-in is off');
if(off&&!/turned on in the Firebase console \\(step 5\\)/.test(document.querySelector('[data-providers-off]')?.innerText||''))bad.push('provider note wording');
return bad.length===0||bad.join('; ');`) });
add("/", "live-email-link-attempt", 1280, { shot: false,
  action: act(`await until(()=>document.querySelector('[data-google]'),15000);fill('Email','check@example.invalid');document.querySelector('[data-email-link]').click();
await until(()=>document.querySelector('[data-signin-error]')||document.querySelector('[data-note]'),20000);await sleep(300);`),
  expect: exp(`const e=document.querySelector('[data-signin-error]');const code=e?.dataset.signinError;const n=document.querySelector('[data-note]');const t=document.body.innerText;
return ((n&&/Link sent to/.test(n.innerText)||(e&&['notEnabled','offline','tooMany'].includes(code)))&&!/auth\\/|FirebaseError|undefined/.test(t))||JSON.stringify({code,note:n?.innerText,t:t.slice(0,200)});`) });

// Nothing opens without a sign-in, including the Setup page; no demo data and no secrets show.
for (const path of ["/settings/setup/", "/projects/", "/labour/payments/", "/clients/", "/settings/"]) {
  add(path, "live-needs-signin", 390, { shot: false,
    expect: exp(`await until(()=>document.querySelector('[data-google]'),15000);const t=document.body.innerText;
return (!document.querySelector('[data-setup-item]')&&!document.querySelector('.sidenav')&&!/Resend|Shiv Nagar|Anil Mishra/.test(t))||t.slice(0,200);`) });
}

writeFileSync(new URL("./live.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(J.length, "jobs");
