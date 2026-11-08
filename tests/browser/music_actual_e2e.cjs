'use strict';
// Actual packaged PodView and Python bridge; final HA/native service is stateful and inert.
const {chromium}=require('playwright');
const testEnv=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const root=testEnv.root,port=Number(process.env.MUSIC_TEST_PORT||18973),base=`http://127.0.0.1:${port}`;
const runtimeRoot=testEnv.runtimeRoot;
const seekMode=process.env.MUSIC_SEEK_TEST==='1';
const externalOutputMode=process.env.MUSIC_EXTERNAL_OUTPUT_TEST==='1';
if(process.env.MUSIC_LONG_SESSION==='1'||seekMode||externalOutputMode)process.env.MUSIC_EXTENDED='1';
let server,browser,data,servedBundleSHA,serverSuspended=false;
const requests=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const playbackReads=s=>s.serviceReads.filter(row=>row.path.endsWith('/get_playback_snapshot')).length;
const readJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
const change=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function externalOutputJourney(page,errors){
 const before=await state(),initialPosts=requests.length;
 const control=page.locator('#play-pause');
 const track=page.locator('#track-name');
 const trackName=await track.innerText();
 const output=page.locator('#output');
 const roomRequests=snapshot=>snapshot.serviceReads.filter(row=>
  /\/(?:prepare_room_|control_room_|move_room_|start_room_)/.test(row.path));
 const assertNoTakeover=async()=>{
  assert.equal(requests.length,initialPosts);
  const current=await state();
  assert.deepEqual(roomRequests(current),roomRequests(before));
  assert.deepEqual(current.writes,before.writes);
 };
 for(const [target,label] of [['tesla','Tesla'],['iphone','iPhone']]){
  const transferred=await change({externalOutput:target});
  assert.equal(transferred.ok,true);
  await page.waitForFunction(name=>{
   const playback=document.querySelector('pv-widget-host')?.liveMedia?.playback;
   return playback?.observationStatus==='account_observed'&&playback.reason==='route_unavailable'
    &&playback.target?.name===name&&playback.roomBinding===null
    &&document.querySelector('#output')?.getAttribute('aria-label')?.includes(name)
    &&document.querySelector('#play-pause')?.disabled===true;
  },label,{timeout:15000});
  assert.equal(await track.innerText(),trackName);
  assert.equal((await output.locator('#player-room').innerText()).trim(),label);
  assert.match(await output.getAttribute('aria-label'),/højttaler ikke bekræftet/);
  const freshRead=page.waitForResponse(response=>{
   const url=new URL(response.url());
   return url.pathname==='/view/api/music'&&url.searchParams.get('kind')==='playback'&&response.ok();
  },{timeout:10000});
  for(const selector of ['#play-pause','#next','#previous','#volume']){
   const button=page.locator(selector),box=await button.boundingBox();
   assert.ok(box,selector);
   assert.equal(await button.isDisabled(),true,selector);
   await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  }
  const observed=await (await freshRead).json();
  assert.equal(observed.status,'account_observed');
  assert.equal(observed.data.playback.target.name,label);
  assert.equal(observed.binding,null);
  assert.equal((await state()).externalDevice,target);
  await assertNoTakeover();
 }
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-external-output-readonly.png')});
 assert.equal((await change({externalOutput:'native-room'})).ok,true);
 const waitForKitchen=phase=>page.waitForFunction(value=>{
  const host=document.querySelector('pv-widget-host'),p=host?.liveMedia?.playback;
  const button=document.querySelector('#play-pause'),output=document.querySelector('#output');
  return p?.observationStatus==='observed'&&p.roomBinding?.nativeRoomId==='native-room'
   &&p.roomBinding?.nativeHomepodId==='42'&&p.state===value&&button&&!button.disabled
   &&!host.liveControls.musicIntentPending&&output?.textContent.includes('Køkkenalrum HomePod')
   &&output.getAttribute('aria-label')?.includes('Aktuelt output');
 },phase,{timeout:15000});
 await waitForKitchen('playing');
 await assertNoTakeover();
 for(const phase of ['paused','playing']){
  await control.tap();
  await waitForKitchen(phase);
 }
 const after=await state();
 assert.equal(await track.innerText(),trackName);
 assert.deepEqual(after.writes.slice(before.writes.length).map(({action,room,homepod})=>[action,room,homepod]),
  [['pause','native-room','42'],['resume','native-room','42']]);
 assert.deepEqual(requests.slice(initialPosts).map(row=>row.body?.action),['pause','resume']);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'H7',servedBundleSHA,externalAccountOutputs:['Tesla','iPhone'],
  outsideRoomControlPosts:0,automaticTakeovers:0,returnedOutput:'Køkkenalrum HomePod',
  confirmedTouchEffects:['pause','resume'],inertFinalService:true,pageErrors:errors};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-external-output.json'),JSON.stringify(proof,null,2));
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-external-output-return.png')});
 console.log(JSON.stringify(proof));
}
async function seekJourney(page,errors){
 const slider=page.locator('#detail-seek');
 const player=page.locator('pv-widget-host');
 const pause=page.locator('#play-pause');
 const effects=async count=>{
  for(let attempt=0;attempt<100;attempt++){
   const snapshot=await state();
   if(snapshot.writes.length>=count)return snapshot;
   await sleep(50);
  }
  throw Error(`A5: inert owner did not receive effect ${count}`);
 };
 const assertControls=async expected=>{
  assert.equal(await pause.isEnabled(),true);
  assert.match(await pause.getAttribute('aria-label'),expected);
  for(const selector of ['#next','#previous','#volume','#detail-seek']){
   assert.equal(await page.locator(selector).isEnabled(),true,selector);
  }
 };
 const observed=async (positionMs,phase)=>page.waitForFunction(({positionMs,phase})=>{
  const host=document.querySelector('pv-widget-host'),p=host.liveMedia.playback;
  return p?.progressMs===positionMs&&p?.state===phase
   &&host.liveControls.musicFence?.settlementStatus==='confirmed';
 },{positionMs,phase},{timeout:12000});
 await slider.waitFor({state:'visible'});
 await assertControls(/pause/i);
 const initial=await state();
 const initialIdentity=await player.evaluate(h=>({
  uri:h.liveMedia.playback.item.uri,epoch:h.liveMedia.playback.owner_epoch,
  binding:h.liveMedia.playback.roomBinding.bindingId,
 }));
 assert.equal(await slider.evaluate(n=>n.type),'range');
 await slider.evaluate(n=>{
  window.seekProbe={input:[],changes:[]};
  n.addEventListener('input',event=>window.seekProbe.input.push([event.isTrusted,Number(n.value)]));
  n.addEventListener('change',event=>window.seekProbe.changes.push([event.isTrusted,Number(n.value)]));
 });
 const held={};
 await change({delayMs:700});
 await testEnv.touchRange(page,slider,82000,{beforeRelease:async()=>{
  held.positionMs=Number(await slider.inputValue());
  assert(Math.abs(held.positionMs-82000)<=1000,'actual touch previews the requested timeline position');
  const before=await state();
  assert.equal(before.writes.length,initial.writes.length,'drag has not reached the owner before release');
  assert.equal(requests.filter(row=>row.body?.action==='seek').length,0,'no early browser POST');
  const response=await change({externalPlaybackState:'playing'});
  const {sequence}=await response.json();
  await page.waitForFunction(sequence=>{
   const host=document.querySelector('pv-widget-host');
   return host.liveMedia.playback?.poll_sequence>=sequence;
  },sequence,{timeout:10000});
  assert.equal(Number(await slider.inputValue()),held.positionMs,'real background read preserves held thumb');
  assert.equal(await slider.isEnabled(),true);
  held.pollSequence=sequence;
  await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-seek-held.png')});
 }});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host').liveControls.musicIntentPending,
  undefined,{timeout:5000});
 assert.equal(Number(await slider.inputValue()),held.positionMs,'pending command preserves last intent');
 await assertControls(/pause/i);
 const played=await effects(initial.writes.length+1);
 assert.equal(played.writes.at(-1).positionMs,held.positionMs);
 await observed(held.positionMs,'playing');
 await change({delayMs:0});
 await pause.tap();
 const paused=await effects(initial.writes.length+2);
 assert.equal(paused.state,'paused');
 await page.waitForFunction(()=>document.querySelector('pv-widget-host').liveMedia.playback?.state==='paused',
  undefined,{timeout:10000});
 await assertControls(/Fortsæt/);
 await testEnv.touchRange(page,slider,34000);
 const pausedSeek=await effects(initial.writes.length+3);
 const pausedPosition=pausedSeek.writes.at(-1).positionMs;
 assert(Math.abs(pausedPosition-34000)<=1000);
 await observed(pausedPosition,'paused');
 assert.equal(Number(await slider.inputValue()),pausedPosition);
 await assertControls(/Fortsæt/);
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-seek-paused.png')});

 let lostCount=0;
 await page.route('**/view/api/control/actions',async route=>{
  if(route.request().postDataJSON()?.action!=='seek'||lostCount)return route.continue();
  lostCount++;
  const response=await route.fetch();
  assert.equal((await response.json()).outcome,'accepted','owner applies seek before response is lost');
  await route.fulfill({status:502,json:{error:'inert_response_lost'}});
 });
 await testEnv.touchRange(page,slider,57000);
 const lost=await effects(initial.writes.length+4);
 const lostPosition=lost.writes.at(-1).positionMs;
 await page.waitForFunction(()=>{
  const controls=document.querySelector('pv-widget-host').liveControls;
  return controls.musicFence?.action==='seek'&&controls.musicFence.outcome==='unknown'
   &&!controls.musicIntentPending;
 },undefined,{timeout:10000});
 assert.equal(lostCount,1);
 assert.match(await page.locator('#playback-status').innerText(),/Kunne ikke bekræfte ændringen/);
 const observedAfterLoss=await change({externalPlaybackState:'paused'});
 await page.waitForFunction(({sequence,positionMs})=>{
  const p=document.querySelector('pv-widget-host').liveMedia.playback;
  return p?.poll_sequence>=sequence&&p?.progressMs===positionMs&&p?.state==='paused';
 },{sequence:(await observedAfterLoss.json()).sequence,positionMs:lostPosition},{timeout:12000});
 assert.equal((await state()).writes.length,initial.writes.length+4,'ordinary observation never repeats seek');
 await assertControls(/Fortsæt/);
 const writes=(await state()).writes.slice(initial.writes.length);
 assert.deepEqual(writes.map(row=>row.action),['seek','pause','seek','seek']);
 const seekPosts=requests.filter(row=>row.body?.action==='seek').map(row=>row.body);
 const seekPositions=[held.positionMs,pausedPosition,lostPosition];
 assert.equal(seekPosts.length,3);
 assert.deepEqual(seekPosts.map(row=>row.args),seekPositions.map(positionMs=>({
  positionMs,expectedOwnerEpoch:initialIdentity.epoch,expectedTrackUri:initialIdentity.uri,
 })));
 assert(seekPosts.every(row=>row.target.expectedBindingId===initialIdentity.binding));
 assert.equal(new Set(seekPosts.map(row=>row.requestId)).size,3);
 assert.deepEqual(writes.filter(row=>row.action==='seek').map(row=>row.positionMs),seekPositions);
 const probe=await page.evaluate(()=>window.seekProbe);
 assert.deepEqual(probe.changes,seekPositions.map(positionMs=>[true,positionMs]));
 assert(probe.input.length>=3&&probe.input.every(([trusted])=>trusted));
 assert.deepEqual(errors,[]);
 const proof={outcome:'PASS',story:'A5',servedBundleSHA,actualPackagedPodView:true,
  inertFinalService:true,physicalAudioVerified:false,held,playingAndPausedSeek:true,
  seekPositions,heldThroughActualRefresh:true,unknownWithoutReplay:true,controlsPreserved:true,pageErrors:errors};
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-seek-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
// Opt-in real elapsed-time coverage: both browser and Python use their real clocks.
// This proves local lease renewal and browser recovery, not ten minutes of Spotify or hardware.
async function longSession(page,errors){
 const before=await state();
 const startedAt=Date.now();
 const samples=[];
 for(let minute=1;minute<=10;minute++){
  await sleep(Math.max(0,startedAt+minute*60000-Date.now()));
  const sample=await state();
  samples.push({minute,elapsedMs:Date.now()-startedAt,reads:sample.serviceReads.length});
  assert.equal(sample.writes.length,before.writes.length,'A10: waiting never starts an automatic effect');
  assert(sample.serviceReads.length>(samples.at(-2)?.reads??before.serviceReads.length),
   `A10: actual inert service reads renew during minute ${minute}`);
  console.log('longSessionMinute',JSON.stringify(samples.at(-1)));
 }
 async function exercise(surface,label){
  if(await surface.locator('#photo-view').isVisible())await testEnv.openOverview(surface);
  const pause=surface.locator('#play-pause');
  await surface.waitForFunction(()=>{
   const button=document.querySelector('#play-pause');
   return button&&!button.disabled&&/pause/i.test(button.getAttribute('aria-label')||'');
  },undefined,{timeout:15000});
  const baseline=await state();
  await pause.tap();
  for(let n=0;(await state()).state!=='paused';n++){
   if(n>=100)throw Error(`A10: ${label} Pause did not reach inert owner`);
   await sleep(100);
  }
  await surface.locator('#next').tap();
  for(let n=0;(await state()).song!==baseline.song+1;n++){
   if(n>=100)throw Error(`A10: ${label} Next did not reach inert owner`);
   await sleep(100);
  }
  const volume=surface.locator('#volume');
  await surface.waitForFunction(()=>!document.querySelector('#volume')?.disabled,undefined,{timeout:15000});
  const percent=label==='after-ten-minutes'?45:60;
  await testEnv.touchRange(surface,volume,percent);
  for(let n=0;(await state()).volume!==percent;n++){
   if(n>=100)throw Error(`A10: ${label} volume did not reach inert owner`);
   await sleep(100);
  }
  await surface.waitForFunction(()=>{
   const button=document.querySelector('#play-pause');
   return button&&!button.disabled&&/Fortsæt/.test(button.getAttribute('aria-label')||'');
  },undefined,{timeout:15000});
  await pause.tap();
  for(let n=0;(await state()).state!=='playing';n++){
   if(n>=100)throw Error(`A10: ${label} Resume did not reach inert owner`);
   await sleep(100);
  }
  const writes=(await state()).writes.slice(baseline.writes.length);
  assert.deepEqual(writes.map(row=>row.action),['pause','next','volume','resume'],
   `A10: ${label} each explicit action reaches the owner once`);
  await surface.screenshot({path:path.join(testEnv.artifactDir(),`podview-music-${label}.png`)});
  return {label,actions:writes.map(row=>row.action),volumePercent:percent};
 }
 const afterAge=await exercise(page,'after-ten-minutes');
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-long-session-age.json'),JSON.stringify({
  outcome:'PASS',story:'A10-age-only',realElapsedMs:Date.now()-startedAt,inertFinalService:true,
  servedBundleSHA,renewalSamples:samples,afterAge,reopenVerified:false,physicalAudioVerified:false,
 },null,2));
 const storageState=await page.context().storageState();
 await page.close();
 const reopened=await browser.newPage({viewport:{width:1280,height:800},hasTouch:true,storageState});
 reopened.on('pageerror',error=>errors.push(error.message));
 await reopened.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await testEnv.openOverview(reopened);
 const afterReopen=await exercise(reopened,'after-reopen');
 assert.deepEqual(errors,[]);
 const result={outcome:'PASS',story:'A10',realElapsedMs:Date.now()-startedAt,inertFinalService:true,
  actualPackagedPodView:true,servedBundleSHA,renewalSamples:samples,afterAge,afterReopen,
  physicalAudioVerified:false,realSpotifyPollingVerified:false};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-long-session.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}
