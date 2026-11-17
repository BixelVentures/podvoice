'use strict';
// P4 list (docs/MOTION.md, ui/list-motion.js) on the Musik queue, sampled every frame with a real touch.
// Tapping a later row
// reorders the queue: the chosen row slides up on the smooth spring from where it stood (no jump), the rows it
// passes slide down, and everything lands within ~700 ms; the playing indicator moves to the new current row as one
// element and never jumps.
// Reduced: the queue reorders at once, nothing slides.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.LIST_TEST_PORT||19013),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser;

// Every frame: each row's visible top (layout plus its running translate) and the indicator's box.
const startSampling=page=>page.evaluate(()=>{
 const queue=document.querySelector('#queue'),out=[];window.listSamples=out;
 addEventListener('touchend',()=>{window.listT0=performance.now();},{capture:true,once:true});
 const loop=()=>{
  const rows={};for(const row of queue.querySelectorAll(':scope>.queue-track'))
   rows[row.dataset.trackId]={y:row.getBoundingClientRect().y,current:row.dataset.current==='true',
    ty:Number.parseFloat(getComputedStyle(row).translate.split(' ')[1]??0)||0};
  const eq=queue.querySelector('.queue-eq');
  out.push({t:performance.now(),rows,eq:eq?eq.getBoundingClientRect().y:null});
  if(out.length<70)requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
});

(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 for(const reduced of [false,true]){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820},
   reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/index.html?stage=now`,{waitUntil:'domcontentloaded'});
  await page.locator('.player .cover-button').click();
  await page.locator('#queue>.queue-track').nth(2).waitFor({state:'visible'});await sleep(900);
  const chosen=await page.locator('#queue>.queue-track').nth(2).getAttribute('data-track-id');
  const passed=await page.locator('#queue>.queue-track').nth(0).getAttribute('data-track-id');
  await startSampling(page);
  const box=await page.locator('#queue>.queue-track').nth(2).boundingBox();
  await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  await sleep(1300);
  const samples=await page.evaluate(()=>window.listSamples.map(s=>({...s,t:s.t-(window.listT0??s.t)})));
  const after=samples.filter(s=>s.t>=0&&s.rows[chosen]?.current);
  assert(after.length>10,'the chosen row became the current one');
  const start=after[0],end=samples.at(-1);
  const travel=after.map(s=>s.rows[chosen].y),settled=end.rows[chosen].y;
  assert(Math.abs(end.rows[chosen].ty)<.01&&Math.abs(end.rows[passed].ty)<.01,'every row has landed');
  if(reduced){
   assert(after.every(s=>Object.values(s.rows).every(row=>Math.abs(row.ty)<.01)),'reduced: nothing slides');
   assert(Math.abs(start.rows[chosen].y-settled)<.5,'reduced: the row is in place at once');
  }else{
   assert(Math.abs(box.y-start.rows[chosen].y)<2,`the row starts where it stood (${box.y} vs ${start.rows[chosen].y})`);
   for(let i=1;i<travel.length;i++)assert(travel[i]<=travel[i-1]+.01,`it slides straight up: ${travel.join(' ')}`);
   const moving=travel.filter(y=>Math.abs(y-settled)>.5).length;
   assert(moving>=8,`it slides over several frames, not a jump (${moving})`);
   const landed=after.find(s=>Math.abs(s.rows[chosen].y-settled)<.5);
   assert(landed&&landed.t<=720,`landed within the smooth spring (${landed?.t})`);
   assert(after.some(s=>Math.abs(s.rows[passed].ty)>1),'the passed rows slide too');
   // The indicator travels from its old box to its new one as one element: it never jumps between frames, even
   // though it now lives in another row that slides.
   const eqs=samples.map(s=>s.eq).filter(y=>y!==null);
   assert(eqs.length>20,'the playing indicator is shown');
   const jump=Math.max(...eqs.slice(1).map((y,i)=>Math.abs(y-eqs[i])));
   assert(jump<20,`the indicator does not jump (${jump.toFixed(1)}px)`);
  }
  console.log('list',JSON.stringify({reduced,chosen,landedAt:Math.round(after.find(s=>Math.abs(s.rows[chosen].y-settled)
   <.5)?.t??-1)}));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('list: queue rows slide on the smooth spring, the indicator travels, reduced is immediate ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');}})();
