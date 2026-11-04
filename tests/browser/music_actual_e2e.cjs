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
let server,browser,data,servedBundleSHA,serverSuspended=false;
const requests=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const readJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
const change=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
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
 await page.locator('#photo-view').waitFor({state:'visible'});
 await page.locator('#photo-view').tap();
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
 await change({delayMs:1200,witnessUnknownReads:1});
 const pauseBox=await control.boundingBox();assert(pauseBox);const started=Date.now();await control.tap();await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveControls?.musicIntentPending===true,undefined,{timeout:3000});
 const pendingTouch=await control.evaluate(button=>{const host=document.querySelector('pv-widget-host');return {disabled:button.disabled,ariaBusy:button.getAttribute('aria-busy'),ariaLabel:button.getAttribute('aria-label'),feedback:button.dataset.feedback,html:button.outerHTML,ownerPending:host?.liveControls?.musicIntentPending===true,status:host?.liveControls?.musicStatus?.textContent,feedbackMessage:host?.feedbackMessage};});
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-touch-pending-witness.json'),JSON.stringify(pendingTouch,null,2));await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-touch-pending.png')});
 await page.touchscreen.tap(pauseBox.x+pauseBox.width/2,pauseBox.y+pauseBox.height/2);
 await change({song:2});
 await page.waitForFunction(()=>document.getElementById('play-pause')?.getAttribute('aria-label')?.includes('Fortsæt'),undefined,{timeout:15000});
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
  for(const [name,room] of [['Soveværelse','bedroom'],['Køkkenalrum HomePod','native-room']]){
   await page.locator('#output').tap();
   const speaker=page.locator('#room-options button').filter({hasText:name});
   await speaker.waitFor({state:'visible',timeout:10000});
   await page.waitForFunction(n=>{const b=[...document.querySelectorAll('#room-options button')].find(b=>b.textContent.includes(n));return b&&!b.disabled},name,{timeout:15000});
   await speaker.tap();
   for(let n=0;(await state()).room!==room;n++){if(n>80)throw Error('output move not observed: '+room);await sleep(100)}
   await page.waitForFunction(n=>document.querySelector('#output')?.textContent.includes(n)&&document.querySelector('#output')?.getAttribute('aria-label')?.includes('Aktuelt output'),name,{timeout:15000});
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
 const writesAfterLoss=afterLoss.writes.length,readsBeforeRecovery=afterLoss.serviceReads.length,observedBeforeOffline=await page.locator('pv-widget-host').evaluate(h=>h.liveMedia.playback.observedAt);
 await page.context().setOffline(true);assert.equal(server.kill('SIGSTOP'),true,'only our spawned inert owner is suspended');serverSuspended=true;
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveTransport?.connected===false},undefined,{timeout:15000});
 assert.equal(server.kill('SIGCONT'),true);serverSuspended=false;assert.equal((await state()).writes.length,writesAfterLoss);
 await page.context().setOffline(false);
 await page.waitForFunction(before=>{const h=document.querySelector('pv-widget-host');return h?.liveTransport?.connected===true&&h?.liveMedia?.readState==='ready'&&h?.liveMedia?.playback?.state==='paused'&&Date.parse(h.liveMedia.playback.observedAt)>Date.parse(before)&&document.querySelector('#track-name')?.textContent?.trim().startsWith('Isoleret sang')},observedBeforeOffline,{timeout:30000});
 const recovered=await state();assert.equal(recovered.writes.length,writesAfterLoss,'reconnect restores reads without any automatic effect replay');assert.ok(recovered.serviceReads.length>readsBeforeRecovery,'actual service reads recover after reconnect');
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-lost-response-recovered.png')});
 let journal;
 for(let n=0;n<200;n++){
  journal=await readJournal(page);
  const unknown=journal.records?.find(record=>record.row.stage==='control_action'&&record.row.code==='unknown'&&record.row.requestRef===lostRequestRef),disconnected=unknown&&journal.records.find(record=>record.row.stage==='connection'&&record.row.code==='disconnected'&&record.row.seq>unknown.row.seq);if(disconnected&&journal.records.some(record=>record.row.stage==='music_read'&&record.row.code==='ok'&&record.row.seq>disconnected.row.seq))break;
  await sleep(500);
 }
 assert(journal.records?.some(record=>record.row.stage==='control_intent'&&record.row.action==='pause'),'persisted input trace');
 assert(journal.records?.some(record=>record.row.stage==='control_action'&&record.row.action==='pause'&&record.row.code==='accepted'),'persisted accepted trace');
 assert(journal.records?.some(record=>record.row.stage==='playback_confirmation'&&record.row.code==='confirmed'),'persisted correlated confirmation');
 const lostRow=journal.records?.find(record=>record.row.stage==='control_action'&&record.row.code==='unknown'&&record.row.requestRef===lostRequestRef);assert(lostRow,'lost accepted reply persists as correlated UNKNOWN');const disconnectedRow=journal.records.find(record=>record.row.stage==='connection'&&record.row.code==='disconnected'&&record.row.seq>lostRow.row.seq);assert(disconnectedRow,'actual transport loss is persisted after UNKNOWN');assert(journal.records.some(record=>record.row.stage==='music_read'&&record.row.code==='ok'&&record.row.seq>disconnectedRow.row.seq),'a later persisted source read recovers after actual disconnect');assert.equal(journal.records.some(record=>record.row.stage==='playback_confirmation'&&record.row.code==='confirmed'&&record.row.requestRef===lostRequestRef),false,'lost response is not promoted to causal success by an unrelated ordinary state read');assert.equal((await state()).writes.length,writesAfterLoss,'journal recovery never replays the effect');
 assert.equal((await state()).unknownWitnesses,1,'actual service returned one temporary unknown witness before confirmation');
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-e2e-diagnostics.json'),JSON.stringify(journal,null,2));
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-recovery-witness.json'),JSON.stringify({servedBundleSHA,lostRequestRef,swallowedResponses,writesBefore:beforeLoss.writes.length,writesAfterRecovery:recovered.writes.length,serviceReadsBeforeRecovery:readsBeforeRecovery,serviceReadsAfterRecovery:recovered.serviceReads.length,observedBeforeOffline,observedAfterRecovery:await page.locator('pv-widget-host').evaluate(h=>h.liveMedia.playback.observedAt),journal},null,2));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',inertFinalService:true,actualPackagedPodView:true,pauseDuringSongChange:true,resume:true,extendedTransport:process.env.MUSIC_EXTENDED==='1',externalOwnerPlaybackAndOutput:process.env.MUSIC_EXTENDED==='1',overviewMatchesPlayer:true,persistedActionTrace:true,lostAcceptedResponse:true,offlineReadRecoveryWithoutEffectReplay:true,touchInput:true,repeatedPendingTapOneEffect:true,pauseRequests:(await state()).writes.filter(row=>row.action==='pause').length,browserSetupRequests:0,pauseObservedWithinMs:pauseObservedMs,pageErrors:errors}));
 }catch(error){
  if(serverSuspended){server.kill('SIGCONT');serverSuspended=false;}
  const page=browser?.contexts()[0]?.pages()[0];
  if(page){await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-extended-failure.png')});console.log('failureState',JSON.stringify({service:await state(),requests,controls:await page.evaluate(()=>{const h=document.querySelector('pv-widget-host'),c=h?.liveControls,p=h?.liveMedia?.playback;return {volume:document.querySelector('#volume')?.outerHTML,fence:c?.musicFence?.outcome,settlement:c?.musicFence?.settlementStatus,pending:c?.musicIntentPending,playbackState:p?.state,poll:p?.poll_sequence,output:document.querySelector('#output')?.outerHTML};})}));}
  throw error;
 }finally{if(serverSuspended){server.kill('SIGCONT');serverSuspended=false;}if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');let timer;try{await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>{server.kill('SIGKILL');reject(Error('isolated inert server shutdown exceeded5s'));},5000);})]);}finally{clearTimeout(timer);}}}
})().catch(e=>{console.error(e);process.exitCode=1});
