'use strict';
// P3 press inside a scroller (ui/pressed-state.js), with real touches on the Musik queue. Like UIScrollView's
// delaysContentTouches: a finger that starts a scroll on a row never presses it (no animation starts on any row, so
// nothing hops), a finger resting on a row presses it after 150 ms, and a quick tap still shows the press on release.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.PRESS_SCROLL_TEST_PORT||19014),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser;

// Records, every frame, which queue rows have an animation (a press is Web Animations on the row).
const startSampling=page=>page.evaluate(()=>{
 const run={};window.rowRun=run;window.rowPressed=[];window.rowTimes={};
 addEventListener('pointerdown',()=>{window.rowTimes.down=performance.now();},{capture:true,once:true});
 const loop=()=>{if(window.rowRun!==run)return;
  for(const row of document.querySelectorAll('#queue .queue-track'))
   if(row.getAnimations().length)window.rowPressed.push({t:performance.now()-(window.rowTimes.down??0),
    row:row.dataset.trackId,scale:getComputedStyle(row).scale});
  requestAnimationFrame(loop);};
 requestAnimationFrame(loop);
});
const pressed=page=>page.evaluate(()=>{window.rowRun=null;return window.rowPressed;});
async function touch(page,from,to,{hold=0}={}){
 const session=await page.context().newCDPSession(page),point=p=>[{...p,id:1,radiusX:6,radiusY:6,force:1}];
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(from)});
 if(hold)await sleep(hold);
 if(to)for(let step=1;step<=8;step++){
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point({x:from.x+(to.x-from.x)*step/8,
   y:from.y+(to.y-from.y)*step/8})});await sleep(12);}
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
}

(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 const context=await browser.newContext({hasTouch:true,viewport:{width:1180,height:820}});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 // Keep the page still: the press is under test, not the queue change a tap would make.
 await page.addInitScript(()=>addEventListener('click',event=>{if(event.target.closest?.('#queue')){
  event.preventDefault();event.stopImmediatePropagation();}},true));
 await page.goto(`${base}/index.html?stage=now`,{waitUntil:'domcontentloaded'});
 await page.locator('.player .cover-button').click();
 const rows=page.locator('#queue .queue-track');
 await rows.nth(3).waitFor({state:'visible'});await sleep(900);
 const box=await rows.nth(3).boundingBox(),start={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};

 // A scroll that starts on a row: no row is pressed at any point.
 await startSampling(page);await touch(page,start,{x:start.x,y:start.y-260});await sleep(500);
 assert.deepEqual(await pressed(page),[],'scrolling the queue presses no row');
 // A sideways drag past the slop on a row: no press either.
 await startSampling(page);await touch(page,start,{x:start.x+60,y:start.y});await sleep(500);
 assert.deepEqual(await pressed(page),[],'a drag past the slop presses no row');

 const fresh=await rows.nth(3).boundingBox();
 const at={x:Math.round(fresh.x+fresh.width/2),y:Math.round(fresh.y+fresh.height/2)};
 // A finger resting on a row: pressed after the 150 ms delay, not before.
 await startSampling(page);await touch(page,at,null,{hold:400});await sleep(500);
 const rest=await pressed(page);
 assert(rest.length,'a resting finger presses the row');
 assert(rest[0].t>=140,`the press waits for the finger to rest (${Math.round(rest[0].t)} ms)`);
 // A quick tap: the press shows on release.
 await startSampling(page);await touch(page,at,null,{hold:40});await sleep(500);
 const quick=await pressed(page);
 assert(quick.some(s=>s.scale!=='none'&&Number.parseFloat(s.scale)<1),'a quick tap still shows the press');
 console.log('press-scroll',JSON.stringify({restFirst:Math.round(rest[0].t)}));
 assert.deepEqual(errors,[]);
 console.log('press in a scroller: scrolling presses nothing, resting presses after 150 ms, quick tap presses ok');
}catch(error){console.error(error);process.exitCode=1}finally{await browser?.close();
 if(server&&server.exitCode===null)server.kill('SIGTERM');}})();
