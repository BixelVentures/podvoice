'use strict';
// P1 page transition (docs/MOTION.md §3.2) with a real touch, sampled every frame. Push: the new page comes 48px
// from the right on the smooth spring and fades in over --pv-dur-base while the old page is still there and
// leaves 24px to the left in --pv-dur-quick (it does not vanish in frame 0). Pop is mirrored. A touch during the
// transition reaches the live page and skips it. Reduced motion only fades.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.PAGE_TEST_PORT||18995),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;

// Samples the old and new page snapshots of the view transition every frame, from the touch on.
const startSampling=page=>page.evaluate(()=>{
 const run={};window.pageRun=run;window.pageSamples=[];window.pageT0=null;
 addEventListener('touchend',()=>{window.pageT0=performance.now();},{capture:true,once:true});
 const read=pseudo=>{const style=getComputedStyle(document.documentElement,pseudo);
  return {x:style.translate==='none'?0:Number.parseFloat(style.translate),opacity:Number(style.opacity)};};
 const loop=()=>{if(window.pageRun!==run)return;
  const nav=document.documentElement.dataset.pvNav||null;
  // The snapshots exist once the transition has captured both pages (a frame after data-pv-nav is set).
  const drawn=document.getAnimations().some(a=>a.effect?.pseudoElement?.includes('(pv-page)'));
  window.pageSamples.push({t:performance.now(),nav:drawn?nav:null,old:read('::view-transition-old(pv-page)'),
   now:read('::view-transition-new(pv-page)'),focus:document.querySelector('pv-widget-host').state.focus});
  if(window.pageSamples.length<80)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
});
const samples=async page=>{await sleep(1400);return page.evaluate(()=>window.pageSamples.map(s=>({...s,
 t:s.t-(window.pageT0??s.t)})));};
async function tap(page,selector){
 const box=await page.locator(selector).first().boundingBox();assert(box,`${selector} is visible`);
 await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
}
const series=values=>values.map(v=>Math.round(v*10)/10).join(' ');

function check(s,{kind,reduced}){
 const sign=kind==='push'?1:-1,during=s.filter(x=>x.nav===kind);
 assert(during.length>10,`${kind}: a view transition ran (${during.length} frames)`);
 const first=during[0];
 assert(first.t<100,`${kind}: the transition starts within 100 ms of the touch (${Math.round(first.t)})`);
 // The old page is still there in the first frame and leaves; it is gone within ~300 ms.
 assert(first.old.opacity>.9,`${kind}: the old page does not vanish in frame 0 (${first.old.opacity})`);
 const gone=during.find(x=>x.old.opacity<.01);
 assert(gone&&gone.t-first.t<=200,`${kind}: the old page has left in --pv-dur-quick (${gone&&gone.t-first.t})`);
 const opaque=during.find(x=>x.now.opacity>.99);
 assert(opaque&&opaque.t-first.t<=(reduced?200:300),`${kind}: new page opaque in time (${opaque&&opaque.t-first.t})`);
 if(reduced){
  for(const x of during)assert(x.old.x===0&&x.now.x===0,`${kind}: reduced pages do not move`);
  return;
 }
 assert(Math.abs(first.now.x-sign*48)<2,`${kind}: the new page starts 48px away (${first.now.x})`);
 const xs=during.map(x=>x.now.x);
 for(let i=1;i<xs.length;i++)assert(sign*(xs[i]-xs[i-1])<=.01,`${kind}: new page moves straight in: ${series(xs)}`);
 assert(xs.every(x=>sign*x>=-.01),`${kind}: smooth spring, no overshoot`);
 const half=during.find(x=>sign*x.now.x<24);
 assert(half&&half.t-first.t<260,`${kind}: half way within ~250 ms (${half&&half.t-first.t})`);
 const olds=during.filter(x=>x.old.opacity>0).map(x=>x.old.x);
 for(let i=1;i<olds.length;i++)assert(sign*(olds[i]-olds[i-1])<=.01,`${kind}: old page leaves: ${series(olds)}`);
 assert(during.filter(x=>x.old.opacity>0).every(x=>Math.abs(x.old.x)<=24.01),`${kind}: old page moves at most 24px`);
 assert.equal(s.at(-1).nav,null,`${kind}: the transition has ended`);
}

(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-page-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},
   reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
  await env.openOverview(page);await sleep(500);
  const focus=()=>page.evaluate(()=>document.querySelector('pv-widget-host').state.focus);

  await startSampling(page);await tap(page,'#home-radio');
  const push=await samples(page);check(push,{kind:'push',reduced});assert.equal(await focus(),'radio');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.pvNav),undefined,'push: data-pv-nav cleared');
  await startSampling(page);await tap(page,'.topbar-title-action');
  const pop=await samples(page);check(pop,{kind:'pop',reduced});assert.equal(await focus(),'now');

  // A touch 120 ms into a push reaches the live page: the back tap is handled and the push is skipped.
  if(!reduced){
   await tap(page,'#home-radio');await sleep(120);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.pvNav),'push','push still running');
   assert.ok(await page.evaluate(()=>document.getAnimations().some(a=>a.effect?.pseudoElement)),'snapshots shown');
   await tap(page,'.topbar-title-action');await sleep(900);
   assert.equal(await focus(),'now','the touch during the transition was not swallowed');
  }
  const report=s=>{const d=s.filter(x=>x.nav);return {start:Math.round(d[0].t),
   oldGone:Math.round(d.find(x=>x.old.opacity<.01).t-d[0].t),newOpaque:Math.round(d.find(x=>x.now.opacity>.99).t-d[0].t)};};
  console.log('page',JSON.stringify({reduced,push:report(push),pop:report(pop)}));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('page transition: push/pop with both pages in motion, touch skips, reduced fade only ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
