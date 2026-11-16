'use strict';
// P3 press feedback (docs/MOTION.md §3.4) with a real touch: a card shrinks to .97 and a button to .98 within
// 100 ms, and on release the scale springs back to 1 within 500 ms without a jump. No filter is used. Reduced motion keeps the overlay and drops the scale.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.PRESS_TEST_PORT||18989),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Enabled in the live fixture overview: a card (tile .97) and a topbar button (.98).
const targets=[['#home-radio',.97],['#header-ro',.98]];
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
  const run={};window.pressRun=run;
  const loop=()=>{if(window.pressRun!==run)return;const style=getComputedStyle(node),scale=style.scale==='none'?1:Number.parseFloat(style.scale);
   window.pressSamples.push({t:performance.now(),scale,filter:style.filter,overlay:style.boxShadow.includes('999px'),
    pressed:node.classList.contains('is-pressed')});
   if(window.pressSamples.length<120)requestAnimationFrame(loop);};
  requestAnimationFrame(loop);
 },selector);
 // A real touch held for 250 ms, as on the wall iPad.
 const session=await page.context().newCDPSession(page),point=[{x:box.x+box.width/2,y:box.y+box.height/2,id:1,
  radiusX:6,radiusY:6,force:1}];
 await sleep(50);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point});await sleep(250);
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();await sleep(900);
 return page.evaluate(selector=>{const node=document.querySelector(selector);delete node.dataset.pressProbe;
  const {down,up}=window.pressTimes;
  return window.pressSamples.map(s=>({...s,sinceDown:s.t-down,sinceUp:s.t-up}));},selector);
}

function check(selector,expected,samples,{reduced=false}={}){
 const held=samples.filter(s=>s.sinceDown>=0&&s.sinceUp<0),after=samples.filter(s=>s.sinceUp>=0);
 assert(held.length>5&&after.length>20,`${selector}: sampled the press and the release`);
 for(const s of samples)assert.equal(s.filter,'none',`${selector}: press never uses filter`);
 assert(held.some(s=>s.pressed&&s.overlay),`${selector}: the overlay shows while pressed`);
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
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);await sleep(600);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.pvMotion),reduced?'reduced':'full');
  for(const [selector,expected]of targets){
   const samples=await press(page,selector);check(selector,expected,samples,{reduced});
   const held=samples.filter(s=>s.sinceDown>=0&&s.sinceUp<0).at(-1).scale;
   console.log('press',JSON.stringify({reduced,selector,held,
    backAt:Math.round(samples.find(s=>s.sinceUp>=0&&Math.abs(s.scale-1)<.002)?.sinceUp??-1)}));
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('press: card .97, button .98, spring release, reduced overlay only ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
