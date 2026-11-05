'use strict';
// Packaged PodView → actual Python/NativeRadio → inert local native HTTP owner.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const port=Number(process.env.RADIO_TEST_PORT||18982),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
// Read every bounded persisted page; a healthy trace may exceed the first64 rows.
const readJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
const radio=()=>fetch(base+'/lab/radio').then(r=>r.json());
const settleMotion=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))});
let server,browser,page,bundleSHA,serverLog='';const actions=[],responses=[],errors=[];
(async()=>{try{
 const testNonce=require('node:crypto').randomUUID();
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-radio-'));
 server=spawn(env.python,[path.join(__dirname,'radio_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({RADIO_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:'1',PODVIEW_TEST_NONCE:testNonce}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>300)throw Error('server startup');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,testNonce,'own isolated Python runtime nonce');
 browser=await chromium.launch(env.browserOptions());page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');if(/\/api\/(radio|music\/selection)/.test(r.url()))responses.push({url:r.url(),status:r.status(),body:await r.text()})});
 page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(radio|music\/selection)/.test(r.url()))actions.push({url:r.url(),body:r.postDataJSON()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);await page.locator('#home-radio').tap();
 const stations=page.locator('#radio-view pv-choice-list');
 await stations.getByRole('button',{name:/P3/}).waitFor({state:'visible',timeout:15000});
 assert.deepEqual((await state()).radioWrites,[],'navigation and passive state reads have no effects');
 await stations.getByRole('button',{name:/P3/}).tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveRadio?.value?.state?.status==='playing'&&!h.liveRadio.pending&&h.liveRadio.value.state.stationId==='p3'&&document.querySelector('#track-name')?.textContent?.trim()==='P3'},undefined,{timeout:15000});
 assert.equal((await radio()).source_kind,'radio');assert.equal((await radio()).target_id,'42');
 assert((await page.locator('#output').innerText()).includes('Køkkenalrum HomePod'));
 assert.equal(await page.locator('#play-pause').getAttribute('aria-label'),'Stop radio');
 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-playing.png')});
 const volume=page.locator('#volume');
 assert.equal(await volume.getAttribute('max'),'100');
 await page.waitForFunction(()=>{const input=document.querySelector('#volume');return input&&!input.disabled&&input.value==='30'},undefined,{timeout:5000});
 await env.touchRange(page,volume,31,{beforeRelease:async()=>{
  assert.equal(await volume.inputValue(),'31','native finger has selected31 before release');
  await page.locator('pv-widget-host').evaluate(host=>host.renderLive());
  assert.equal(await volume.inputValue(),'31','passive repaint cannot overwrite a valid held touch');
 }});
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host'),input=document.querySelector('#volume');return h?.liveRadio?.value?.state?.volumePercent===31&&!h.liveRadio.pending&&input?.value==='31'&&!input.disabled},undefined,{timeout:10000});
 assert.equal((await radio()).volume_percent,31);
 const volumeWrites=(await state()).radioWrites.filter(r=>r.action==='volume');assert.equal(volumeWrites.length,1);assert.equal(volumeWrites[0].volume_percent,31);
 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-volume-31.png')});
 await page.locator('#play-pause').tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveRadio?.value?.state?.status==='stopped'&&!h.liveRadio.pending},undefined,{timeout:15000});
 assert.equal((await radio()).source_kind,'none');assert.equal((await state()).radioWrites.length,3);
 await page.waitForFunction(()=>{const b=document.querySelector('#play-pause');return b&&!b.disabled&&b.getAttribute('aria-label')==='Start radio ved livepunkt'&&document.querySelector('#track-name')?.textContent?.trim()==='P3'},undefined,{timeout:5000});
 assert.equal(await page.locator('#play-icon').getAttribute('src'),'assets/icons/play-fill.svg');
 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-stopped.png')});
 // The same inert native owner then reports a legitimate Spotify catalogue start.
 await stations.getByRole('button',{name:/P6 Beat/i}).tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveRadio?.value?.state?.stationId==='p6-beat'&&h.liveRadio.value.state.status==='playing'&&!h.liveRadio.pending},undefined,{timeout:15000});
 await page.locator('#header-title-action').tap();await page.locator('#home-music').tap();await page.locator('[data-collection="top"]').tap();
 const choice=page.locator('#result-list button.result').filter({hasText:'Katalogsang 11'});await choice.waitFor({state:'visible',timeout:15000});await choice.tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveSelection?.feedback?.settlementStatus==='confirmed'&&h.liveMedia?.playback?.item?.uri==='spotify:track:0000000000000000000011'&&h.liveRadio?.value?.state?.sourceKind==='spotify'&&document.querySelector('#track-name')?.textContent?.trim()==='Isoleret sang 11'},undefined,{timeout:15000});
 assert((await page.locator('#output').innerText()).includes('Køkkenalrum HomePod'));
 const final=await state();assert.deepEqual(final.radioWrites.map(r=>r.action),['start','volume','stop','start']);assert.deepEqual(final.sourceTransitions,['radio','none','radio','spotify']);assert.equal(final.selections.length,1);assert.deepEqual(errors,[]);assert.match(bundleSHA,/^[a-f0-9]{64}$/);
 assert.equal(actions.filter(r=>r.url.endsWith('/radio/actions')).length,4);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,1);
 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-to-spotify.png')});
 let journal;for(let n=0;n<200;n++){
  journal=await readJournal(page);
  if(journal.records?.some(({row})=>row.stage==='control_observation'&&row.domain==='radio'&&row.action==='volume'&&row.code==='observed'&&row.observedValue===31)&&journal.records?.some(({row})=>row.stage==='control_observation'&&row.domain==='radio'&&row.action==='stop'&&row.code==='observed'))break;
  await sleep(500);
 }
 const rows=journal.records?.map(entry=>entry.row)||[],resourceRef=createHash('sha256').update('42').digest('hex').slice(0,16);
 for(const action of ['volume','stop']){
  const observation=rows.find(row=>row.stage==='control_observation'&&row.domain==='radio'&&row.action===action&&row.code==='observed');assert(observation,`persisted radio ${action} observation`);
  assert.equal(observation.resourceRef,resourceRef);assert.equal(observation.source,'podradio');assert.equal(observation.trust,'state_observation');assert.equal(observation.requestedValue,action==='volume'?31:false);assert.equal(observation.observedValue,action==='volume'?31:false);assert.match(observation.diagnosticRef,/^[a-f0-9]{16}$/);
  for(const [stage,code]of [['control_intent','start'],['control_setup','ok'],['control_action','accepted']])assert(rows.some(row=>row.stage===stage&&row.code===code&&row.diagnosticRef===observation.diagnosticRef),`persisted correlated radio ${action} ${stage}`);
  assert.equal(observation.requestRef,undefined,'radio diagnostic metadata is not a wire request identifier');
 }
 assert.equal(actions.some(request=>request.body.diagnosticRef||request.body.resourceId),false,'diagnostic metadata never enters action wire');assert.equal(rows.some(row=>row.resourceId!==undefined),false);
 const serverProof=actions.filter(request=>request.url.endsWith('/radio/actions')).map(({body})=>{
  const taskRef=createHash('sha256').update(body.taskId).digest('hex').slice(0,16),optionRef=createHash('sha256').update(body.optionId).digest('hex').slice(0,16);
  const lines=serverLog.split('\n').filter(line=>line.includes('podview_radio ')&&line.includes('task_ref='+taskRef)&&line.includes('option_ref='+optionRef));
  for(const [stage,outcome]of [['admission','admitted'],['dispatch','started'],['receipt','accepted']])assert(lines.some(line=>line.includes('stage='+stage)&&line.includes('outcome='+outcome)),`server-owned radio ${stage}`);
  return {taskRef,optionRef,lines};
 });
 assert.equal(serverProof.length,4,'every explicit radio command has its owner trace');
 await fs.writeFile(path.join(env.artifactDir(),'podview-radio-server-trace.json'),JSON.stringify(serverProof,null,2));
 await fs.writeFile(path.join(env.artifactDir(),'podview-radio-product-journal.json'),JSON.stringify(journal,null,2));
 await fs.writeFile(path.join(env.artifactDir(),'podview-radio-trace.json'),JSON.stringify({bundleSHA,service:final,radio:await radio(),actions,responses},null,2));
 console.log(JSON.stringify({outcome:'PASS',bundleSHA,actualPackagedPodView:true,actualNativeRadioHTTP:true,inertFinalService:true,stationStart:true,authoritativeOutput:'42',radioVolume:{gesture:'touch-drag',passivePaintDuringTouch:true,observedPercent:31,effects:1},stop:true,radioToSpotifyCatalogue:true,persistedValueTargetTrace:true,oneEffectPerExplicitInput:true,pageErrors:errors}));
 }catch(error){if(page){console.log('failureState',JSON.stringify({service:await state(),radio:await radio(),ui:await page.locator('body').innerText(),actions,responses:responses.slice(-5)}));await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-failure.png')})}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
