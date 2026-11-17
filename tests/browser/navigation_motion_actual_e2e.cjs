'use strict';
// Navigation motion with a real touch, sampled every frame (docs/MOTION.md §3.2).
// 1. A widget tap (Hjem -> Radio) and the back tap start their page transition within 100 ms of the finger lifting;
//    the press is still springing back then, so the two overlap. Setting data-pv-nav puts no custom property on the
//    root (that restyled the whole page in the tap), and the heading is focused once the new page is there.
// 2. Ro <-> Hjem is a ripple: the new screen is revealed in a circle growing from the finger over the old screen, which
//    stays opaque. No frame fades the page (no flash) and no frame shows the new screen before the circle.
// 3. The Ro button does not change before the navigation: its only write is `hidden` when the page changes, and its
//    opacity and visibility are steady until then (no blink).
// Reduced motion: no circle; the new screen fades in over the old one in --pv-dur-reduced.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.NAVIGATION_TEST_PORT||18996),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data;

// Every frame from the touch on: the transition kind, the page and root snapshots, and the Ro button.
const startSampling=page=>page.evaluate(()=>{
 const run={},root=document.documentElement,ro=document.getElementById('show-photo');
 const host=document.querySelector('pv-widget-host');
 window.navRun=run;window.navSamples=[];window.navTimes={};window.navMutations=[];
 addEventListener('pointerdown',()=>{window.navTimes.down=performance.now();},{capture:true,once:true});
 addEventListener('pointerup',()=>{window.navTimes.up=performance.now();},{capture:true,once:true});
 window.navObserver?.disconnect();
 window.navObserver=new MutationObserver(records=>{for(const r of records)window.navMutations.push(
  {t:performance.now(),what:r.type==='attributes'?`${r.target.nodeName}[${r.attributeName}]`:r.type});});
 window.navObserver.observe(ro,{attributes:true,childList:true,characterData:true,subtree:true});
 const pseudo=name=>{const style=getComputedStyle(root,name);return {opacity:Number(style.opacity),clip:style.clipPath,
  x:style.translate==='none'?0:Number.parseFloat(style.translate)};};
 const loop=()=>{if(window.navRun!==run)return;
  const animations=document.getAnimations().filter(a=>a.effect?.pseudoElement?.startsWith('::view-transition'));
  const style=getComputedStyle(ro);
  window.navSamples.push({t:performance.now(),nav:animations.length?root.dataset.pvNav||null:null,
   rootPageIn:root.dataset.pvNav?getComputedStyle(root).getPropertyValue('--pv-page-in'):'',
   oldRoot:pseudo('::view-transition-old(pv-ro)'),newRoot:pseudo('::view-transition-new(pv-ro)'),
   ro:{hidden:ro.hidden,opacity:style.opacity,visibility:style.visibility},focus:host.state.focus,
   dom:host.dataset.view==='rest'?'photo':document.getElementById('now-view').hidden?'detail':'now'});
  if(window.navSamples.length<120)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
});
const collect=async page=>{await sleep(1500);return page.evaluate(()=>{const up=window.navTimes.up;
 window.navObserver.disconnect();
 return {samples:window.navSamples.map(s=>({...s,t:s.t-up})),
  mutations:window.navMutations.map(m=>({...m,t:m.t-up}))};});};
// A real touch, held for 90 ms like a quick tap on the wall iPad. Returns the touch point in the screen's (host's)
// own box, which is the box of the pv-ro snapshot the ripple clips.
async function tap(page,selector){
 const box=await page.locator(selector).first().boundingBox();assert(box,`${selector} is visible`);
 const point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
 const host=await page.locator('pv-widget-host').boundingBox();
 const session=await page.context().newCDPSession(page);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',
  touchPoints:[{...point,id:1,radiusX:6,radiusY:6,force:1}]});
 await sleep(90);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
 return {x:point.x-host.x,y:point.y-host.y};
}
const circle=clip=>{const m=/^circle\(([\d.]+)px at ([\d.]+)px ([\d.]+)px\)$/.exec(clip||'');
 return m?{r:Number(m[1]),x:Number(m[2]),y:Number(m[3])}:null;};

