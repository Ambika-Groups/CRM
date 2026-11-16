// Builds tools/jobs/files.json: browser checks for the files adapter (photos and documents on the free plan), run in
// demo mode against the demo-only page /settings/files-check/ (web/src/components/files/FilesDemo.tsx).
// What is checked: a large photo is made smaller (under 150 KB, a JPEG) and kept; it is still there after a reload;
// the full-size viewer opens it; a wrong file type and a PDF where only photos are wanted are refused in plain words;
// a PDF is kept as it is; no more than the limit can be added; adding works offline; a file is removed after a
// confirmation and stays removed after a reload; who may attach and see files (supervisor, viewer, CA); the usage
// line; and the screens in Hindi, at 360 px and in the dark theme.
// Jobs share one browser profile, so the demo data carries over from job to job in this order.
// Usage: node tools/jobs/make-files.mjs   then   node tools/ui-check.mjs tools/jobs/files.json <outDir>
import { writeFileSync } from "node:fs";

const J = [];
const add = (name, width, o = {}) => J.push({ path: "/settings/files-check/", name, width, theme: o.theme ?? "light", shot: o.shot ?? true, ...o });

// Helpers shared by the actions and expects (run inside the page).
const H = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){let v;try{v=f();}catch(e){v=null;}if(v)return v;await sleep(100);}return null;};
const main=()=>document.querySelector('main').innerText;
const q=(s)=>document.querySelector(s);
const qa=(s)=>[...document.querySelectorAll(s)];
const saved=()=>qa('[data-saved-files] [data-file-thumb]');
const ready=()=>until(()=>q('[data-files-check] [data-file-input]')&&(q('[data-saved-files] [data-file-thumb]')||q('[data-saved-files] .empty')));
// A picture like a phone photo of a bill: large, detailed, the same every time.
const makePhoto=async(w,h,name)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,w,h);g.addColorStop(0,'#f4efe6');g.addColorStop(1,'#b9c4d0');x.fillStyle=g;x.fillRect(0,0,w,h);let s=7;const r=()=>{s=(s*16807)%2147483647;return s/2147483647;};for(let i=0;i<1500;i++){x.fillStyle='rgb('+Math.floor(r()*255)+','+Math.floor(r()*255)+','+Math.floor(r()*255)+')';x.fillRect(r()*w,r()*h,8+r()*60,4+r()*30);}x.fillStyle='#111111';x.font='bold 64px sans-serif';x.fillText('TAX INVOICE 1234',80,160);const b=await new Promise(res=>c.toBlob(res,'image/jpeg',0.95));return new File([b],name,{type:'image/jpeg'});};
const makePdf=(name)=>new File(['%PDF-1.4 1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 300 200]/Parent 2 0 R>>endobj trailer<</Root 1 0 R>> %%EOF'],name,{type:'application/pdf'});
const give=async(card,files)=>{const inp=await until(()=>q('[data-check='+card+'] [data-file-input]'));if(!inp)throw new Error('no file input: '+card);const dt=new DataTransfer();for(const f of files)dt.items.add(f);inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));await sleep(200);await until(()=>!q('[data-check='+card+'] [data-busy]'),20000);await sleep(300);};
const thumbs=(card)=>qa('[data-check='+card+'] [data-file-thumb]');
const errors=(card)=>q('[data-check='+card+'] [data-file-errors]')?.innerText||'';
`;
const act = (body) => H + body;
const exp = (body) => H + body;

// ---------- the empty page ----------
add("files-empty", 1280, {
  expect: exp(`await ready();return (qa('[data-file-attach]').length===3&&saved().length===0&&!!q('[data-saved-files] .empty')&&main().includes('Bill photo'))||main().slice(0,300);`) });

// ---------- attach: a large photo is made smaller and kept; it is still there after a reload ----------
add("files-attach-bill", 1280, { reload: true, viewport: true,
  action: act(`await ready();const f=await makePhoto(2400,1800,'Shop bill 12.jpg');sessionStorage.setItem('fc-orig',String(f.size));await give('bill',[f]);const t=thumbs('bill')[0];sessionStorage.setItem('fc-added',t?t.dataset.sizeBytes+'|'+t.dataset.mime:'none|'+errors('bill'));`),
  expect: exp(`await ready();const orig=Number(sessionStorage.getItem('fc-orig'));const added=sessionStorage.getItem('fc-added');const s=saved();const t=s[0];const size=Number(t?.dataset.sizeBytes);const img=t?.querySelector('img');
