'use strict';
// The wall iPad must never end up drawing a screen that ignores every tap (HA Companion = WebKit). Real touch in
// WebKit at 1180×820 against the packaged UI:
// 1. The timer alarm's buttons take a tap. They were placed with `transform`, which the press rule
//    `:is(button,…):active{transform:none!important}` (ui-kit.css) removes while the finger is down: in WebKit the
//    button jumps away under the finger, the release lands on the modal alarm itself and the tap is lost. With
//    »Stop« not allowed, »Luk visning« was the only way out of a full-screen modal.
// 2. No control anywhere is placed by `transform` (the same rule would move it under the finger).
// 3. A modal dialog that is open but not drawn (the page is inert and looks normal) is closed by the first tap.
// 4. »Tidligere svar« opened again before its close event has run leaves no page inert after it closes.
// PODVIEW_TEST_ENGINES=chromium runs the same checks in Chromium.
const playwright=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const engines=(process.env.PODVIEW_TEST_ENGINES||'webkit').split(',');
const port=Number(process.env.TAP_LOCK_TEST_PORT||(20000+Math.floor(Math.random()*20000)));
const base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const STAGES=['now','timer-detail-finished','timers','weather','radio-selected','music','player','light','catalog',
 'stack','visual-history','rest'];
let server,browser;

async function tap(page,selector){
 const box=await page.locator(selector).first().boundingBox();
 assert(box,`${selector} is visible`);
 await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await sleep(500);
}
const opened=page=>page.evaluate(()=>[...document.querySelectorAll('dialog[open]')].map(d=>d.id));
const modals=page=>page.evaluate(()=>[...document.querySelectorAll('dialog')].filter(d=>d.matches(':modal'))
 .map(d=>d.id));
const focus=page=>page.evaluate(()=>document.querySelector('pv-widget-host').state.focus);
const inertPages=page=>page.evaluate(()=>[...document.querySelectorAll('.responses>[inert]')]
 .map(n=>n.id||n.className));

(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 for(const engine of engines){
  browser=await playwright[engine].launch(engine==='chromium'?env.browserOptions():{headless:true});
  const open=async stage=>{
   const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
   await page.goto(`${base}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
   await page.locator('pv-widget-host').waitFor({state:'attached'});await sleep(900);return page;
  };

  // 1. The alarm's Stop and »Luk visning« each close it with one tap, and the screen under it answers taps again.
  for(const control of ['#timer-alert-dismiss','#timer-alert-open']){
   const page=await open('timer-detail-finished');
   assert.deepEqual(await opened(page),['timer-alert'],'the alarm is shown');
   await tap(page,control);await sleep(400);
   assert.deepEqual(await opened(page),[],`${engine}: one tap on ${control} closes the alarm`);
   assert.equal(await page.locator('#timer-alert').isVisible(),false);
   await tap(page,'.topbar-title-action');
   assert.equal(await focus(page),'now',`${engine}: after ${control} the screen answers a tap`);
   assert.deepEqual(page.errors,[]);await page.close();
  }

  // 2. No visible control is placed by a transform with a translation (the press rule removes it under the finger).
  for(const stage of STAGES){
   const page=await open(stage);
   const moved=await page.evaluate(()=>[...document.querySelectorAll('button,a[href],summary,[role=button]')]
    .filter(node=>node.getClientRects().length).map(node=>{const m=new DOMMatrix(getComputedStyle(node).transform);
     return {id:node.id||String(node.className).slice(0,40),x:Math.round(m.m41),y:Math.round(m.m42)};})
    .filter(row=>Math.abs(row.x)>1||Math.abs(row.y)>1));
   assert.deepEqual(moved,[],`${engine} ${stage}: controls placed by transform`);
   await page.close();
  }

  // 3. A modal that is open but not drawn is closed by the first tap; the next tap works.
  {
   const page=await open('now');
   await tap(page,'#output');
   assert.deepEqual(await modals(page),['rooms'],'the speaker sheet is open');
   // Whatever leaves it undrawn (an ancestor hidden, a transition that never ran) the page is inert under it.
   await page.evaluate(()=>{document.getElementById('rooms').style.setProperty('visibility','hidden','important');});
   // An empty spot of the topbar, so only the recovery is under test.
   await page.touchscreen.tap(790,60);await sleep(400);
   assert.deepEqual(await modals(page),[],`${engine}: an undrawn modal is closed by the first tap`);
   await tap(page,'#home-weather');
   assert.equal(await focus(page),'weather',`${engine}: the next tap works`);
   assert.deepEqual(page.errors,[]);await page.close();
  }

  // 4. »Tidligere svar« closed and opened again in one task, then closed: no page is left inert.
  {
   const page=await open('now');
   await tap(page,'#open-history');
   assert((await inertPages(page)).length>0,'the pages under the history are inert while it is open');
   await page.evaluate(()=>{const history=document.getElementById('history');history.close();
    document.getElementById('open-history').click();});
   await sleep(300);await page.evaluate(()=>document.getElementById('history').close());await sleep(500);
   assert.deepEqual(await inertPages(page),[],`${engine}: no page is left inert`);
   if(await focus(page)!=='now')
    await page.evaluate(()=>document.querySelector('pv-widget-host').dispatch({type:'show',id:'now'}));
   await sleep(600);await tap(page,'#home-weather');
   assert.equal(await focus(page),'weather',`${engine}: Hjem answers a tap`);
   assert.deepEqual(page.errors,[]);await page.close();
  }
  await browser.close();browser=null;
  console.log(`tap lock (${engine}): alarm buttons, transforms, undrawn modals and history inert ok`);
 }
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();server?.kill();}})();
