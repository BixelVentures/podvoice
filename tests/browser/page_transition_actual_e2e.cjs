'use strict';
// P1 page push/pop on live layers (docs/MOTION.md §3.2, ui/page-motion.js) with a real touch. The motion itself
// (start, direction, opacity, no flash, timing) is measured frame by frame in navigation_motion_actual_e2e.cjs.
// This journey covers what surrounds it:
// 1. Push and pop leave exactly one page shown, with no layer styles, plate or dim left behind, and no view
//    transition; the old page is hidden again and the heading is the new page's.
// 2. A touch during a push acts on what is under the finger: the back tap is handled and finishes the push.
// 3. A render while a page moves (new data) runs at once; the leaving page stays painted until the end.
// Reduced motion: the same, with the cross-fade.
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

async function tap(page,selector){
 const box=await page.locator(selector).first().boundingBox();assert(box,`${selector} is visible`);
 await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
}
// The page area at rest: which sections are shown, and whether anything of the page layer is left.
const rest=page=>page.evaluate(()=>{
 const feed=document.querySelector('pv-widget-host .responses');
 return {shown:[...feed.children].filter(n=>!n.hidden&&n.getClientRects().length&&!n.dataset.pvPageLayer&&
   n.id!=='resource-rail').map(n=>n.id),
  layer:[...feed.querySelectorAll('[data-pv-page-layer]')].filter(n=>!n.hidden||n.getAttribute('style')).length,
  styled:[...feed.children].filter(n=>/z-index|position|transform/.test(n.getAttribute('style')||'')).map(n=>n.id),
  animations:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming?.().iterations!==Infinity&&
   (a.effect.target?.parentNode===feed||a.effect.pseudoElement?.startsWith('::view-transition'))).length,
  moving:document.querySelector('pv-widget-host').motion.moving};});

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
  const settled=async(name,id)=>{await sleep(900);const r=await rest(page);
   assert.deepEqual(r.shown,[id],`${name}: one page shown`);assert.equal(r.layer,0,`${name}: no plate or dim left`);
   assert.deepEqual(r.styled,[],`${name}: no layer styles left`);assert.equal(r.animations,0,`${name}: nothing moves`);
   assert.equal(r.moving,false,`${name}: the layer has ended`);
   const nav=await page.evaluate(()=>document.documentElement.dataset.pvNav);
   assert.equal(nav,undefined,`${name}: no view transition`);};

  await tap(page,'#home-radio');await settled('push','radio-view');assert.equal(await focus(),'radio');
  await tap(page,'.topbar-title-action');await settled('pop','now-view');assert.equal(await focus(),'now');

  // A touch during a push acts on what is under the finger: the back tap is handled and ends the push.
  await tap(page,'#home-radio');await sleep(reduced?60:200);
  assert.equal(await page.evaluate(()=>document.querySelector('pv-widget-host').motion.moving),true,'push running');
  await tap(page,'.topbar-title-action');await settled('interrupted push','now-view');
  assert.equal(await focus(),'now','the touch during the push was not swallowed');

  // A render during the motion (new data) runs at once on the live new page, and the leaving page stays painted.
  const during=await page.evaluate(async()=>{const host=document.querySelector('pv-widget-host');
   const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
   host.querySelector('#home-radio').click();for(let i=0;i<4;i++)await frame();
   const wasMoving=host.motion.moving;host.render();await frame();
   const old=document.getElementById('now-view');
   // The [hidden] attribute, not the property: during a run ui/page-motion.js keeps the leaving page's requested
   // hidden state aside (the property reports it) and applies it only when the motion ends.
   return {wasMoving,painted:getComputedStyle(old).display!=='none'&&!old.hasAttribute('hidden')};});
  assert.equal(during.wasMoving,true,'a page was moving');
  assert.equal(during.painted,true,'the leaving page stays painted through a render');
  await settled('render during the motion','radio-view');
  assert.deepEqual(errors,[]);await context.close();
  console.log('page',JSON.stringify({reduced,ok:true}));
 }
 console.log('page transition: live layers end clean, a touch during them is handled, renders keep the old page ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');
 if(data)await fs.rm(data,{recursive:true,force:true});}})();