function checkPage({samples},kind,from){
 const during=samples.filter(s=>s.nav===kind);
 assert(during.length>10,`${kind}: a page transition ran (${during.length} frames)`);
 assert(during[0].t<=100,
  `${kind}: first transition frame ${Math.round(during[0].t)} ms after the finger lifted (<= 100)`);
 // Until the transition draws, the old page is on screen: nothing renders outside the transition.
 for(const s of samples.filter(s=>s.t<during[0].t))
  assert.equal(s.dom,from,`${kind}: no page change before the transition`);
 for(const s of samples.filter(s=>s.nav))assert.equal(s.rootPageIn,'',`${kind}: no custom property on the root`);
 assert.equal(samples.at(-1).nav,null,`${kind}: the transition has ended`);
 return Math.round(during[0].t);
}
function checkRipple({samples,mutations},point,{from,to,reduced}){
 const during=samples.filter(s=>s.nav==='ro');
 assert(during.length>8,`${from}->${to}: a ripple ran (${during.length} frames)`);
 assert(during[0].t<=100,`${from}->${to}: first ripple frame ${Math.round(during[0].t)} ms after the finger lifted`);
 for(const s of samples.filter(s=>s.t<during[0].t))assert.equal(s.dom,from,`${from}->${to}: no jump before the ripple`);
 // The old screen never fades: it is fully there under the new one in every frame (no flash, no blank frame).
 for(const s of during)assert.equal(s.oldRoot.opacity,1,`${from}->${to}: old screen opaque (${s.oldRoot.opacity})`);
 if(reduced){
  for(const s of during)assert.equal(s.newRoot.clip,'none',`${from}->${to}: reduced has no circle`);
  assert(during[0].newRoot.opacity<.5,`${from}->${to}: reduced new screen fades in (${during[0].newRoot.opacity})`);
  const opaque=during.find(s=>s.newRoot.opacity>.99);
  assert(opaque&&opaque.t-during[0].t<=200,`${from}->${to}: reduced fade within --pv-dur-reduced`);
 }else{
  const circles=during.map(s=>circle(s.newRoot.clip));
  assert(circles.every(Boolean),
   `${from}->${to}: every frame clips the new screen to a circle: ${during[0].newRoot.clip}`);
  for(const c of circles)assert(Math.abs(c.x-point.x)<=2&&Math.abs(c.y-point.y)<=2,
   `${from}->${to}: the circle grows from the finger (${c.x},${c.y} vs ${point.x},${point.y})`);
  assert(circles[0].r<=120,`${from}->${to}: the circle starts small (${circles[0].r})`);
  for(let i=1;i<circles.length;i++)assert(circles[i].r>=circles[i-1].r-.01,`${from}->${to}: the circle only grows`);
  for(const s of during)assert.equal(s.newRoot.opacity,1,`${from}->${to}: the new screen is not faded`);
 }
 assert.equal(samples.at(-1).nav,null,`${from}->${to}: the ripple has ended`);
 assert.equal(samples.at(-1).focus,to);
 // Ro button: one write (hidden) and it is the page change; steady look before it.
 const ro=mutations.map(m=>m.what);
 assert.deepEqual(ro,['BUTTON[hidden]'],`${from}->${to}: the Ro button's only change is the page change (${ro})`);
 const before=samples.filter(s=>s.t<mutations[0].t&&!s.ro.hidden);
 for(const s of before)assert.deepEqual(s.ro,before[0].ro,`${from}->${to}: Ro button steady before navigating`);
 return Math.round(during[0].t);
}

(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-navigation-'));
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
  const focused=()=>page.evaluate(()=>document.activeElement?.closest?.('#header-title,#photo-view')?.id||null);
  const report={reduced};

  await startSampling(page);await tap(page,'#home-radio');
  report.push=checkPage(await collect(page),'push','now');assert.equal(await focused(),'header-title');
  await startSampling(page);await tap(page,'.topbar-title-action');
  report.pop=checkPage(await collect(page),'pop','detail');

  await startSampling(page);let point=await tap(page,'#show-photo');
  report.toRo=checkRipple(await collect(page),point,{from:'now',to:'photo',reduced});
  assert.equal(await focused(),'photo-view');
  await startSampling(page);point=await tap(page,'#photo-view');
  report.fromRo=checkRipple(await collect(page),point,{from:'photo',to:'now',reduced});
  assert.equal(await focused(),'header-title');
  console.log('navigation',JSON.stringify(report));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('navigation motion: transitions start <= 100 ms after release, Ro ripples from the finger, no blink ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
