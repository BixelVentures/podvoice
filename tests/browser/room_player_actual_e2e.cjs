'use strict';
// Music started outside PodView (HA play_media / the Spotify app) shows the same player with
// working controls. PodConnect gives no output proof; only the room's media_player exists.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict'),path=require('node:path');
const port=Number(process.env.ROOM_PLAYER_TEST_PORT||18983),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const update=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify(body)}).then(r=>r.json());
const services=async()=>(await state()).writes.map(write=>write.service);
async function until(check,label,timeout=5000){
 const start=Date.now();
 for(;;){
  const value=await check();if(value)return value;
  if(Date.now()-start>timeout)throw Error(label);await sleep(25);
 }
}
let server,browser;
(async()=>{try{
 server=spawn(env.python,[path.join(__dirname,'room_player_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({ROOM_PLAYER_TEST_PORT:String(port)}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){
  if(server.exitCode!==null)throw Error('server exited');
  try{if((await fetch(base+'/view/')).ok)break;}catch{}
  if(n>100)throw Error('server startup');await sleep(100);
 }
 browser=await chromium.launch(env.browserOptions());
 const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 // The overview's player is the room player.
 const toggle=page.locator('#play-pause'),track=page.locator('#track-name');
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent==='Hey Jude'
  &&!document.querySelector('#play-pause')?.disabled,undefined,{timeout:15000});
 // a) The player shows the room, never an unconfirmed or locked state.
 await page.waitForFunction(()=>document.querySelector('#player-state')?.textContent==='Spiller på'
  &&document.querySelector('#player-room')?.textContent==='Køkkenalrum HomePod',undefined,{timeout:15000});
 const text=await page.locator('pv-widget-host').innerText();
 assert.doesNotMatch(text,/ikke bekræftet/i,'no "not confirmed" state for music started elsewhere');
 for(const selector of ['#play-pause','#next','#previous','#volume'])
  assert.equal(await page.locator(selector).isDisabled(),false,selector+' is usable');
 assert.deepEqual(await services(),[],'opening the player sends nothing');

 // b) Pause flips at once (< 100 ms) and is one media_pause call.
 await toggle.evaluate(button=>{
  button.addEventListener('click',()=>{
   const start=performance.now();
   new MutationObserver((_,observer)=>{
    if(button.getAttribute('aria-label')!=='Fortsæt musikken')return;
    window.pauseFeedbackMs=performance.now()-start;observer.disconnect();
   }).observe(button,{attributes:true,attributeFilter:['aria-label']});
  },{once:true,capture:true});
 });
 await update({hold:true});
 await toggle.tap();
 await until(async()=>(await state()).held,'pause call not held');
 const pauseMs=await page.evaluate(()=>window.pauseFeedbackMs);
 assert(pauseMs>=0&&pauseMs<100,`pause shows within 100 ms: ${pauseMs}`);
 // The running call turns a ring centred in the round button (testnoter 13/11 fejl 5).
 const ring=await toggle.evaluate(button=>{
  const mark=getComputedStyle(button,'::after'),box=button.getBoundingClientRect();
  const left=parseFloat(mark.left),top=parseFloat(mark.top);
  return {busy:button.getAttribute('aria-busy'),animation:mark.animationName,
   dx:left+parseFloat(mark.width)/2-box.width/2,dy:top+parseFloat(mark.height)/2-box.height/2};
 });
 assert.equal(ring.busy,'true','the running pause shows on its button');
 assert.match(ring.animation,/pv-control-pending/,'the waiting ring turns');
 assert(Math.abs(ring.dx)<=1&&Math.abs(ring.dy)<=1,`the ring is centred: ${JSON.stringify(ring)}`);
 // c) While the call runs, buttons stay usable and a second tap waits its turn.
 assert.equal(await page.locator('#next').isDisabled(),false,'next stays usable during a running call');
 await page.locator('#next').tap();
 assert.deepEqual(await services(),['media_pause'],'the second tap waits for the first');
 await update({release:true});
 await until(async()=>(await services()).length===2,'queued next not sent');
 assert.deepEqual(await services(),['media_pause','media_next_track']);
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent==='Let It Be'
  &&document.querySelector('#play-pause')?.getAttribute('aria-label')==='Fortsæt musikken',undefined,{timeout:3000});
 assert.equal((await page.locator('#player-state').innerText()).trim(),'','paused: no "Spiller på"');

 // d) Volume: one absolute call, clamped to the room's maximum (50 %).
 await env.touchRange(page,page.locator('#volume'),80,{thumbSize:32});
 await until(async()=>(await services()).includes('volume_set'),'volume not sent');
 const volume=(await state()).writes.find(write=>write.service==='volume_set');
 assert.equal(volume.volume_level,0.5,'volume is clamped to the room maximum');
 assert.equal(volume.entity_id,'media_player.kokkenalrum');

 // e) A refused call whose effect did not happen: at most one short toast, never text that stays in
 // the player or above the queue, and never a retry.
 const refusedText=()=>page.evaluate(()=>({
  toast:(()=>{const n=document.getElementById('playback-status');
   return !!n?.checkVisibility()&&n.innerText.includes('Højttaleren afviste');})(),
  player:[...document.querySelectorAll('.player,#music-detail')].some(n=>/afviste|svarede ikke/.test(n.innerText)),
 }));
 await update({reject:true});
 const before=(await services()).length;
 await page.locator('#previous').tap();
 await page.waitForFunction(()=>document.getElementById('playback-status')?.innerText.includes('Højttaleren afviste'),
  undefined,{timeout:3000});
 assert.equal((await refusedText()).player,false,'no refusal text in the player or queue');
 await sleep(500);
 assert.equal((await services()).length,before+1,'a rejected tap is sent exactly once');
 await page.waitForFunction(()=>{const n=document.getElementById('playback-status');
  return !n?.checkVisibility()||!n.innerText.includes('Højttaleren afviste');},undefined,{timeout:8000});
 // e2) Green 13/11: Speakers reports a pause as failed although the room paused. Nothing is shown.
 await page.waitForFunction(()=>document.querySelector('#play-pause')?.getAttribute('aria-label')==='Sæt musik på pause'
  ||document.querySelector('#play-pause')?.getAttribute('aria-label')==='Fortsæt musikken',undefined,{timeout:3000});
 if(await toggle.getAttribute('aria-label')==='Fortsæt musikken'){
  await toggle.tap();
  await page.waitForFunction(()=>document.querySelector('#play-pause')?.getAttribute('aria-label')==='Sæt musik på pause',
   undefined,{timeout:3000});
 }
 await update({rejectAfterEffect:true});
 await toggle.tap();
 await page.waitForFunction(()=>document.querySelector('#play-pause')?.getAttribute('aria-label')==='Fortsæt musikken',
  undefined,{timeout:3000});
 for(let n=0;n<20;n++){
  const shown=await refusedText();
  assert(!shown.toast&&!shown.player,'a pause that happened shows no refusal: '+JSON.stringify(shown));
  await sleep(100);
 }
 assert.equal((await state()).room.state,'paused');

 // f) The Spotify app changes the room; HA's state_changed reaches the screen without a reload.
 await until(async()=>(await state()).subscribed,'HA events not subscribed');
 const changedAt=Date.now();
 await update({external:{state:'playing',track:2,position:3}});
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent==='Yesterday'
  &&document.querySelector('#player-state')?.textContent==='Spiller på',undefined,{timeout:1500});
 const externalMs=Date.now()-changedAt;
 assert(externalMs<1500,`external change visible within 1.5 s: ${externalMs}`);
 assert.deepEqual(errors,[]);
 console.log('room player journey',JSON.stringify({pauseMs:Math.round(pauseMs),externalMs,
  services:await services()}));
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.kill();}})();