(async()=>{try{
 const testNonce=require('node:crypto').randomUUID();
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-music-e2e-'));
 server=spawn(testEnv.python,[path.join(__dirname,'music_e2e_server.py')],{cwd:testEnv.runtimeRoot,env:testEnv.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,PODVIEW_TEST_NONCE:testNonce}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server start timeout');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,testNonce,'own isolated Python runtime nonce');
 browser=await chromium.launch(testEnv.browserOptions());
 const page=await browser.newPage({viewport:{width:1280,height:800},hasTouch:true}),errors=[],diagnosticResponses=[];
 page.on('response',async response=>{if(response.url().endsWith('/podview.bundle.js'))servedBundleSHA=require('node:crypto').createHash('sha256').update(await response.body()).digest('hex');if(response.url().includes('/client-diagnostics')&&response.request().method()==='POST')diagnosticResponses.push({status:response.status(),body:await response.text().catch(()=>'<unreadable>')})});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/control/'))requests.push({url:r.url(),body:r.postDataJSON()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await testEnv.openOverview(page);
 const control=page.locator('#play-pause');
 await control.waitFor({state:'visible',timeout:10000}).catch(async error=>{
  await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-failure.png')});
  console.log('visibleUI',await page.locator('body').innerText());
  throw error;
 });
 await control.waitFor({state:'attached'});
 await page.waitForFunction(()=>{const b=document.getElementById('play-pause');return b&&!b.disabled&&/pause/i.test(b.getAttribute('aria-label')||'')},undefined,{timeout:15000}).catch(async error=>{
  await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-failure.png')});
  console.log('control',await control.evaluate(e=>e.outerHTML));
  console.log('visibleUI',await page.locator('body').innerText());
  console.log('playback',await (await page.request.get(base+'/view/api/music?room=kitchen&kind=playback&account=account&include_controls=1')).json());
  throw error;
 });
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-before.png')});
 if(seekMode){await seekJourney(page,errors);return;}
 if(externalOutputMode){await externalOutputJourney(page,errors);return;}
 if(process.env.MUSIC_LONG_SESSION==='1'){await longSession(page,errors);return;}
 // Measure from the actual trusted touch-generated click, not from a later screenshot.
 await page.evaluate(()=>{
  const probe={clickAt:null,pausePaintMs:null,rapidSong:null,rapidLastTap:null,rapidPaintMs:null,disabled:[]};
  window.musicUXProbe=probe;
  const selectors='#play-pause, #next, #previous';
  document.addEventListener('click',event=>{
   if(event.isTrusted&&event.target.closest('#next')&&probe.rapidSong!==null){
    probe.rapidLastTap=performance.now();
    const painted=()=>{
     if(document.querySelector('#track-name')?.textContent?.trim()===`Isoleret sang ${probe.rapidSong}`){
      probe.rapidPaintMs=performance.now()-probe.rapidLastTap;
     }else requestAnimationFrame(painted);
    };
    requestAnimationFrame(painted);
   }
   if(event.isTrusted&&event.target.closest('#play-pause')&&probe.clickAt===null){
    probe.clickAt=performance.now();
    const painted=()=>{
     const button=document.querySelector('#play-pause');
     if(button?.getAttribute('aria-label')?.includes('Fortsæt')&&!button.disabled){
      probe.pausePaintMs=performance.now()-probe.clickAt;
     }else requestAnimationFrame(painted);
    };
    requestAnimationFrame(painted);
   }
  },{capture:true});
  probe.observer=new MutationObserver(records=>{
   for(const record of records){
    const target=record.target;
    if(target.matches?.(selectors)&&record.attributeName==='disabled'&&
      (target.disabled||record.oldValue!==null)){
     probe.disabled.push({id:target.id,at:performance.now(),oldValue:record.oldValue});
    }
   }
  });
  probe.observer.observe(document.querySelector('pv-widget-host'),{
   subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['disabled'],
  });
 });
 await change({delayMs:1200,witnessUnknownReads:1});
 const started=Date.now();await control.tap();await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveControls?.musicIntentPending===true,undefined,{timeout:3000});
 await page.waitForFunction(()=>window.musicUXProbe.pausePaintMs!==null,undefined,{timeout:1000});
 const pausePaintMs=await page.evaluate(()=>window.musicUXProbe.pausePaintMs);
 assert(pausePaintMs<100,`A1: optimistic Pause paints within 100 ms; observed ${pausePaintMs} ms`);
 // A real read while the command is in flight must not undo the optimistic view or lock controls.
 await page.evaluate(()=>document.querySelector('pv-widget-host').liveMedia.refresh({immediate:true}));
 assert.match(await control.getAttribute('aria-label'),/^Fortsæt/,'refresh preserves the pending Pause intent');
 const pauseBox=await control.boundingBox();assert(pauseBox);
 const pendingTouch=await control.evaluate(button=>{const host=document.querySelector('pv-widget-host');return {disabled:button.disabled,ariaBusy:button.getAttribute('aria-busy'),ariaLabel:button.getAttribute('aria-label'),feedback:button.dataset.feedback,html:button.outerHTML,ownerPending:host?.liveControls?.musicIntentPending===true,status:host?.liveControls?.musicStatus?.textContent,feedbackMessage:host?.feedbackMessage};});
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-touch-pending-witness.json'),JSON.stringify(pendingTouch,null,2));await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-touch-pending.png')});
 const duplicatePauseBox=await control.boundingBox();assert(duplicatePauseBox);
 for(const key of ['x','y','width','height'])assert(Math.abs(duplicatePauseBox[key]-pauseBox[key])<1,'pending Pause geometry stays stable: '+key);
 const duplicatePoint={x:duplicatePauseBox.x+duplicatePauseBox.width/2,y:duplicatePauseBox.y+duplicatePauseBox.height/2};
 assert(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('#play-pause'),duplicatePoint),'duplicate touch targets the actual pending Pause control');
 // Optimistic toggle: the tapped Pause shows "Fortsæt" at once and is never disabled.
 await page.waitForFunction(()=>{const b=document.getElementById('play-pause');return b&&!b.disabled&&b.getAttribute('aria-label')?.includes('Fortsæt');},undefined,{timeout:100});
 await change({song:2});
 for(let n=0;n<60&&(await state()).state!=='paused';n++)await sleep(250);
 const afterPause=await state();
 assert.equal(afterPause.state,'paused');assert.equal(afterPause.song,2);
 await page.waitForFunction(()=>{const player=document.querySelector('#track-name')?.textContent?.trim(),overview=document.querySelector('#home-music strong')?.textContent?.trim();return player==='Isoleret sang 2'&&overview===player;},undefined,{timeout:10000});
 assert.equal(afterPause.writes.filter(x=>x.action==='pause').length,1);
 assert.equal(requests.filter(x=>x.url.endsWith('/control/setup')).length,0,'normal touch must not fetch browser setup');
 assert.equal(requests.filter(x=>x.body?.action==='pause').length,1);
 const pauseObservedMs=Date.now()-started;
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-paused.png')});
 let pauseTrace;
 for(let n=0;n<80;n++){
  pauseTrace=await readJournal(page);
  if(pauseTrace.records?.some(r=>r.row.stage==='playback_confirmation'&&r.row.action==='pause'&&r.row.code==='confirmed'))break;
  await sleep(500);
 }
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-pause-witness-trace.json'),JSON.stringify({state:await state(),journal:pauseTrace,diagnosticResponses},null,2));
 assert(pauseTrace.records?.some(r=>r.row.stage==='playback_confirmation'&&r.row.action==='pause'&&r.row.code==='confirmed'),'accepted Pause survives a temporary unknown witness and later confirms before another command');
 await change({delayMs:0});
 await page.waitForFunction(()=>{const b=document.getElementById('play-pause');return b&&!b.disabled&&b.getAttribute('aria-label')?.includes('Fortsæt')},undefined,{timeout:15000});
 await control.tap();
 await page.waitForFunction(()=>/pause/i.test(document.getElementById('play-pause')?.getAttribute('aria-label')||''),undefined,{timeout:15000});
 assert.equal((await state()).state,'playing');
 if(process.env.MUSIC_EXTENDED==='1'){
  for(const [selector,action,song] of [['#next','next',3],['#previous','previous',2]]){
   const button=page.locator(selector);
   await page.waitForFunction(s=>{const b=document.querySelector(s);return b&&!b.disabled},selector,{timeout:15000});
   await button.tap();
   for(let n=0;(await state()).song!==song;n++){if(n>80)throw Error(action+' effect not observed');await sleep(100)}
   await page.waitForFunction(value=>document.querySelector('#track-name')?.textContent?.trim()===value,'Isoleret sang '+song,{timeout:15000});
   assert.equal((await state()).writes.filter(x=>x.action===action).length,1);
  }
  const volume=page.locator('#volume');
  for(const value of [0,100]){
   await page.waitForFunction(()=>{const s=document.querySelector('#volume');return s&&!s.disabled},undefined,{timeout:15000});
   await testEnv.touchRange(page,volume,value);
   for(let n=0;(await state()).volume!==value;n++){if(n>80)throw Error('volume effect not observed: '+value);await sleep(100)}
   await page.waitForFunction(v=>document.querySelector('#volume')?.value===String(v),value,{timeout:15000});
  }
  assert.deepEqual((await state()).writes.filter(x=>x.action==='volume').map(x=>x.percent),[0,100]);
  await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-volume-100.png')});
  const beforeRoundtrip=await state();
  const roundtripTrack=await page.locator('pv-widget-host').evaluate(h=>h.liveMedia.playback.item.uri);
  const waitForRoomControl=(room,homepod,phase)=>page.waitForFunction(({room,homepod,phase,uri})=>{
   const h=document.querySelector('pv-widget-host'),p=h.liveMedia.playback,button=document.querySelector('#play-pause');
   return p?.roomBinding?.nativeRoomId===room&&p.roomBinding.nativeHomepodId===homepod
    &&p.item?.uri===uri&&p.state===phase&&button&&!button.disabled&&!h.liveControls.musicIntentPending
    &&(phase==='paused'?button.getAttribute('aria-label')?.includes('Fortsæt'):/pause/i.test(button.getAttribute('aria-label')||''));
  },{room,homepod,phase,uri:roundtripTrack},{timeout:15000});
  for(const [name,room,homepod] of [['Soveværelse','bedroom','43'],['Køkkenalrum HomePod','native-room','42']]){
   await page.locator('#output').tap();
   const speaker=page.locator('#room-options button').filter({hasText:name});
   await speaker.waitFor({state:'visible',timeout:10000});
   await page.waitForFunction(n=>{const b=[...document.querySelectorAll('#room-options button')].find(b=>b.textContent.includes(n));return b&&!b.disabled},name,{timeout:15000});
   await speaker.tap();
   for(let n=0;(await state()).room!==room;n++){if(n>80)throw Error('output move not observed: '+room);await sleep(100)}
   await page.waitForFunction(n=>document.querySelector('#output')?.textContent.includes(n)&&document.querySelector('#output')?.getAttribute('aria-label')?.includes('Aktuelt output'),name,{timeout:15000});
   await waitForRoomControl(room,homepod,'playing');
   const beforeTouch=await state();
   for(const phase of ['paused','playing']){
    await control.tap();
    await waitForRoomControl(room,homepod,phase);
   }
   const afterTouch=await state();
   assert.equal(afterTouch.song,beforeRoundtrip.song,'H5: pause and resume keep the same track after move');
   assert.deepEqual(afterTouch.writes.slice(beforeTouch.writes.length).map(({action,room,homepod})=>[action,room,homepod]),
    [['pause',room,homepod],['resume',room,homepod]],'H5: exactly one owner effect per touch on the current output');
  }
  assert.deepEqual((await state()).writes.filter(x=>x.action==='move_existing_session').map(x=>x.room),['bedroom','native-room']);
  // Actual owner snapshots change outside PodView; no command/receipt is fabricated.
  const externalWrites=(await state()).writes.length;
  for(const playbackState of ['paused','playing']){
   await fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({externalPlaybackState:playbackState})});
   await page.waitForFunction(value=>{const h=document.querySelector('pv-widget-host'),button=document.querySelector('#play-pause');return h?.liveMedia?.playback?.state===value&&button&&!button.disabled&&(value==='paused'?button.getAttribute('aria-label')?.includes('Fortsæt'):/pause/i.test(button.getAttribute('aria-label')||''));},playbackState,{timeout:15000});
   assert.equal((await state()).writes.length,externalWrites,'external playback observation sends no PodView effect');
  }
  for(const [room,name]of [['bedroom','Soveværelse'],['native-room','Køkkenalrum HomePod']]){
   await fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({externalOutput:room})});
   await page.waitForFunction(label=>document.querySelector('#output')?.textContent.includes(label)&&document.querySelector('#output')?.getAttribute('aria-label')?.includes('Aktuelt output'),name,{timeout:15000});
   assert.equal((await state()).writes.length,externalWrites,'external output observation sends no transfer or other effect');
  }
  await control.tap();await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.state==='paused',undefined,{timeout:15000});
  await page.waitForFunction(()=>{const b=document.querySelector('#play-pause');return b&&!b.disabled&&b.getAttribute('aria-label')?.includes('Fortsæt')},undefined,{timeout:15000});await control.tap();
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.state==='playing',undefined,{timeout:15000});
  assert.equal((await state()).writes.length,externalWrites+2,'touch control remains usable after an external route change');
 }
 // Three explicit rapid taps must become three commands, including taps while the first is pending.
 await page.waitForFunction(()=>!document.querySelector('pv-widget-host')?.liveControls?.musicIntentPending,
  undefined,{timeout:15000});
 const beforeRapid=await state();
 await change({delayMs:250});
 const next=page.locator('#next');
 await page.evaluate(song=>{window.musicUXProbe.rapidSong=song;},beforeRapid.song+3);
 for(let tap=0;tap<3;tap++)await next.tap();
 await page.waitForFunction(()=>window.musicUXProbe.rapidPaintMs!==null,undefined,{timeout:10000});
 const rapidVisibleMs=await page.evaluate(()=>window.musicUXProbe.rapidPaintMs);
 const afterRapid=await state();
 assert.equal(afterRapid.song,beforeRapid.song+3,'A3: three taps advance three songs');
 assert.deepEqual(afterRapid.writes.slice(beforeRapid.writes.length).map(row=>row.action),['next','next','next'],
  'A3: no rapid tap is lost or automatically duplicated');
 assert(rapidVisibleMs<1500,`A3: final track visible within 1.5 s of last tap; observed ${rapidVisibleMs} ms`);
 // A9: each tap follows the visible toggle, even before the owner confirms the first Pause.
 await page.waitForFunction(()=>!document.querySelector('pv-widget-host')?.liveControls?.musicIntentPending,
  undefined,{timeout:15000});
 const beforeToggleBurst=await state();
 await change({delayMs:600});
 const toggleLabels=[];
 for(let tap=0;tap<3;tap++){
  await control.tap();
  toggleLabels.push(await control.getAttribute('aria-label'));
 }
 await page.waitForFunction(()=>{
  const controls=document.querySelector('pv-widget-host')?.liveControls;
  return !controls?.musicIntentPending&&!controls?.musicQueued;
 },undefined,{timeout:15000});
 const toggleWrites=(await state()).writes.slice(beforeToggleBurst.writes.length).map(row=>row.action);
 assert.deepEqual(toggleWrites,['pause','resume','pause'],
  `A9: rapid visible Pause/Resume/Pause preserves all intents; labels ${JSON.stringify(toggleLabels)}`);
 assert.equal((await state()).state,'paused','A9: final explicit Pause wins');
 assert.match(toggleLabels[0],/^Fortsæt/);
 assert.match(toggleLabels[1],/pause/i);
 assert.match(toggleLabels[2],/^Fortsæt/);
 await change({delayMs:0});
 await control.tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.playback?.state==='playing',
  undefined,{timeout:15000});
 const disabledDuringRefresh=await page.evaluate(()=>{
  const probe=window.musicUXProbe;probe.observer.disconnect();return probe.disabled;
 });
 assert.deepEqual(disabledDuringRefresh,[],'A1/A3/A9: controls never flash disabled during commands and refresh');
 await change({delayMs:0});
 // Lose one actual accepted Pause response, then the browser connection. No
 // fixture state mutation or fabricated receipt substitutes for the backend.
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host'),b=document.querySelector('#play-pause');return h?.liveMedia?.playback?.state==='playing'&&b&&!b.disabled},undefined,{timeout:15000});
 const beforeLoss=await state();let swallowedResponses=0;
 const controlURL=base+'/view/api/control/actions';
 const loseAcceptedPause=async route=>{if(route.request().postDataJSON()?.action!=='pause'){await route.continue();return;}const response=await route.fetch();assert.equal(response.ok(),true);const receipt=await response.json();assert.equal(receipt.outcome,'accepted');swallowedResponses++;await route.abort('failed');};
 await page.route(controlURL,loseAcceptedPause);await control.tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveControls?.musicFence?.outcome==='unknown',undefined,{timeout:15000});
 await page.unroute(controlURL,loseAcceptedPause);
 const afterLoss=await state(),lostRequestId=requests.filter(request=>request.body?.action==='pause').at(-1)?.body.requestId,lostRequestRef=require('node:crypto').createHash('sha256').update(lostRequestId).digest('hex').slice(0,16);assert.equal(swallowedResponses,1);assert.equal(afterLoss.state,'paused');assert.equal(afterLoss.writes.length,beforeLoss.writes.length+1,'lost response never resends its effect');
 const writesAfterLoss=afterLoss.writes.length,readsBeforeRecovery=playbackReads(afterLoss),observedBeforeOffline=await page.locator('pv-widget-host').evaluate(h=>h.liveMedia.playback.observedAt);
 const visibleIdentity=()=>page.locator('pv-widget-host').evaluate(h=>{
  const p=h.liveMedia.playback;
  return {uri:p.item?.uri,room:p.roomBinding?.nativeRoomId,homepod:p.roomBinding?.nativeHomepodId};
 });
 const identityBeforeOffline=await visibleIdentity();
 await page.context().setOffline(true);assert.equal(server.kill('SIGSTOP'),true,'only our spawned inert owner is suspended');serverSuspended=true;
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveTransport?.connected===false},undefined,{timeout:15000});
 assert.equal(server.kill('SIGCONT'),true);serverSuspended=false;assert.equal((await state()).writes.length,writesAfterLoss);
 await page.context().setOffline(false);
 await page.waitForFunction(before=>{const h=document.querySelector('pv-widget-host');return h?.liveTransport?.connected===true&&h?.liveMedia?.readState==='ready'&&h?.liveMedia?.playback?.state==='paused'&&Date.parse(h.liveMedia.playback.observedAt)>Date.parse(before)&&document.querySelector('#track-name')?.textContent?.trim().startsWith('Isoleret sang')},observedBeforeOffline,{timeout:30000});
 const recovered=await state();assert.equal(recovered.writes.length,writesAfterLoss,'reconnect restores reads without any automatic effect replay');assert.ok(playbackReads(recovered)>readsBeforeRecovery,'actual playback source reads recover after reconnect');
 assert.equal(recovered.song,afterLoss.song,'recovery keeps the same observed song');
 assert.equal(recovered.room,afterLoss.room,'recovery keeps the same output');
 assert.equal(recovered.state,'paused','recovery observes the actual paused owner');
 assert.deepEqual(await visibleIdentity(),identityBeforeOffline,'rendered playback recovers the same song and output');
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-lost-response-recovered.png')});
 let journal;
 for(let n=0;n<200;n++){
  journal=await readJournal(page);
  const unknown=journal.records?.find(record=>record.row.stage==='control_action'&&record.row.code==='unknown'&&record.row.requestRef===lostRequestRef),disconnected=unknown&&journal.records.find(record=>record.row.stage==='connection'&&record.row.code==='disconnected'&&record.row.seq>unknown.row.seq);if(disconnected)break;
  await sleep(500);
 }
 // Recovery is proved above by the actual playback source and rendered observation.
 // The bounded telemetry buffer may discard quiet music_read/ok rows when full of actions.
 // Keep durable UNKNOWN/disconnect checks, but never equate optional telemetry with product state.
 const recoveryDiagnostics=await page.locator('pv-widget-host').evaluate(h=>h.liveTransport.diagnostics());
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-recovery-observation.json'),JSON.stringify({
  servedBundleSHA,readsBeforeRecovery,readsAfterRecovery:playbackReads(recovered),
  observedBeforeOffline,observedAfterRecovery:await page.locator('pv-widget-host').evaluate(h=>h.liveMedia.playback.observedAt),
  writesAfterLoss,writesAfterRecovery:recovered.writes.length,journal,recoveryDiagnostics,
 },null,2));
 assert(journal.records?.some(record=>record.row.stage==='control_intent'&&record.row.action==='pause'),'persisted input trace');
 assert(journal.records?.some(record=>record.row.stage==='control_action'&&record.row.action==='pause'&&record.row.code==='accepted'),'persisted accepted trace');
 assert(journal.records?.some(record=>record.row.stage==='playback_confirmation'&&record.row.code==='confirmed'),'persisted correlated confirmation');
 const lostRow=journal.records?.find(record=>record.row.stage==='control_action'&&record.row.code==='unknown'&&record.row.requestRef===lostRequestRef);assert(lostRow,'lost accepted reply persists as correlated UNKNOWN');const disconnectedRow=journal.records.find(record=>record.row.stage==='connection'&&record.row.code==='disconnected'&&record.row.seq>lostRow.row.seq);assert(disconnectedRow,'actual transport loss is persisted after UNKNOWN');assert.equal(journal.records.some(record=>record.row.stage==='playback_confirmation'&&record.row.code==='confirmed'&&record.row.requestRef===lostRequestRef),false,'lost response is not promoted to causal success by an unrelated ordinary state read');assert.equal((await state()).writes.length,writesAfterLoss,'journal recovery never replays the effect');
 assert.equal((await state()).unknownWitnesses,1,'actual service returned one temporary unknown witness before confirmation');
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-e2e-diagnostics.json'),JSON.stringify(journal,null,2));
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-recovery-witness.json'),JSON.stringify({servedBundleSHA,lostRequestRef,swallowedResponses,writesBefore:beforeLoss.writes.length,writesAfterRecovery:recovered.writes.length,serviceReadsBeforeRecovery:readsBeforeRecovery,serviceReadsAfterRecovery:playbackReads(recovered),observedBeforeOffline,observedAfterRecovery:await page.locator('pv-widget-host').evaluate(h=>h.liveMedia.playback.observedAt),journal},null,2));
 // A7: recovery must restore deliberate touch, not only source reads.
 const beforeRecoveredTouch=await state();
 for(const [action,expectedState,label] of [['resume','playing','Fortsæt'],['pause','paused','pause']]){
  await page.waitForFunction(label=>{
   const button=document.querySelector('#play-pause');
   return button&&!button.disabled&&(button.getAttribute('aria-label')||'').toLowerCase().includes(label.toLowerCase());
  },label,{timeout:15000});
  await control.tap();
  for(let n=0;(await state()).state!==expectedState;n++){
   if(n>=100)throw Error(`A7: recovered ${action} did not reach owner`);
   await sleep(100);
  }
 }
 const recoveredTouch=(await state()).writes.slice(beforeRecoveredTouch.writes.length);
 assert.deepEqual(recoveredTouch.map(row=>row.action),['resume','pause']);
 assert(recoveredTouch.every(row=>row.requestId!==afterLoss.writes.at(-1).requestId),
  'new touch never reuses the lost native request');
 assert.equal(new Set(recoveredTouch.map(row=>row.requestId)).size,2);
 assert.equal((await state()).song,beforeRecoveredTouch.song);
 assert.equal((await state()).room,beforeRecoveredTouch.room);
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-recovered-touch.json'),JSON.stringify({
  servedBundleSHA,outcome:'PASS',inertFinalService:true,actions:recoveredTouch,
  noReload:true,sameSong:true,sameOutput:true,physicalAudioVerified:false,
 },null,2));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({
  outcome:'PASS',inertFinalService:true,actualPackagedPodView:true,
  pauseDuringSongChange:true,resume:true,
  extendedTransport:process.env.MUSIC_EXTENDED==='1',
  externalOwnerPlaybackAndOutput:process.env.MUSIC_EXTENDED==='1',
  overviewMatchesPlayer:true,persistedActionTrace:true,lostAcceptedResponse:true,
  offlineReadRecoveryWithoutEffectReplay:true,touchInput:true,rapidPendingTapsPreserved:true,rapidToggleSequence:toggleWrites,
  pauseRequests:(await state()).writes.filter(row=>row.action==='pause').length,browserSetupRequests:0,pauseObservedWithinMs:pauseObservedMs,
  optimisticPausePaintMs:pausePaintMs,rapidThreeNextVisibleMs:rapidVisibleMs,disabledDuringRefresh,pageErrors:errors}));
 }catch(error){
  if(serverSuspended){server.kill('SIGCONT');serverSuspended=false;}
  const page=browser?.contexts()[0]?.pages()[0];
  if(page){await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-extended-failure.png')});console.log('failureState',JSON.stringify({service:await state(),requests,controls:await page.evaluate(()=>{const h=document.querySelector('pv-widget-host'),c=h?.liveControls,p=h?.liveMedia?.playback;return {volume:document.querySelector('#volume')?.outerHTML,fence:c?.musicFence?.outcome,settlement:c?.musicFence?.settlementStatus,pending:c?.musicIntentPending,playbackState:p?.state,poll:p?.poll_sequence,output:document.querySelector('#output')?.outerHTML};})}));}
  throw error;
 }finally{if(serverSuspended){server.kill('SIGCONT');serverSuspended=false;}if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');let timer;try{await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>{server.kill('SIGKILL');reject(Error('isolated inert server shutdown exceeded5s'));},5000);})]);}finally{clearTimeout(timer);}}}
})().catch(e=>{console.error(e);process.exitCode=1});
