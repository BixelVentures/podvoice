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
const manualRetryMode=process.env.MUSIC_MANUAL_RETRY_TEST==='1';
const renewedControlsMode=process.env.MUSIC_RENEWED_CONTROLS_TEST==='1';
const seekMode=process.env.MUSIC_SEEK_TEST==='1';
const volumeDragMode=process.env.MUSIC_VOLUME_DRAG_TEST==='1';
const externalOutputMode=process.env.MUSIC_EXTERNAL_OUTPUT_TEST==='1';
const speakerRefreshMode=process.env.MUSIC_SPEAKER_REFRESH_TEST==='1';
const outputTransferMode=process.env.MUSIC_OUTPUT_TRANSFER_TEST==='1';
const multiScreenMode=process.env.MUSIC_MULTI_SCREEN_TEST==='1';
if(process.env.MUSIC_LONG_SESSION==='1'||renewedControlsMode||seekMode||volumeDragMode||externalOutputMode||speakerRefreshMode||outputTransferMode||multiScreenMode){
 process.env.MUSIC_EXTENDED='1';
}
let server,browser,data,servedBundleSHA,serverSuspended=false;
const requests=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const playbackReads=s=>s.serviceReads.filter(row=>row.path.endsWith('/get_playback_snapshot')).length;
const readJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
const change=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function speakerRefreshJourney(page,errors){
 const before=await state(),posts=requests.length;
 const dialog=page.locator('#rooms'),rows=dialog.locator('#room-options > button');
 const refresh=dialog.getByRole('button',{name:'Opdater liste',exact:true});
 let hold=false,release,markHeld;
 const gate=new Promise(resolve=>{release=resolve;});
 const held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music?**',async route=>{
  const url=new URL(route.request().url());
  if(!hold||url.searchParams.get('kind')!=='speakers')return route.continue();
  hold=false;
  const response=await route.fetch(),body=await response.json();
  markHeld(body);
  await gate;
  await route.fulfill({response});
 });
 await page.locator('#output').tap();
 await dialog.waitFor({state:'visible'});
 await rows.nth(1).waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#rooms .speaker-list-refresh')?.disabled===false);
 const inspect=()=>rows.evaluateAll(items=>items.map(row=>{
  const {x,y,width,height}=row.getBoundingClientRect(),style=getComputedStyle(row);
  return {name:row.querySelector('strong').textContent,pressed:row.getAttribute('aria-pressed'),
   status:row.querySelector('.target-status').textContent,rect:[x,y,width,height].map(Math.round),
   border:style.borderTopColor,surface:style.backgroundColor,shadow:style.boxShadow};
 }));
 const initial=await inspect(),nodes=await rows.elementHandles();
 assert.deepEqual(initial.map(({name,pressed})=>[name,pressed]),
  [['Køkkenalrum HomePod','true'],['Soveværelse','false']]);
 assert.equal(initial[0].status,'Aktuelt output');
 assert.notEqual(initial[0].shadow,initial[1].shadow);
 assert.match(initial[0].shadow,/inset/);

 // Render the shipped radio-selected preview with the same packaged CSS and JS.
 // Demo mode has no provider or device transport.
 const radio=await browser.newPage();
 try{
  await radio.route(base+'/lab/radio-preview?stage=radio-selected',async route=>{
   const response=await route.fetch({url:base+'/view/'});
   const html=(await response.text()).replace('<head>','<head><base href="/view/">');
   await route.fulfill({response,body:html});
  });
  await radio.goto(base+'/lab/radio-preview?stage=radio-selected');
  const station=radio.locator('#radio-view .radio-station-tiles button[aria-pressed="true"]');
  await station.waitFor({state:'visible',timeout:10000});
  const radioStyle=await station.evaluate(node=>{
   const style=getComputedStyle(node);
   return {border:style.borderTopColor,surface:style.backgroundColor};
  });
  assert.deepEqual({border:initial[0].border,surface:initial[0].surface},radioStyle);
 }finally{await radio.close();}

 const deadline=await page.locator('pv-widget-host').evaluate(host=>host.liveOutputs.validUntil);
 await page.waitForFunction(until=>until-Date.now()<3000,deadline,{timeout:32000});
 assert.ok(deadline>Date.now(),'refresh begins before the actual roster lease expires');
 hold=true;
 try{
  await refresh.tap();
  const response=await Promise.race([
   held,page.waitForTimeout(7000).then(()=>{throw Error('speaker roster refresh did not reach the bridge');}),
  ]);
  assert.equal(response.ok,true);
  assert.ok(response.retrievedAt*1000+30000>deadline);
  await page.waitForFunction(until=>Date.now()>=until
   &&document.querySelector('pv-widget-host')?.liveOutputs.validUntil===0,deadline,{timeout:6000});
  const during=await inspect();
  assert.equal(await dialog.isVisible(),true);
  assert.doesNotMatch(await dialog.innerText(),/udløbet|skal hentes igen|kunne ikke opdateres/i);
  assert.deepEqual(during,initial);
  await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-speakers-during-refresh.png')});
 }finally{release();}
 await page.waitForFunction(until=>document.querySelector('pv-widget-host')?.liveOutputs.validUntil>until,
  deadline,{timeout:7000});
 const refreshed=await inspect();
 assert.deepEqual(refreshed,initial);
 for(const [index,node] of nodes.entries()){
  assert.equal(await rows.nth(index).evaluate((row,original)=>row===original,node),true);
 }
 assert.equal(await dialog.isVisible(),true);
 assert.equal((await state()).room,before.room);
 assert.deepEqual((await state()).writes,before.writes);
 assert.equal(requests.length,posts);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'H6',servedBundleSHA,actualLeaseExpiry:true,stableRows:true,
  stableLayout:true,matchedRadioBorderAndSurface:true,retainedSelectedOutput:true,
  currentPlaybackStillConfirmed:true,controlPosts:0,inertFinalService:true};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-speakers-refresh-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function outputTransferJourney(page,errors,{composed=false}={}){
 const output=page.locator('#output'),dialog=page.locator('#rooms'),volume=page.locator('#volume');
 const queue=page.locator('#queue'),rows=queue.locator('button.queue-track[data-current=false]');
 const kitchen={name:'Køkkenalrum HomePod',room:'native-room',homepod:'42'};
 const bedroom={name:'Soveværelse',room:'bedroom',homepod:'43'};
 const observed=(target,song)=>page.waitForFunction(({name,room,homepod,song})=>{
  const p=document.querySelector('pv-widget-host')?.liveMedia.playback;
  const button=document.querySelector('#output');
  return p?.roomBinding?.nativeRoomId===room&&p.roomBinding.nativeHomepodId===homepod
   &&p.item?.name===`Isoleret sang ${song}`&&button?.textContent.includes(name)
   &&button.getAttribute('aria-label')?.includes('Aktuelt output');
 },{...target,song},{timeout:15000});
 const nextPassiveRead=async()=>{
  const after=playbackReads(await state());
  for(let n=0;playbackReads(await state())<=after;n++){
   if(n>=120)throw Error('no subsequent passive playback read');
   await sleep(100);
  }
 };
 const move=async({name},beforeReply)=>{
  if(!await dialog.isVisible())await output.tap();
  const row=dialog.locator('#room-options button').filter({hasText:name});
  const reply=page.waitForResponse(r=>r.url().endsWith('/view/api/control/actions')&&r.request().method()==='POST'
   &&r.request().postDataJSON()?.action==='move_existing_session',{timeout:15000});
  if(beforeReply)await beforeReply(row);
  else await row.tap();
  return (await reply).json();
 };
 let pendingFeedback;
 const measureFirstMove=async row=>{
  const before=await state();
  const requestCount=requests.length;
  await row.evaluate((button,name)=>{
   button.addEventListener('click',event=>{
    if(!event.isTrusted)return;
    const startedAt=performance.now();
    const sample=()=>{
     const output=document.getElementById('output');
     const status=document.getElementById('player-state');
     const room=document.getElementById('player-room');
     const binding=document.querySelector('pv-widget-host')?.liveMedia?.playback?.roomBinding;
     const label=output?.getAttribute('aria-label');
     const elapsedMs=performance.now()-startedAt;
     const visible={visibilityProperty:true,opacityProperty:true};
     if(output?.checkVisibility(visible)&&status?.checkVisibility(visible)&&room?.checkVisibility(visible)
       &&status.textContent==='Skifter til'&&room.textContent===name){
      window.h1PendingFeedback={elapsedMs,label,room:binding?.nativeRoomId,homepod:binding?.nativeHomepodId};
     }else if(elapsedMs<1000)requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
   },{capture:true,once:true});
  },bedroom.name);
  assert((await change({holdMove:true})).ok);
  try{
   await row.tap();
   await page.waitForFunction(()=>window.h1PendingFeedback,undefined,{timeout:2500});
   pendingFeedback=await page.evaluate(()=>window.h1PendingFeedback);
   assert(pendingFeedback.elapsedMs<100,`H1 first visible pending feedback took ${pendingFeedback.elapsedMs} ms`);
   assert.match(pendingFeedback.label,/Valgt: Soveværelse · skifter højttaler · Afventer bekræftelse/);
   assert.doesNotMatch(pendingFeedback.label,/Aktuelt output/);
   assert.deepEqual([pendingFeedback.room,pendingFeedback.homepod],[kitchen.room,kitchen.homepod]);
   let owner;
   for(let n=0;;n++){
    owner=await state();
    if(owner.heldMoveRequestId)break;
    if(n>=60)throw Error('move did not reach the held inert owner');
    await sleep(25);
   }
   assert.deepEqual([owner.room,owner.homepod,owner.song],[kitchen.room,kitchen.homepod,before.song]);
   assert.deepEqual(owner.writes,before.writes,'pending feedback is visible before any owner effect');
   assert.equal(await page.locator('#player-state').innerText(),'Skifter til');
   assert.equal(await page.locator('#player-room').innerText(),bedroom.name);
   assert.equal(await output.getAttribute('aria-label'),pendingFeedback.label);
   const movePosts=requests.slice(requestCount).filter(({body})=>body.action==='move_existing_session');
   assert.equal(movePosts.length,1);
   pendingFeedback.browserRequestId=movePosts[0].body.requestId;
   pendingFeedback.nativeRequestId=owner.heldMoveRequestId;
  }finally{assert((await change({holdMove:false})).ok);}
 };
 const effects=[],destinationRenewals=[];
 const readDestination=()=>page.locator('pv-widget-host').evaluate(host=>{
  const playback=host.liveMedia.playback;
  const binding=playback.roomBinding;
  return {epoch:playback.owner_epoch,bindingId:binding.bindingId,room:binding.nativeRoomId,
   homepod:binding.nativeHomepodId,validUntil:binding.validUntil,observedAt:playback.observedAt};
 });
 for(const [target,percent,song] of [[bedroom,25,22],[kitchen,31,23]]){
  const before=await state();
  const first=target===bedroom;
  const receipt=await move(target,first?measureFirstMove:undefined);
  assert.equal(receipt.outcome,'accepted');
  if(first)assert.equal(receipt.requestId,pendingFeedback.browserRequestId);
  await observed(target,before.song);
  assert.doesNotMatch(await output.getAttribute('aria-label'),/Afventer bekræftelse/);
  const original=await readDestination();
  const beforeRenewal=await state();
  const postsBeforeRenewal=requests.filter(row=>row.url.endsWith('/control/actions')).length;
  assert(original.validUntil*1000>Date.now(),'capture an unexpired destination binding');
  if(target===kitchen&&!composed){
   await page.reload({waitUntil:'domcontentloaded'});
   await testEnv.openOverview(page);
  }
  await observed(target,before.song);
  await page.waitForFunction(original=>{
   const playback=document.querySelector('pv-widget-host')?.liveMedia?.playback;
   const binding=playback?.roomBinding;
   return Date.now()>=original.validUntil*1000&&binding?.bindingId===original.bindingId
    &&binding.nativeRoomId===original.room&&binding.nativeHomepodId===original.homepod
    &&playback.owner_epoch===original.epoch&&Date.parse(playback.observedAt)>Date.parse(original.observedAt)
    &&binding.validUntil*1000>Date.now()&&binding.validUntil>original.validUntil;
  },original,{timeout:20000});
  const renewed=await readDestination(),afterRenewal=await state();
  assert(playbackReads(afterRenewal)>playbackReads(beforeRenewal),'the inert owner served a new playback read');
  assert.deepEqual(afterRenewal.writes,beforeRenewal.writes,'passive renewal has no effects');
  assert.equal(requests.filter(row=>row.url.endsWith('/control/actions')).length,postsBeforeRenewal,
   'passive renewal issues no command');
  destinationRenewals.push({original,renewed,checkedAt:Date.now(),reloaded:target===kitchen&&!composed});
  const transport=page.locator('#play-pause');
  for(const [label,state] of [['Sæt musik på pause','paused'],['Fortsæt musikken','playing']]){
   await page.getByRole('button',{name:label,exact:true}).tap();
   await page.waitForFunction(state=>{
    const host=document.querySelector('pv-widget-host');
    return host?.liveMedia?.playback?.state===state&&!host.liveControls?.musicIntentPending;
   },state,{timeout:15000});
  }
  assert.equal(await transport.getAttribute('aria-label'),'Sæt musik på pause');
  await page.waitForFunction(()=>!document.querySelector('#volume')?.disabled,undefined,{timeout:15000});
  await testEnv.touchRange(page,volume,percent);
  await page.waitForFunction(value=>document.querySelector('pv-widget-host')?.liveControls?.musicMeasurement?.volume
   ===value,percent,{timeout:15000});
  if(!await queue.isVisible())await page.locator('#track').tap();
  await rows.filter({hasText:`Køsang ${song}`}).tap();
  await observed(target,song);
  const added=(await state()).writes.slice(before.writes.length);
  assert.deepEqual(added.map(row=>row.action),['move_existing_session','pause','resume','volume','play_queue_occurrence']);
  assert.equal(added[0].room,target.room);
  if(first)assert.equal(added[0].requestId,pendingFeedback.nativeRequestId);
  for(const row of added.slice(1))assert.deepEqual([row.room,row.homepod],[target.room,target.homepod]);
  assert.equal(added[3].percent,percent);
  assert.equal(added[4].song,song);
  effects.push(added);
 }
 if(composed)return {pendingFeedback,destinationRenewals,effects};

 const failures=[];
 for(const outcome of ['rejected','unknown']){
  const before=await state(),requestsBefore=requests.length;
  assert((await change({nextMoveOutcome:outcome})).ok);
  const receipt=await move(bedroom);
  assert.equal(receipt.outcome,outcome,JSON.stringify(receipt));
  assert.equal(receipt.retryAllowed,false);
  await nextPassiveRead();
  await observed(kitchen,before.song);
  if(!await dialog.isVisible())await output.tap();
  const target=dialog.locator('#room-options button').filter({hasText:bedroom.name});
  await target.waitFor({state:'visible',timeout:10000});
  assert.equal(await target.getAttribute('aria-pressed'),'false');
  assert.doesNotMatch(await target.getAttribute('aria-label'),/Aktuelt output/);
  if(outcome==='unknown'){
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot
    ?.capabilities?.queueSelection===false,undefined,{timeout:10000});
   assert.equal(await rows.and(queue.locator('button:enabled')).count(),0,
    'UNKNOWN transfer leaves no executable queue choice from the old session');
  }
  const after=await state();
  assert.deepEqual(after.writes,before.writes,'failed transfer cannot replay or issue a queued effect');
  assert.equal(after.failedMoveAttempts.length,(before.failedMoveAttempts?.length||0)+1);
  assert.equal(requests.slice(requestsBefore).filter(row=>row.body?.action==='move_existing_session').length,1);
  failures.push({outcome,receipt,attempt:after.failedMoveAttempts.at(-1)});
 }
 assert.deepEqual(errors,[]);
 assert(servedBundleSHA);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',stories:['H1','H5','H8'],servedBundleSHA,pendingFeedback,destinationRenewals,effects,failures,
  inertFinalService:true};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-output-transfer.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function multiScreenJourney(first,errors){
 const url=base+'/view/?room=kitchen';
 const secondContext=await browser.newContext({hasTouch:true,viewport:{width:768,height:1024}});
 await secondContext.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const openSecond=async()=>{
  const page=await secondContext.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
   if(request.url().includes('/control/'))requests.push({url:request.url(),body:request.postDataJSON()});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await testEnv.openOverview(page);
  return page;
 };
 let second=await openSecond();
 assert.notEqual(first.context(),second.context());
 const confirmed=async(page,room,homepod,name,song)=>{
  const result=await page.waitForFunction(({room,homepod,name,song})=>{
   const playback=document.querySelector('pv-widget-host')?.liveMedia?.playback;
   const output=document.querySelector('#output');
   if(playback?.observationStatus!=='observed'||playback.roomBinding?.nativeRoomId!==room||
    playback.roomBinding?.nativeHomepodId!==homepod||playback.item?.name!==song||
    !output?.textContent.includes(name)||!output.getAttribute('aria-label')?.includes('Aktuelt output'))return false;
   return {account:playback.config_entry_id,epoch:playback.owner_epoch,uri:playback.item.uri,room,homepod,song};
  },{room,homepod,name,song},{timeout:15000});
  return result.jsonValue();
 };
 const both=async(room,homepod,name,song)=>{
  const [left,right]=await Promise.all([first,second].map(page=>confirmed(page,room,homepod,name,song)));
  assert.deepEqual(left,right,'independent clients agree on the same source observation');
  return left;
 };
 const start=await both('native-room','42','Køkkenalrum HomePod','Isoleret sang 1');
 await first.locator('#output').tap();
 const reply=first.waitForResponse(response=>response.url().endsWith('/view/api/control/actions')
  &&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='move_existing_session');
 await first.locator('#room-options button').filter({hasText:'Soveværelse'}).tap();
 assert.equal((await (await reply).json()).outcome,'accepted');
 const moved=await both('bedroom','43','Soveværelse','Isoleret sang 1');
 assert.equal(moved.uri,start.uri);
 assert.equal(moved.epoch,start.epoch);
 const target=await state();
 assert.deepEqual(target.writes.map(row=>row.action),['move_existing_session']);
 assert((await change({externalSong:7,externalOutput:'native-room'})).ok);
 const returned=await both('native-room','42','Køkkenalrum HomePod','Isoleret sang 7');
 assert.equal(returned.account,start.account);
 assert.equal(returned.epoch,start.epoch);

 const roomEffects=value=>value.serviceReads.filter(row=>
  /\/(?:prepare_room_|control_room_|move_room_|start_room_)/.test(row.path));
 const baseline=await state(),postsAtBaseline=requests.length;
 const readOnly=async(page,scenario)=>{
  const status=scenario==='occupied'?'account_observed':'unavailable';
  const reason=scenario==='occupied'?'ambiguous_output':'account_unavailable';
  const reply=await page.waitForResponse(async response=>{
   const request=new URL(response.url());
   if(request.pathname!=='/view/api/music'||request.searchParams.get('kind')!=='playback'||!response.ok()){
    return false;
   }
   const body=await response.json();
   return body.status===status&&body.reason===reason;
  },{timeout:15000});
  assert.equal((await reply.json()).binding,null);
  await page.waitForFunction(()=>{
   const host=document.querySelector('pv-widget-host');
   return !host?.liveMedia?.playback?.roomBinding&&
    ['#play-pause','#next','#previous','#volume'].every(selector=>document.querySelector(selector)?.disabled);
  },undefined,{timeout:15000});
  assert.doesNotMatch(await page.locator('#output').getAttribute('aria-label')||'',/Aktuelt output/);
  assert.doesNotMatch(await page.locator('body').innerText(),/Spiller fra en anden konto|Spil her|Sofie/);
 };
 const proof={start,moved,returned,blocked:[]};
 for(const scenario of ['occupied','unknown']){
  const reading=Promise.all([readOnly(first,scenario),readOnly(second,scenario)]);
  assert((await change({externalAuthority:scenario})).ok);
  await reading;
  const refreshing=readOnly(first,scenario);
  await first.reload({waitUntil:'domcontentloaded'});
  await testEnv.openOverview(first);
  await refreshing;
  await second.close();
  // New page in the independent context must not inherit local output custody.
  const reopening=secondContext.waitForEvent('page').then(page=>readOnly(page,scenario));
  second=await openSecond();
  await reopening;
  const current=await state();
  assert.deepEqual(current.writes,baseline.writes);
  assert.deepEqual(roomEffects(current),roomEffects(baseline));
  assert.equal(requests.length,postsAtBaseline);
  proof.blocked.push(scenario);
  await first.screenshot({path:path.join(testEnv.artifactDir(),`podview-two-screens-${scenario}.png`)});
 }
 assert((await change({externalAuthority:null})).ok);
 assert.deepEqual(await both('native-room','42','Køkkenalrum HomePod','Isoleret sang 7'),returned);
 assert.deepEqual((await state()).writes,baseline.writes);
 assert.deepEqual(roomEffects(await state()),roomEffects(baseline));
 assert.equal(requests.length,postsAtBaseline);
 assert.deepEqual(errors,[]);
 const bundle=await fs.readFile(path.join(runtimeRoot,'podvoice/gatekeeper/static/podview/podview.bundle.js'));
 assert.equal(servedBundleSHA,require('node:crypto').createHash('sha256').update(bundle).digest('hex'));
 const result={outcome:'PASS',stories:['H9','H10'],servedBundleSHA,independentContexts:2,
  ...proof,automaticTakeovers:0,ownerEffects:baseline.writes,pageErrors:errors};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-two-screens.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}

