'use strict';
const {chromium}=require('playwright'),env=require('./podview_actual_env.cjs'),{spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const port=Number(process.env.VEHICLE_TEST_PORT||18980),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json()),update=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());let server,browser;
const lifecycle=process.env.VEHICLE_LIFECYCLE_TEST==='1',recovery=process.env.VEHICLE_RECOVERY_TEST==='1';
const readOwnerJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
async function assertBalancedConfirmation(dialog){
 const geometry = await dialog.evaluate(node=>{
  const header = node.querySelector('.pv-dialog-header');
  const actions = node.querySelector('.pv-dialog-actions');
  const style = getComputedStyle(actions);
  const rect = element=>element.getBoundingClientRect().toJSON();
  return {
   display:style.display,
   gap:parseFloat(style.columnGap),
   topPadding:parseFloat(style.paddingTop),
   headerHeight:rect(header).height,
   titleHeight:rect(header.querySelector('h2')).height,
   footer:rect(actions),
   buttons:[...actions.querySelectorAll('button')].map(rect),
  };
 });
 console.log('Tesla confirmation geometry',JSON.stringify(geometry));
 assert.equal(geometry.display,'grid','confirmation uses the balanced kit action grid');
 assert.equal(geometry.buttons.length,2);
 const [cancel,confirm] = geometry.buttons;
 assert.equal(geometry.gap,16);
 assert.equal(geometry.topPadding,0);
 assert.equal(geometry.headerHeight,geometry.titleHeight);
 assert.equal(cancel.height,64);
 assert.equal(confirm.height,64);
 assert.equal(cancel.top,confirm.top);
 assert(Math.abs(cancel.width-confirm.width)<1);
 assert(Math.abs(cancel.left-geometry.footer.left)<1);
 assert(Math.abs(confirm.right-geometry.footer.right)<1);
}
async function lifecycleJourney(page,card,errors,commands){
 const root=page.locator('#vehicle-view'),hero=root.getByRole('region',{name:'Bilens status'});
 const dialog=page.locator('dialog.vehicle-confirmation');
 const fieldTimes=()=>page.locator('pv-widget-host').evaluate(host=>host.state.vehicle.fieldObservedAt);
 const snapshotReady=condition=>page.waitForFunction(condition,undefined,{timeout:12000});
 const before=await state();
 await card.tap();
 await hero.waitFor({state:'visible'});
 assert.match(await hero.innerText(),/72/);
 assert.match(await hero.innerText(),/312 km/);
 const time=hero.locator('.vehicle-connection-note');
 const firstTimestamp=await time.innerText();
 assert.match(firstTimestamp,/^Ældste observation .+\d\d[.:]\d\d$/);
 assert.doesNotMatch(await hero.innerText(),/kW/);
 const trunk=name=>root.getByRole('button',{name,exact:true});
 const up=root.getByRole('button',{name:'Hæv temperatur',exact:true});
 await trunk('Åbn bagagerum').waitFor({state:'visible'});
 assert(await trunk('Lås op').isEnabled());
 assert(await up.isDisabled());
 assert.deepEqual((await state()).snapshotReads,before.snapshotReads,'opening only uses current passive data');
 const knownTimes=await fieldTimes();
 assert(Number.isFinite(knownTimes.trunk)&&Number.isFinite(knownTimes['climate.status']));
 const refresh=async phase=>{
  await sleep(5200); // Let the real passive cache expire before reading changed fixture state.
  await update({phase});
  await page.locator('pv-widget-host').evaluate(host=>host.loadLiveHome());
 };
 await refresh('historical');
 await snapshotReady(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.historicalFields?.includes('trunk'));
 assert.deepEqual(await fieldTimes(),knownTimes,'historical re-emission preserves every field timestamp');
 assert.match(await hero.innerText(),/Sidst kendt/);
 assert.equal(await time.innerText(),firstTimestamp);
 assert.match(await hero.innerText(),/312 km/);
 assert.doesNotMatch(await hero.innerText(),/dvale/i,'unproven sleep is not labelled as observed');
 assert(await trunk('Åbn bagagerum').isDisabled());
 assert(await trunk('Lås op').isDisabled());
 assert(await up.isDisabled());
 assert.deepEqual((await state()).writes,[]);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-vehicle-last-known.png')});

 await refresh('partial');
 await trunk('Bagagerum ukendt').waitFor({state:'visible'});
 assert(await trunk('Bagagerum ukendt').isDisabled());
 assert.equal(await trunk('Åbn bagagerum').count(),0);
 assert.equal(await trunk('Luk bagagerum').count(),0);
 assert(await trunk('Lås op').isEnabled());
 assert.match(await hero.innerText(),/312 km/);
 assert(await trunk('Afrimning ukendt').isDisabled());
 assert.deepEqual((await state()).writes,[]);

 await refresh('changed');
 await snapshotReady(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.access?.rearTrunk==='open');
 assert.match(await hero.innerText(),/Bilen lader/);
 assert.match(await hero.innerText(),/11 kW/);
 assert(await trunk('Luk bagagerum').isEnabled());
 assert(await trunk('Lås bilen').isEnabled());
 assert(await up.isEnabled());
 assert(await root.locator('#vehicle-seat-heat-trigger').isEnabled());
 assert.equal(await root.locator('.vehicle-climate-actions button:visible').count(),1);
 assert(await trunk('Afrimning ukendt').isDisabled());
 assert((await fieldTimes()).trunk>knownTimes.trunk);
 assert((await fieldTimes())['climate.status']>knownTimes['climate.status']);
 assert.deepEqual((await state()).writes,[]);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-vehicle-external-charging.png')});
 await page.setViewportSize({width:834,height:1194});
 assert.equal(await root.locator('.vehicle-control-tiles > section:visible').count(),2);
 assert.equal(await trunk('Luk bagagerum').count(),1);
 assert.equal(await root.locator('.vehicle-climate-actions button:visible').count(),1);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-vehicle-tablet-viewport.png')});

 await trunk('Luk bagagerum').tap();
 await dialog.waitFor({state:'visible'});
 await dialog.getByRole('heading',{name:/Luk bagagerum/}).waitFor({state:'visible'});
 assert.equal(await dialog.locator('.pv-dialog-actions button:visible').count(),2);
 assert.deepEqual((await state()).writes,[]);
 const accepted=page.waitForResponse(response=>
  new URL(response.url()).pathname==='/view/api/control/actions'&&response.request().method()==='POST');
 await dialog.getByRole('button',{name:'Luk bagagerum',exact:true}).tap();
 assert.equal((await (await accepted).json()).outcome,'accepted');
 assert.equal(await trunk('Åbn bagagerum').count(),0,'acceptance cannot render an unobserved closed trunk');
 assert(await trunk('Luk bagagerum').isVisible());
 assert.deepEqual((await state()).writes,[{service:'close_cover',body:{entity_id:'cover.trunk'}}]);

 await refresh('closed');
 await snapshotReady(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.access?.rearTrunk==='closed');
 assert(await trunk('Åbn bagagerum').isEnabled());
 assert(await trunk('Lås op').isEnabled());
 assert(await up.isDisabled());
 assert(await trunk('Afrim ruder').isDisabled());
 assert.match(await hero.innerText(),/312 km/);
 assert.doesNotMatch(await hero.innerText(),/kW/);
 assert.equal(commands.length,1);
 assert.deepEqual(errors,[]);
 const bundle=await fetch(base+'/view/podview.bundle.js').then(response=>response.arrayBuffer());
 const bundleSHA=crypto.createHash('sha256').update(Buffer.from(bundle)).digest('hex');
 if(process.env.VEHICLE_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.VEHICLE_EXPECTED_BUNDLE);
 const proof={outcome:'PASS',bundleSHA,knownToLastKnownToFresh:true,fieldTimestampsRetained:true,
  noAdditionalNativeReadsOnOpen:true,noWakeCommand:true,missingDefrostSingleDisabledControl:true,
  missingTrunkUnknownWithoutSiblingLoss:true,tabletSizedChromiumLayout:true,
  scopedTrunkAcceptanceBeforeObservedClosure:true,externalLockAndClimateObserved:true,
  chargingAndIdleReadFromSource:true,inertFinalHA:true};
 await fs.writeFile(path.join(env.artifactDir(),'podview-vehicle-lifecycle-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
async function recoveryJourney(page,card,errors,requests){
 const host=page.locator('pv-widget-host');
 const toggle=page.locator('#vehicle-view [data-kit=toggle]:visible').first();
 const dialog=page.locator('dialog.vehicle-confirmation');
 const hasAuthority=allowed=>page.waitForFunction(allowed=>{
  const h=document.querySelector('pv-widget-host'),s=h?.liveSnapshot;
  return h?.liveTransport?.connected===true
   && s?.admission?.kind==='ha_ingress' && s.admission.authenticated===true
   && s.capabilities.homeRead.includes('vehicle')
   && (s.capabilities.controlSetup?.includes('vehicle')===true)===allowed
   && (s.capabilities.vehicleActions?.includes('climateOn')===true)===allowed;
 },allowed,{timeout:15000});
 const confirmWithoutSending=async()=>{
  await toggle.tap();
  await dialog.getByRole('button',{name:'Tænd klima',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Annuller',exact:true}).tap();
  await dialog.waitFor({state:'hidden'});
 };

 await hasAuthority(true);
 await card.tap();
 await confirmWithoutSending();
 await update({controlAvailable:false});
 await hasAuthority(false);
 assert.equal(await toggle.count(),0,'read-only Tesla hides the climate toggle');
 assert.match(await page.locator('#vehicle-view').innerText(),/Slukket/);
 await page.locator('#header-title-action').tap();
 await page.locator('#home-recipes').tap();
 const recipe=page.locator('#recipe-view');
 await recipe.locator('[data-recipe="Burgerboller"]').tap();
 await recipe.getByRole('button',{name:'Start opskrift',exact:true}).tap();
 await recipe.locator('[data-recipe-layout=reading] li button').first().tap();
 const recipeBefore=await host.evaluate(h=>{
  const view=h.recipeView,active=view.active,session=view.sessions.get(active);
  window.recoveryRecipe={h,view,active,session};
  return {title:active.title,steps:[...session.steps],focus:h.state.focus,readAt:h.liveTransport.acceptedReadAt};
 });
 assert.equal(recipeBefore.title,'Burgerboller');
 assert.equal(recipeBefore.steps.length,1);

 await page.context().setOffline(true);
 await page.waitForFunction(()=>{
  const h=document.querySelector('pv-widget-host');
  return h?.browserOffline===true&&h.connectionNotice?.state==='offline';
 });
 const reconnectStatuses=[];
 page.on('response',response=>{
  if(new URL(response.url()).pathname==='/view/api/snapshot')reconnectStatuses.push(response.status());
 });
 await update({controlAvailable:true,interruptTransport:true});
 await page.context().setOffline(false);
 await hasAuthority(true);
 assert.deepEqual(reconnectStatuses,[503,200],'automatic recovery must retry the failed reconnect read');
 const recipeAfter=await host.evaluate(h=>{
  const {h:priorHost,view,active,session}=window.recoveryRecipe;
  return {sameOwners:h===priorHost&&h.recipeView===view&&view.active===active&&view.sessions.get(active)===session,
   title:active.title,steps:[...session.steps],focus:h.state.focus,readAt:h.liveTransport.acceptedReadAt};
 });
 assert(recipeAfter.sameOwners);
 assert.equal(recipeAfter.title,recipeBefore.title);
 assert.deepEqual(recipeAfter.steps,recipeBefore.steps);
 assert.equal(recipeAfter.focus,recipeBefore.focus);
 assert(recipeAfter.readAt>recipeBefore.readAt);
 assert(await recipe.locator('[data-recipe-layout=reading]').isVisible());
 await page.locator('#header-title-action').tap();
 await page.locator('#header-title-action').tap();
 await card.tap();
 await confirmWithoutSending();

 assert.deepEqual(requests.filter(({path})=>/\/api\/(pair|controller\/)/.test(path)),[]);
 assert.deepEqual(requests.filter(({method,path})=>method==='POST'&&/\/actions$/.test(path)),[]);
 assert.equal(requests.filter(({method,path})=>method==='POST'&&path==='/view/api/control/setup').length,2,
  'only the two deliberate confirmation opens request setup');
 assert.deepEqual((await state()).writes,[]);
 assert.deepEqual(errors,[]);
 const bundle=await fetch(base+'/view/podview.bundle.js').then(response=>response.arrayBuffer());
 const bundleSHA=crypto.createHash('sha256').update(Buffer.from(bundle)).digest('hex');
 if(process.env.VEHICLE_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.VEHICLE_EXPECTED_BUNDLE);
 console.log(JSON.stringify({outcome:'PASS',bundleSHA,haIngressWithoutRegistration:true,
  vehicleAuthorityWithdrawnAndRestored:true,reconnectStatuses,
  sameActiveRecipeAndProgress:true,noAutomaticControlSetup:true,noActionPosts:true,noNativeWrites:true}));
}
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-vehicle-'));server=spawn(env.python,[path.join(__dirname,'vehicle_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({VEHICLE_TEST_PORT:String(port),VEHICLE_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}}),errors=[],commands=[];page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/view/api/control/actions')commands.push(r.postDataJSON());});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(/\/view\/api\/(home|control)/.test(r.url()))console.log('API',r.status(),r.url(),await r.text().catch(()=>''));});
 const requests=[];
 if(recovery){
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  page.on('request',r=>requests.push({method:r.method(),path:new URL(r.url()).pathname}));
 }
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 const card=page.locator('#home-vehicle');
 await card.waitFor({timeout:15000});
 if(recovery){
  await recoveryJourney(page,card,errors,requests);
  return;
 }
 if(lifecycle){
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.batteryPercent===72,
   undefined,{timeout:15000});
  await lifecycleJourney(page,card,errors,commands);
  return;
 }
 await card.tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.climate?.status==='off',undefined,{timeout:15000});assert.deepEqual((await state()).writes,[]);console.log('vehicle initial',await page.locator('body').innerText());
 const up=page.getByRole('button',{name:'Hæv temperatur'});assert(await up.isDisabled(),'dependent temperature disabled when climate off');
 const seats=page.locator('#vehicle-seat-heat-trigger');
 const defrost=page.getByRole('button',{name:'Afrim ruder',exact:true});
 const assertDependentsOff=async()=>{
  const beforeWrites=(await state()).writes.length,beforeCommands=commands.length;
  for(const control of [up,seats,defrost]){
   await control.scrollIntoViewIfNeeded();
   assert(await control.isDisabled(),'OFF must disable every climate dependent');
   const box=await control.boundingBox();
   assert(box,'disabled control remains visible');
   await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  }
  assert.equal(await seats.getAttribute('aria-expanded'),'false');
  assert(await page.locator('input[name=vehicle-seat-driver]').evaluateAll(rows=>
   rows.length>0&&rows.every(row=>row.disabled)));
  assert(await page.locator('input[name=vehicle-seat-passenger]').evaluateAll(rows=>
   rows.length>0&&rows.every(row=>row.disabled)));
  assert.equal(commands.length,beforeCommands,'disabled touch sends no command POST');
  assert.equal((await state()).writes.length,beforeWrites,'disabled touch sends no HA write');
  assert(await page.locator('#vehicle-view [data-kit=toggle]:visible').first().isEnabled());
 };
 await assertDependentsOff();
 const toggle=page.locator('#vehicle-view [data-kit=toggle]:visible').first();await toggle.tap();const dialog=page.locator('dialog.vehicle-confirmation');await dialog.waitFor({state:'visible'});assert.deepEqual((await state()).writes,[],'setup and confirmation have no effects');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-vehicle-balanced-confirmation.png')});
 await assertBalancedConfirmation(dialog);
 await update({hold:true});await dialog.getByRole('button',{name:'Tænd klima',exact:true}).tap();for(let n=0;!(await state()).intentHeld;n++){if(n>100)throw Error('vehicle intent not held');await sleep(25)}await update({voice:true});await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.sessionId==='voice-next',undefined,{timeout:2500});await update({release:true});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.climate?.status==='heat_cool',undefined,{timeout:5000});assert.equal((await state()).writes.length,1);assert.deepEqual((await state()).writes[0],{service:'turn_on',body:{entity_id:'climate.car'}});
 assert(await up.isEnabled());
 assert(await seats.isEnabled());assert(await defrost.isEnabled());
 await seats.tap();
 const driver=page.locator('input[name=vehicle-seat-driver][value="2"]');
 assert(await driver.isEnabled());
 await driver.locator('..').tap();
 await dialog.waitFor({state:'visible'});
 await dialog.getByRole('button',{name:'Annuller',exact:true}).tap();
 await defrost.tap();await dialog.waitFor({state:'visible'});
 await dialog.getByRole('button',{name:'Annuller',exact:true}).tap();
 assert.equal((await state()).writes.length,1,'seat and defrost confirmation cancellation has no effect');
 assert.equal(commands.length,1,'no command POST before confirmation');
 await seats.tap();
 await sleep(5200); // Allow the existing five-second passive home cache to expire before holding a real source read.
 await update({holdRead:true});await page.locator('pv-widget-host').evaluate(h=>{void h.loadLiveHome()});for(let n=0;!(await state()).readHeld;n++){if(n>40)throw Error('pre-effect vehicle read not held');await sleep(20)}await up.tap();await dialog.waitFor({state:'visible'});console.log('temperature confirm',await dialog.innerText());await dialog.locator('button.pv-primary').tap();for(let n=0;(await state()).writes.length<2;n++){if(n>60)throw Error('temperature intent not sent');await sleep(20)}await update({holdFollowup:true});await update({releaseRead:true});for(let n=0;!(await state()).followupHeld;n++){if(n>60)throw Error('post-receipt follow-up not held');await sleep(20)}const between=await page.locator('pv-widget-host').evaluate(h=>({vehicleStale:h.state.vehicle?.stale??false,homeReadStatus:h.state.homeReadStatus,visible:document.querySelector('#vehicle-view')?.innerText}));console.log('betweenReads',JSON.stringify(between));assert.equal(between.vehicleStale,false,'superseded read must retain last observed vehicle while follow-up is pending');await update({releaseFollowup:true});await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.climate?.targetTemperatureC===20.5,undefined,{timeout:10000});assert.deepEqual((await state()).writes[1],{service:'set_temperature',body:{entity_id:'climate.car',temperature:20.5}});
 await page.locator('#vehicle-view [data-kit=toggle]:visible').first().tap();await dialog.waitFor({state:'visible'});await dialog.getByRole('button',{name:'Sluk klima',exact:true}).tap();await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.vehicle?.climate?.status==='off',undefined,{timeout:10000});assert.deepEqual((await state()).writes[2],{service:'turn_off',body:{entity_id:'climate.car'}});assert.equal((await state()).writes.length,3);assert(await up.isDisabled(),'temperature becomes disabled after observed climate off');assert.deepEqual(errors,[]);
 await assertDependentsOff();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:path.join(env.artifactDir(),'podview-vehicle-success.png')});const bundle=await fetch(base+'/view/podview.bundle.js').then(r=>r.arrayBuffer());let journal;const ref=value=>crypto.createHash('sha256').update(value).digest('hex').slice(0,16),expected=[['climateOn',true],['temperature',20.5],['climateOff',false]];
 for(let n=0;n<180;n++){journal=await readOwnerJournal(page);if(commands.length===3&&commands.every(command=>journal.records?.some(record=>record.row.stage==='control_observation'&&['observed','unconfirmed'].includes(record.row.code)&&record.row.requestRef===ref(command.requestId))))break;await sleep(250);}
 await fs.writeFile(path.join(env.artifactDir(),'podview-vehicle-journal.json'),JSON.stringify(journal,null,2));commands.forEach((command,index)=>{const rows=journal.records.filter(record=>record.row.requestRef===ref(command.requestId)).map(record=>record.row),[action,value]=expected[index];assert(rows.some(row=>row.stage==='control_action'&&row.action===action&&row.code==='accepted'));const observed=rows.find(row=>row.stage==='control_observation'&&row.domain==='vehicle'&&row.action===action&&['observed','unconfirmed'].includes(row.code));assert(observed,'persisted vehicle HA observation matches original UUID');assert.equal(observed.requestedValue,value);assert.equal(observed.observedValue,value);assert.equal(observed.source,'home_assistant');assert.equal(observed.trust,'state_observation');assert.match(observed.resourceRef,/^[a-f0-9]{16}$/);});
 const homeRows=journal.records.map(record=>record.row).filter(row=>row.stage==='home_read');assert(homeRows.some(row=>row.code==='superseded'));assert(homeRows.some(row=>row.code==='recovered'));assert(homeRows.every(row=>row.code!=='confirmed'));assert(!JSON.stringify(journal).includes('climate.car'),'product journal stores only hashed resource identity');await fs.writeFile(path.join(env.artifactDir(),'podview-vehicle-journal.json'),JSON.stringify(journal,null,2));
 console.log(JSON.stringify({outcome:'PASS',persistedVehicleJournal:true,persistedSupersededAndRecoveredHomeReads:true,actualPackagedPodView:true,actualVehicleControl:true,inertHA:true,climateDependentTouchGating:true,seatAndDefrostConfirmationCancelled:true,voiceDuringHeldCommand:true,heldPreEffectRead:true,navigationEffects:0,writes:(await state()).writes,servedBundleSha256:crypto.createHash('sha256').update(Buffer.from(bundle)).digest('hex')}));
 }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(env.artifactDir(),'podview-vehicle-failure.png')});console.log('failureState',JSON.stringify({server:await state(),ui:await page.locator('body').innerText(),host:await page.locator('pv-widget-host').evaluate(h=>({vehicle:h.state.vehicle,capabilities:h.liveSnapshot?.capabilities}))}));}throw error}
 finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
