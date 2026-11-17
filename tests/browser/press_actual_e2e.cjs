'use strict';
// P3 press feedback (docs/MOTION.md) with a real touch: a card shrinks to .97 and a button to .98 within 100 ms, and
// on release the scale springs back to 1 on Motion's critically damped quick spring: no jump, no overshoot. A card
// only scales (as a UICollectionViewCell or a SwiftUI press): no overlay, shadow, colour or opacity change; a button
// keeps its overlay. The press is Web Animations on the control: no class, attribute or inline style changes
// anywhere. No filter. Reduced motion: a card dims to .8, a button keeps its overlay; nothing scales.
// Per-frame timing (rAF deltas) through press and release is reported. PODVIEW_TEST_ENGINE=webkit runs it in WebKit
// with a mouse for the finger.
const playwright=require('playwright');
const engine=process.env.PODVIEW_TEST_ENGINE||'chromium';
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.PRESS_TEST_PORT||18989),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Enabled in the live fixture overview: a card (tile .97) and a topbar button (.98).
const targets=[['#home-radio',.97,'card'],['#header-ro',.98,'button']];
let server,browser,data;

// Samples the target's computed press styles every frame from pointerdown until well after release.
async function press(page,selector){
 const box=await page.locator(selector).boundingBox();
 assert(box,`${selector} is visible`);
 await page.evaluate(selector=>{
  const node=document.querySelector(selector);window.pressSamples=[];window.pressTimes={};
  // Keep the page still: the press is under test, not the navigation it would start.
  window.pressBlock??=event=>{if(event.target.closest?.('[data-press-probe]')){event.preventDefault();
   event.stopImmediatePropagation();}};
  window.addEventListener('click',window.pressBlock,true);node.dataset.pressProbe='';
  addEventListener('pointerdown',()=>{window.pressTimes.down=performance.now();},{capture:true,once:true});
  addEventListener('pointerup',()=>{window.pressTimes.up=performance.now();},{capture:true,once:true});
  // Any class, attribute or inline-style write on the control or an ancestor would invalidate selectors page-wide.
  window.pressMutations=[];window.pressObserver?.disconnect();
  window.pressObserver=new MutationObserver(records=>{for(const r of records)if(r.target.contains?.(node))
   window.pressMutations.push(`${r.target.id||r.target.nodeName}[${r.attributeName}] ${r.target.getAttribute(r.attributeName)}`);});
  window.pressObserver.observe(document.documentElement,{attributes:true,subtree:true});
  const run={};window.pressRun=run;
  const loop=()=>{if(window.pressRun!==run)return;const style=getComputedStyle(node),scale=style.scale==='none'?1:Number.parseFloat(style.scale);
   window.pressSamples.push({t:performance.now(),scale,filter:style.filter,overlay:style.boxShadow.includes('999px'),
    opacity:Number(style.opacity),shadow:style.boxShadow,background:style.backgroundColor,
    pressed:node.getAnimations().length>0});
   if(window.pressSamples.length<120)requestAnimationFrame(loop);};
  requestAnimationFrame(loop);
 },selector);
 // A real touch held for 250 ms, as on the wall iPad (a mouse in WebKit, which has no touch input to drive).
 const x=box.x+box.width/2,y=box.y+box.height/2;
 if(engine==='chromium'){
  const session=await page.context().newCDPSession(page),point=[{x,y,id:1,radiusX:6,radiusY:6,force:1}];
  await sleep(50);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point});await sleep(250);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
 }else{await page.mouse.move(x,y);await sleep(50);await page.mouse.down();await sleep(250);await page.mouse.up();}
 await sleep(900);
 return page.evaluate(selector=>{const node=document.querySelector(selector);delete node.dataset.pressProbe;
  const {down,up}=window.pressTimes;window.pressObserver.disconnect();
  const samples=window.pressSamples.map(s=>({...s,sinceDown:s.t-down,sinceUp:s.t-up}));
  samples.mutations=window.pressMutations;return {samples,mutations:window.pressMutations};},selector).then(result=>{
  assert.deepEqual(result.mutations,[],`${selector}: the press writes no class, attribute or style`);return result.samples;});
}