async function externalOutputJourney(page,errors,{composed=false}={}){
 const host=page.locator('pv-widget-host');
 const readHomeQueue=async priorTask=>{
  const witness=await page.waitForFunction(prior=>{
   const {playback,queueControls}=document.querySelector('pv-widget-host')?.liveMedia??{};
   const offer=queueControls?.offer,binding=playback?.roomBinding;
   const item=offer?.items.find(row=>row.title==='Køsang 24');
   if(queueControls?.status!=='ready'||!offer||offer.taskId===prior||offer.expiresAt<=Date.now()||
    binding?.nativeRoomId!=='native-room'||binding.nativeHomepodId!=='42'||
    offer.expectedBindingId!==binding.bindingId||offer.ownerEpoch!==playback.owner_epoch||
    offer.accountId!==playback.config_entry_id||!item)return false;
   return {taskId:offer.taskId,bindingId:binding.bindingId,ownerEpoch:offer.ownerEpoch,
    accountId:offer.accountId,room:binding.nativeRoomId,homepod:binding.nativeHomepodId,item};
  },priorTask,{timeout:15000});
  return witness.jsonValue();
 };
 const oldQueue=composed?await readHomeQueue(null):null;
 const before=await state(),initialPosts=requests.length;
 const queueCalls=snapshot=>(snapshot.nativeCalls??[]).filter(row=>['prepare_room_queue','control_room_queue'].includes(row.service));
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
  if(composed)assert.deepEqual(queueCalls(current),queueCalls(before));
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
  if(composed){
   assert.equal(await host.evaluate(h=>h.liveMedia.queueControls.offer),null,'external output revokes the old queue offer');
   assert.equal(await page.locator('#queue button.queue-track[data-current=false]:enabled').count(),0);
  }
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
 assert.equal(await track.innerText(),trackName);
 let renewedQueue;
 if(composed){
  const queue=page.locator('#queue');
  if(!await queue.isVisible())await page.locator('#track').tap();
  renewedQueue=await readHomeQueue(oldQueue.taskId);
  assert.equal(renewedQueue.ownerEpoch,oldQueue.ownerEpoch);
  assert.equal(renewedQueue.accountId,oldQueue.accountId);
  const row=queue.locator('button.queue-track[data-current=false]').filter({hasText:'Køsang 24'});
  const submit=page.waitForRequest(r=>r.url().endsWith('/music/queue/actions')&&r.method()==='POST');
  await row.tap();
  const body=(await submit).postDataJSON();
  assert.equal(body.taskId,renewedQueue.taskId);
  assert.equal(body.optionId,renewedQueue.item.id);
  await page.waitForFunction(uri=>{
   const p=document.querySelector('pv-widget-host')?.liveMedia?.playback;
   return p?.item?.uri===uri&&p.state==='playing'&&p.roomBinding?.nativeRoomId==='native-room'&&
    p.roomBinding?.nativeHomepodId==='42'&&document.querySelector('#track-name')?.textContent==='Isoleret sang 24';
  },renewedQueue.item.uri,{timeout:15000});
 }
 const after=await state();
 assert.deepEqual(after.writes.slice(before.writes.length).map(({action,room,homepod})=>[action,room,homepod]),
  [['pause','native-room','42'],['resume','native-room','42'],
   ...(composed?[['play_queue_occurrence','native-room','42']]:[])]);
 assert.deepEqual(requests.slice(initialPosts).map(row=>row.body?.action),['pause','resume']);
 if(composed){
  const native=queueCalls(after).slice(queueCalls(before).length);
  assert.deepEqual(native.map(({service,args})=>[service,args.room_id,args.homepod_id]),
   [['prepare_room_queue','native-room','42'],['control_room_queue','native-room','42']]);
  assert.equal(native[1].args.args.occurrence_id,renewedQueue.item.id);
  assert.equal(after.song,24);
  return {externalAccountOutputs:['Tesla','iPhone'],outsideRoomControlPosts:0,automaticTakeovers:0,
   oldQueue,renewedQueue,effects:after.writes.slice(before.writes.length)};
 }
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
async function manualRetryJourney(page,errors){
 const host=page.locator('pv-widget-host'),recipe=page.locator('#recipe-view');
 const pause=page.locator('#play-pause'),posts=[],snapshots=[];
 page.on('request',request=>{
  const path=new URL(request.url()).pathname;
  if(request.method()==='POST'&&path.endsWith('/actions'))posts.push(path);
  if(path==='/view/api/snapshot')snapshots.push(request);
 });
 const playback=()=>host.evaluate(h=>{
  const p=h.liveMedia.playback,b=p?.roomBinding;
  return {account:h.liveMedia.account,state:p?.state,uri:p?.item?.uri,bindingId:b?.bindingId,
   room:b?.nativeRoomId,homepod:b?.nativeHomepodId};
 });
 await pause.tap();
 await page.waitForFunction(()=>{
  const h=document.querySelector('pv-widget-host');
  return h?.liveMedia?.playback?.state==='paused'&&!h.liveControls.musicIntentPending;
 });
 const beforePlayback=await playback();
 assert.equal(beforePlayback.state,'paused');
 assert.equal(beforePlayback.homepod,'42');
 assert(beforePlayback.bindingId&&beforePlayback.uri);
 const beforeWrites=(await state()).writes;
 assert.deepEqual(beforeWrites.map(row=>row.action),['pause']);
 assert.equal(posts.length,1);

 await page.locator('#home-recipes').tap();
 await recipe.locator('[data-recipe="Burgerboller"]').tap();
 await recipe.getByRole('button',{name:'Start opskrift',exact:true}).tap();
 await recipe.locator('[data-recipe-layout=ingredients] pv-checklist button').first().tap();
 await recipe.locator('[data-recipe-layout=reading] li button').first().tap();
 await recipe.locator('#recipe-ingredients-trigger').tap();
 const cooking=record=>host.evaluate((h,record)=>{
  const view=h.recipeView,active=view.active,session=view.sessions.get(active);
  if(record)window.retryRecipe={host:h,view,active,session};
  const prior=window.retryRecipe;
  return {sameOwners:prior.host===h&&prior.view===view&&prior.active===active&&prior.session===session,
   title:active.title,steps:[...session.steps],ingredients:[...session.ingredients],
   expanded:session.ingredientsExpanded,focus:h.state.focus};
 },record);
 const beforeRecipe=await cooking(true);
 assert.equal(beforeRecipe.steps.length,1);
 assert.equal(beforeRecipe.ingredients.length,1);
 assert.equal(beforeRecipe.expanded,false);

 const retry=page.locator('#quick-sheet').getByRole('button',{name:'Prøv igen',exact:true});
 await page.locator('#header-ro').tap();
 await page.locator('#screen-device-more-summary').tap();
 const outage=page.waitForResponse(r=>new URL(r.url()).pathname==='/view/api/snapshot'
  &&r.status()===503,{timeout:15000});
 assert((await change({blockRetryTransport:true})).ok);
 await outage;
 await retry.waitFor({state:'visible'});
 assert(await retry.isEnabled());
 const beforeRead=await host.evaluate(h=>({generation:h.liveTransport.generation,
  playbackDeadline:h.liveMedia.playback?.roomBinding?.validUntil??0}));
 await retry.evaluate(button=>button.addEventListener('click',event=>{
  window.trustedManualRetry={trusted:event.isTrusted,online:navigator.onLine};
 },{once:true,capture:true}));
 const endpoint='**/view/api/snapshot?*';
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 let markHeld,timeout;
 const entered=new Promise(resolve=>{markHeld=resolve;});
 await page.route(endpoint,async route=>{
  const manual=await page.evaluate(()=>window.trustedManualRetry?.trusted===true
   &&document.querySelector('pv-widget-host')?.connectionRetryPending===true);
  if(manual){markHeld();await gate;}
  await route.continue();
 });
 try{
  const mark=snapshots.length;
  await retry.tap();
  await Promise.race([entered,new Promise((_,reject)=>{
   timeout=setTimeout(()=>reject(Error('manual Retry did not request a snapshot')),5000);
  })]);
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.connectionRetryPending===true);
  assert.deepEqual(await page.evaluate(()=>window.trustedManualRetry),{trusted:true,online:true});
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.connectionRetry?.getAttribute('aria-busy')==='true');
  assert.deepEqual(await cooking(false),beforeRecipe);
  const success=page.waitForResponse(r=>new URL(r.url()).pathname==='/view/api/snapshot'&&r.ok(),{timeout:10000});
  assert((await change({blockRetryTransport:false})).ok);
  release();
  await success;
  await page.waitForFunction(({generation,playbackDeadline})=>{
   const h=document.querySelector('pv-widget-host');
   return h?.liveTransport?.connected&&h.liveTransport.generation>generation&&!h.connectionRetryPending
    &&h.liveMedia?.playback?.roomBinding?.validUntil>Math.max(Date.now()/1000,playbackDeadline)
    &&!document.getElementById('play-pause').disabled;
  },beforeRead,{timeout:15000});
  assert.equal(snapshots.length-mark,1,'one Retry starts one snapshot read');
 }finally{clearTimeout(timeout);release();}
 await page.locator('#quick-sheet').getByRole('button',{name:'Luk Skærm og enhed'}).tap();
 assert(await recipe.locator('[data-recipe-layout=reading]').isVisible());
 assert.deepEqual(await cooking(false),beforeRecipe);
 assert.deepEqual(await playback(),beforePlayback);
 assert.match(await pause.getAttribute('aria-label'),/Fortsæt/);
 assert.deepEqual((await state()).writes,beforeWrites);
 assert.equal(posts.length,1,'only the earlier explicit Pause was sent');
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 console.log(JSON.stringify({outcome:'PASS',story:'G3',servedBundleSHA,control:'Prøv igen',
  trustedTouch:true,failedSnapshot503:true,manualSnapshotReads:1,sameRecipeProgressAndChoices:true,
  samePausedMusicBinding:true,automaticActionPosts:0,nativeWritesDuringRetry:0,inertFinalService:true}));
}
async function volumeDragJourney(page,errors){
 const slider=page.locator('#volume'),host=page.locator('pv-widget-host');
 const before=await state(),latePercent=23,desired=82;
 const owner=()=>host.evaluate(h=>{
  const p=h.liveMedia.playback,b=p.roomBinding;
  return {epoch:p.owner_epoch,binding:b.bindingId,room:b.nativeRoomId,homepod:b.nativeHomepodId};
 });
 const initialOwner=await owner();
 await page.waitForFunction(percent=>{
  const input=document.getElementById('volume');
  return !input.disabled&&Number(input.value)===percent;
 },before.volume,{timeout:5000});
 await slider.evaluate(input=>{
  const read=()=>({value:Number(input.value),label:document.getElementById('volume-value').textContent,
   progress:input.style.getPropertyValue('--pv-slider-progress'),enabled:!input.disabled});
  const probe=window.volumeDragProbe={read,inputs:[],changes:[],lateFrames:[]};
  input.addEventListener('input',event=>probe.inputs.push({trusted:event.isTrusted,...read()}));
  input.addEventListener('change',event=>probe.changes.push({trusted:event.isTrusted,...read()}));
 });
 const actions=()=>requests.filter(row=>row.url.endsWith('/control/actions'));
 const endpoint='**/view/api/music?**';
 let release,markHeld,holdTimeout,holding=true;
 const gate=new Promise(resolve=>{release=resolve;});
 const held=new Promise(resolve=>{markHeld=resolve;});
 const handler=async route=>{
  if(!holding||new URL(route.request().url()).searchParams.get('kind')!=='playback')return route.continue();
  holding=false;
  const response=await route.fetch();
  markHeld();
  await gate;
  await route.fulfill({response});
 };
 await page.route(endpoint,handler);
 let inputs,lateFrames;
 try{
  const changed=await change({externalVolume:latePercent});
  assert(changed.ok);
  const {sequence}=await changed.json();
  await Promise.race([held,new Promise((_,reject)=>{
   holdTimeout=setTimeout(()=>reject(Error('earlier owner response was not held')),4000);
  })]);
  clearTimeout(holdTimeout);
  assert.equal(Number(await slider.inputValue()),before.volume,'browser still displays the prior owner volume');
  await testEnv.touchRange(page,slider,desired,{beforeRelease:async()=>{
   inputs=await page.evaluate(()=>window.volumeDragProbe.inputs);
   assert.equal(inputs.length,5,'every native move produced one trusted volume sample');
   for(const [index,sample] of inputs.entries()){
    const expected=before.volume+(desired-before.volume)*(index+1)/inputs.length;
    assert(Math.abs(sample.value-expected)<=1,'thumb follows the finger at this move');
    assert(sample.trusted&&sample.enabled);
    assert.equal(sample.label,sample.value+' %');
    assert.equal(sample.progress,sample.value+'%');
    if(index)assert(sample.value>inputs[index-1].value,'each trusted move advances the thumb');
   }
   assert.equal(inputs.at(-1).value,desired);
   assert.deepEqual(actions(),[],'held gesture has sent no action');
   assert.deepEqual((await state()).writes,before.writes);
   assert.equal(await host.evaluate(h=>h.liveMedia.playback.controls.volume.base_percent),before.volume,
    'earlier owner response is still in flight while the gesture is held');
   await page.evaluate(()=>{
    const probe=window.volumeDragProbe;
    const sample=()=>{probe.lateFrames.push(probe.read());probe.frame=requestAnimationFrame(sample);};
    sample();
   });
   release();
   await page.waitForFunction(({sequence,latePercent})=>{
    const p=document.querySelector('pv-widget-host').liveMedia.playback;
    return p.poll_sequence===sequence&&p.controls.volume.base_percent===latePercent;
   },{sequence,latePercent},{timeout:5000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   lateFrames=await page.evaluate(()=>{
    const probe=window.volumeDragProbe;cancelAnimationFrame(probe.frame);return probe.lateFrames;
   });
   assert(lateFrames.length>=3);
   for(const frame of lateFrames){
    assert.deepEqual(frame,{value:desired,label:desired+' %',progress:desired+'%',enabled:true},
     'earlier owner observation must not repaint a held thumb');
   }
   assert.deepEqual(await owner(),initialOwner);
   assert.deepEqual(actions(),[],'late owner observation did not commit the gesture');
  }});
 }finally{
  clearTimeout(holdTimeout);
  release();
  await page.unroute(endpoint,handler);
 }
 await page.waitForFunction(percent=>{
  const h=document.querySelector('pv-widget-host'),p=h.liveMedia.playback;
  return p.controls.volume.base_percent===percent&&!h.liveControls.musicIntentPending
   &&h.liveControls.musicFence?.settlementStatus==='confirmed'&&Number(document.getElementById('volume').value)===percent;
 },desired,{timeout:10000});
 assert.deepEqual(await owner(),initialOwner);
 assert.deepEqual(await page.evaluate(()=>window.volumeDragProbe.changes.map(({trusted,value})=>[trusted,value])),[[true,desired]]);
 assert.deepEqual(actions().map(({body})=>[body.action,body.args.percent]),[['volume',desired]]);
 const writes=(await state()).writes.slice(before.writes.length);
 assert.deepEqual(writes.map(({action,room,homepod,percent})=>({action,room,homepod,percent})),
  [{action:'volume',room:initialOwner.room,homepod:initialOwner.homepod,percent:desired}]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'A4',servedBundleSHA,inputs,latePercent,lateFrames,
  owner:initialOwner,finalPercent:desired,nativeWrites:writes,inertFinalService:true,physicalAudioVerified:false};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-volume-drag.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function renewedControlsJourney(page,errors){
 const host=page.locator('pv-widget-host');
 const original=await host.evaluate(h=>h.liveMedia.playback.roomBinding);
 const initial=await state();
 assert(original.validUntil*1000>Date.now(),'capture a still-current original lease');
 await page.waitForFunction(original=>{
  const h=document.querySelector('pv-widget-host'),binding=h?.liveMedia?.playback?.roomBinding;
  return Date.now()>=original.validUntil*1000&&binding?.bindingId===original.bindingId
   &&binding.validUntil*1000>Date.now()
   &&['play-pause','next','previous','volume'].every(id=>!document.getElementById(id)?.disabled);
 },original,{timeout:20000});
 assert.deepEqual((await state()).writes,initial.writes,'lease renewal never sends a control action');
 const effects=[];
 const cases=[
  {action:'pause',id:'play-pause',label:'Fortsæt musikken',observed:'paused'},
  {action:'resume',id:'play-pause',label:'Sæt musik på pause',observed:'playing'},
  {action:'next',id:'next',song:initial.song+1},
  {action:'previous',id:'previous',song:initial.song},
  {action:'volume',id:'volume',percent:57},
 ];
 for(const expected of cases){
  const {action,id,percent}=expected;
  const control=page.locator('#'+id);
  await control.evaluate((node,{label,percent})=>{
   window.controlRenewalPaint=null;
   const type=percent===undefined?'click':'change';
   document.addEventListener(type,function measure(event){
    if(!event.isTrusted||!node.contains(event.target))return;
    document.removeEventListener(type,measure,true);
    const start=performance.now();
    const frame=()=>{
     const elapsedMs=performance.now()-start;
     const pending=label?node.closest('.transport')?.getAttribute('aria-busy'):node.getAttribute('aria-busy');
     if(pending==='true'&&(!label||node.getAttribute('aria-label')===label)
       &&(percent===undefined||(Number(node.value)===percent&&document.getElementById('volume-value').textContent===percent+' %'))){
      window.controlRenewalPaint={elapsedMs,start};
     }else if(elapsedMs<2000)requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
   },true);
  },expected);
  const before=await state();
  const beforeRead=await host.evaluate(h=>{
   const p=h.liveMedia.playback;
   return {state:p.state,uri:p.item.uri,volume:p.controls.volume.base_percent};
  });
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const endpoint='**/view/api/control/actions';
  const matches=request=>new URL(request.url()).pathname==='/view/api/control/actions'
   &&request.method()==='POST'&&request.postDataJSON()?.action===action;
  const handler=async route=>{
   if(matches(route.request()))await gate;
   await route.continue();
  };
  await page.route(endpoint,handler);
  const sent=page.waitForRequest(matches,{timeout:5000});
  try{
   if(percent===undefined)await control.tap();
   else await testEnv.touchRange(page,control,percent,{beforeRelease:async()=>{
    assert.equal(Number(await control.inputValue()),percent,'volume follows trusted touch before release');
    assert.equal((await state()).writes.length,before.writes.length);
   }});
   await sent;
   await page.waitForFunction(()=>window.controlRenewalPaint!==null,undefined,{timeout:2000});
   const paintMs=await page.evaluate(()=>window.controlRenewalPaint.elapsedMs);
   assert(paintMs<100,`${action} feedback took ${paintMs} ms after trusted input`);
   assert.deepEqual((await state()).writes,before.writes,'feedback paints before the effect request reaches the owner');
   assert.deepEqual(await host.evaluate(h=>{
    const p=h.liveMedia.playback;
    return {state:p.state,uri:p.item.uri,volume:p.controls.volume.base_percent};
   }),beforeRead,'feedback paints while the player still has the previous owner observation');
   if(expected.song!==undefined){
    assert.equal(await page.locator('#track-name').textContent(),`Isoleret sang ${before.song}`);
   }

   const replied=page.waitForResponse(response=>matches(response.request()),{timeout:5000});
   release();
   const response=await replied;
   const receiptMs=await page.evaluate(()=>performance.now()-window.controlRenewalPaint.start);
   assert.equal((await response.json()).outcome,'accepted');
   assert(receiptMs<(expected.song===undefined?1000:1500),`${action} inert receipt took ${receiptMs} ms`);
   await page.waitForFunction(({observed,song,percent})=>{
    const h=document.querySelector('pv-widget-host'),p=h?.liveMedia?.playback;
    return !h?.liveControls?.musicIntentPending
     &&(observed===undefined||p?.state===observed)
     &&(song===undefined||document.getElementById('track-name').textContent===`Isoleret sang ${song}`)
     &&(percent===undefined||p?.controls?.volume?.base_percent===percent);
   },expected,{timeout:10000});
   const observedMs=await page.evaluate(()=>performance.now()-window.controlRenewalPaint.start);
   if(expected.song!==undefined)assert(observedMs<1500,`${action} title took ${observedMs} ms`);
   const writes=(await state()).writes.slice(before.writes.length);
   assert.deepEqual(writes.map(({action,room,homepod})=>({action,room,homepod})),
    [{action,room:original.nativeRoomId,homepod:original.nativeHomepodId}]);
   effects.push({action,paintMs,receiptMs,observedMs});
  }finally{
   release();
   await page.unroute(endpoint,handler);
   await sent.catch(()=>{});
  }
 }
 assert.deepEqual(requests.filter(row=>row.url.endsWith('/control/actions')).map(row=>row.body.action),
  cases.map(row=>row.action),'exactly one browser command per trusted input');
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 console.log(JSON.stringify({outcome:'PASS',story:'A13',servedBundleSHA,realLeaseExpiry:true,
  effects,inertFinalService:true,physicalAudioVerified:false}));
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
 const serverScript=outputTransferMode?'music_selection_e2e_server.py':'music_e2e_server.py';
 server=spawn(testEnv.python,[path.join(__dirname,serverScript)],{cwd:testEnv.runtimeRoot,
  env:testEnv.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,PODVIEW_TEST_NONCE:testNonce}),
  stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server start timeout');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,testNonce,'own isolated Python runtime nonce');
 const browserOptions=testEnv.browserOptions();
 if(multiScreenMode||outputTransferMode)browserOptions.args=['--mute-audio'];
 browser=await chromium.launch(browserOptions);
 const page=await browser.newPage({viewport:{width:1280,height:800},hasTouch:true}),errors=[],diagnosticResponses=[];
 page.on('response',async response=>{
  if(!servedBundleSHA&&response.status()===200&&response.url().endsWith('/podview.bundle.js')){
   servedBundleSHA=require('node:crypto').createHash('sha256').update(await response.body()).digest('hex');
  }
  if(response.url().includes('/client-diagnostics')&&response.request().method()==='POST'){
   diagnosticResponses.push({status:response.status(),body:await response.text().catch(()=>'<unreadable>')});
  }
 });
 if(renewedControlsMode||multiScreenMode||manualRetryMode||volumeDragMode||outputTransferMode)await page.route('**/*',route=>
  new URL(route.request().url()).origin===base?route.continue():route.abort());
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
 if(manualRetryMode){await manualRetryJourney(page,errors);return;}
 if(renewedControlsMode){await renewedControlsJourney(page,errors);return;}
 if(volumeDragMode){await volumeDragJourney(page,errors);return;}
 if(seekMode){await seekJourney(page,errors);return;}
 if(speakerRefreshMode){await speakerRefreshJourney(page,errors);return;}
 if(outputTransferMode&&externalOutputMode){
  const documentOrigin=await page.evaluate(()=>performance.timeOrigin);
  const local=await outputTransferJourney(page,errors,{composed:true});
  const external=await externalOutputJourney(page,errors,{composed:true});
  assert.equal(await page.evaluate(()=>performance.timeOrigin),documentOrigin,'all transitions use one document');
  assert.deepEqual(errors,[]);
  assert(servedBundleSHA);
  if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(servedBundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
  const proof={outcome:'PASS',stories:['H5','H7'],servedBundleSHA,sameDocument:true,local,external,inertFinalService:true};
  await fs.writeFile(path.join(testEnv.artifactDir(),'podview-music-output-roundtrip.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
  return;
 }
 if(outputTransferMode){await outputTransferJourney(page,errors);return;}
 if(multiScreenMode){await multiScreenJourney(page,errors);return;}
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
