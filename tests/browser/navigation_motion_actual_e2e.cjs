'use strict';
// Navigation motion with a real touch, sampled every frame (docs/MOTION.md §0, §3.2).
// 1. A card tap (Hjem -> Radio) and the back tap move the pages (live layers) within 100 ms of the finger lifting.
//    The heading is focused once the new page is there.
// 2. Ro <-> Hjem runs on two live layers, not a view transition. Hjem -> Ro: the Ro photo grows in a circle from the
//    moon button within 100 ms of the release and for at least 450 ms, over Hjem, which is not rendered again until
//    the circle covers it. Ro -> Hjem: Hjem is rendered under the full photo, which then shrinks into the finger.
//    The circle is a scaled mask (transform), never clip-path. Ro and Hjem stay mounted throughout.
// 3. No flash: no frame is lighter or darker than both the screen before and the screen after (pixels, sampled from
//    every frame the compositor draws, in Chromium), and the Ro button changes only when the page changes.
// 4. Per-frame timing is reported: rAF deltas from the release, frames over 20 ms and the longest frame.
// Reduced motion: the Ro photo cross-fades in 200 ms; the new page fades in over the old one.
// PODVIEW_TEST_ENGINE=webkit runs the same journey in WebKit (Safari's engine), with a mouse for the finger and no
// pixel capture (WebKit has no per-frame screencast); NAVIGATION_CPU_THROTTLE=4 slows Chromium's CPU.
const playwright=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const engine=process.env.PODVIEW_TEST_ENGINE||'chromium',chromium=engine==='chromium';
const throttle=Number(process.env.NAVIGATION_CPU_THROTTLE||1);
const port=Number(process.env.NAVIGATION_TEST_PORT||18996),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,data,frameRun=0;

// Every frame from the touch on: rAF time, page transition kind, the Ro layer's circle and the Ro button.
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
 const layer=()=>{
  const cover=host.querySelector('.pv-ro-cover');if(!cover)return {visible:false};
  const style=getComputedStyle(cover),mask=getComputedStyle(cover.querySelector('.pv-ro-mask'));
  const m=/^matrix\(([^)]+)\)$/.exec(mask.transform),v=m?m[1].split(',').map(Number):[1,0,0,1,0,0];
  const [a,e,f]=[v[0],v[4],v[5]];
  const size=cover.querySelector('.pv-ro-mask').offsetWidth/2;
  return {visible:style.visibility==='visible',opacity:Number(style.opacity),radius:a*size,x:e+a*size,y:f+a*size,
   clip:mask.clipPath};
 };
 // A page's horizontal offset as a percentage of its width, whether it is painted, and its opacity.
 const pageAt=id=>{const node=document.getElementById(id),style=getComputedStyle(node);
  const m=/^matrix\(([^)]+)\)$/.exec(style.transform),x=m?Number(m[1].split(',')[4]):0;
  return {x:node.offsetWidth?100*x/node.offsetWidth:0,painted:style.display!=='none'&&!!node.getClientRects().length,
   opacity:Number(style.opacity),hidden:node.hidden,inline:node.getAttribute('style')||''};};
 const loop=()=>{if(window.navRun!==run)return;
  const animations=document.getAnimations().filter(a=>a.effect?.pseudoElement?.startsWith('::view-transition'));
  const style=getComputedStyle(ro),photo=document.getElementById('photo-view');
  window.navSamples.push({t:performance.now(),nav:animations.length?root.dataset.pvNav||null:null,
   now:pageAt('now-view'),radio:pageAt('radio-view'),
   plate:getComputedStyle(host.querySelector('[data-pv-page-layer=plate]')||root).display,
   rootPageIn:root.dataset.pvNav?getComputedStyle(root).getPropertyValue('--pv-page-in'):'',layer:layer(),
   view:host.dataset.view,mounted:document.getElementById('now-view')?.isConnected===true&&photo?.isConnected===true,
   fore:Number(getComputedStyle(photo.querySelector('.photo-time')).opacity),
   ro:{hidden:ro.hidden,opacity:style.opacity,visibility:style.visibility},focus:host.state.focus,
   dom:host.dataset.view==='rest'?'photo':document.getElementById('now-view').hidden?'detail':'now'});
  if(window.navSamples.length<150)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
});
const collect=async page=>{await sleep(1700);return page.evaluate(()=>{const up=window.navTimes.up;
 window.navObserver.disconnect();
 return {samples:window.navSamples.map(s=>({...s,t:s.t-up})),
  mutations:window.navMutations.map(m=>({...m,t:m.t-up}))};});};