function check(selector,expected,samples,{reduced=false,kind}={}){
 const held=samples.filter(s=>s.sinceDown>=0&&s.sinceUp<0),after=samples.filter(s=>s.sinceUp>=0);
 assert(held.length>5&&after.length>20,`${selector}: sampled the press and the release`);
 for(const s of samples)assert.equal(s.filter,'none',`${selector}: press never uses filter`);
 for(const s of samples)assert(s.scale<=1.0005,`${selector}: no overshoot (${s.scale})`);
 if(kind==='card'){
  // Only the scale moves: no colour, shadow or brightness change, so nothing jumps.
  for(const s of samples){assert.equal(s.overlay,false,`${selector}: a card has no overlay`);
   assert.equal(s.shadow,samples[0].shadow,`${selector}: the shadow never changes`);
   assert.equal(s.background,samples[0].background,`${selector}: the colour never changes`);}
  if(reduced)assert(Math.abs(held.at(-1).opacity-.8)<.01,`${selector}: reduced dims to .8 (${held.at(-1).opacity})`);
  else for(const s of samples)assert.equal(s.opacity,1,`${selector}: a card does not dim`);
 }else assert(held.some(s=>s.pressed&&s.overlay),`${selector}: the overlay shows while pressed`);
 const target=reduced?1:expected,last=held.at(-1).scale;
 assert(Math.abs(last-target)<.002,`${selector}: held scale ${last}, expected ${target}`);
 if(target<1){
  const early=held.filter(s=>s.sinceDown<=100).at(-1);
  assert(early&&early.scale<1-(1-target)*.7,`${selector}: visible within 100 ms (scale ${early?.scale})`);
  const release=after.filter(s=>s.sinceUp<=500);
  for(let i=1;i<release.length;i++)assert(release[i].scale>=release[i-1].scale-1e-4,`${selector}: release is monotonic`);
  assert(release[0].scale<1-(1-target)*.5,`${selector}: release starts from the pressed scale (${release[0].scale})`);
  const steps=release.filter(s=>s.scale>target+.001&&s.scale<.999).length;
  assert(steps>=5,`${selector}: release animates over several frames, not a jump (${steps})`);
  assert(Math.abs(release.at(-1).scale-1)<.002,`${selector}: back at 1 within 500 ms (${release.at(-1).scale})`);
 }else{
  for(const s of samples)assert.equal(s.scale,1,`${selector}: no scale`);
 }
 assert(after.filter(s=>s.sinceUp>300).every(s=>!s.overlay),`${selector}: overlay gone after release`);
}

(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-press-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('fixture exited');try{
  if((await fetch(base+'/view/')).ok)break}catch{}
  if(n>100)throw Error('fixture startup');await sleep(100)}
 browser=await playwright[engine].launch(engine==='chromium'?env.browserOptions():{headless:true});
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);await sleep(600);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.pvMotion),reduced?'reduced':'full');
  for(const [selector,expected,kind]of targets){
   const samples=await press(page,selector);check(selector,expected,samples,{reduced,kind});
   const held=samples.filter(s=>s.sinceDown>=0&&s.sinceUp<0).at(-1).scale;
   const deltas=[];for(let i=1;i<samples.length;i++)
    if(samples[i].sinceDown>=0&&samples[i].sinceUp<600)deltas.push(samples[i].t-samples[i-1].t);
   console.log('press',JSON.stringify({engine,reduced,selector,held,
    backAt:Math.round(samples.find(s=>s.sinceUp>=0&&Math.abs(s.scale-1)<.002)?.sinceUp??-1),
    frames:deltas.length,over20:deltas.filter(d=>d>20).length,maxFrame:Math.round(Math.max(...deltas))}));
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(`press (${engine}): card .97 scale only, button .98, critically damped release, reduced dims ok`);
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
