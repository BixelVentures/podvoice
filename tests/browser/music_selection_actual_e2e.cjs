'use strict';
// Packaged UI → real Python selection/queue brokers → stateful inert native service.
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const holdPlayback=process.env.MUSIC_HOLD_PLAYBACK==='1';
const loseSelectionReceipt = process.env.MUSIC_UNKNOWN_AFTER_COMMIT === '1';
const queueColdTail = process.env.MUSIC_QUEUE_INTENTS === 'cold-tail';
const queueIntentDuringRefresh = process.env.MUSIC_QUEUE_INTENTS === 'refresh' || queueColdTail;
const queueUnknownUnchanged = process.env.MUSIC_QUEUE_INTENTS === 'unknown-unchanged';
const queueUnknown = process.env.MUSIC_QUEUE_INTENTS === 'unknown' || queueUnknownUnchanged;
const queueIntents = process.env.MUSIC_QUEUE_INTENTS === '1' || queueIntentDuringRefresh || queueUnknown;
const queueJourney = process.env.MUSIC_QUEUE_JOURNEY === '1' || queueIntents;
const defaultSpeakerProof=process.env.MUSIC_DEFAULT_SPEAKER_PROOF==='1';
const discoveryLoading=process.env.MUSIC_DISCOVERY_LOADING_TEST==='1';
const discoveryRevisit=process.env.MUSIC_DISCOVERY_LOADING_TEST==='revisit';
const discoveryCover=process.env.MUSIC_DISCOVERY_LOADING_TEST==='cover';
const cold=defaultSpeakerProof||process.env.MUSIC_COLD_CONTEXT==='1',rejectSetup=process.env.MUSIC_COLD_REJECT==='1',repeatMood=process.env.MUSIC_REPEAT_MOOD==='1',previewRenew=process.env.MUSIC_PREVIEW_RENEW==='1',holdMood=process.env.MUSIC_HOLD_MOOD==='1';
const port=Number(process.env.MUSIC_TEST_PORT||18979),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,page,serverLog='';const errors=[],actions=[],responses=[],moodRenewals=[];let bundleSHA;
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
async function defaultSpeakerJourney(){
 const viewport={width:1194,height:834},controls=[];
 const record=surface=>surface.on('request',request=>{
  if(request.method()==='POST'&&/\/(control|music)\/.*actions$/.test(new URL(request.url()).pathname)){
   controls.push(request.postDataJSON()?.action);
  }
 });
 const modal=surface=>surface.locator('#rooms');
 const row=(surface,name)=>modal(surface).locator('#room-options button').filter({hasText:name});
 const open=async surface=>{
  await surface.locator('#output').tap();
  await modal(surface).waitFor({state:'visible'});
  await row(surface,'Køkkenalrum HomePod').waitFor({state:'visible'});
 };
 await page.setViewportSize(viewport);
 record(page);
 await env.openOverview(page);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveMedia?.readState==='idle',
  undefined,{timeout:15000});
 await open(page);
 const kitchen=row(page,'Køkkenalrum HomePod'),bedroom=row(page,'Soveværelse');
 assert.equal(await kitchen.getAttribute('aria-pressed'),'true');
 assert.equal(await kitchen.locator('.target-status').innerText(),'Valgt');
 assert.equal(await bedroom.getAttribute('aria-pressed'),'false');
 assert.equal(await modal(page).locator('#room-options button[aria-pressed="true"]').count(),1);
 assert.equal((await state()).state,'no_active_playback');
 assert.deepEqual((await state()).writes,[]);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-speaker-default-idle.png')});

 await page.close();
 assert.equal((await (await fetch(base+'/lab/state',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({externalOutput:'bedroom',externalPlaybackState:'playing'}),
 })).json()).room,'bedroom');
 page=await browser.newPage({hasTouch:true,viewport});
 record(page);
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.waitForFunction(()=>{
  const h=document.querySelector('pv-widget-host'),p=h?.liveMedia?.playback;
  return p?.state==='playing'&&p.roomBinding?.nativeRoomId==='bedroom'
   &&document.querySelector('#output')?.textContent.includes('Soveværelse');
 },undefined,{timeout:15000});
 await open(page);
 const active=row(page,'Soveværelse'),standard=row(page,'Køkkenalrum HomePod');
 assert.equal(await active.getAttribute('aria-pressed'),'true');
 assert.equal(await active.locator('.target-status').innerText(),'Aktuelt output');
 assert.equal(await standard.getAttribute('aria-pressed'),'false');
 assert.equal(await standard.locator('.target-status').innerText(),'Standardrum');
 assert.equal(await modal(page).locator('#room-options button[aria-pressed="true"]').count(),1);
 const after=await state();
 assert.equal(after.room,'bedroom');
 assert.equal(after.state,'playing');
 assert.deepEqual(after.writes,[]);
 assert.deepEqual(controls,[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'H4',bundleSHA,viewport,touch:true,
  idleDefault:'Køkkenalrum HomePod',alreadyPlayingOutput:'Soveværelse',
  controlPosts:controls.length,inertOwnerWrites:after.writes.length,inertNativeService:true,pageErrors:errors};
 await fs.writeFile(path.join(env.artifactDir(),'podview-speaker-default-proof.json'),JSON.stringify(proof,null,2));
 await page.screenshot({path:path.join(env.artifactDir(),'podview-speaker-existing-output.png')});
 console.log(JSON.stringify(proof));
}
async function discoveryLoadingJourney(){
 const rows=page.locator('#result-list > button.result'),recent=page.locator('[data-collection=recent]');
 let releaseResponse,markHeld;
 const gate=new Promise(resolve=>{releaseResponse=resolve;}),held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music?**',async route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.get('kind')!=='recent')return route.continue();
  const response=await route.fetch(),body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.data.tracks.length,7);
  markHeld();
  await gate;
  await route.fulfill({response});
 });
 const layout=()=>rows.evaluateAll(nodes=>{
  const list=nodes[0].parentElement,origin=list.getBoundingClientRect();
  return nodes.map(row=>{
   const box=row.getBoundingClientRect(),cover=row.querySelector('.result-art').getBoundingClientRect();
   return {x:Math.round(box.left-origin.left),y:Math.round(box.top-origin.top),
    width:Math.round(box.width),height:Math.round(box.height),
    coverWidth:Math.round(cover.width),coverHeight:Math.round(cover.height)};
  });
 });
 await page.locator('#home-music').tap();
 await recent.tap();
 let loading;
 try{
  await Promise.race([held,sleep(10000).then(()=>{throw Error('recent read not held');})]);
  await page.locator('#result-list[aria-busy="true"]').waitFor();
  await rows.first().waitFor();
  loading=await layout();
 }finally{releaseResponse();}
 await rows.filter({hasText:'Katalogsang 15'}).waitFor({timeout:15000});
 const ready=await layout();
 assert.equal(ready.length,5,'five recent songs fill the initial page');
 assert.deepEqual(loading,ready,'recent loading reserves exactly the geometry of the first five songs');
 assert.deepEqual((await state()).writes,[]);
 assert.deepEqual(actions.filter(action=>!action.url.endsWith('/queue/offer')),[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'F5',bundleSHA,loading,ready,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-loading-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function discoveryRevisitJourney(){
 const recent=page.locator('[data-collection=recent]'),top=page.locator('[data-collection=top]');
 const ready=page.locator('#result-list > button.result[data-option-id]');
 let reads=0,releaseFirst,markHeld;
 const gate=new Promise(resolve=>{releaseFirst=resolve;}),held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music?**',async route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.get('kind')!=='recent'||++reads!==1)return route.continue();
  const response=await route.fetch();
  assert.equal((await response.json()).ok,true);
  markHeld();
  await gate;
  await route.fulfill({response}).catch(()=>{}); // An abandoned browser fetch may already be cancelled.
 });
 await page.locator('#home-music').tap();
 await recent.tap();
 try{
  await Promise.race([held,sleep(10000).then(()=>{throw Error('first recent read not held');})]);
  await top.tap();
  await ready.filter({hasText:'Katalogsang 11'}).waitFor({timeout:10000});
  assert.equal(await ready.count(),3,'the other tab completed while the first read was held');
  await recent.tap();
  await page.waitForFunction(()=>document.querySelector('#result-list')?.getAttribute('aria-busy')==='true'
   ||document.querySelectorAll('#result-list > button[data-option-id]').length===5,undefined,{timeout:3000});
  await ready.filter({hasText:'Katalogsang 15'}).waitFor({timeout:10000});
  assert.equal(reads,2,'returning to an interrupted initial tab starts exactly one new read');
  assert.equal(await ready.count(),5);
  await top.tap();
  assert.equal(await ready.count(),3,'returning to a populated tab retains its rows');
  assert.equal(await page.locator('#result-list [data-empty=true]').count(),0);
 }finally{releaseFirst();}
 assert.deepEqual((await state()).writes,[]);
 assert.deepEqual(actions.filter(action=>!action.url.endsWith('/queue/offer')),[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'F5',bundleSHA,revisitedAbandonedFirstRead:true,reads,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-revisit-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function discoveryCoverJourney(){
 const coverUrl='https://i.scdn.co/image/InertRecentCover';
 await page.route(coverUrl,route=>route.fulfill({contentType:'image/svg+xml',
  body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>'}));
 let reads=0,releaseRefresh,markHeld;
 const gate=new Promise(resolve=>{releaseRefresh=resolve;}),held=new Promise(resolve=>{markHeld=resolve;});
 await page.route('**/view/api/music?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('kind')!=='recent'||++reads!==2)return route.continue();
  const response=await route.fetch(),body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.data.tracks[0].artwork,undefined,'the actual refresh returns no cover for the same item');
  markHeld();
  await gate;
  await route.fulfill({response});
 });
 await page.locator('#home-music').tap();
 await page.locator('[data-collection=recent]').tap();
 const list=page.locator('#result-list'),row=list.locator('button.result').filter({hasText:'Katalogsang 11'});
 const image=row.locator('img.result-art:not([data-content-transition])');
 await page.waitForFunction(url=>[...document.querySelectorAll('#result-list img.result-art')]
  .some(image=>image.getAttribute('src')===url&&image.naturalWidth>0),coverUrl,{timeout:15000});
 const initial=await row.elementHandle();
 await row.evaluate(element=>{
  element.coverTransitions=0;
  new MutationObserver(records=>{
   for(const record of records)for(const node of record.addedNodes){
    if(node.nodeType===Node.ELEMENT_NODE&&node.matches('img[data-content-transition]'))element.coverTransitions++;
   }
  }).observe(element,{childList:true});
 });
 assert.equal(await image.getAttribute('src'),coverUrl);
 await page.getByRole('button',{name:'Se tidligere',exact:true}).tap();
 try{
  await Promise.race([held,sleep(10000).then(()=>{throw Error('cover refresh not held');})]);
  assert.equal(await image.getAttribute('src'),coverUrl);
 }finally{releaseRefresh();}
 await list.locator('button.result').filter({hasText:'Katalogsang 17'}).waitFor({timeout:15000});
 assert.equal(await row.evaluate((current,original)=>current===original,initial),true);
 assert.equal(await image.getAttribute('src'),coverUrl,'missing metadata never resets the accepted cover');
 assert.equal(await image.evaluate(img=>img.naturalWidth),64);
 assert.equal(await row.evaluate(element=>element.coverTransitions),0,'unchanged visible cover never crossfades to itself');
 assert.equal(reads,2);
 assert.deepEqual((await state()).writes,[]);
 assert.deepEqual(actions.filter(action=>!action.url.endsWith('/queue/offer')),[]);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',story:'F9',bundleSHA,retainedCover:true,retainedWithoutCrossfade:true,recentExpanded:7,inertNativeService:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-discovery-cover-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function queuePersistenceJourney(){
 const queue=page.locator('#queue');
 const rows=queue.locator('button.queue-track[data-current="false"]');
 const title=page.locator('#queue-title');
 const open=async()=>page.locator('#track').tap();
 const close=async()=>page.locator('#header-title-action').tap();
 const itemNames=()=>rows.locator('.queue-copy strong').allTextContents();
 const status=async expected=>page.waitForFunction(value=>document.querySelector('#queue').dataset.status===value,
  expected,{timeout:10000});
 const assertNames=async numbers=>assert.deepEqual(await itemNames(),numbers.map(number=>`Køsang ${number}`));
 const assertNoEmpty=async()=>assert.equal(await queue.locator('.queue-empty').count(),0);
 const tapPaints=[];
 async function assertTapPaint(song){
  const title=`Køsang ${song}`;
  await page.waitForFunction(title=>window.queueTapPaints.some(row=>row.title===title),title,{timeout:2000});
  const paint=await page.evaluate(title=>window.queueTapPaints.find(row=>row.title===title),title);
  assert.deepEqual(paint.spinners,[title],'new trusted touch moves the single existing spinner');
  assert(paint.elapsedMs<100,`new selection paint took ${paint.elapsedMs} ms`);
  tapPaints.push(paint);
 }
 const condition=async condition=>{
  assert.equal((await page.request.post(base+'/lab/queue',{data:{condition}})).ok(),true);
 };
 async function holdNext(endpoint,{loseReply=false}={}){
  let markEntered,release;
  const entered=new Promise(resolve=>{markEntered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const handler=async route=>{
   markEntered();
   await gate;
   if(!loseReply)return route.continue();
   if(!queueUnknownUnchanged){
    const response=await route.fetch();
    assert.equal((await response.json()).outcome,'accepted','owner applied the first choice before reply loss');
   }
   await route.fulfill({status:502,json:{error:'inert_queue_receipt_lost'}});
  };
  await page.route(`**/view/api/music/queue/${endpoint}`,handler,{times:1});
  return {wait:async()=>{
   let timer;
   try{
    await Promise.race([entered,new Promise((_,reject)=>{
     timer=setTimeout(()=>reject(Error(`queue ${endpoint} was not requested`)),10000);
    })]);
   }finally{clearTimeout(timer);}
  },release};
 }

 await open();
 await status('ready');
 await assertNames([21,22,23,24]);
 if(queueIntents)await queue.evaluate(node=>{
  window.queueTapPaints=[];
  document.addEventListener('click',event=>{
   const row=event.target.closest?.('button.queue-track[data-current="false"]');
   if(!event.isTrusted||!node.contains(row))return;
   const label=item=>item.querySelector('.queue-copy strong').textContent;
   const title=label(row),started=performance.now();
   requestAnimationFrame(()=>{
    const spinners=[...node.querySelectorAll('button.queue-track')]
     .filter(item=>getComputedStyle(item,'::after').animationName==='pv-music-play-pending')
     .map(label);
    window.queueTapPaints.push({title,elapsedMs:performance.now()-started,spinners});
   });
  },true);
 });
 const stableRow=await rows.filter({hasText:'Køsang 23'}).elementHandle();
 const sourceBefore=await state();
 const command=await holdNext('actions',{loseReply:queueUnknown});
 const postAcceptRead=queueIntentDuringRefresh?await holdNext('offer'):null;
 await queue.evaluate(node=>{
  const list={minimum:Infinity,frames:0,stopped:false};
  window.queueFrameProbe=list;
  const watch=()=>{
   if(list.stopped)return;
   const visible=[...node.querySelectorAll('button.queue-track[data-current="false"]')]
    .filter(row=>row.getClientRects().length>0).length;
   list.minimum=Math.min(list.minimum,visible);
   list.frames++;
   requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
 });
 try{
  await rows.filter({hasText:'Køsang 22'}).tap();
  await command.wait();
  await status('pending');
  await assertNames([21,22,23,24]);
  const pendingRows=rows.and(queue.locator('[aria-busy="true"]'));
  assert.deepEqual(await pendingRows.locator('.queue-copy strong').allTextContents(),['Køsang 22']);
  const spinners=await rows.evaluateAll(items=>items
   .filter(row=>getComputedStyle(row,'::after').animationName==='pv-music-play-pending')
   .map(row=>row.querySelector('.queue-copy strong').textContent));
  assert.deepEqual(spinners,['Køsang 22'],'only the tapped occurrence renders a spinner');
  await assertNoEmpty();
  assert.equal((await state()).writes.length,sourceBefore.writes.length);
  await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-selected-only.png')});
  if(queueIntents&&!queueIntentDuringRefresh){
   const second=rows.filter({hasText:'Køsang 23'});
   assert.equal(await second.isEnabled(),true,'pending queue command must not disable another row');
   await second.tap();
   await assertTapPaint(23);
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);
   assert.equal((await state()).writes.length,sourceBefore.writes.length,'second touch waits behind first');
  }
 }finally{command.release();}
 if(queueUnknown){
  await status('unknown');
  assert.equal(await queue.locator('button[aria-busy="true"]').count(),0,'UNKNOWN clears visible selection');
  assert.equal(await rows.evaluateAll(items=>items.some(
   row=>getComputedStyle(row,'::after').animationName==='pv-music-play-pending',
  )),false);
  assert.match(await page.locator('#playback-status').innerText(),/dit næste valg blev ikke sendt/);
  const unknown=await state(),priorEffects=queueUnknownUnchanged?[]:[22];
  assert.equal(unknown.writes.length,sourceBefore.writes.length+priorEffects.length);
  const initialOffers=actions.filter(row=>row.url.endsWith('/music/queue/offer')).length;
  if(queueUnknownUnchanged){
   assert.equal(unknown.sequence,sourceBefore.sequence,'the existing same-track source is current');
  }else{
   const pushed=await page.request.post(base+'/lab/state',{data:{externalPlaybackState:'playing'}});
   const {sequence}=await pushed.json();
   await page.waitForFunction(sequence=>{
    const h=document.querySelector('pv-widget-host');
    return h?.liveMedia?.playback?.poll_sequence>=sequence;
   },sequence,{timeout:10000});
   await status('ready');
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/offer')).length,initialOffers+1);
  }
  assert.equal(await queue.locator('button[aria-busy="true"]').count(),0);
  assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);
  assert.deepEqual((await state()).queueSelections.map(row=>row.song),priorEffects);
  const deliberate=rows.filter({hasText:'Køsang 24'});
  assert.equal(await deliberate.isEnabled(),true,'a new deliberate choice is possible without reload');
  await deliberate.tap();
  await page.locator('#track-name').filter({hasText:'Isoleret sang 24'}).waitFor({state:'visible',timeout:15000});
  await status('ready');
  const final=await state(),posts=actions.filter(row=>row.url.endsWith('/music/queue/actions'));
  const effectSongs=[...priorEffects,24];
  assert.deepEqual(final.queueSelections.map(row=>row.song),effectSongs);
  assert.equal(posts.length,2);
  assert.notEqual(posts[0].body.taskId,posts[1].body.taskId);
  assert.notEqual(posts[0].body.requestId,posts[1].body.requestId);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{window.queueFrameProbe.stopped=true;});
  const proof={outcome:'PASS',bundleSHA,unknownQueueReply:true,visibleSpinnerCleared:true,tapPaints,
   effectSongs,recoveryWithoutReload:true,explicitReadBeforeNewPoll:queueUnknownUnchanged,
   inertNativeService:true,pageErrors:errors};
  if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
  await fs.writeFile(path.join(env.artifactDir(),'podview-queue-unknown-proof.json'),JSON.stringify(proof,null,2));
  await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-unknown.png')});
  console.log(JSON.stringify(proof));
  return;
 }
 let secondCommand;
 if(postAcceptRead){
  try{
   await postAcceptRead.wait();
   await status('loading');
   await page.locator('#track-name').filter({hasText:'Isoleret sang 22'}).waitFor({state:'visible'});
   const second=rows.filter({hasText:'Køsang 23'});
   assert.equal(await second.isEnabled(),true,'an accepted command does not lock another row during refresh');
   if(queueColdTail)secondCommand=await holdNext('actions');
   await second.tap();
   await assertTapPaint(23);
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);
   assert.equal((await state()).writes.length,sourceBefore.writes.length+1,'second touch needs the new offer');
  }finally{postAcceptRead.release();}
 }
 if(secondCommand){
  try{
   await secondCommand.wait();
   await status('pending');
   await assertNames([21,22,23,24]);
   const third=rows.filter({hasText:'Køsang 24'});
   assert.equal(await third.isEnabled(),true,'fresh exact surviving row stays tappable with a cold tail');
   for(const removed of [21,22])assert.equal(await rows.filter({hasText:`Køsang ${removed}`}).isEnabled(),false);
   assert.equal(await rows.filter({hasText:'Køsang 23'}).getAttribute('aria-busy'),'true');
   assert.equal(await queue.getByText('Nummer i køen').count(),0,'unknown tail cannot invent a visible row');
   await third.tap();
   await assertTapPaint(24);
   assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,2);
   assert.equal((await state()).writes.length,sourceBefore.writes.length+1,'new touch waits behind row 23');
   await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-intents-cold-tail.png')});
  }finally{secondCommand.release();}
 }
 if(queueIntents){
  const expectedOrder=queueColdTail?[22,23,24]:[22,23];
  await page.locator('#track-name').filter({hasText:`Isoleret sang ${expectedOrder.at(-1)}`})
   .waitFor({state:'visible',timeout:15000});
  await status('ready');
  await assertNames(queueColdTail?[25]:[24]);
  const value=await state();
  const posts=actions.filter(row=>row.url.endsWith('/music/queue/actions'));
  const seenTasks=posts.map(row=>row.body.taskId),seenRequests=posts.map(row=>row.body.requestId);
  assert.equal(posts.length,expectedOrder.length);
  assert.equal(new Set(seenTasks).size,expectedOrder.length,'each later touch uses a fresh broker task');
  assert.equal(new Set(seenRequests).size,expectedOrder.length,'one identity per explicit choice');
  assert.deepEqual(value.queueSelections.map(({song,index})=>[song,index]),
   expectedOrder.map((song,index)=>[song,index===0?1:0]));
  assert.equal(value.writes.length,sourceBefore.writes.length+expectedOrder.length);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{window.queueFrameProbe.stopped=true;});
  const proof={outcome:'PASS',bundleSHA,queueIntentOrder:expectedOrder,freshTasks:seenTasks.length,queueIntentDuringRefresh,queueColdTail,
   tapPaints,fixturePreservedOpaqueOccurrenceIds:true,inertNativeService:true,pageErrors:errors};
  if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
  await fs.writeFile(path.join(env.artifactDir(),'podview-queue-intents-proof.json'),JSON.stringify(proof,null,2));
  await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-intents.png')});
  console.log(JSON.stringify(proof));
  return;
 }
 await page.locator('#track-name').filter({hasText:'Isoleret sang 22'}).waitFor({state:'visible',timeout:15000});
 await status('ready');
 await assertNames([23,24]);
 const frameProbe=await page.evaluate(()=>{
  const probe=window.queueFrameProbe;
  probe.stopped=true;
  return {minimum:probe.minimum,frames:probe.frames};
 });
 assert(frameProbe.frames>0&&frameProbe.minimum>=2,'queue never paints an empty frame while advancing');
 // This inert fixture keeps opaque IDs stable across advancement; the native owner must
 // independently prove continuity before the same node can be expected on the live route.
 assert.equal(await stableRow.evaluate(row=>row.isConnected&&row.querySelector('.queue-order').textContent==='1'),
  true,'fixture-preserved occurrence moves to the first position on the same DOM row');
 await assertNoEmpty();
 assert.equal(await queue.locator('button[aria-busy="true"]').count(),0);
 const afterChoice=await state();
 assert.deepEqual(afterChoice.queueSelections.map(({song,index})=>[song,index]),[[22,1]]);
 assert.equal(actions.filter(row=>row.url.endsWith('/music/queue/actions')).length,1);

 // A new real queue offer fails on the service side while reopening same-session display custody.
 await condition('failed');
 const failedRead=await holdNext('offer');
 try{
  await close();
  await open();
  await failedRead.wait();
  await status('loading');
  await assertNames([23,24]);
  await assertNoEmpty();
  assert.equal(await stableRow.evaluate(row=>row.isConnected&&row.getClientRects().length>0),true);
 }finally{failedRead.release();}
 await status('error');
 await assertNames([23,24]);
 await assertNoEmpty();
 assert.equal(await title.innerText(),'Køen kunne ikke hentes');
 assert.equal(await stableRow.evaluate(row=>row.isConnected),true);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-queue-refresh-failed.png')});

 // A separate actual owner observation with zero upcoming rows is authoritative empty.
 await condition('empty');
 const emptyRead=await holdNext('offer');
 try{
  await close();
  await open();
  await emptyRead.wait();
  await status('loading');
  await assertNames([23,24]);
  await assertNoEmpty();
 }finally{emptyRead.release();}
 await status('ready');
 await assertNames([]);
 assert.equal(await queue.locator('.queue-empty').innerText(),'Ingen sange i køen.');
 assert.equal(await queue.locator('button[data-current="true"] strong').innerText(),'Isoleret sang 22');
 assert.equal((await state()).writes.length,sourceBefore.writes.length+1);
 assert.deepEqual(errors,[]);
 if(process.env.MUSIC_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.MUSIC_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',stories:['K2','K5','K7'],bundleSHA,frameProbe,
  selectedOccurrence:22,retainedAfterFailure:[23,24],authoritativeEmpty:true,
  sameSessionReopen:true,fixturePreservedOpaqueOccurrenceIds:true,inertNativeService:true,pageErrors:errors};
 await fs.writeFile(path.join(env.artifactDir(),'podview-queue-persistence-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
(async()=>{try{
 const nonce=require('node:crypto').randomUUID();
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-selection-'));
 server=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:"1",MUSIC_COLD_CONTEXT:cold?"1":"0",MUSIC_COLD_REJECT:rejectSetup?"1":"0",MUSIC_REPEAT_MOOD:repeatMood?"1":"0",MUSIC_QUEUE_JOURNEY:queueJourney?"1":"0",MUSIC_QUEUE_COLD_TAIL:queueColdTail?"1":"0",PODVIEW_TEST_NONCE:nonce}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('startup');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,nonce,'own inert runtime');
 browser=await chromium.launch(env.browserOptions());
 page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/podview.bundle.js'))bundleSHA=createHash('sha256').update(await r.body()).digest('hex');if(r.url().includes('/music/selection/')||r.url().includes('/music/queue/')||cold&&r.url().includes('/music?')&&new URL(r.url()).searchParams.get('kind')==='mood')responses.push({url:r.url(),status:r.status(),body:await r.text()})});
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/music/'))actions.push({url:r.url(),body:r.postDataJSON(),traceHeader:r.headers()['x-podview-trace']});if(previewRenew&&r.method()==='GET'&&r.url().includes('/music?')){const url=new URL(r.url());if(url.searchParams.get('kind')==='mood'&&url.searchParams.get('renew')==='1')moodRenewals.push(r.headers()['x-podview-trace']);}});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 if(defaultSpeakerProof){await defaultSpeakerJourney();return;}
 if(cold){
  const initial=await (await page.request.get(base+'/view/api/music?kind=playback&account=account&include_controls=1')).json();
  assert.equal(initial.ok,true);assert.equal(initial.status,'idle');
  assert.equal(initial.data.playback.state,'no_active_playback');assert.equal(initial.data.playback.target,null);assert.equal(initial.data.playback.item,null);
  const snapshot=await (await page.request.get(base+'/view/api/snapshot')).json();assert.equal(snapshot.voice.active,false);assert.equal(snapshot.voice.phase,'IDLE');assert.equal(snapshot.voice.sessionId,null);assert.equal(snapshot.admission.kind,'ha_ingress');assert.equal(snapshot.voice.turnId,null);for(const key of ['taskId','inputRevision','providerGeneration'])assert.equal(Object.hasOwn(snapshot.voice,key),false);for(const key of ['sessionId','turnId','taskId','inputRevision'])assert.equal(snapshot.answers[key],null);assert.deepEqual(snapshot.capabilities.musicActions,[]);assert.equal(snapshot.mediaRoomBindings.length,1);
  const targets=await (await page.request.get(base+'/view/api/music?kind=targets&account=account')).json();assert.deepEqual(targets.data.targets,[]);
  let previewArmed=false,initialMood=true,holdArmed=false,releaseMood,markHeld;const heldMood=new Promise(resolve=>{markHeld=resolve;}),moodGate=new Promise(resolve=>{releaseMood=resolve;});
  if(holdMood)await page.route('**/view/api/music?**',async route=>{const url=new URL(route.request().url());if(!holdArmed||url.searchParams.get('kind')!=='mood'||url.searchParams.get('renew')!=='1')return route.continue();holdArmed=false;const response=await route.fetch();markHeld();await moodGate;await route.fulfill({response});});
  if(previewRenew)await page.route('**/view/api/music?**',async route=>{const url=new URL(route.request().url());if(url.searchParams.get('kind')!=='mood'||!initialMood&&!previewArmed)return route.continue();const response=await route.fetch(),body=await response.json();assert.equal(body.ok,true);assert.ok(body.candidateSet,'actual owner supplied playlist source');const tracks=body.data.tracks.map(({uri,name,artist,themeId,themeTitle,themeArt,artwork})=>({uri,name,artist,themeId,themeTitle,themeArt,...(artwork?{artwork}:{})}));const preview={ok:true,schema:'podview.mood-preview.v1',preview:{readOnly:true,bootId:snapshot.bootId,roomId:snapshot.roomId,configEntryId:'account',ownerEpoch:body.data.owner_epoch,source:'spotify_web_api',expiresIn:60,voiceSessionId:snapshot.voice.sessionId,voiceTurnId:snapshot.voice.turnId},data:{config_entry_id:'account',owner_epoch:body.data.owner_epoch,source:'spotify_web_api',tracks}};initialMood=false;previewArmed=false;await route.fulfill({response,json:preview});});
  await env.openOverview(page);await page.locator('#home-music').tap();
  await page.locator('#output').tap();await page.locator('#room-options button').filter({hasText:'Køkkenalrum HomePod'}).tap();
  const row=page.locator('#result-list button.result').filter({hasText:'Kold jazz'}).first();await row.waitFor({state:'visible',timeout:20000});await row.tap();
  if(rejectSetup){
   await page.locator('#player-empty').getByText('Højttaleren i rummet kan ikke bruges lige nu.',{exact:true}).waitFor({state:'visible',timeout:15000});
   await sleep(1700);assert(await page.locator('#player-empty').getByText('Højttaleren i rummet kan ikke bruges lige nu.',{exact:true}).isVisible(),'setup failure survives normal snapshot');
  }else{
   await page.locator('#track-name').filter({hasText:'Isoleret sang 11'}).waitFor({state:'visible',timeout:15000});
   await page.waitForFunction(()=>document.querySelector('#play-pause')?.disabled===false,undefined,{timeout:15000});
  }
  const value=await state(),commits=value.nativeCalls.filter(r=>r.service==='start_room_selected_content'),prepares=value.nativeCalls.filter(r=>r.service==='prepare_room_selected_content');
  assert.equal(commits.length,rejectSetup?0:1);assert.equal(prepares.length,rejectSetup?0:1);assert.equal(value.selections.length,rejectSetup?0:1);
  const mood=responses.map(r=>{try{return JSON.parse(r.body)}catch{return null}}).find(r=>r?.candidateSet?.sourceKind==='mood');assert(mood,'real Python mood source');
  if(!rejectSetup){const args=commits[0].args;assert.equal(args.args.context_uri,mood.data.tracks[0].uri);assert.equal(args.action,'play_context');assert(actions.find(r=>r.url.endsWith('/music/selection/setup'))?.body.target.speakerId,'actual selected alias forwarded to owner');assert.match(args.args.context_uri,/^spotify:playlist:[a-z0-9]{22}$/);assert.equal(args.room_id,'native-room');assert.equal(args.homepod_id,'42');assert.equal(args.target_id,'device');assert.deepEqual(args.args,{context_uri:args.args.context_uri,max_volume:100});assert.equal(value.state,'playing');assert.equal(value.volume,35);assert.equal(args.start_offer.start_volume_percent,35);assert.equal(value.writes.length,1);}
  if(rejectSetup){assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/setup')).length,1);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,0);assert.equal(value.writes.length,0);}
  // Read existing diagnostics only; never inject product state or force upload.
  const setupRequests=actions.filter(r=>r.url.endsWith('/music/selection/setup'));
  const actionRequests=actions.filter(r=>r.url.endsWith('/music/selection/actions'));
  assert.equal(setupRequests.length,1);const traceId=setupRequests[0].traceHeader;
  assert.match(traceId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(Object.hasOwn(setupRequests[0].body,'requestId'),false,'setup body stays closed; trace is optional metadata');
  const traceRef=createHash('sha256').update(traceId).digest('hex').slice(0,16);
  if(!rejectSetup){assert.equal(actionRequests.length,1);assert.equal(actionRequests[0].traceHeader,traceId);assert.equal(actionRequests[0].body.requestId,traceId);}
  const local=await page.locator('pv-widget-host').evaluate(h=>h.liveTransport.diagnostics());
  const intent=local.records.filter(r=>r.stage==='control_intent'&&r.code==='start'&&r.domain==='music');
  assert.equal(intent.length,1);assert.equal(intent[0].requestId,traceId,'one UUID minted at actual card tap');
  const localSetup=local.records.find(r=>r.stage==='request'&&r.endpoint==='music/selection/setup'&&r.code==='start'&&r.requestId===traceId);
  assert(localSetup&&intent[0].seq<localSetup.seq,'intent is recorded before setup starts');
  const parseServer=()=>serverLog.split('\n').flatMap(line=>{
   const match=line.match(/\b(selected_trace|selected_start_prepare|selected_start_commit|selected_start_receipt)\s/);if(!match)return [];
   const fields={marker:match[1]};for(const [,key,value]of line.matchAll(/\b(trace_ref|request_ref|stage|outcome|state|error_class|error_kind|accepted|native_identity_match|possible_send|prepared|poll_floor|elapsed_ms)=([A-Za-z0-9_.:-]+)/g))fields[key]=value;
   return fields.trace_ref===traceRef?[fields]:[];
  });
  const serverTrace=parseServer(),setupTrace=serverTrace.filter(r=>r.marker==='selected_trace'&&r.stage==='setup');
  assert.equal(setupTrace.length,1);assert.equal(setupTrace[0].outcome,rejectSetup?'native_unavailable':'accepted');
  if(rejectSetup){assert.equal(serverTrace.filter(r=>r.marker.startsWith('selected_start_')||r.stage==='action').length,0);}
  else{
   for(const marker of ['selected_start_prepare','selected_start_commit','selected_start_receipt'])assert.equal(serverTrace.filter(r=>r.marker===marker).length,1);
   assert(serverTrace.some(r=>r.marker==='selected_trace'&&r.stage==='selection'&&r.outcome==='send_started'));
   assert(serverTrace.some(r=>r.marker==='selected_trace'&&r.stage==='action'&&r.outcome==='accepted'));
   const nativeRefs=serverTrace.filter(r=>r.marker.startsWith('selected_start_')).map(r=>r.request_ref);assert.equal(new Set(nativeRefs).size,1);assert.match(nativeRefs[0],/^[a-f0-9]{16}$/);
  }
  assert(!serverLog.includes(traceId),'server logger never prints browser UUID');
  const expected=[['control_intent','start'],['control_intent',rejectSetup?'rejected':'accepted'],['request',rejectSetup?'http_error':'ok','music/selection/setup'],...(!rejectSetup?[['request','ok','music/selection/actions'],['control_action','accepted']]:[])];
  let journalRows=[];
  for(let attempt=0;attempt<21;attempt++){
   let after=0;const rows=[];for(let pageIndex=0;pageIndex<8;pageIndex++){
    const response=await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after);if(response.status()===429)break;assert.equal(response.status(),200);
    const body=await response.json();rows.push(...body.records);if(!body.hasMore)break;after=body.nextAfter;
   }
   journalRows=rows.filter(r=>r.row.requestRef===traceRef);
   if(expected.every(([stage,code,endpoint])=>journalRows.some(r=>r.row.stage===stage&&r.row.code===code&&(!endpoint||r.row.endpoint===endpoint))))break;
   if(attempt<20)await sleep(3000);
  }
  for(const [stage,code,endpoint]of expected)assert(journalRows.some(r=>r.row.stage===stage&&r.row.code===code&&(!endpoint||r.row.endpoint===endpoint)),`persisted same trace_ref ${stage}/${code}/${endpoint||''}`);
  const traceWitness={bundleSHA,traceRef,intentBeforeSetup:true,oneUuidAcrossSetupAndAction:!rejectSetup,setupBodyUnchanged:true,serverTrace,journal:journalRows.map(({serverSeq,row})=>({serverSeq,...row})),effectCount:value.writes.length};
  // Only closed, hashed trace facts enter this receipt; headers/UUIDs stay in memory.
  await fs.writeFile(path.join(env.artifactDir(),'cold-trace-'+(rejectSetup?'rejected':'observed')+'.json'),JSON.stringify(traceWitness,null,2));
  const terminalSnapshot=await (await page.request.get(base+'/view/api/snapshot')).json();assert.deepEqual(terminalSnapshot.voice,snapshot.voice);assert.deepEqual(terminalSnapshot.mediaRoomBindings,snapshot.mediaRoomBindings);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(env.artifactDir(),'podview-cold-context-'+(rejectSetup?'rejected':'observed')+'.png')});
  await fs.writeFile(path.join(env.artifactDir(),'cold-context-'+(rejectSetup?'rejected':'observed')+'.json'),JSON.stringify({runtimeNonceVerified:true,bundleSHA,initialStatus:initial.status,voice:snapshot.voice,terminalVoice:terminalSnapshot.voice,trace:traceWitness,service:{state:value.state,prepareCount:prepares.length,commitCount:commits.length,effectCount:value.writes.length},visible:await page.locator('body').innerText()},null,2));
  if((repeatMood||previewRenew)&&!rejectSetup){
   await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveSelection?.feedback?.settlementStatus==='confirmed'&&h.liveMedia?.playback?.state==='playing'&&!h.liveControls?.musicIntentPending&&!h.liveSelection.pending;},undefined,{timeout:15000});
   await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-before-pause.png')});
   await page.locator('#play-pause').tap();
   await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveMedia?.playback?.state==='paused'&&!h.liveControls?.musicIntentPending&&document.querySelector('#play-pause')?.getAttribute('aria-label')==='Fortsæt musikken';},undefined,{timeout:15000});
   assert.equal((await state()).state,'paused');await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-after-pause.png')});const firstUri=value.selections[0].uri,second=mood.data.tracks.find(track=>track.uri!==firstUri);assert(second?.themeTitle,'a genuinely different displayed mood playlist exists');
   const holdOldItem=async expected=>{
    let staleShown,release;
    const stale=new Promise(resolve=>{staleShown=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const old=(await (await page.request.get(base+'/view/api/music?kind=playback&account=account&include_controls=1')).json()).data.playback;
    let usedOld=false;
    const handler=async route=>{
     const url=new URL(route.request().url());
     if(url.searchParams.get('kind')!=='playback')return route.continue();
     const response=await route.fetch(),body=await response.json();
     if(body.data?.playback?.item?.name!==expected)return route.fulfill({response,json:body});
     if(!usedOld){usedOld=true;body.data.playback=old;await route.fulfill({response,json:body});staleShown();return;}
     await gate;return route.fulfill({response,json:body});
    };
    await page.route('**/view/api/music?**',handler);
    return {stale,release,remove:()=>page.unroute('**/view/api/music?**',handler)};
   };
   const playlistHold=holdPlayback?await holdOldItem('Isoleret sang 12'):null;
   const secondRow=page.locator('#result-list button.result').filter({hasText:second.themeTitle});await secondRow.waitFor({state:'visible',timeout:15000});if(previewRenew)previewArmed=true;if(holdMood)holdArmed=true;await secondRow.tap();
   if(holdMood){await Promise.race([heldMood,sleep(10000).then(()=>{throw Error('actual second mood response not held');})]);const before=await page.locator('pv-widget-host').evaluate(h=>({readAt:h.liveTransport.acceptedReadAt,boot:h.liveSnapshot.bootId,room:h.liveSnapshot.roomId,voice:JSON.stringify(h.liveSnapshot.voice),binding:JSON.stringify(h.liveSnapshot.mediaRoomBindings),focus:h.state.focus}));await page.waitForFunction(readAt=>document.querySelector('pv-widget-host')?.liveTransport?.acceptedReadAt>readAt,before.readAt,{timeout:5000});const after=await page.locator('pv-widget-host').evaluate(h=>({readAt:h.liveTransport.acceptedReadAt,boot:h.liveSnapshot.bootId,room:h.liveSnapshot.roomId,voice:JSON.stringify(h.liveSnapshot.voice),binding:JSON.stringify(h.liveSnapshot.mediaRoomBindings),focus:h.state.focus}));assert.deepEqual({...after,readAt:0},{...before,readAt:0},'same-owner natural SSE arrived while actual renewal response held');const held=await page.locator('pv-widget-host').evaluate(h=>({pending:!!h.liveSelection.recovery,metadata:h.liveSelection.pendingPlayer()?.title??null}));assert.equal(held.pending,true,'explicit choice remains pending after normal SSE');assert(held.metadata,'selected metadata remains visible during renewal');assert.deepEqual((await state()).writes.map(row=>row.action),['play_context','pause'],'no second effect before renewal response');assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/setup')).length,1,'no second setup before renewal response');console.log('HELD_MOOD_SNAPSHOT',JSON.stringify({received:true,sameOwner:true,focus:after.focus,pending:true,metadataRetained:true,noSecondEffect:true}));releaseMood();}
   if(previewRenew){const feedback=page.locator('#player-state');await feedback.waitFor({state:'visible',timeout:15000});await page.waitForFunction(()=>document.querySelector('#player-state')?.textContent==='Musikvalget fejlede · prøv igen.',undefined,{timeout:15000});const readAt=await page.locator('pv-widget-host').evaluate(h=>h.liveTransport.acceptedReadAt);await page.waitForFunction(at=>document.querySelector('pv-widget-host')?.liveTransport?.acceptedReadAt>at,readAt,{timeout:5000});assert.equal(await feedback.textContent(),'Musikvalget fejlede · prøv igen.','preview feedback survives normal SSE');const denied=await state();assert.equal(denied.state,'paused');assert.equal(denied.selections.length,1);assert.deepEqual(denied.writes.map(row=>row.action),['play_context','pause']);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,1);const terminal=await page.locator('pv-widget-host').evaluate(h=>h.liveTransport.diagnostics().records.filter(row=>row.stage==='control_intent'&&row.code==='renewal_readonly').at(-1));assert(terminal?.requestId,'explicit readonly branch emits its actual intent reason');assert.equal(moodRenewals.at(-1),terminal.requestId,'same touch UUID correlates the explicit renewal read');const renewalRef=createHash('sha256').update(terminal.requestId).digest('hex').slice(0,16);await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-preview-feedback.png')});const feedbackGeometry=[];const feedbackState=async stage=>console.log('FEEDBACK_STATE',stage,JSON.stringify(await page.locator('pv-widget-host').evaluate(h=>{const v=h.liveSelection,t=v?.resultTicket,d=document;return {message:v?.feedback?.message??null,scopeCurrent:v?.resultCurrent?.(t)??null,ticket:!!t,scopeEqual:t?.scope===v?.feedbackScope?.(),focusTicket:d.activeElement===t?.focus,focusBody:d.activeElement===d.body,activeTag:d.activeElement?.tagName,visible:d.visibilityState,view:h.state?.focus,playerText:d.querySelector('#player-state')?.textContent,sourcePresent:!!v?.source,connected:h.liveTransport?.connected};})));for(const [width,height]of [[980,800],[768,1024]]){await feedbackState('before-'+width);await page.setViewportSize({width,height});await feedbackState('after-resize-'+width);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));});await feedbackState('after-animation-'+width);const geometry=await feedback.evaluate(node=>{const r=document.createRange();r.selectNodeContents(node);const text=r.getBoundingClientRect(),box=node.getBoundingClientRect(),player=node.closest('.player').getBoundingClientRect(),style=getComputedStyle(node);return {text:{left:text.left,right:text.right,top:text.top,bottom:text.bottom},box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},player:{left:player.left,right:player.right,top:player.top,bottom:player.bottom},scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,whiteSpace:style.whiteSpace};});feedbackGeometry.push({width,height,...geometry});console.log('FEEDBACK_GEOMETRY',JSON.stringify({width,height,...geometry}));await page.screenshot({path:path.join(env.artifactDir(),`podview-mood-preview-feedback-${width}.png`)});assert(geometry.text.left>=geometry.player.left-1&&geometry.text.right<=geometry.player.right+1&&geometry.text.top>=geometry.player.top-1&&geometry.text.bottom<=geometry.player.bottom+1,`feedback text stays in player at ${width}`);assert(geometry.scrollWidth<=geometry.clientWidth+1,`feedback is not horizontally clipped at ${width}`);}let persisted=null,mirrored=false,moodLogged=false;for(let attempt=0;attempt<21;attempt++){let after=0;for(let pageIndex=0;pageIndex<8;pageIndex++){const response=await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after);if(response.status()===429)break;assert.equal(response.status(),200);const body=await response.json();persisted=body.records.find(item=>item.row.stage==='control_intent'&&item.row.code==='renewal_readonly'&&item.row.requestRef===renewalRef)||persisted;if(!body.hasMore)break;after=body.nextAfter;}const lines=serverLog.split('\n');moodLogged=lines.some(line=>line.includes('mood_result ')&&line.includes('response=full')&&line.includes('trace_ref='+renewalRef));mirrored=!!persisted&&lines.some(line=>line.includes('client_diagnostics source=client ')&&line.includes('seq='+persisted.row.seq+' ')&&line.includes('requestRef='+renewalRef+' ')&&line.includes('code=renewal_readonly'));if(persisted&&moodLogged&&mirrored)break;if(attempt<20)await sleep(3000);}assert(persisted,'readonly terminal durably stored');assert(moodLogged,'original owner full response correlated before local preview fixture');assert(mirrored,'stored terminal mirrored once to owner log');const previewProof={outcome:'PASS',bundleSHA,explicitPreviewFeedback:true,visible:true,noNewAction:true,paused:true,readTraceRef:renewalRef,ownerResponse:'full',fixtureResponse:'preview',durableTerminal:true,serverMirror:true,feedbackGeometry,pageErrors:errors};await fs.writeFile(path.join(env.artifactDir(),'podview-mood-preview-feedback.json'),JSON.stringify(previewProof,null,2));console.log(JSON.stringify(previewProof));return;}
   if(holdPlayback){
    try{
     await Promise.race([playlistHold.stale,sleep(10000).then(()=>{throw Error('No held playback transition');})]);
     await page.waitForFunction(title=>document.querySelector('#track-name')?.textContent===title,second.name,{timeout:8000});
     await page.waitForFunction(()=>document.querySelector('#cover')?.getAttribute('src')?.includes('kitchen'),undefined,{timeout:4000});
     await page.screenshot({path:path.join(env.artifactDir(),'podview-playlist-during-old-read.png')});
    }finally{playlistHold.release();}
   }
   for(let n=0;(await state()).selections.length<2;n++){if(n>150)throw Error('second explicit mood selection has no native effect');await sleep(100);}
   await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveSelection?.feedback?.settlementStatus==='confirmed'&&h.liveMedia?.playback?.state==='playing'&&h.liveMedia.playback.item?.name==='Isoleret sang 12'&&!h.liveControls?.musicIntentPending&&!h.liveSelection.pending;},undefined,{timeout:15000});
   const repeated=await state();if(holdPlayback)await page.locator('#track-name').filter({hasText:'Isoleret sang 12'}).waitFor({state:'visible',timeout:15000});assert.equal(repeated.selections.length,2);assert.equal(repeated.selections[1].uri,second.uri);assert.notEqual(repeated.selections[1].requestId,repeated.selections[0].requestId);assert.deepEqual(repeated.writes.map(row=>row.action),['play_context','pause','play_context']);assert.equal(actions.filter(r=>r.url.endsWith('/music/selection/actions')).length,2);assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(env.artifactDir(),'podview-mood-after-second-selection.png')});const repeatProof={outcome:'PASS',bundleSHA,repeatMood:true,firstObserved:true,pauseObserved:true,secondDistinctPlaylistObserved:true,effects:repeated.writes.map(row=>row.action),oneEffectPerInput:true,pageErrors:errors};await fs.writeFile(path.join(env.artifactDir(),'podview-mood-repeat.json'),JSON.stringify(repeatProof,null,2));console.log(JSON.stringify(repeatProof));
   if(holdPlayback){
    await playlistHold.remove();
    await page.locator('[data-collection="recent"]').tap();
    const recent=page.locator('#result-list button.result').filter({hasText:'Katalogsang 13'});
    await recent.waitFor({state:'visible',timeout:15000});
    const recentHold=await holdOldItem('Isoleret sang 13');
    try{
     await recent.tap();
     await Promise.race([recentHold.stale,sleep(10000).then(()=>{throw Error('No held Hør igen playback transition');})]);
     await page.waitForFunction(()=>document.querySelector('#track-name')?.textContent==='Katalogsang 13',undefined,{timeout:8000});
     await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-during-old-read.png')});
    }finally{recentHold.release();}
    await page.locator('#track-name').filter({hasText:'Isoleret sang 13'}).waitFor({state:'visible',timeout:15000});
    assert.deepEqual((await state()).writes.map(row=>row.action),['play_context','pause','play_context','play_track']);
    await page.screenshot({path:path.join(env.artifactDir(),'podview-recent-after-switch.png')});
   }
  }
  console.log(JSON.stringify({outcome:'PASS',coldContext:true,rejectSetup,prepares:prepares.length,commits:commits.length,pageErrors:errors}));return;
 }
 await env.openOverview(page);
 if(queueJourney){await queuePersistenceJourney();return;}
 if(discoveryLoading){await discoveryLoadingJourney();return;}
 if(discoveryRevisit){await discoveryRevisitJourney();return;}
 if(discoveryCover){await discoveryCoverJourney();return;}
 await page.locator('#home-music').tap();
 await page.locator('[data-collection="top"]').tap();
 const rows=page.locator('#result-list button.result');
 await rows.filter({hasText:'Katalogsang 11'}).waitFor({state:'visible',timeout:15000});
 if (loseSelectionReceipt) {
  const endpoint = '**/view/api/music/selection/actions';
  await page.route(endpoint, async route => {
   const committed = await route.fetch();
   assert.equal((await committed.json()).outcome, 'accepted');
   assert.equal((await state()).song, 11, 'the inert owner acted before the receipt was lost');
   await route.fulfill({status: 502, json: {error: 'fixture_receipt_lost'}});
  }, {times: 1});

  await rows.filter({hasText: 'Katalogsang 11'}).tap();
  await page.waitForFunction(() => {
   const selection = document.querySelector('pv-widget-host')?.liveSelection;
   return selection?.feedback?.outcome === 'unknown' && !selection.pending && !selection.pendingPlayer();
  }, undefined, {timeout: 12000});
  await page.locator('#track-name').filter({hasText: 'Isoleret sang 11'}).waitFor({state: 'visible', timeout: 15000});
  assert.equal((await state()).selections.length, 1, 'passive observation does not repeat the unknown command');
  assert.equal(actions.filter(action => action.url.endsWith('/selection/actions')).length, 1);

  await rows.filter({hasText: 'Katalogsang 12'}).tap();
  await page.locator('#track-name').filter({hasText: 'Isoleret sang 12'}).waitFor({state: 'visible', timeout: 15000});
  const observed = await state();
  assert.deepEqual(observed.selections.map(row => Number(row.uri.split(':').pop())), [11, 12]);
  const setups = actions.filter(action => action.url.endsWith('/selection/setup'));
  const sent = actions.filter(action => action.url.endsWith('/selection/actions'));
  assert.equal(setups.length, 2);
  assert.equal(sent.length, 2);
  assert.notEqual(setups[0].body.candidateSetId, setups[1].body.candidateSetId);
  assert.notEqual(sent[0].body.taskId, sent[1].body.taskId);
  assert.notEqual(sent[0].body.requestId, sent[1].body.requestId);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({outcome: 'PASS', bundleSHA, unknownAfterCommit: true, explicitChoiceEffects: [11, 12]}));
  return;
 }
 // Passive bounded CI evidence only: no method wrapping, synthetic events or upload.
 await page.evaluate(()=>{const ids=new WeakMap(),scopes=new Map(),events=[],mutations=[];let serial=0;const id=node=>{if(!node)return null;if(!ids.has(node))ids.set(node,++serial);return ids.get(node);},scope=h=>{const s=h?.liveSnapshot,key=JSON.stringify([s?.bootId,s?.roomId,s?.capabilities?.musicRead,s?.capabilities?.musicSelection,s?.mediaRoomBindings]);if(!scopes.has(key))scopes.set(key,scopes.size+1);return scopes.get(key);},save=(list,row)=>{list.push(row);if(list.length>100)list.shift();};for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click'])document.addEventListener(type,event=>{const h=document.querySelector('pv-widget-host'),v=h?.liveSelection,c=h?.liveCatalogue,e=c?.entries?.get(c.key()),point=event.changedTouches?.[0]||event,b=event.target.closest?.('#result-list button.result');save(events,{type,at:performance.now(),target:id(event.target),button:id(b),x:point.clientX??null,y:point.clientY??null,disabled:b?.disabled??null,connected:b?.isConnected??null,scope:scope(h),focus:h?.state?.focus,pending:v?.pending,used:v?.used,musicPending:!!h?.liveControls?.musicIntentPending,settlement:v?.feedback?.settlementStatus,selectionSpent:e?.selectionSpent,selectionConfirmed:e?.selectionConfirmed});},true);new MutationObserver(records=>{for(const record of records)if(record.type==='childList')save(mutations,{at:performance.now(),parent:id(record.target),added:[...record.addedNodes].map(id),removed:[...record.removedNodes].map(id)});else if(record.type==='attributes')save(mutations,{at:performance.now(),target:id(record.target),attribute:record.attributeName,oldValue:record.oldValue,value:record.target.getAttribute(record.attributeName)});}).observe(document.querySelector('#result-list'),{childList:true,subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['disabled','hidden','inert','aria-disabled']});window.selectionCiEvidence={events,mutations};});
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
 // A voice answer must not revoke an unchanged music queue (A12/K7).
 const queueBeforeVoice=await page.locator('#queue').innerText();
 await page.request.post(base+'/lab/state',{data:{unrelatedVoiceTurn:'s1:unrelated-answer'}});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.turnId==='s1:unrelated-answer',undefined,{timeout:10000});
 assert.equal(await page.locator('#queue').innerText(),queueBeforeVoice,'unrelated voice keeps queue content');
 assert.equal(await queueRow.isEnabled(),true,'unrelated voice keeps queue selectable');
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
 }catch(error){if(page){try{const evidence=await page.locator('pv-widget-host').evaluate(async h=>{const t=h.liveTransport,records=[];for(const row of t?.diagnostics?.().records||[]){let requestRef;if(row.requestId){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.requestId));requestRef=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16);}records.push({seq:row.seq,atMs:row.atMs,generation:row.generation,stage:row.stage,code:row.code,domain:row.domain,endpoint:row.endpoint,current:row.current,...(requestRef?{requestRef}:{})});}const v=h.liveSelection,c=h.liveCatalogue,e=c?.entries?.get(c.key());return {events:window.selectionCiEvidence?.events||[],mutations:window.selectionCiEvidence?.mutations||[],records,dropped:t?.diagnosticDropped,scope:{focus:h.state?.focus,connected:t?.connected,generation:t?.generation,feedback:v?.feedback?.settlementStatus,pending:v?.pending,used:v?.used,musicPending:!!h.liveControls?.musicIntentPending,entry:e?{selectionSpent:e.selectionSpent,selectionExpired:e.selectionExpired,selectionUnavailable:e.selectionUnavailable,actionDispatched:e.actionDispatched,selectionConfirmed:e.selectionConfirmed,selectionSettlementStatus:e.selectionSettlementStatus}:null}};});await fs.writeFile(path.join(env.artifactDir(),'podview-music-selection-failure-evidence.json'),JSON.stringify(evidence,null,2));}catch(evidenceError){console.error('selection evidence unavailable',evidenceError.message);}console.log('failureState',JSON.stringify({service:await state(),responses,actions,ui:await page.locator('body').innerText(),selection:await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,account:h.liveMedia?.account,capabilities:h.liveSnapshot?.capabilities,feedback:h.liveSelection?.feedback&&{message:h.liveSelection.feedback.message,outcome:h.liveSelection.feedback.outcome},queueStatus:h.liveMedia?.queueControls?.status,note:h.liveSelection?.note?.textContent,offer:h.liveSelection?.offer}))}));await page.screenshot({path:path.join(env.artifactDir(),'podview-music-selection-failure.png')})}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