// Every frame the compositor draws (Chromium screencast), from before the touch until the screen is still.
async function startFrames(page){
 if(!chromium)return null;
 const session=await page.context().newCDPSession(page),frames=[];
 session.on('Page.screencastFrame',frame=>{frames.push({data:frame.data,at:frame.metadata.timestamp});
  session.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});});
 await session.send('Page.startScreencast',{format:'jpeg',quality:70,maxWidth:590,maxHeight:410,everyNthFrame:1});
 await sleep(150);
 return {session,frames};
}
// Mean luminance of each frame inside box (CSS px of the 1180 x 820 page); decoded in a blank page's canvas.
async function luminance(context,capture,box){
 if(!capture)return null;
 await capture.session.send('Page.stopScreencast');await capture.session.detach();
 // NAVIGATION_FRAMES=<dir> keeps every captured frame for inspection.
 if(process.env.NAVIGATION_FRAMES){const dir=path.join(process.env.NAVIGATION_FRAMES,String(++frameRun));
  await fs.mkdir(dir,{recursive:true});
  for(const [i,frame]of capture.frames.entries())
   await fs.writeFile(path.join(dir,`${String(i).padStart(3,'0')}.jpg`),Buffer.from(frame.data,'base64'));}
 const page=await context.newPage();
 const values=await page.evaluate(async({frames,box})=>{
  const out=[];
  for(const frame of frames){
   const bytes=Uint8Array.from(atob(frame.data),c=>c.charCodeAt(0));
   const image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
   const scale=image.width/1180,canvas=new OffscreenCanvas(image.width,image.height),g=canvas.getContext('2d');
   g.drawImage(image,0,0);
   const x=Math.round(box.x*scale),y=Math.round(box.y*scale);
   const w=Math.round(box.width*scale),h=Math.round(box.height*scale);
   const {data}=g.getImageData(x,y,w,h);let sum=0;
   for(let i=0;i<data.length;i+=4)sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
   out.push(sum/(data.length/4));
  }
  return out;
 },{frames:capture.frames,box});
 await page.close();return values;
}
// No flash: every drawn frame lies between the screen before and the screen after (within tol), and with
// `monotonic` it only ever moves from the one to the other. Ro's tolerance (25) covers the photo drawn alone for a
// few frames while its clock and player fade; a page may go up to 25 darker under its 10 % dim. A flash of the
// paper (lighter than both screens) or a blank frame is outside both.
function checkFlash(name,values,{tol=5,darker=tol,monotonic=false}={}){
 if(!values)return null;
 assert(values.length>=8,`${name}: frames captured (${values.length})`);
 const first=values[0],last=values.at(-1),low=Math.min(first,last)-darker,high=Math.max(first,last)+tol;
 for(const [i,v]of values.entries())assert(v>=low&&v<=high,
  `${name}: frame ${i} luminance ${v.toFixed(1)} outside ${first.toFixed(1)}..${last.toFixed(1)} (a flash)`);
 if(monotonic){const sign=Math.sign(last-first);
  for(let i=1;i<values.length;i++)assert(sign*(values[i]-values[i-1])>=-tol,
   `${name}: frame ${i} goes back (${values[i-1].toFixed(1)} -> ${values[i].toFixed(1)})`);}
 return {frames:values.length,from:Math.round(first),to:Math.round(last),
  min:Math.round(Math.min(...values)),max:Math.round(Math.max(...values))};
}
// rAF deltas from the release through the next 900 ms.
function timing(samples){
 const deltas=[];for(let i=1;i<samples.length;i++)if(samples[i].t>0&&samples[i].t<900)
  deltas.push(samples[i].t-samples[i-1].t);
 return {frames:deltas.length,over20:deltas.filter(d=>d>20).length,max:Math.round(Math.max(...deltas))};
}
// A real touch, held for 90 ms like a quick tap on the wall iPad (CDP touch in Chromium, a mouse in WebKit).
// Returns the touch point in client coordinates.
async function tap(page,selector){
 const box=await page.locator(selector).first().boundingBox();assert(box,`${selector} is visible`);
 const point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
 if(!chromium){await page.mouse.move(point.x,point.y);await page.mouse.down();await sleep(90);await page.mouse.up();
  return point;}
 const session=await page.context().newCDPSession(page);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',
  touchPoints:[{...point,id:1,radiusX:6,radiusY:6,force:1}]});
 await sleep(90);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
 return point;
}

