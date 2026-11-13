'use strict';
// Packaged PodView → actual Python/NativeRadio → inert local native HTTP owner.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const port=Number(process.env.RADIO_TEST_PORT||18982),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const configMode=process.env.RADIO_CONFIG_TEST;
const privateFixtureTokens=configMode?[require('node:crypto').randomUUID(),require('node:crypto').randomUUID()]:[];
const timingMode=process.env.RADIO_TIMING_TEST==='1';
const startLatency=process.env.RADIO_START_LATENCY_TEST==='1';
const volumeMode=process.env.RADIO_VOLUME_TEST==='1';
const stationOrderMode=process.env.RADIO_STATION_ORDER_TEST;
const orderedStations=['1','unknown','rejected'].includes(stationOrderMode);
// Read every bounded persisted page; a healthy trace may exceed the first64 rows.
const readJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
const radio=()=>fetch(base+'/lab/radio').then(r=>r.json());
const settleMotion=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))});
let server,browser,page,bundleSHA,serverLog='';const actions=[],responses=[],errors=[];
async function radioConfigJourney(stations){
 const mismatch=configMode==='mismatch';
 const expected=mismatch?'radio_native_auth_rejected':'radio_native_not_configured';
 const model=await page.locator('pv-widget-host').evaluate(async host=>{
  await host.liveRadio.refresh({immediate:true});
  return host.liveRadio.value;
 });
 const snapshot=await state();
 assert.equal(snapshot.radioReads,0,'no authenticated native read');
 assert.equal(snapshot.radioDeniedReads>0,mismatch,'only configured client reaches native authentication');
 assert.deepEqual(snapshot.radioWrites,[]);
 assert.equal(actions.length,0);
 assert.equal(await stations.locator('button:enabled').count(),0);
 assert.equal(model.enabled,false);
 assert.equal(model.actions.length,0);
 const browserText=await page.locator('#radio-view').innerText();
 const persisted=await readJournal(page);
 for(const token of privateFixtureTokens){
  const surfaces=[browserText,JSON.stringify(model),JSON.stringify(responses),JSON.stringify(persisted),serverLog];
  assert(surfaces.every(value=>!value.includes(token)),'a fixture credential escaped the native boundary');
 }
 assert(model.blockedReasons.length===1&&model.blockedReasons[0]===expected,'precise radio configuration reason');
 assert.match(browserText,mismatch?/PodConnect afviste radiotokenet/:/Radio mangler opsætning/);
 assert.deepEqual(errors,[]);
 if(process.env.RADIO_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.RADIO_EXPECTED_BUNDLE);
 console.log(JSON.stringify({outcome:'PASS',bundleSHA,radioConfig:configMode,safeReason:expected,
  noCredentialExposure:true,actionPosts:0,nativeWrites:0,inertFinalService:true}));
}
async function radioConfigRecoveryJourney(stations){
 const p3=stations.getByRole('button',{name:/P3/}),host=page.locator('pv-widget-host');
 const read=()=>host.evaluate(async h=>{
  await h.liveRadio.refresh({immediate:true});
  return {revision:h.liveRadio.value.revision,playing:h.liveRadio.value.state.status==='playing',
   active:h.liveRadio.current(),issue:h.liveRadio.setupIssue()};
 });
 const fault=async fault=>assert((await page.request.post(base+'/lab/radio',{data:{fault}})).ok());
 await p3.tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveRadio?.value?.state?.status==='playing');
 const healthy=await read();
 assert(healthy.active&&healthy.playing);
 await fault('reject');
 const denied=await read();
 assert.deepEqual(denied,{...healthy,active:false,issue:'radio_native_auth_rejected'});
 assert.equal(await p3.isEnabled(),false);
 assert.match(await page.locator('#radio-view').innerText(),/PodConnect afviste radiotokenet/);
 await fault('unavailable');
 const unavailable=await read();
 assert.deepEqual(unavailable,{...healthy,active:false,issue:null});
 assert.equal(await p3.isEnabled(),false);
 await fault(null);
 assert.deepEqual(await read(),healthy);
 assert.equal(await p3.isEnabled(),true);
 assert.equal(actions.filter(row=>row.url.endsWith('/radio/actions')).length,1);
 assert.equal((await state()).radioWrites.length,1);
 for(const token of privateFixtureTokens){
  const surfaces=[await page.locator('body').innerText(),JSON.stringify(responses),JSON.stringify(await readJournal(page)),serverLog];
  assert(surfaces.every(value=>!value.includes(token)),'a fixture credential escaped the native boundary');
 }
 assert.deepEqual(errors,[]);
 if(process.env.RADIO_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.RADIO_EXPECTED_BUNDLE);
 console.log(JSON.stringify({outcome:'PASS',bundleSHA,radioConfig:'rotate',
  noCredentialExposure:true,healthyRejectedUnavailableRecovered:true,revisionFloorRetained:true,noReplay:true}));
}
// Green timing: the native owner accepts at once and reports playing 2.7 s later.
// Playing is shown from that observation, never before it, and well under 3 s.
async function radioStartLatencyJourney(stations){
 const p3=stations.getByRole('button',{name:/P3/});
 await p3.evaluate(node=>{
  node.addEventListener('click',event=>{
   if(!event.isTrusted)return;
   const start=performance.now(),probe=window.radioLatency={clickAt:Date.now(),pendingMs:null,playingMs:null};
   const frame=()=>{
    const now=performance.now()-start,radio=document.querySelector('pv-widget-host')?.liveRadio;
    if(probe.pendingMs===null&&document.querySelector('#track-name')?.textContent==='P3')probe.pendingMs=now;
    if(radio?.value?.state?.status==='playing'
     &&document.getElementById('play-pause')?.getAttribute('aria-label')==='Stop radio')probe.playingMs=now;
    else if(now<10000)requestAnimationFrame(frame);
   };
   requestAnimationFrame(frame);
  },{capture:true,once:true});
 });
 await p3.tap();
 await page.waitForFunction(()=>Number.isFinite(window.radioLatency?.playingMs),undefined,{timeout:12000});
 const probe=await page.evaluate(()=>window.radioLatency),fixture=await state();
 const result={pendingMs:Math.round(probe.pendingMs),nativePlayingMs:Math.round(fixture.radioPlayingAtMs-probe.clickAt),
  playingMs:Math.round(probe.playingMs),bundleSHA};
 console.log('radioStartLatency',JSON.stringify(result));
 assert(probe.pendingMs<300,`chosen station visible within 300 ms: ${JSON.stringify(result)}`);
 assert(result.playingMs>=result.nativePlayingMs,`never playing before the native owner: ${JSON.stringify(result)}`);
 assert(probe.playingMs<3000,`radio playing shown under 3 s: ${JSON.stringify(result)}`);
 assert(result.playingMs-result.nativePlayingMs<300,`playing within 300 ms of the native owner: ${JSON.stringify(result)}`);
 assert.deepEqual((await state()).radioWrites.map(row=>row.action),['start']);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',mode:'radio-start-latency',...result}));
}
// Volume during radio (Green 12 Nov): the native owner answers after 1.5 s. The slider keeps the
// chosen value and neither it nor Stop is ever greyed; Stop pressed meanwhile wins.
async function radioVolumeJourney(stations){
 await stations.getByRole('button',{name:/P3/}).tap();
 const volume=page.locator('#volume'),toggle=page.locator('#play-pause');
 await page.waitForFunction(()=>{const input=document.querySelector('#volume');
  return document.querySelector('pv-widget-host')?.liveRadio?.value?.state?.status==='playing'&&input&&!input.disabled
   &&input.value==='30';},undefined,{timeout:10000});
 const sent=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/view/api/radio/actions')sent.push(Date.now());});
 await page.evaluate(()=>{const probe=window.radioVolumeProbe={disabled:[],stop:false};const sample=()=>{
  for(const id of ['volume','play-pause'])if(document.getElementById(id)?.disabled&&!probe.stop)probe.disabled.push(id);
  if(!probe.stop)requestAnimationFrame(sample);};requestAnimationFrame(sample);});
 const before=(await state()).radioWrites.length;let releasedAt;
 await env.touchRange(page,volume,40,{afterRelease:()=>{releasedAt=Date.now();}});
 releasedAt??=Date.now();
 assert.equal(await volume.inputValue(),'40','the slider stays at the chosen value while the command is sent');
 assert.equal(await volume.isDisabled(),false);assert.equal(await toggle.isDisabled(),false);
 for(let n=0;sent.length===0&&n<50;n++)await sleep(20);
 const sendMs=sent[0]-releasedAt;
 await sleep(300);
 assert.equal(await page.evaluate(()=>document.querySelector('pv-widget-host').liveRadio.pending),true,'volume still pending');
 assert.equal(await volume.inputValue(),'40');
 await toggle.tap();
 const stopTappedMs=Date.now()-releasedAt;
 await page.evaluate(()=>{window.radioVolumeProbe.stop=true;});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveRadio?.value?.state?.status==='stopped'
  &&!document.querySelector('pv-widget-host').liveRadio.pending,undefined,{timeout:15000});
 const doneMs=Date.now()-releasedAt,probe=await page.evaluate(()=>window.radioVolumeProbe);
 const writes=(await state()).radioWrites.slice(before);
 assert.deepEqual(writes.map(row=>row.action),['volume','stop'],'Stop pressed during the volume command is sent');
 assert.equal(writes[0].volume_percent,40);
 assert.deepEqual([...new Set(probe.disabled)],[],'slider and Stop are never greyed during the volume command');
 assert(sendMs<300,`volume command sent ${sendMs} ms after release`);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',mode:'radio-volume',sendMs,stopTappedMs,stoppedMs:doneMs,bundleSHA}));
}
async function radioTimingJourney(stations){
 const results=[];
 for(const {action,control,expectedState,limit} of [
  {action:'start',control:stations.getByRole('button',{name:/P3/}),expectedState:'playing',limit:3000},
  {action:'stop',control:page.locator('#play-pause'),expectedState:'stopped',limit:1000},
 ]){
  await control.evaluate((node,action)=>{
   window.radioInputPaint=null;
   node.addEventListener('click',event=>{
    if(!event.isTrusted)return;
    const start=performance.now();
    const frame=()=>{
     const elapsedMs=performance.now()-start,cover=document.querySelector('#cover');
     const identityReady=action==='stop'||document.querySelector('#track-name')?.textContent==='P3'
      &&cover?.getAttribute('src')==='assets/radio-p3.svg'&&cover.naturalWidth>0;
     if(node.getAttribute('aria-busy')==='true'&&identityReady){
      window.radioInputPaint={start,elapsedMs};
     }else if(elapsedMs<2000)requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
   },{capture:true,once:true});
  },action);
  const before=await state();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/view/api/radio/actions',async route=>{
   await gate;
   await route.continue();
  },{times:1});
  try{
   await control.tap();
   await page.waitForFunction(()=>window.radioInputPaint!==null,undefined,{timeout:3000});
   const paintMs=await page.evaluate(()=>window.radioInputPaint.elapsedMs);
   assert(paintMs<100,`${action} feedback took ${paintMs} ms`);
   assert.deepEqual((await state()).radioWrites,before.radioWrites);
   assert.equal((await radio()).state,action==='start'?'stopped':'playing');
   release();
   await page.waitForFunction(status=>{
    const radio=document.querySelector('pv-widget-host')?.liveRadio;
    const button=document.getElementById('play-pause');
    return !radio?.pending&&radio.value?.state?.status===status
     &&button?.getAttribute('aria-label')===(status==='playing'?'Stop radio':'Start radio ved livepunkt');
   },expectedState,{timeout:10000});
   const observedMs=await page.evaluate(()=>performance.now()-window.radioInputPaint.start);
   assert(observedMs<limit,`${action} inert observed result took ${observedMs} ms`);
   const after=await state();
   assert.deepEqual(after.radioWrites.slice(before.radioWrites.length).map(row=>row.action),[action]);
   results.push({action,paintMs,observedMs});
  }finally{release();}
 }
 const writes=(await state()).radioWrites;
 assert.equal(writes[0].station_id,'p3');
 assert.equal(writes[0].target_id,'42');
 assert.equal(actions.filter(row=>row.url.endsWith('/radio/actions')).length,2);
 assert.deepEqual(errors,[]);
 if(process.env.RADIO_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.RADIO_EXPECTED_BUNDLE);
 console.log(JSON.stringify({outcome:'PASS',bundleSHA,stories:['R1','R2'],results,
  actualNativeRadioHTTP:true,inertFinalService:true,physicalAudioVerified:false}));
}
async function stationOrderJourney(stations){
 const station=name=>stations.getByRole('button',{name:new RegExp(name)});
 const p3=station('P3'),p1=station('P1'),p6=station('P6 Beat');
 const observed=stationId=>page.waitForFunction(stationId=>{
  const radio=document.querySelector('pv-widget-host').liveRadio;
  return !radio.pending&&radio.value?.state?.status==='playing'&&radio.value.state.stationId===stationId;
 },stationId,{timeout:12000});
 await p3.tap();
 await observed('p3');
 let enter,release;
 const entered=new Promise(resolve=>{enter=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/view/api/radio/actions',async route=>{
  enter();
  await gate;
  if(stationOrderMode!=='unknown')return route.continue();
  const committed=await route.fetch();
  assert.equal((await committed.json()).status,'accepted');
  await route.fulfill({status:502,json:{error:'inert_radio_receipt_lost'}});
 },{times:1});
 try{
  await p1.tap();
  let timeout;
  try{await Promise.race([entered,new Promise((_,reject)=>{
   timeout=setTimeout(()=>reject(Error('first station request was not observed')),10000);
  })]);}finally{clearTimeout(timeout);}
  assert.equal(await p3.getAttribute('aria-pressed'),'true','last observed station stays selected while request waits');
  assert.equal(await p1.getAttribute('aria-busy'),'true');
  assert.equal(await p6.isEnabled(),true,'ordinary station pending must not disable a second explicit tap');
  if(stationOrderMode!=='rejected'){
   await p6.tap();
   assert.equal(await p3.getAttribute('aria-pressed'),'true','queued choice does not claim playback');
   assert.equal(await p1.getAttribute('aria-pressed'),'false');
   assert.equal(await p6.getAttribute('aria-busy'),'true','latest explicit choice paints existing pending label');
   assert.equal(await p1.getAttribute('aria-busy'),'false');
  }
  assert.deepEqual((await state()).radioWrites.map(row=>row.station_id),['p3']);
  assert.equal(actions.filter(row=>row.url.endsWith('/radio/actions')).length,2);
  await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-stations-held.png')});
 }finally{release();}
 let expected=['p3','p1','p6-beat'];
 if(stationOrderMode==='unknown'){
  await page.waitForFunction(()=>document.querySelector('pv-widget-host').liveRadio.unknown,
   undefined,{timeout:12000});
  assert.equal(await p6.getAttribute('aria-busy'),'false','lost reply clears the queued choice');
  assert.deepEqual((await state()).radioWrites.map(row=>row.station_id),['p3','p1']);
  const p8=station('P8 Jazz');
  await page.waitForFunction(()=>{
   const h=document.querySelector('pv-widget-host'),radio=h.liveRadio;
   return !radio.unknown&&radio.value?.state?.stationId==='p1';
  },undefined,{timeout:16000});
  assert.equal(await p8.isEnabled(),true);
  await p8.tap();
  await observed('p8-jazz');
  expected=['p3','p1','p8-jazz'];
 }else{
  if(stationOrderMode==='rejected'){
   await page.getByText('Radio kunne ikke startes. Prøv igen.',{exact:true}).waitFor({state:'visible'});
   assert.equal(await p3.getAttribute('aria-pressed'),'true');
   assert.equal(await p6.isEnabled(),true);
   await p6.tap();
   expected=['p3','p6-beat'];
  }
  await observed('p6-beat');
  assert.equal(await p6.getAttribute('aria-pressed'),'true');
  assert.equal(await p6.getAttribute('aria-busy'),'false');
 }
 const final=await state();
 assert.deepEqual(final.radioWrites.map(row=>row.station_id),expected);
 const posts=actions.filter(row=>row.url.endsWith('/radio/actions')).map(row=>row.body);
 assert.equal(new Set(posts.map(row=>row.taskId)).size,3);
 assert.equal(posts.length,3);
 assert.deepEqual(errors,[]);
 const proof={outcome:'PASS',bundleSHA,orderedStations:final.radioWrites.map(row=>row.station_id),
  mode:stationOrderMode,freshTasks:posts.length,inertNativeService:true,pageErrors:errors};
 if(process.env.RADIO_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.RADIO_EXPECTED_BUNDLE);
 await fs.writeFile(path.join(env.artifactDir(),'podview-radio-station-order-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
(async()=>{try{
 const testNonce=require('node:crypto').randomUUID();
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-radio-'));
 server=spawn(env.python,[path.join(__dirname,'radio_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({RADIO_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:'1',PODVIEW_TEST_NONCE:testNonce,
  ...(configMode?{RADIO_FIXTURE_OWNER_TOKEN:privateFixtureTokens[0],RADIO_FIXTURE_CLIENT_TOKEN:privateFixtureTokens[1]}:{})}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();if(!configMode)process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>300)throw Error('server startup');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,testNonce,'own isolated Python runtime nonce');
 browser=await chromium.launch(env.browserOptions());page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 if(configMode||timingMode)await page.route('**/*',route=>
  new URL(route.request().url()).origin===base?route.continue():route.abort());
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.status()>=300&&r.status()<400)return;if(r.url().endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');if(/\/api\/(radio|music\/selection)/.test(r.url()))responses.push({url:r.url(),status:r.status(),body:await r.text()})});
 page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(radio|music\/selection)/.test(r.url()))actions.push({url:r.url(),body:r.postDataJSON()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);await page.locator('#home-radio').tap();
 const stations=page.locator('#radio-view pv-choice-list');
 await stations.getByRole('button',{name:/P3/}).waitFor({state:'visible',timeout:15000});
 assert.deepEqual((await state()).radioWrites,[],'navigation and passive state reads have no effects');
 if(configMode==='rotate'){await radioConfigRecoveryJourney(stations);return;}
 if(configMode){await radioConfigJourney(stations);return;}
 if(timingMode){await radioTimingJourney(stations);return;}
 if(startLatency){await radioStartLatencyJourney(stations);return;}
 if(volumeMode){await radioVolumeJourney(stations);return;}
 if(orderedStations){await stationOrderJourney(stations);return;}
 await stations.getByRole('button',{name:/P3/}).tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveRadio?.value?.state?.status==='playing'&&!h.liveRadio.pending&&h.liveRadio.value.state.stationId==='p3'&&document.querySelector('#track-name')?.textContent?.trim()==='P3'},undefined,{timeout:15000});
 assert.equal((await radio()).source_kind,'radio');assert.equal((await radio()).target_id,'42');
 assert((await page.locator('#output').innerText()).includes('Køkkenalrum HomePod'));
 assert.equal(await page.locator('#play-pause').getAttribute('aria-label'),'Stop radio');
 const p3=stations.getByRole('button',{name:/P3/});
 assert.equal(await p3.getAttribute('aria-pressed'),'true','observed station is selected');
 const originalP3=await p3.elementHandle();
 await page.locator('pv-widget-host').evaluate(host=>host.renderLive());
 assert(await p3.evaluate((node,original)=>node===original,originalP3),
  'unchanged repaint preserves station node');
 await page.locator('#header-title-action').tap();
 await page.locator('#home-radio').tap();
 await p3.waitFor({state:'visible'});
 assert.equal(await p3.getAttribute('aria-pressed'),'true','reopening retains observed station selection');
 assert.equal((await state()).radioWrites.length,1,'repaint and reopen do not restart the station');

 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-playing.png')});
 const p3Presentation=()=>p3.evaluate(button=>{
  const style=getComputedStyle(button),logo=button.querySelector('img');
  return {
   name:button.querySelector('strong')?.textContent,
   logo:logo?.getAttribute('src'),logoLoaded:logo?.complete&&logo.naturalWidth>0,
   borderWidth:style.borderTopWidth,borderColor:style.borderTopColor,borderStyle:style.borderTopStyle,
   background:style.backgroundColor,shadow:style.boxShadow,
  };
 });
 const selectedBefore=await p3Presentation();
 assert.equal(selectedBefore.name,'P3');
 assert.match(selectedBefore.logo,/(?:^|\/)assets\/radio-p3\.svg$/);
 assert.equal(selectedBefore.logoLoaded,true);
 // Lærred v190 »A-Radio« (issue 393): the selected tile has one 3-px inset ring in the station colour, no border.
 assert.equal(selectedBefore.borderWidth,'0px');
 assert.equal(selectedBefore.shadow,'rgb(77, 255, 77) 0px 0px 0px 3px inset','the selected tile has a single edge');
 const beforeReload=await page.evaluate(()=>performance.timeOrigin);
 const refreshedOwner=page.waitForResponse(response=>
  new URL(response.url()).pathname==='/view/api/radio'&&response.request().method()==='GET'&&response.ok());
 await page.reload({waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.locator('#home-radio').tap();
 await refreshedOwner;
 await page.waitForFunction(()=>{
  const host=document.querySelector('pv-widget-host');
  return host?.liveRadio?.current()&&host.liveRadio.value.state.stationId==='p3'&&
   host.liveRadio.value.state.status==='playing'&&document.querySelector('#track-name')?.textContent?.trim()==='P3';
 });
 // Issue 393: the tile carries only logo and name; the hero names the station and that it plays.
 await page.waitForFunction(()=>document.querySelector('#radio-view .radio-hero h2')?.textContent==='P3'&&
  /^Spiller/.test(document.querySelector('#radio-view .radio-hero-status')?.textContent||''));
 await p3.locator('img').waitFor({state:'visible'});
 await p3.locator('img').evaluate(image=>image.decode());
 assert.notEqual(await page.evaluate(()=>performance.timeOrigin),beforeReload,'reload uses a new document');
 assert.equal(await p3.getAttribute('aria-pressed'),'true');
 assert.deepEqual(await p3Presentation(),selectedBefore,'selected P3 retains name, logo and edge after reload');
 const logoBytes=await fetch(new URL(selectedBefore.logo,base+'/view/')).then(response=>response.arrayBuffer());
 assert.equal(createHash('sha256').update(Buffer.from(logoBytes)).digest('hex'),
  'e9782d842cceb388a7be45cf2f1e271cb583e14c6f95379a1bc7175fcf494547','approved official P3 asset');
 assert.equal(actions.filter(row=>row.url.endsWith('/radio/actions')).length,1,'reload sends no new action');
 assert.equal((await state()).radioWrites.length,1,'reload sends no new native Start');
 const reloadScreenshot=path.join(env.artifactDir(),'podview-radio-p3-reloaded.png');
 await settleMotion();
 await page.screenshot({path:reloadScreenshot});
 const reloadProof={outcome:'PASS',story:'R5',bundleSHA,hardReload:true,selectedStation:'P3',
  approvedSelection:selectedBefore,actionPosts:1,nativeStarts:1,inertFinalService:true,screenshot:reloadScreenshot};
 await fs.writeFile(path.join(env.artifactDir(),'podview-radio-p3-reloaded.json'),JSON.stringify(reloadProof,null,2));
 console.log(JSON.stringify(reloadProof));
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
 // g) A stopped station stays like a paused song: 10 minutes, also across a reload (9 min yes, 11 min no).
 const ageStation=minutes=>page.evaluate(ms=>{
  const saved=JSON.parse(localStorage.getItem('podview.radioStation'));
  localStorage.setItem('podview.radioStation',JSON.stringify({...saved,at:Date.now()-ms}));
 },minutes*60000);
 const reloadRadio=async()=>{
  await page.reload({waitUntil:'domcontentloaded'});await env.openOverview(page);await page.locator('#home-radio').tap();
  await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');
   return h?.liveRadio?.current()&&h.liveRadio.value.state.status==='stopped'&&!h.liveRadio.pending;},undefined,{timeout:15000});
 };
 // The earlier document's diagnostics are persisted before it is replaced.
 for(let n=0;n<200;n++){
  const early=await readJournal(page);
  if(early.records?.some(({row})=>row.stage==='control_observation'&&row.domain==='radio'&&row.action==='volume'&&row.code==='observed')
   &&early.records?.some(({row})=>row.stage==='control_observation'&&row.domain==='radio'&&row.action==='stop'&&row.code==='observed'))break;
  await sleep(500);
 }
 await ageStation(9);await reloadRadio();
 await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent?.trim()==='P3'
  &&document.querySelector('#play-pause')?.getAttribute('aria-label')==='Start radio ved livepunkt',undefined,{timeout:5000});
 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-stopped-9min-reload.png')});
 await ageStation(11);await reloadRadio();
 assert.equal(await page.evaluate(()=>document.querySelector('pv-widget-host').liveRadio.knownStopped()),false);
 assert.notEqual((await page.locator('#track-name').innerText()).trim(),'P3','after 10 minutes the player is empty');
 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-stopped-11min-reload.png')});
 // The same inert native owner then reports a legitimate Spotify catalogue start.
 await stations.getByRole('button',{name:/P6 Beat/i}).tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveRadio?.value?.state?.stationId==='p6-beat'&&h.liveRadio.value.state.status==='playing'&&!h.liveRadio.pending},undefined,{timeout:15000});
 await page.locator('#header-title-action').tap();await page.locator('#home-music').tap();await page.locator('[data-collection="top"]').tap();
 const choice=page.locator('#result-list button.result').filter({hasText:'Katalogsang 11'});await choice.waitFor({state:'visible',timeout:15000});await choice.tap();
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveSelection?.feedback?.displayObserved===true&&h.liveMedia?.playback?.item?.uri==='spotify:track:0000000000000000000011'&&h.liveRadio?.value?.state?.sourceKind==='spotify'&&document.querySelector('#track-name')?.textContent?.trim()==='Isoleret sang 11'},undefined,{timeout:15000});
 assert((await page.locator('#output').innerText()).includes('Køkkenalrum HomePod'));
 const final=await state();assert.deepEqual(final.radioWrites.map(r=>r.action),['start','volume','stop','start']);assert.deepEqual(final.sourceTransitions,['radio','none','radio','spotify']);assert.equal(final.selections.length,1);assert.deepEqual(errors,[]);assert.match(bundleSHA,/^[a-f0-9]{64}$/);
 assert.equal(actions.filter(r=>r.url.endsWith('/radio/actions')).length,4);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,1);
 await settleMotion();await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-to-spotify.png')});
 let journal;for(let n=0;n<200;n++){
  journal=await readJournal(page);
  if(journal.records?.some(({row})=>row.stage==='control_observation'&&row.domain==='radio'&&row.action==='volume'&&row.code==='observed'&&row.observedValue===31)&&journal.records?.some(({row})=>row.stage==='control_observation'&&row.domain==='radio'&&row.action==='stop'&&row.code==='observed'))break;
  await sleep(500);
 }
 await fs.writeFile(path.join(env.artifactDir(),'podview-radio-product-journal.json'),JSON.stringify(journal,null,2));
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
 await fs.writeFile(path.join(env.artifactDir(),'podview-radio-trace.json'),JSON.stringify({bundleSHA,service:final,radio:await radio(),actions,responses},null,2));
 console.log(JSON.stringify({outcome:'PASS',bundleSHA,actualPackagedPodView:true,actualNativeRadioHTTP:true,inertFinalService:true,stationStart:true,authoritativeOutput:'42',radioVolume:{gesture:'touch-drag',passivePaintDuringTouch:true,observedPercent:31,effects:1},stop:true,radioToSpotifyCatalogue:true,persistedValueTargetTrace:true,oneEffectPerExplicitInput:true,pageErrors:errors}));
 }catch(error){if(page&&!configMode){console.log('failureState',JSON.stringify({service:await state(),radio:await radio(),ui:await page.locator('body').innerText(),actions,responses:responses.slice(-5)}));await page.screenshot({path:path.join(env.artifactDir(),'podview-radio-failure.png')})}throw error;
 }finally{
  try{
   // Let in-flight response body reads finish before closing their browser.
   if(page)await page.removeAllListeners('response',{behavior:'wait'});
  }finally{
   try{
    if(browser)await browser.close();
   }finally{
    if(server&&server.exitCode===null){
     const done=new Promise(resolve=>server.once('exit',resolve));
     server.kill('SIGTERM');
     await done;
    }
   }
  }
 }
})().catch(e=>{console.error(e);process.exitCode=1});
