'use strict';
// Actual packaged PodView and Python bridge; final HA/native service is stateful and inert.
const {chromium}=require('playwright');
const testEnv=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const root=testEnv.root,port=18973,base=`http://127.0.0.1:${port}`;
const runtimeRoot=testEnv.runtimeRoot;
let server,browser,data;
const requests=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const change=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-music-e2e-'));
 server=spawn(testEnv.python,[path.join(__dirname,'music_e2e_server.py')],{cwd:testEnv.runtimeRoot,env:testEnv.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server start timeout');await sleep(100)}
 browser=await chromium.launch(testEnv.browserOptions());
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],diagnosticResponses=[];
 page.on('response',async response=>{if(response.url().includes('/client-diagnostics')&&response.request().method()==='POST')diagnosticResponses.push({status:response.status(),body:await response.text().catch(()=>'<unreadable>')})});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/control/'))requests.push({url:r.url(),body:r.postDataJSON()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await page.locator('#photo-view').waitFor({state:'visible'});
 await page.locator('#photo-view').click();
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
 const started=Date.now();await control.click();
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
  pauseTrace=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen')).json();
  if(pauseTrace.records?.some(r=>r.row.stage==='playback_confirmation'&&r.row.action==='pause'&&r.row.code==='confirmed'))break;
  await sleep(500);
 }
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-pause-witness-trace.json'),JSON.stringify({state:await state(),journal:pauseTrace,diagnosticResponses},null,2));
 assert(pauseTrace.records?.some(r=>r.row.stage==='playback_confirmation'&&r.row.action==='pause'&&r.row.code==='confirmed'),'accepted Pause survives a temporary unknown witness and later confirms before another command');
 await change({delayMs:0});
 await page.waitForFunction(()=>{const b=document.getElementById('play-pause');return b&&!b.disabled&&b.getAttribute('aria-label')?.includes('Fortsæt')},undefined,{timeout:15000});
 await control.click();
 await page.waitForFunction(()=>/pause/i.test(document.getElementById('play-pause')?.getAttribute('aria-label')||''),undefined,{timeout:15000});
 assert.equal((await state()).state,'playing');
 if(process.env.MUSIC_EXTENDED==='1'){
  for(const [selector,action,song] of [['#next','next',3],['#previous','previous',2]]){
   const button=page.locator(selector);
   await page.waitForFunction(s=>{const b=document.querySelector(s);return b&&!b.disabled},selector,{timeout:15000});
   await button.click();
   for(let n=0;(await state()).song!==song;n++){if(n>80)throw Error(action+' effect not observed');await sleep(100)}
   await page.waitForFunction(value=>document.querySelector('#track-name')?.textContent?.trim()===value,'Isoleret sang '+song,{timeout:15000});
   assert.equal((await state()).writes.filter(x=>x.action===action).length,1);
  }
  const volume=page.locator('#volume');
  for(const [key,value] of [['Home',0],['End',100]]){
   await page.waitForFunction(()=>{const s=document.querySelector('#volume');return s&&!s.disabled},undefined,{timeout:15000});
   await volume.focus();console.log('beforeVolumeKey',key,await page.locator('pv-widget-host').evaluate(h=>({active:document.activeElement?.id,disabled:document.querySelector('#volume')?.disabled,value:document.querySelector('#volume')?.value,pending:h.liveControls?.musicIntentPending,settlement:h.liveControls?.musicFence?.settlementStatus})));await page.keyboard.press(key);console.log('afterVolumeKey',key,await volume.evaluate(s=>({active:document.activeElement?.id,value:s.value,disabled:s.disabled})));
   for(let n=0;(await state()).volume!==value;n++){if(n>80)throw Error('volume effect not observed: '+value);await sleep(100)}
   await page.waitForFunction(v=>document.querySelector('#volume')?.value===String(v),value,{timeout:15000});
  }
  assert.deepEqual((await state()).writes.filter(x=>x.action==='volume').map(x=>x.percent),[0,100]);
  await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-volume-100.png')});
  for(const [name,room] of [['Soveværelse','bedroom'],['Køkkenalrum HomePod','native-room']]){
   await page.locator('#output').click();
   const speaker=page.locator('#room-options button').filter({hasText:name});
   await speaker.waitFor({state:'visible',timeout:10000});
   await page.waitForFunction(n=>{const b=[...document.querySelectorAll('#room-options button')].find(b=>b.textContent.includes(n));return b&&!b.disabled},name,{timeout:15000});
   await page.locator('#rooms').evaluate(async dialog=>{await Promise.allSettled(dialog.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));});
   await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-speaker-roster-'+room+'.png')});
   await speaker.click();
   for(let n=0;(await state()).room!==room;n++){if(n>80)throw Error('output move not observed: '+room);await sleep(100)}
   await page.waitForFunction(n=>document.querySelector('#output')?.textContent.includes(n)&&document.querySelector('#output')?.getAttribute('aria-label')?.includes('Aktuelt output'),name,{timeout:15000});
  }
  assert.deepEqual((await state()).writes.filter(x=>x.action==='move_existing_session').map(x=>x.room),['bedroom','native-room']);
 }
 let journal;
 for(let n=0;n<25;n++){
  journal=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen')).json();
  if(journal.records?.some(record=>record.row.stage==='playback_confirmation'&&record.row.code==='confirmed'))break;
  await sleep(500);
 }
 assert(journal.records?.some(record=>record.row.stage==='control_intent'&&record.row.action==='pause'),'persisted input trace');
 assert(journal.records?.some(record=>record.row.stage==='control_action'&&record.row.action==='pause'&&record.row.code==='accepted'),'persisted accepted trace');
 assert(journal.records?.some(record=>record.row.stage==='playback_confirmation'&&record.row.code==='confirmed'),'persisted correlated confirmation');
 assert.equal((await state()).unknownWitnesses,1,'actual service returned one temporary unknown witness before confirmation');
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-e2e-diagnostics.json'),JSON.stringify(journal,null,2));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',inertFinalService:true,actualPackagedPodView:true,pauseDuringSongChange:true,resume:true,extendedTransport:process.env.MUSIC_EXTENDED==='1',overviewMatchesPlayer:true,persistedActionTrace:true,pauseRequests:1,browserSetupRequests:0,pauseObservedWithinMs:pauseObservedMs,pageErrors:errors}));
 }catch(error){
  const page=browser?.contexts()[0]?.pages()[0];
  if(page){await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-music-extended-failure.png')});console.log('failureState',JSON.stringify({service:await state(),requests,controls:await page.evaluate(()=>{const h=document.querySelector('pv-widget-host'),c=h?.liveControls,p=h?.liveMedia?.playback;return {volume:document.querySelector('#volume')?.outerHTML,fence:c?.musicFence?.outcome,settlement:c?.musicFence?.settlementStatus,pending:c?.musicIntentPending,playbackState:p?.state,poll:p?.poll_sequence,output:document.querySelector('#output')?.outerHTML};})}));}
  throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await closed;}}
})().catch(e=>{console.error(e);process.exitCode=1});