// Push (Hjem -> Radio) and pop run on live layers (ui/page-motion.js), no view transition. The leaving page moves
// within 100 ms of the release and stays painted, opaque and mounted until the new page has arrived; the new page
// starts off-screen (push 100 %, pop -33 %) and only moves towards 0; neither ever fades (no flash). At the end the
// leaving page is hidden again and both carry no layer styles. Reduced: nothing moves; the new page fades in.
function checkPage({samples},kind,reduced){
 const [leaving,entering]=kind==='push'?['now','radio']:['radio','now'];
 for(const s of samples)assert.equal(s.nav,null,`${kind}: no view transition`);
 const moving=samples.filter(s=>s.t>=0&&(Math.abs(s[leaving].x)>.05||s[entering].painted&&s[leaving].painted));
 assert(moving.length>8,`${kind}: the pages moved (${moving.length} frames)`);
 const start=moving[0];
 // Reduced has nothing to move before the new page renders, so its first frame waits for that one render
 // (~100 ms in WebKit on an M-series Mac).
 const limit=reduced&&!chromium?150:100;
 assert(start.t<=limit,
  `${kind}: first moving frame ${Math.round(start.t)} ms after the finger lifted (<= ${limit})`);
 const both=samples.filter(s=>s[entering].painted&&s[leaving].painted);
 for(const s of both){
  assert.equal(s[leaving].opacity,1,`${kind}: the leaving page stays opaque (${s[leaving].opacity})`);
  if(!reduced)assert.equal(s[entering].opacity,1,`${kind}: the new page is opaque (${s[entering].opacity})`);
 }
 const arrived=samples.findIndex(s=>s[entering].painted&&Math.abs(s[entering].x)<.5&&s[entering].opacity>.99);
 assert(arrived>=0,`${kind}: the new page arrived`);
 // Until it has arrived, the leaving page is on screen in every frame: no frame without a page.
 for(const s of samples.slice(0,arrived).filter(s=>s.t>=0))
  assert(s[leaving].painted,`${kind}: the leaving page stays painted until the new one is in place`);
 if(!reduced){
  const from=kind==='push'?100:-33,sign=Math.sign(from),xs=both.map(s=>s[entering].x);
  assert(Math.abs(xs[0]-from)<12,`${kind}: the new page starts at ${from}% (${xs[0]})`);
  for(let i=1;i<xs.length;i++)assert(sign*(xs[i]-xs[i-1])<=.05,`${kind}: the new page only moves in`);
  const olds=samples.filter(s=>s[leaving].painted).map(s=>s[leaving].x),to=kind==='push'?-33:100;
  for(let i=1;i<olds.length;i++)assert(Math.sign(to)*(olds[i]-olds[i-1])>=-.05,`${kind}: the old page only leaves`);
 }
 const end=samples.at(-1);
 assert(!end[leaving].painted&&end[leaving].hidden,`${kind}: the leaving page is hidden at the end`);
 assert.equal(end.plate,'none',`${kind}: the page layer's plate is hidden at the end`);
 assert(!/z-index|position/.test(end[entering].inline),`${kind}: no layer styles left (${end[entering].inline})`);
 return {start:Math.round(start.t),arrived:Math.round(samples[arrived].t),...timing(samples)};
}
function checkRo({samples,mutations},point,{to,reduced}){
 const name=to==='photo'?'Hjem->Ro':'Ro->Hjem',shown=samples.filter(s=>s.layer.visible);
 for(const s of samples)assert.equal(s.mounted,true,`${name}: Ro and Hjem stay mounted`);
 for(const s of samples)assert.equal(s.nav,null,`${name}: no view transition`);
 for(const s of shown)assert(!s.layer.clip||s.layer.clip==='none',`${name}: no clip-path animates (${s.layer.clip})`);
 assert(shown.length>8,`${name}: the Ro layer ran (${shown.length} frames)`);
 const end=samples.at(-1);
 assert.equal(end.layer.visible,false,`${name}: the Ro layer has gone`);assert.equal(end.focus,to);
 assert.equal(end.view,to==='photo'?'rest':'active');
 let start,report={};
 if(to==='photo'){
  // Hjem stays as it is (not rendered again) until the photo covers the screen.
  const full=Math.max(...shown.map(s=>s.layer.radius));
  for(const s of shown.filter(s=>s.view==='rest'))
   assert(s.layer.radius>=full-1&&(reduced||s.layer.opacity===1)||s.fore<1,
    `${name}: Ro is drawn only under the full photo or while its content fades in`);
  const before=samples.filter(s=>s.t<0||!s.layer.visible&&s.view==='active');
  for(const s of before)assert.equal(s.dom,'now',`${name}: no page change before the photo`);
  if(reduced){
   start=shown.find(s=>s.layer.opacity>0);
   for(const s of shown)assert(Math.abs(s.layer.radius-full)<1,`${name}: reduced has no circle`);
   const opaque=shown.find(s=>s.layer.opacity>.99);
   assert(opaque&&opaque.t-start.t<=230,`${name}: reduced cross-fade in 200 ms (${opaque&&opaque.t-start.t})`);
  }else{
   start=shown[0];
   const radii=shown.filter(s=>s.view==='active').map(s=>s.layer.radius);
   assert(radii[0]<=60,`${name}: the circle starts at the moon button (${radii[0]})`);
   for(let i=1;i<radii.length;i++)assert(radii[i]>=radii[i-1]-.01,`${name}: the circle only grows`);
   for(const s of shown.filter(s=>s.view==='active'))assert(Math.abs(s.layer.x-point.x)<=2&&
    Math.abs(s.layer.y-point.y)<=2,`${name}: the circle grows from the moon (${s.layer.x},${s.layer.y})`);
   const covered=shown.find(s=>s.layer.radius>=.995*full);
   report.lasts=Math.round(covered.t-start.t);
   assert(report.lasts>=450,`${name}: the reveal lasts >= 450 ms (${report.lasts})`);
  }
 }else{
  // Hjem renders under the full photo; the photo then shrinks into the finger.
  const first=samples.find(s=>s.view==='active');
  assert(first.layer.visible&&first.layer.opacity===1,`${name}: Hjem is first drawn under the full photo`);
  start=samples.find(s=>s.t>=0&&(s.fore<1||s.layer.visible));
  if(!reduced){
   const shrinking=shown.filter(s=>s.view==='active');
   const radii=shrinking.map(s=>s.layer.radius);
   for(let i=1;i<radii.length;i++)assert(radii[i]<=radii[i-1]+.01,`${name}: the circle only shrinks`);
   for(const s of shrinking)assert(Math.abs(s.layer.x-point.x)<=2&&Math.abs(s.layer.y-point.y)<=2,
    `${name}: the circle shrinks into the finger (${s.layer.x},${s.layer.y} vs ${point.x},${point.y})`);
   report.lasts=Math.round(shown.at(-1).t-start.t);
  }
 }
 assert(start&&start.t<=100,`${name}: first moving frame ${start&&Math.round(start.t)} ms after release (<= 100)`);
 // Ro button: one write (hidden) and it is the page change; steady look before it.
 const ro=mutations.map(m=>m.what);
 assert.deepEqual(ro,['BUTTON[hidden]'],`${name}: the Ro button's only change is the page change (${ro})`);
 const steady=samples.filter(s=>s.t<mutations[0].t&&!s.ro.hidden);
 for(const s of steady)assert.deepEqual(s.ro,steady[0].ro,`${name}: Ro button steady before navigating`);
 return {start:Math.round(start.t),...report,...timing(samples)};
}