return (orig>300000&&s.length===1&&size>0&&size<=150000&&t.dataset.mime==='image/jpeg'&&added===size+'|image/jpeg'&&t.innerText.includes('Shop bill 12.jpg')&&!!img&&img.naturalWidth>0&&img.src.startsWith('data:image/')&&img.src.length<=20000)||JSON.stringify({orig,added,n:s.length,size,mime:t?.dataset.mime,text:t?.innerText,err:main().slice(0,200)});`) });

// ---------- the full-size viewer ----------
add("files-viewer", 1280, { viewport: true,
  action: act(`await ready();q('[data-saved-files] [data-file-view-open]').click();await until(()=>{const i=q('[data-file-viewer] img[data-file-view]');return i&&i.complete&&i.naturalWidth>0;});await sleep(300);`),
  expect: exp(`const i=q('[data-file-viewer] img[data-file-view]');const d=q('[data-file-viewer]');return (!!i&&i.naturalWidth>=600&&i.naturalWidth<=1600&&!!d.querySelector('[data-file-download]')&&!!d.querySelector('[data-file-open]')&&d.innerText.includes('Shop bill 12.jpg')&&d.innerText.includes('KB'))||JSON.stringify({w:i?.naturalWidth,state:q('[data-file-view-state]')?.dataset.fileViewState,text:d?.innerText});`) });
add("files-viewer", 390, { viewport: true, state: "phone",
  action: act(`await ready();q('[data-saved-files] [data-file-view-open]').click();await until(()=>{const i=q('[data-file-viewer] img[data-file-view]');return i&&i.complete&&i.naturalWidth>0;});await sleep(300);`),
  expect: exp(`const i=q('[data-file-viewer] img[data-file-view]');return (!!i&&i.getBoundingClientRect().width<=390&&i.getBoundingClientRect().width>100)||('viewer image width '+i?.getBoundingClientRect().width);`) });

// ---------- refusals in plain words ----------
add("files-wrong-type", 390, { viewport: true,
  action: act(`await ready();await give('site',[new File(['hello'],'notes.txt',{type:'text/plain'})]);window.__e1=errors('site');await give('site',[makePdf('plan.pdf')]);window.__e2=errors('site');await give('site',[new File([],'empty.jpg',{type:'image/jpeg'})]);window.__e3=errors('site');await give('site',[new File(['not really a picture'],'broken.jpg',{type:'image/jpeg'})]);window.__e4=errors('site');`),
  expect: exp(`const ok=window.__e1.includes('notes.txt is not a photo or a PDF')&&window.__e2.includes('Only photos can be added here')&&window.__e3.includes('empty.jpg is empty')&&window.__e4.includes('broken.jpg could not be opened as a picture')&&thumbs('site').length===0;return ok||JSON.stringify([window.__e1,window.__e2,window.__e3,window.__e4,thumbs('site').length]);`) });

// ---------- a PDF is kept as it is ----------
add("files-pdf", 1280, { reload: true, shot: false,
  action: act(`await ready();await give('bill',[makePdf('GST invoice.pdf')]);window.__n=thumbs('bill').length;`),
  expect: exp(`await ready();const p=saved().filter(t=>t.dataset.mime==='application/pdf');return (saved().length===2&&p.length===1&&p[0].innerText.includes('GST invoice.pdf')&&p[0].innerText.includes('PDF'))||JSON.stringify({n:saved().length,pdf:p.length,err:main().slice(0,200)});`) });

// ---------- no more than the limit ----------
add("files-max", 390, { viewport: true,
  action: act(`await ready();const fs=[];for(let i=1;i<=4;i++)fs.push(await makePhoto(640,480,'limit-'+i+'.jpg'));await give('bill',fs);`),
  expect: exp(`const n=thumbs('bill').length;const e=errors('bill');return (n===3&&e.includes('up to 3')&&q('[data-check=bill] [data-file-choose]').disabled&&q('[data-check=bill] [data-file-count]').innerText.includes('3 of 3'))||JSON.stringify({n,e});`) });

// ---------- offline: the photo is still added (the demo keeps it on this device) ----------
add("files-offline", 390, { offline: "action", shot: false,
  action: act(`await ready();await give('site',[await makePhoto(1200,900,'site-offline.jpg')]);`),
  expect: exp(`return (thumbs('site').length===1&&!errors('site'))||JSON.stringify({n:thumbs('site').length,e:errors('site')});`) });

// ---------- the usage line counts what is kept ----------
add("files-usage", 1280, { shot: false,
  expect: exp(`await ready();await until(()=>q('[data-usage]'));const u=q('[data-usage]');const n=saved().length;const sum=saved().reduce((a,t)=>a+Number(t.dataset.sizeBytes),0);return (!!u&&Number(u.dataset.usageFiles)===n&&Number(u.dataset.usageBytes)===sum&&n>=6&&u.innerText.includes('% of the free space'))||JSON.stringify({files:u?.dataset.usageFiles,bytes:u?.dataset.usageBytes,n,sum});`) });

// ---------- remove: asks first, then the file is gone, and stays gone after a reload ----------
add("files-remove-asks", 1280, { viewport: true,
  action: act(`await ready();sessionStorage.setItem('fc-before',String(saved().length));saved().find(t=>t.innerText.includes('limit-1.jpg')).querySelector('[data-file-remove]').click();await until(()=>q('[role=dialog]'));await sleep(200);`),
  expect: exp(`const d=q('[role=dialog]');return (!!d&&d.innerText.includes('Remove this file?')&&d.innerText.includes('limit-1.jpg')&&saved().length===Number(sessionStorage.getItem('fc-before')))||(d?.innerText??'no dialog');`) });
add("files-remove", 1280, { reload: true, shot: false,
  action: act(`await ready();sessionStorage.setItem('fc-before',String(saved().length));saved().find(t=>t.innerText.includes('limit-1.jpg')).querySelector('[data-file-remove]').click();await until(()=>q('[role=dialog]'));[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Remove').click();await until(()=>saved().length===Number(sessionStorage.getItem('fc-before'))-1);await sleep(300);`),
  expect: exp(`await ready();const before=Number(sessionStorage.getItem('fc-before'));return (before>0&&saved().length===before-1&&!main().includes('limit-1.jpg'))||JSON.stringify({before,now:saved().length});`) });

