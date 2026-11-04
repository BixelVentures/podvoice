'use strict';
// Packaged UI → real Python selection/queue brokers → stateful inert native service.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const port=18979,base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,page;const errors=[],actions=[],responses=[];let bundleSHA;
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-selection-'));
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:"1"}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');if(r.url().includes('/music/selection/')||r.url().includes('/music/queue/'))responses.push({url:r.url(),status:r.status(),body:await r.text()})});
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/music/'))actions.push({url:r.url(),body:r.postDataJSON()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await page.locator('#photo-view').tap();
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="top"]').tap();
 const rows=page.locator('#result-list button.result');
 await rows.filter({hasText:'Katalogsang 11'}).waitFor({state:'visible',timeout:15000});
 for(const song of [11,12,11]){
  const row=rows.filter({hasText:`Katalogsang ${song}`});
  await row.tap();
  for(let n=0;(await state()).song!==song;n++){if(n>100)throw Error('selection effect missing '+song);await sleep(100)}
  await page.waitForFunction(s=>document.querySelector('#track-name')?.textContent?.trim()===`Isoleret sang ${s}`,song,{timeout:15000});
  await page.waitForFunction(s=>{const h=document.querySelector('pv-widget-host');return !h?.liveControls?.musicIntentPending&&!h?.liveSelection?.pending&&h?.liveSelection?.feedback?.settlementStatus==='confirmed'&&h.liveMedia?.playback?.item?.uri===`spotify:track:${String(s).padStart(22,'0')}`},song,{timeout:15000});
 }
 const result=await state();
 assert.deepEqual(result.selections.map(r=>Number(r.uri.split(':').pop())),[11,12,11]);
 assert.equal(new Set(result.selections.map(r=>r.requestId)).size,3);
 assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,3);
 await page.locator('#track').tap();
 const queueRow=page.locator('#queue button.queue-track').filter({hasText:'Køsang 22'});
 await queueRow.waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll('#queue button.queue-track')].some(b=>b.textContent.includes('Køsang 22')&&!b.disabled),undefined,{timeout:15000});
 await queueRow.tap();
 for(let n=0;(await state()).song!==22;n++){if(n>100)throw Error('queue occurrence effect missing');await sleep(100)}
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent?.trim()==='Isoleret sang 22',undefined,{timeout:15000});
 const queued=await state();assert.equal(queued.queueSelections.length,1);assert.equal(queued.queueSelections[0].index,1);
 assert.equal(actions.filter(r=>r.url.endsWith('/music/queue/actions')).length,1);
 assert.deepEqual(queued.writes.map(r=>r.action),['play_track','play_track','play_track','play_queue_occurrence']);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='prepare_room_selected_content').length,3);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='start_room_selected_content').length,3);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='prepare_room_queue').length,1);
 assert.equal(queued.nativeCalls.filter(r=>r.service==='control_room_queue').length,1);
 for(const r of actions.filter(r=>r.url.endsWith('/actions'))){assert(!Object.hasOwn(r.body,'uri'));assert(!Object.hasOwn(r.body,'index'));}
 assert.match(bundleSHA,/^[a-f0-9]{64}$/);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(env.artifactDir(),'podview-music-selection-trace.json'),JSON.stringify({bundleSHA,service:queued,actions,responses},null,2));
 await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection.png')});
 console.log(JSON.stringify({outcome:'PASS',packagedUI:true,bundleSHA,inertNativeService:true,catalogueSelections:[11,12,11],oneEffectPerExplicitChoice:true,queueProof:'opaque second occurrence → existing prepare/commit → observed song22',pageErrors:errors}));
 }catch(error){if(page){console.log('failureState',JSON.stringify({service:await state(),responses,actions,ui:await page.locator('body').innerText(),selection:await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,account:h.liveMedia?.account,capabilities:h.liveSnapshot?.capabilities,feedback:h.liveSelection?.feedback&&{message:h.liveSelection.feedback.message,outcome:h.liveSelection.feedback.outcome},queueStatus:h.liveMedia?.queueControls?.status,note:h.liveSelection?.note?.textContent,offer:h.liveSelection?.offer}))}));await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection-failure.png')})}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