(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-navigation-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await playwright[engine].launch(chromium?env.browserOptions():{headless:true});
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},
   reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
  await env.openOverview(page);await sleep(800);
  if(chromium&&throttle>1)await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',
   {rate:throttle});
  const focused=()=>page.evaluate(()=>document.activeElement?.closest?.('#header-title,#photo-view')?.id||null);
  const pageBox=await page.locator('pv-widget-host .responses').boundingBox();
  const screen={x:0,y:0,width:1180,height:820},report={engine,throttle,reduced};
  const step=async(selector,check,box,flash)=>{
   const frames=await startFrames(page);await startSampling(page);const point=await tap(page,selector);
   const result=check(await collect(page),point);
   result.pixels=checkFlash(selector,await luminance(context,frames,box),flash);return result;
  };

  report.push=await step('#home-radio',run=>checkPage(run,'push',reduced),pageBox,{darker:25});
  assert.equal(await focused(),'header-title');
  report.pop=await step('.topbar-title-action',run=>checkPage(run,'pop',reduced),pageBox,{darker:25});
  report.toRo=await step('#show-photo',(run,point)=>checkRo(run,point,{to:'photo',reduced}),screen,
   {monotonic:true,tol:25});
  assert.equal(await focused(),'photo-view');
  report.fromRo=await step('#photo-view',(run,point)=>checkRo(run,point,{to:'now',reduced}),screen,
   {monotonic:false,tol:25});
  assert.equal(await focused(),'header-title');
  console.log('navigation',JSON.stringify(report));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(`navigation motion (${engine}): pages start <= 100 ms; Ro grows from the moon >= 450 ms and shrinks `+
  'into the finger on live layers; no flash ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
