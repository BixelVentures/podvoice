'use strict';
// Actual packaged PodView and Python bridge; final HA/native service is stateful and inert.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const root=path.resolve(__dirname,'../..'),port=18973,base=`http://127.0.0.1:${port}`;
let server,browser,data;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const change=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-music-e2e-'));
 server=spawn('/Users/madsbachandersen/Documents/PodVoice/.venv/bin/python',[path.join(__dirname,'music_e2e_server.py')],{cwd:root,env:{...process.env,PYTHONPATH:`/private/tmp/pv118-py312all:${root}/podvoice:${root}/tests`,MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data},stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server start timeout');await sleep(100)}
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],requests=[],diagnosticResponses=[];
 page.on('response',async response=>{if(response.url().includes('/client-diagnostics')&&response.request().method()==='POST')diagnosticResponses.push({status:response.status(),body:await response.text().catch(()=>'<unreadable>')})});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/control/'))requests.push({url:r.url(),body:r.postDataJSON()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await page.locator('#photo-view').waitFor({state:'visible'});
 await page.locator('#photo-view').click();
 const control=page.locator('#play-pause');
 await control.waitFor({state:'visible',timeout:10000}).catch(async error=>{
  await page.screenshot({path:'/private/tmp/podview-music-failure.png'});
  console.log('visibleUI',await page.locator('body').innerText());
  throw error;
 });
 await control.waitFor({state:'attached'});
 await page.waitForFunction(()=>{const b=document.getElementById('play-pause');return b&&!b.disabled&&/pause/i.test(b.getAttribute('aria-label')||'')},undefined,{timeout:15000}).catch(async error=>{
  await page.screenshot({path:'/private/tmp/podview-music-failure.png'});
  console.log('control',await control.evaluate(e=>e.outerHTML));
  console.log('visibleUI',await page.locator('body').innerText());
  console.log('playback',await (await page.request.get(base+'/view/api/music?room=kitchen&kind=playback&account=account&include_controls=1')).json());
  throw error;
 });
 await page.screenshot({path:'/private/tmp/podview-music-before.png'});
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
 await page.screenshot({path:'/private/tmp/podview-music-paused.png'});
 let pauseTrace;
 for(let n=0;n<80;n++){
  pauseTrace=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen')).json();
  if(pauseTrace.records?.some(r=>r.row.stage==='playback_confirmation'&&r.row.action==='pause'&&r.row.code==='confirmed'))break;
  await sleep(500);
 }
 await fs.writeFile('/private/tmp/podview-music-pause-witness-trace.json',JSON.stringify({state:await state(),journal:pauseTrace,diagnosticResponses},null,2));
 assert(pauseTrace.records?.some(r=>r.row.stage==='playback_confirmation'&&r.row.action==='pause'&&r.row.code==='confirmed'),'accepted Pause survives a temporary unknown witness and later confirms before another command');
 await change({delayMs:0});
 await page.waitForFunction(()=>{const b=document.getElementById('play-pause');return b&&!b.disabled&&b.getAttribute('aria-label')?.includes('Fortsæt')},undefined,{timeout:15000});
 await control.click();
 await page.waitForFunction(()=>/pause/i.test(document.getElementById('play-pause')?.getAttribute('aria-label')||''),undefined,{timeout:15000});
 assert.equal((await state()).state,'playing');
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
 await fs.writeFile('/private/tmp/podview-music-e2e-diagnostics.json',JSON.stringify(journal,null,2));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',inertFinalService:true,actualPackagedPodView:true,pauseDuringSongChange:true,resume:true,overviewMatchesPlayer:true,persistedActionTrace:true,pauseRequests:1,browserSetupRequests:0,pauseObservedWithinMs:pauseObservedMs,pageErrors:errors}));
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await closed;}}
})().catch(e=>{console.error(e);process.exitCode=1});