// ---------- who may attach and see files ----------
// A supervisor adds a site photo on their own project, has no ID proof box, and sees only their own project's files
// (not the owner's company-level bills).
add("files-supervisor", 390, { role: "uSupShivNagar", lang: "en", reload: true, viewport: true, state: "supervisor",
  action: act(`await ready();await give('site',[await makePhoto(1600,1200,'drain-progress.jpg')]);window.__n=thumbs('site').length;`),
  expect: exp(`await ready();const s=saved();return (!q('[data-check=id]')&&s.length===1&&s[0].innerText.includes('drain-progress'))||JSON.stringify({id:!!q('[data-check=id]'),n:s.length,names:s.map(t=>t.innerText.slice(0,30))});`) });
// Site photos are WebP where the browser can make it, and still under the cap.
add("files-photo-format", 1280, { shot: false,
  expect: exp(`await ready();const t=saved().find(x=>x.innerText.includes('drain-progress'));const size=Number(t?.dataset.sizeBytes);return (!!t&&['image/webp','image/jpeg'].includes(t.dataset.mime)&&size>0&&size<=150000)||JSON.stringify({mime:t?.dataset.mime,size});`) });
// The project manager on the same project sees the supervisor's photo; the supervisor of another project does not.
add("files-pm-sees-project", 1280, { role: "uPm", shot: false,
  expect: exp(`await ready();const s=saved();return (s.length===1&&s[0].innerText.includes('drain-progress'))||JSON.stringify(s.map(t=>t.innerText.slice(0,30)));`) });
add("files-other-site", 390, { role: "uSupGomti", lang: "en", shot: false,
  expect: exp(`await ready();return saved().length===0||JSON.stringify(saved().map(t=>t.innerText.slice(0,30)));`) });
// The viewer and the CA cannot add a file; the viewer sees none; the CA sees bills only.
add("files-viewer-role", 1280, { role: "uViewer", shot: false,
  action: act(`await ready();await give('site',[await makePhoto(640,480,'viewer-try.jpg')]);`),
  expect: exp(`return (thumbs('site').length===0&&errors('site').includes("can't add")&&saved().length===0)||JSON.stringify({n:thumbs('site').length,e:errors('site'),s:saved().length});`) });
add("files-ca-role", 1280, { role: "uCa", shot: false,
  action: act(`await ready();await give('bill',[await makePhoto(640,480,'ca-try.jpg')]);`),
  expect: exp(`const s=saved();return (thumbs('bill').length===0&&errors('bill').includes("can't add")&&s.length>=1&&s.every(t=>!t.innerText.includes('drain-progress')&&!t.innerText.includes('site-offline')))||JSON.stringify({e:errors('bill'),names:s.map(t=>t.innerText.slice(0,30))});`) });

// ---------- Hindi, 360 px, dark ----------
add("files-hi", 360, { lang: "hi", state: "hi",
  expect: exp(`await ready();const t=main();return (t.includes('फ़ाइल जाँच')&&t.includes('बिल की फ़ोटो')&&t.includes('हटाएँ')&&!t.includes('Remove'))||t.slice(0,300);`) });
add("files-dark", 768, { theme: "dark", state: "dark",
  expect: exp(`await ready();return saved().length>=1||main().slice(0,200);`) });
add("files-dark-viewer", 390, { theme: "dark", viewport: true, state: "dark-viewer",
  action: act(`await ready();q('[data-saved-files] [data-file-view-open]').click();await until(()=>q('[data-file-viewer]'));await sleep(500);`),
  expect: exp(`return !!q('[data-file-viewer]')||'no viewer';`) });

writeFileSync(new URL("./files.json", import.meta.url), JSON.stringify({ jobs: J }, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`${J.length} jobs`);
