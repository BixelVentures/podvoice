'use strict';
// Shipped browser and actual Python owners; only final HA/native services are inert.
const {chromium}=require('playwright');
const testEnv=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const root=testEnv.root,port=Number(process.env.ROBOT_TEST_PORT||18975),base=`http://127.0.0.1:${port}`;
let server,browser,serverLog='',serverSuspended=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const update=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
async function waitForIdleRo(page,waitingSince){
 while(performance.now()-waitingSince<600000){
  await sleep(Math.ceil(600000-(performance.now()-waitingSince)));
 }
 await page.locator('#photo-view').waitFor({state:'visible'});
}
// Read every bounded persisted page; a healthy trace may exceed the first64 rows.
const readJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
// This passive journal wait adds no command or home read; the existing owner read must supply the witness.
const assertRobotObservation=async(page,requests,action)=>{
 const request=requests.find(row=>row.body?.domain==='vacuum'&&row.body?.action===action);assert(request,`${action} actual wire request`);
 const requestRef=crypto.createHash('sha256').update(request.body.requestId).digest('hex').slice(0,16),resourceRef=crypto.createHash('sha256').update(request.body.target.entityId).digest('hex').slice(0,16);
 // First prove the actual owner observation independently of telemetry upload.
 await page.waitForFunction(({requestId,action})=>document.querySelector('pv-widget-host')?.liveTransport.diagnostics().records.some(row=>row.stage==='control_observation'&&row.domain==='vacuum'&&row.action===action&&row.requestId===requestId&&row.code==='observed'&&row.trust==='state_observation'),{requestId:request.body.requestId,action},{timeout:5000});
 const custody=await page.locator('pv-widget-host').evaluate((h,{requestId,action})=>{const t=h.liveTransport,rows=t.diagnostics().records,local=rows.find(row=>row.stage==='control_observation'&&row.domain==='vacuum'&&row.action===action&&row.requestId===requestId&&row.code==='observed');return {local,pendingCount:rows.filter(row=>!row.restored&&row.seq<=local.seq&&!t.diagnosticUploadAcked.has(row.seq)).length};},{requestId:request.body.requestId,action});
 // Existing uploader admits16 records per10s. Drain only the measured prefix;
 // this adds no home read, forced upload, command, or wait before Stop/reload.
 const deadline=Date.now()+2000+Math.ceil(custody.pendingCount/16)*10000;
 let observed;while(Date.now()<=deadline){const journal=await readJournal(page);observed=journal.records?.map(record=>record.row).find(row=>row.stage==='control_observation'&&row.domain==='vacuum'&&row.action===action&&row.requestRef===requestRef&&row.code==='observed');if(observed)break;await sleep(250);}
 if(!observed)await fs.writeFile(path.join(testEnv.artifactDir(),`podview-robot-${action}-journal-gap.json`),JSON.stringify({stored:await readJournal(page),client:await page.locator('pv-widget-host').evaluate(h=>({diagnostics:h.liveTransport.diagnostics(),pending:h.liveControls.deviceJournalPending,home:h.liveHomeApplied,devices:h.state.devices}))},null,2));
 assert(observed,`${action} persisted original-request state observation`);assert.equal(observed.source,'home_assistant');assert.equal(observed.trust,'state_observation');assert.equal(observed.resourceRef,resourceRef);assert.equal(observed.observedValue,undefined,'finite journal never invents a numeric robot state');
};
(async()=>{try{
 const testNonce=require('node:crypto').randomUUID();
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-robot-e2e-'));
 server=spawn(testEnv.python,[path.join(__dirname,'music_e2e_server.py')],{cwd:testEnv.runtimeRoot,env:testEnv.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,ROBOT_TEST:'1',ROBOT_SLOW_START_TEST:process.env.ROBOT_SLOW_START_TEST||'0',ROBOT_DRAFT_TEST:process.env.ROBOT_DRAFT_TEST||'0',ROBOT_LONG_SESSION_TEST:process.env.ROBOT_LONG_SESSION_TEST||'0',PODVIEW_TEST_NONCE:testNonce}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server start timeout');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,testNonce,'own isolated Python runtime nonce');
 browser=await chromium.launch(testEnv.browserOptions());
 const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}}),errors=[],requests=[],uploads=[];let loadedBundleSha256=null,loadedCssSha256=null;page.on('response',async r=>{const file=new URL(r.url()).pathname;if(file.endsWith('/podview.bundle.js'))loadedBundleSha256=crypto.createHash('sha256').update(await r.body()).digest('hex');if(file.endsWith('/podview.css'))loadedCssSha256=crypto.createHash('sha256').update(await r.body()).digest('hex')});
 page.on('response',async response=>{if(response.url().includes('/client-diagnostics')&&response.request().method()==='POST')uploads.push({atMs:Date.now(),status:response.status(),body:await response.text().catch(()=>null)});});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/control/'))requests.push({url:r.url(),body:r.postDataJSON()})});
 if(server.exitCode!==null)throw Error('own isolated server exited before navigation');
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 if(process.env.ROBOT_DOCK_TEST==='1'){
  const longSession=process.env.ROBOT_LONG_SESSION_TEST==='1';
  await testEnv.openOverview(page);
  const card=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
  await card.getByText('Batteri 78 %',{exact:true}).waitFor({state:'visible',timeout:10000});
  await card.getByText('Robotstøvsuger',{exact:true}).tap();
  const panel=page.locator('pv-robot-control-panel');
  const baseMenu=panel.getByRole('button',{name:'Base',exact:true});
  const operations=panel.locator('button[data-dock-operation]');
  const ownerWrites=async()=>(await state()).robot.writes.filter(([service])=>service==='services/vacuum/send_command');
  if(process.env.ROBOT_DOCK_RECEIPT_TEST==='1'){
   const host=page.locator('pv-widget-host');
   const start=panel.getByRole('button',{name:'Vask moppe',exact:true});
   await baseMenu.tap();
   const actionPath='**/view/api/control/actions',homePath='**/view/api/home?*';
   let release,upstreamResolve,upstreamReject;
   const held=new Promise(resolve=>{release=resolve;});
   const upstream=new Promise((resolve,reject)=>{upstreamResolve=resolve;upstreamReject=reject;});
   await page.route(actionPath,async route=>{
    try{
     const response=await route.fetch();
     upstreamResolve({status:response.status(),receipt:await response.json()});
     await held;
     await route.fulfill({response});
    }catch(error){upstreamReject(error);}
   });
   const browserReceipt=page.waitForResponse(response=>response.url().endsWith('/view/api/control/actions'));
   const snapshot=()=>host.evaluate(h=>{
    const view=h.liveControls,device=view.robotDevice(),operation=view.activeOperation;
    const receipt=operation?view.receipts.get(operation.key):[...view.receipts.values()].at(-1);
    const renewalCodes=h.liveTransport.diagnostics().records
     .filter(record=>record.stage==='robot_renewal').map(record=>record.code);
    return {connected:h.liveTransport.connected,stale:!!device?.stale,
     homeStatus:h.state.homeReadStatus?.vacuum,operationPending:!!view.pending,
     task:!!view.task,outcome:receipt?.outcome,feedback:view.robotPanel?.value?.controlFeedback?.text,
     renewalCodes};
   });
   const started=performance.now();
   let beforeGap,afterGap,accepted;
   try{
    await start.tap();
    accepted=await upstream;
    assert.equal(accepted.status,200);
    assert.equal(accepted.receipt.outcome,'accepted');
    assert.deepEqual((await ownerWrites()).map(([,body])=>body.command),['app_start_wash']);
    beforeGap=await snapshot();
    assert.equal(beforeGap.outcome,'pending');
    await page.route(homePath,route=>route.fulfill({status:503,body:'{}'}));
    await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
    await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state.homeReadStatus?.vacuum==='error');
    afterGap=await snapshot();
    assert.equal(afterGap.connected,true);
    assert.equal(afterGap.stale,true);
    assert.equal(afterGap.operationPending,true);
   }finally{
    release();
    await page.unroute(homePath);
    await page.unrouteAll({behavior:'wait'});
   }
   assert.equal((await (await browserReceipt).json()).requestId,accepted.receipt.requestId);
   await page.waitForFunction(()=>!document.querySelector('pv-widget-host')?.liveControls.pending);
   const afterReceipt=await snapshot();
   assert.equal(afterReceipt.outcome,'accepted','the exact authoritative reply eventually reaches the browser');
   const ref=crypto.createHash('sha256').update(accepted.receipt.requestId).digest('hex').slice(0,16);
   console.log(JSON.stringify({dockReceiptRef:ref,elapsedMs:Math.round(performance.now()-started),
    beforeGap,afterGap,afterReceipt,upstreamOutcome:accepted.receipt.outcome,loadedBundleSha256}));
   assert.equal(requests.filter(row=>row.url.endsWith('/control/actions')).length,1);
   assert.deepEqual((await ownerWrites()).map(([,body])=>body.command),['app_start_wash']);
   assert.equal(afterGap.outcome,'pending','a transient Home read must not paint a pending admitted dock action as UNKNOWN');
   return;
  }
  if(process.env.ROBOT_IDLE_RETURN_TEST==='1'){
   const host=page.locator('pv-widget-host');
   await update({robotState:'idle'});
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   await page.waitForFunction(()=>{
    const h=document.querySelector('pv-widget-host'),view=h.liveControls;
    const device=view.robotDevice();
    return device?.status==='stopped'&&view.robotDirectOffer(device)?.actions.includes('return')
     &&view.task&&view.robotControlCurrent(view.robotControlOffer?.context);
   });
   const openReturn=async()=>{
    const button=panel.getByRole('button',{name:'Kør til basen',exact:true});
    if(!await button.isVisible()&&await baseMenu.isVisible())await baseMenu.tap();
    await button.tap();
   };
   await openReturn();
   const confirm=panel.getByRole('dialog',{name:'Kør til basen?'});
   const node=await confirm.elementHandle();
   const initial=await host.evaluate(h=>h.liveControls.task.taskId);
   await host.evaluate(h=>h.liveControls.renewRobotTask(h.liveControls.task));
   await page.waitForFunction(id=>{
    const current=document.querySelector('pv-widget-host').liveControls.task?.taskId;
    return current&&current!==id;
   },initial);
   assert(await node.evaluate(dialog=>dialog.isConnected&&dialog.open),'idle return survives same-owner setup renewal');
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   assert(await node.evaluate(dialog=>dialog.isConnected&&dialog.open),'idle return survives fresh same-state Home read');
   console.log('idle return survives actual same-owner setup renewal and fresh Home read');
   await page.route('**/view/api/home?*',route=>route.fulfill({status:503,body:'{}'}));
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   const confirmReturn=confirm.getByRole('button',{name:'Kør til basen',exact:true});
   assert(await node.evaluate(dialog=>dialog.isConnected&&dialog.open),'transient Home read must retain the open return confirmation');
   assert(await confirmReturn.isDisabled(),'the stale offer cannot confirm return');
   await confirmReturn.evaluate(button=>button.click());
   const returnRequests=()=>requests.filter(row=>row.url.endsWith('/control/actions')&&row.body?.action==='return');
   const vacuumWrites=async()=>(await state()).robot.writes.filter(([service])=>service.startsWith('services/vacuum/'));
   assert.deepEqual(returnRequests(),[]);
   assert.deepEqual(await vacuumWrites(),[]);
   await page.unroute('**/view/api/home?*');
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   await page.waitForFunction(()=>{
    const view=document.querySelector('pv-widget-host').liveControls;
    return view.robotDirectOffer(view.robotDevice())?.actions.includes('return');
   });
   assert(await node.evaluate(dialog=>dialog.isConnected&&dialog.open),'fresh same-owner read keeps the original dialog');
   assert(await confirmReturn.isEnabled(),'fresh return offer enables confirmation');

   await update({robotState:'paused'});
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   await page.waitForFunction(()=>{
    const view=document.querySelector('pv-widget-host').liveControls,device=view.robotDevice();
    return device?.status==='paused'&&view.robotDirectOffer(device)?.actions.includes('return');
   });
   assert(!await node.evaluate(dialog=>dialog.isConnected&&dialog.open),'changed robot state closes the previous confirmation despite a fresh Return offer');
   await openReturn();
   const pausedDialog=await confirm.elementHandle();
   await page.route('**/view/api/home?*',route=>route.fulfill({status:503,body:'{}'}));
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   assert(await pausedDialog.evaluate(dialog=>dialog.isConnected&&dialog.open),'unchanged paused robot also retains the confirmation');
   assert(await confirmReturn.isDisabled(),'paused confirmation remains disabled without a fresh offer');
   await page.unroute('**/view/api/home?*');

   await page.route('**/view/api/home?*',route=>route.fulfill({status:403,body:'{}'}));
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   assert(!await pausedDialog.evaluate(dialog=>dialog.isConnected&&dialog.open),'denied Home access closes the dialog');
   assert.deepEqual(returnRequests(),[]);
   assert.deepEqual(await vacuumWrites(),[]);
   await page.unroute('**/view/api/home?*');
   await host.evaluate(h=>h.loadLiveHome({afterCurrent:true}));
   await card.getByText('Robotstøvsuger',{exact:true}).tap();
   await openReturn();
   await confirmReturn.tap();
   await confirm.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.querySelector('pv-widget-host').state.devices.some(
    device=>device.id==='vacuum.qrevo'&&device.status==='docking'));
   assert.equal(returnRequests().length,1);
   assert.deepEqual((await vacuumWrites()).map(([service])=>service),['services/vacuum/return_to_base']);
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({idleReturn:'PASS',idleAndPausedDialogsRetainedAfter503:true,changedStatusClosed:true,denialClosed:true,
    returnRequests:1,vacuumServiceWrites:1,loadedBundleSha256}));
   return;
  }
  if(process.env.ROBOT_ACTIVE_BASE_TEST==='1'){
   const host=page.locator('pv-widget-host');
   const pause=panel.getByRole('button',{name:'Pause',exact:true});
   await pause.waitFor({state:'visible'});
   await operations.first().waitFor({state:'attached'});
   const initialTask=await host.evaluate(h=>h.liveControls.task.taskId);
   const intent=action=>page.waitForResponse(r=>r.url().endsWith('/view/api/control/actions')
    &&r.request().method()==='POST'&&r.request().postDataJSON()?.action===action);
   const paused=intent('pause');
   await pause.tap();
   assert.equal((await (await paused).json()).outcome,'accepted');
   await page.waitForFunction(id=>{
    const host=document.querySelector('pv-widget-host'),view=host.liveControls;
    const device=host.state.devices.find(row=>row.id==='vacuum.qrevo');
    return device?.status==='paused'&&device.transportActions?.actions.includes('resume')
     &&view.task?.taskId!==id&&view.task?.options.some(option=>option.argsSchema.operation==='wash_start');
   },initialTask);
   assert.equal(await baseMenu.count(),1,'only one Base after authoritative Pause and fresh dock offer');
   await baseMenu.tap();
   const goHome=panel.getByRole('button',{name:'Kør til basen',exact:true});
   assert(await goHome.isVisible());
   assert(await panel.getByRole('button',{name:'Vask moppe',exact:true}).isEnabled());
   await goHome.tap();
   const confirm=panel.getByRole('dialog',{name:'Kør til basen?'});
   await confirm.waitFor({state:'visible'});
   const dialog=await confirm.elementHandle();
   const originalOffer=await host.evaluate(h=>h.liveControls.task.taskId);
   await host.evaluate(h=>h.liveControls.renewRobotTask(h.liveControls.task));
   await page.waitForFunction(id=>{const current=document.querySelector('pv-widget-host').liveControls.task?.taskId;return current&&current!==id;},originalOffer);
   assert(await dialog.evaluate(node=>node.isConnected&&node.open),'background renewal keeps the same return confirmation open');
   assert.deepEqual((await state()).robot.writes.filter(([service])=>service.startsWith('services/vacuum/'))
    .map(([service])=>service),['services/vacuum/pause'],'renewal never confirms return');
   await panel.getByRole('button',{name:'Behold turen',exact:true}).tap();
   assert.deepEqual(await ownerWrites(),[],'opening Base and canceling return sends no dock command');
   const resume=panel.getByRole('button',{name:'Fortsæt',exact:true});
   const resumed=intent('resume');
   await resume.tap();
   assert.equal((await (await resumed).json()).outcome,'accepted');
   await page.waitForFunction(()=>{
    const h=document.querySelector('pv-widget-host');
    return h.state.devices.find(row=>row.id==='vacuum.qrevo')?.status==='cleaning'&&h.liveControls.task;
   });
   if(!await goHome.isVisible())await baseMenu.tap();
   await goHome.tap();
   const returnOffer=await host.evaluate(h=>h.liveControls.task.taskId);
   await host.evaluate(h=>h.liveControls.renewRobotTask(h.liveControls.task));
   await page.waitForFunction(id=>{const current=document.querySelector('pv-widget-host').liveControls.task?.taskId;return current&&current!==id;},returnOffer);
   const returned=intent('return');
   await confirm.getByRole('button',{name:'Kør til basen',exact:true}).tap();
   assert.equal((await (await returned).json()).outcome,'accepted');
   await confirm.waitFor({state:'hidden'});
   const writes=(await state()).robot.writes.filter(([service])=>service.startsWith('services/vacuum/'));
   assert.deepEqual(writes.map(([service])=>service),['services/vacuum/pause','services/vacuum/start','services/vacuum/return_to_base']);
   assert.deepEqual(errors,[]);
   assert(loadedBundleSha256&&loadedCssSha256);
   if(process.env.ROBOT_EXPECTED_BUNDLE)assert.equal(loadedBundleSha256,process.env.ROBOT_EXPECTED_BUNDLE);
   if(process.env.ROBOT_EXPECTED_CSS)assert.equal(loadedCssSha256,process.env.ROBOT_EXPECTED_CSS);
   const proof={outcome:'PASS',loadedBundleSha256,loadedCssSha256,
    oneBaseAfterObservedPause:true,confirmationSurvivedRenewal:true,returnCanceled:true,
    observedResumeOffered:true,explicitReturnAfterRenewal:true,writes,inertFinalService:true};
   await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-active-base-proof.json'),
    JSON.stringify(proof,null,2));
   console.log(JSON.stringify(proof));
   return;
  }
  if(process.env.ROBOT_HISTORY_DOCK_TEST==='1'){
   const host=page.locator('pv-widget-host');
   await page.waitForFunction(()=>!!document.querySelector('pv-widget-host')?.liveControls?.task?.historyDraft);
   const capture=()=>host.evaluate(h=>{
    const view=h.liveControls,task=view.task,panel=view.robotPanel;
    return {taskId:task.taskId,historySource:task.historyDraft?.source??task.draft?.status,
     draft:panel.readCleaningDraft(),dock:task.options.filter(o=>o.action==='dock').map(o=>o.argsSchema.operation)};
   });
   const original=await capture();
   assert.equal(original.historySource,'accepted_start_history');
   assert.equal(original.draft.areaIds.length,1);
   assert.equal(original.draft.repeat,2);
   assert.equal(await panel.getByRole('button',{name:'Køkkenalrum',exact:true}).getAttribute('aria-pressed'),'true');
   assert.deepEqual(original.dock,['wash_start','empty_start','dry_start'],'the automatic cleaning draft must not hide fresh Base authority');
   await baseMenu.tap();
   assert.equal(await baseMenu.getAttribute('aria-expanded'),'true');
   assert.deepEqual(await operations.evaluateAll(rows=>rows.map(row=>row.disabled)),[false,false,false]);
   await page.waitForFunction(id=>{
    const view=document.querySelector('pv-widget-host')?.liveControls;
    return view?.task?.taskId&&view.task.taskId!==id&&view.task.draft?.status==='restored';
   },original.taskId,{timeout:20000});
   const renewed=await capture();
   assert.deepEqual(renewed.dock,original.dock);
   assert.equal(renewed.draft.repeat,2);
   assert.equal(await panel.getByRole('button',{name:'Køkkenalrum',exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await baseMenu.getAttribute('aria-expanded'),'true');
   assert.deepEqual(await ownerWrites(),[]);
   const response=page.waitForResponse(r=>r.url().endsWith('/view/api/control/actions')&&r.request().method()==='POST');
   await operations.and(panel.locator('[data-dock-operation=wash_start]')).tap();
   assert.equal((await (await response).json()).outcome,'accepted');
   const writes=await ownerWrites();
   assert.deepEqual(writes,[['services/vacuum/send_command',{entity_id:'vacuum.qrevo',command:'app_start_wash'}]]);
   assert.deepEqual(errors,[]);
   const proof={outcome:'PASS',original,renewed,writes,loadedBundleSha256,loadedCssSha256,inertFinalService:true};
   await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-history-base-proof.json'),JSON.stringify(proof,null,2));
   console.log(JSON.stringify(proof));
   return;
  }
  let refreshProof;
  if(!longSession){
   await baseMenu.waitFor({state:'visible'});
   const host=page.locator('pv-widget-host');
   const first=await host.evaluate(h=>({id:h.liveControls.task.taskId,expiresAt:h.liveControls.task.expiresAt}));
   const oldOptions=await operations.evaluateAll(rows=>rows.map(row=>row.dataset.controlOptionId));
   let releaseRefresh;
   const held=new Promise(resolve=>{releaseRefresh=resolve;});
   const setup='**/view/api/control/setup';
   const gate=async route=>{
    const body=route.request().postDataJSON();
    if(body.domain==='vacuum'&&body.renewTaskId===first.id)return route.abort();
    if(body.domain==='vacuum'&&!body.renewTaskId)await held;
    return route.continue();
   };
   await page.route(setup,gate);
   try{
    await baseMenu.tap();
    assert.equal(await baseMenu.getAttribute('aria-expanded'),'true');
    await page.waitForFunction(first=>{
     const view=document.querySelector('pv-widget-host')?.liveControls;
     return view?.setupPending&&!view.task&&Date.now()/1000>=first.expiresAt;
    },first,{timeout:25000});
    assert.equal(await baseMenu.getAttribute('aria-expanded'),'true','expired offer must not collapse Base');
    assert.equal(await operations.count(),3);
    assert.deepEqual(await operations.evaluateAll(rows=>rows.map(row=>row.disabled)),[true,true,true]);
   }finally{
    releaseRefresh();
    await page.unrouteAll({behavior:'wait'});
   }
   await page.waitForFunction(id=>{
    const task=document.querySelector('pv-widget-host')?.liveControls?.task;
    return task?.taskId&&task.taskId!==id;
   },first.id);
   await operations.first().waitFor({state:'visible'});
   assert.equal(await baseMenu.getAttribute('aria-expanded'),'true','fresh offer preserves the open disclosure');
   assert.deepEqual(await operations.evaluateAll(rows=>rows.map(row=>row.disabled)),[false,false,false]);
   const freshOptions=await operations.evaluateAll(rows=>rows.map(row=>row.dataset.controlOptionId));
   assert(freshOptions.every(id=>!oldOptions.includes(id)),'only new dock option IDs are enabled');
   assert.deepEqual(await ownerWrites(),[],'offer renewal sends no dock command');
   refreshProof={expiredOfferDisabled:true,freshOptions:true,baseStayedOpen:true};
   await baseMenu.tap();
  }
  let idleProof;
  if(longSession){
   const host=page.locator('pv-widget-host');
   await page.waitForFunction(()=>!!document.querySelector('pv-widget-host')?.liveControls?.task?.taskId);
   const before=await host.evaluate(h=>({documentStartedAt:performance.timeOrigin,
    taskId:h.liveControls.task.taskId,expiresAt:h.liveControls.task.expiresAt,bootId:h.liveControls.task.bootId}));
   assert.deepEqual(await ownerWrites(),[]);
   const waitingSince=performance.now();
   console.log('S4: waiting 600 s before reopening Base in the same document');
   await waitForIdleRo(page,waitingSince);
   const realIdleMs=Math.floor(performance.now()-waitingSince);
   assert(realIdleMs>=600000);
   assert.equal(await page.evaluate(()=>performance.timeOrigin),before.documentStartedAt);
   assert.deepEqual(await ownerWrites(),[],'idle session sends no dock command');
   const {robot:{dockReport}}=await update({robotDockReport:true});
   assert.deepEqual(dockReport.values,{status:'charging',dock_error:'ok',mop_drying_status:'off'});
   const reportAge=Date.now()-Date.parse(dockReport.lastReported);
   assert(reportAge>=0&&reportAge<5000,'the inert owner must report before the browser wakes');
   await testEnv.openOverview(page);
   await card.getByText('Robotstøvsuger',{exact:true}).tap();
   await page.waitForFunction(before=>{
    const task=document.querySelector('pv-widget-host')?.liveControls?.task;
    return task?.taskId&&task.taskId!==before.taskId&&task.bootId===before.bootId
     &&Date.now()/1000>=before.expiresAt&&Date.now()/1000<task.expiresAt;
   },before,{timeout:15000});
   assert.equal(await page.evaluate(()=>performance.timeOrigin),before.documentStartedAt);
   idleProof={realIdleMs,wokeFromRoInSameDocument:true,originalOfferExpired:true,freshSameBootOffer:true,dockReport};
  }
  const sendDock=async operation=>{
   const button=operations.and(panel.locator(`[data-dock-operation=${operation}]`));
   const reply=page.waitForResponse(r=>r.url().endsWith('/view/api/control/actions')
    &&r.request().method()==='POST',{timeout:10000});
   await button.tap();
   assert.equal((await (await reply).json()).outcome,'accepted');
   await page.waitForFunction(()=>!document.querySelector('pv-widget-host')?.liveHomePending);
   await page.locator('pv-widget-host').evaluate(h=>h.loadLiveHome());
  };
  const groups=['wash_start','empty_start','dry_start'];
  for(const [start,stop] of [['wash_start','wash_stop'],['empty_start','empty_stop'],['dry_start','dry_stop']]){
   await baseMenu.tap();
   await operations.first().waitFor({state:'visible',timeout:10000});
   assert.deepEqual(await operations.evaluateAll(rows=>rows.map(row=>row.dataset.dockOperation)),groups);
   if(start==='wash_start')assert.deepEqual(await ownerWrites(),[],'opening Base sends no command');
   await sendDock(start);
   await sendDock(stop);
  }
  const writes=await ownerWrites();
  assert.deepEqual(writes.map(([,body])=>[body.command,body.params??null]),[
   ['app_start_wash',null],['app_stop_wash',null],['app_start_collect_dust',null],['app_stop_collect_dust',null],
   ['app_set_dryer_status',{status:1}],['app_set_dryer_status',{status:0}],
  ]);
  assert.deepEqual(errors,[]);
  assert(loadedBundleSha256&&loadedCssSha256);
  if(process.env.ROBOT_EXPECTED_BUNDLE)assert.equal(loadedBundleSha256,process.env.ROBOT_EXPECTED_BUNDLE);
  if(process.env.ROBOT_EXPECTED_CSS)assert.equal(loadedCssSha256,process.env.ROBOT_EXPECTED_CSS);
  const proof={outcome:'PASS',story:longSession?'S4':'S7',loadedBundleSha256,loadedCssSha256,
   groups,writes,inertFinalService:true,...idleProof,...refreshProof};
  const file=longSession?'podview-robot-long-session-dock-proof.json':'podview-robot-dock-proof.json';
  await fs.writeFile(path.join(testEnv.artifactDir(),file),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
  return;
 }
 if(process.env.ROBOT_OBSERVATION_TEST==='1'){
  await testEnv.openOverview(page);
  const card=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
  await card.getByText('Batteri 78 % · Køkkenalrum',{exact:true}).waitFor({state:'visible',timeout:10000});
  await card.getByText('Robotstøvsuger',{exact:true}).tap();
  const panel=page.locator('pv-robot-control-panel');
  const room=panel.getByText('Rengør · Køkkenalrum',{exact:true});
  const progress=panel.getByText('42 % færdig',{exact:true});
  const care=panel.getByRole('button',{name:/^Vedligeholdelse/});
  const warning=panel.getByText('Rent vand mangler',{exact:true});
  await room.waitFor({state:'visible',timeout:10000});
  assert(await panel.getByText('Batteri 78 %',{exact:true}).isVisible());
  assert(await progress.isVisible());
  assert.equal(await care.getAttribute('aria-expanded'),'false');
  await care.tap();
  const filter=panel.getByRole('button',{name:'Filter',exact:true});
  await filter.tap();
  assert(await panel.getByText(/vedligeholdelsesintervallet er nået/).isVisible());
  const dismiss=panel.getByRole('button',{name:'Skjul vedligeholdelse i dag',exact:true});
  assert.equal(await dismiss.getAttribute('data-kit-variant'),'secondary');
  await dismiss.tap();
  const snoozed=panel.getByText('Vedligeholdelse skjult i dag',{exact:true});
  assert(await snoozed.isVisible());
  const counter=await page.locator('pv-widget-host').evaluate(h=>h.state.devices.find(d=>d.id==='vacuum.qrevo')
   ?.telemetry?.items.find(row=>row.key==='filter_time_left')?.value);
  assert.equal(counter,-2,'the local snooze does not change the observed counter');
  await update({robotTelemetry:{filter_time_left:'-3',dock_error:'water_empty',
   clean_box_empty:'on',clean_percent:'unavailable'}});
  await warning.waitFor({state:'visible',timeout:22000});
  assert.equal(await panel.getByText('Rent vand mangler',{exact:true}).count(),1);
  assert(await snoozed.isVisible());
  const technical=panel.locator('details.robot-error-code');
  const rawCode=technical.getByText('Base · water_empty',{exact:true});
  await technical.locator('summary').waitFor({state:'visible',timeout:2000});
  assert.equal(await rawCode.isVisible(),false);
  await technical.locator('summary').tap();
  assert(await rawCode.isVisible());
  assert.equal(await progress.isVisible(),false);
  assert.equal(await panel.locator('progress:visible').count(),0,'missing progress never synthesizes a percentage');
  const writes=(await state()).robot.writes.filter(([service])=>!service.startsWith('services/podvoice/'));
  assert.deepEqual(writes,[],'maintenance and telemetry changes never operate the robot');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-observation-fault.png')});
  const proof={outcome:'PASS',stories:['S1','S9','S10','S11','S15','S16'],loadedBundleSha256,
   battery:78,currentRoom:'Køkkenalrum',knownProgress:42,missingProgressHidden:true,
   cleanWaterWarningCount:1,maintenanceSnoozeRetained:true,technicalCodeInDisclosure:true,nativeEffects:0};
  await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-observation-proof.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
  return;
 }
 if(process.env.ROBOT_SLOW_START_TEST==='1'){
  for(let n=0;n<100&&(!loadedBundleSha256||!loadedCssSha256);n++)await sleep(10);assert(loadedBundleSha256,'hash the actual executed script response');if(process.env.ROBOT_EXPECTED_BUNDLE)assert.equal(loadedBundleSha256,process.env.ROBOT_EXPECTED_BUNDLE);assert(loadedCssSha256);if(process.env.ROBOT_EXPECTED_CSS)assert.equal(loadedCssSha256,process.env.ROBOT_EXPECTED_CSS);const observationReads=new Set(['services/podvoice/robot_snapshot','services/podvoice/robot_observation_snapshot','services/podvoice/robot_water_snapshot']),effectWrites=value=>value.robot.writes.filter(([path])=>!observationReads.has(path));
  await testEnv.openOverview(page);const card=page.locator('.resource-preview[data-kind="vacuum"][data-target="vacuum.qrevo"]:visible').first();await card.waitFor({timeout:15000});await card.tap();await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state.focus==='vacuum.qrevo',undefined,{timeout:5000});const panel=page.locator('pv-robot-control-panel');await panel.getByRole('button',{name:'Køkkenalrum',exact:true}).waitFor({state:'visible',timeout:15000});await panel.getByRole('button',{name:'Vælg alle rum',exact:true}).tap();
  // The actual offered defaults still send all four typed settings before Start.
  const before=await page.locator('pv-widget-host').evaluate(h=>{const c=h.liveControls;return {taskId:c.task?.taskId,expiresAt:c.task?.expiresAt,now:Date.now()/1000,draft:c.robotPanel.readCleaningDraft(),optionId:c.robotPanel.cleaningOptionId}});assert(before.taskId);assert(before.expiresAt>before.now+3&&before.expiresAt<=before.now+15.1,'genuine short dock offer is still fresh at touch');assert.equal(before.draft.areaIds.length,2);assert.equal(before.draft.settingChoices.length,4);assert.deepEqual(effectWrites(await state()),[]);
  const capture=()=>page.locator('pv-widget-host').evaluate((h,taskId)=>{const c=h.liveControls,p=c.robotPanel;return {at:Date.now(),taskId:c.task?.taskId??null,pending:c.pending,operation:c.activeOperation?{taskId:c.activeOperation.taskId,optionId:c.activeOperation.optionId}:null,opening:c.opening,receipt:(()=>{const r=[...c.receipts.values()].find(r=>r.taskId===taskId);return r?Object.fromEntries(['outcome','requestId','taskId','optionId','domain','label'].map(key=>[key,r[key]])):null})(),panelText:p?.innerText??'',busy:p?[...p.querySelectorAll('[aria-busy=true]')].map(b=>b.innerText):[],visibleStart:p?[...p.querySelectorAll('button')].filter(b=>b.getClientRects().length&&/Start/.test(b.innerText)).map(b=>{const r=b.getBoundingClientRect(),label=b.querySelector('span'),l=label?.getBoundingClientRect(),s=getComputedStyle(b),p=getComputedStyle(b,'::after'),rect=x=>x?{x:x.x,y:x.y,width:x.width,height:x.height}:null,w=parseFloat(p.width),h=parseFloat(p.height),right=parseFloat(p.right);return {text:b.innerText,disabled:b.disabled,busy:b.getAttribute('aria-busy'),rect:rect(r),labelRect:rect(l),paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,feedback:b.dataset.feedback,progressGap:parseFloat(s.getPropertyValue('--pv-progress-gap')),iconVisibility:b.querySelector('img')?getComputedStyle(b.querySelector('img')).visibility:null,pseudo:{content:p.content,width:p.width,height:p.height,left:p.left,right:p.right,top:p.top,translate:p.translate},pseudoRect:p.content!=='none'&&Number.isFinite(right)&&Number.isFinite(w)?{x:r.right-right-w,y:r.y+r.height/2-h/2,width:w,height:h}:null}}):[]}},before.taskId);
  await panel.getByRole('button',{name:'Start · 2 rum',exact:true}).scrollIntoViewIfNeeded();const normal=await capture();const requestFailures=[];page.on('requestfailed',r=>{if(r.url().includes('/view/api/control/actions')&&r.postDataJSON()?.taskId===before.taskId)requestFailures.push({at:Date.now(),body:r.postDataJSON(),error:r.failure()?.errorText})});
  const readPath=url=>url.pathname==='/view/api/home';
  let releaseFailedRead, injectedFailure=false;
  const startAdmitted=new Promise(resolve=>{releaseFailedRead=resolve;});
  const unavailable=async route=>{
   await startAdmitted;
   injectedFailure=true;
   await route.fulfill({status:503,json:{error:'inert_home_read_transient'}});
  };
  const readScope=()=>page.locator('pv-widget-host').evaluate(h=>({at:Date.now(),
   bootId:h.liveSnapshot.bootId,roomId:h.liveSnapshot.roomId,generation:h.liveTransport.generation,
   connected:h.liveTransport.connected,stale:h.state.devices.find(row=>row.id==='vacuum.qrevo')?.stale===true}));
  // Arm before touching Start so a passive read cannot cross the admission boundary unobserved.
  await page.route(readPath,unavailable);
  const scopeBefore=await readScope();
  assert.equal(scopeBefore.stale,false,'the fixture starts with a fresh HA observation');
  // Outer fixture guard covers the server's 30s execution and client's 35s receipt wait.
  const responsePromise=page.waitForResponse(r=>r.url().includes('/view/api/control/actions')&&r.request().method()==='POST'&&r.request().postDataJSON()?.taskId===before.taskId,{timeout:40000}).catch(()=>null);const touchedAt=Date.now();await panel.getByRole('button',{name:'Start · 2 rum',exact:true}).tap();const initialPending=await capture();
  // The first inert settings POST holds an admitted Start. Keep the same owner stale through its reply.
  for(let n=0;!(await state()).robot.slowStartPosts.length;n++){
   if(n>50)throw Error('admitted Start did not reach the inert owner');
   await sleep(50);
  }
  const failedRead=page.waitForResponse(r=>readPath(new URL(r.url()))&&r.status()===503,{timeout:5000});
  releaseFailedRead();
  const probeRead=async()=>{
   // A read already intercepted will supply the 503. Wait for older reads to settle
   // before probing, and use the response itself to stop, rather than the stale flag.
   await page.waitForFunction(()=>!document.querySelector('pv-widget-host')?.liveHomePending,
    undefined,{timeout:5000});
   if(!injectedFailure)await page.locator('pv-widget-host').evaluate(h=>h.loadLiveHome());
  };
  const [failedResponse]=await Promise.all([failedRead,probeRead()]);
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state.devices
   .some(row=>row.id==='vacuum.qrevo'&&row.stale===true),undefined,{timeout:5000});
  const scopeAfter=await readScope();
  const transientRead={status:failedResponse.status(),body:await failedResponse.json(),scopeBefore,scopeAfter,
   receipt:await capture()};
  assert.equal(scopeAfter.stale,true);
  for(const key of ['bootId','roomId','generation','connected'])assert.equal(scopeAfter[key],scopeBefore[key]);
  assert(scopeAfter.at<before.expiresAt*1000,'transient read fails before the original offer expires');
  await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-start-transient-read.json'),
   JSON.stringify(transientRead,null,2));
  console.log('slowStartTransientRead',JSON.stringify(transientRead));
  assert.equal(transientRead.receipt.receipt?.outcome,'pending','a transient read cannot discard Start custody');
  while(Date.now()<before.expiresAt*1000+120)await sleep(100);
  const afterExpiry=await capture();await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-slow-start-expired-pending.png')});
  for(let n=0;n<100;n++){const value=await state();if(value.robot.slowStartPosts.length===5&&value.robot.slowStartPosts.at(-1).completedAt)break;await sleep(100)}const response=requestFailures.length?null:await responsePromise,receipt=response?await response.json():null,receivedAt=Date.now();await sleep(100);const settled=await capture();await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-slow-start-accepted.png')});
  const settledScope=await readScope();
  await page.unroute(readPath,unavailable);
  assert.equal(settledScope.stale,true,'receipt settles while HA observation is still stale');
  const wire=requests.filter(r=>r.url.includes('/control/actions')),value=await state(),bundle=await(await page.request.get(base+'/view/podview.bundle.js')).body();const proof={servedBundleSha256:loadedBundleSha256,servedCssSha256:loadedCssSha256,bundleAtEndSha256:crypto.createHash('sha256').update(bundle).digest('hex'),before,touchedAt,receivedAt,normal,initialPending,afterExpiry,receipt,requestFailures,settled,wire,robot:value.robot,errors};await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-slow-start-expiry.json'),JSON.stringify(proof,null,2));console.log('slowStartExpiry',JSON.stringify(proof));
  assert(response,'admitted Start response must remain receivable beyond the12s normal request timeout');assert.equal(response.status(),200);assert.equal(receipt.outcome,'accepted');assert.equal(receipt.completedSteps,5);assert.equal(receipt.startSent,true);assert.equal(receipt.partial,false);assert.equal(wire.length,1,'expiry never creates any second browser action');assert.equal(wire[0].body.taskId,before.taskId);assert.equal(receipt.requestId,wire[0].body.requestId);assert(receivedAt>=before.expiresAt*1000,'accepted arrives after the original UI admission expiry');assert(receivedAt-touchedAt>=16000&&receivedAt-touchedAt<25000);
  const writes=effectWrites(value);assert.deepEqual(writes.map(row=>row[0]),['services/select/select_option','services/select/select_option','services/select/select_option','services/vacuum/set_fan_speed','services/vacuum/send_command']);assert.deepEqual(writes.at(-1)[1],{entity_id:'vacuum.qrevo',command:'app_segment_clean',params:[{segments:[16,17],repeat:1}]});assert.equal(value.robot.state,'cleaning');assert.equal(value.robot.slowStartPosts.length,5);for(const post of value.robot.slowStartPosts.slice(0,4))assert(post.completedAt-post.receivedAt>=4);
  assert.equal(initialPending.pending,true);assert.equal(afterExpiry.pending,true,'original admitted operation retains in-flight custody');assert.equal(afterExpiry.operation?.taskId,before.taskId);assert.equal(afterExpiry.receipt?.outcome,'pending','offer expiry cannot falsely declare an in-flight Start UNKNOWN');assert(afterExpiry.busy.length>0,'pending stays visibly attached to the original Start');assert.equal(settled.receipt?.outcome,'accepted');assert.match(settled.panelText,/modtaget/i,'late accepted receipt remains visible');assert.deepEqual(errors,[]);const normalStart=normal.visibleStart[0],busyStart=afterExpiry.visibleStart[0];assert.equal(busyStart.rect.width,normalStart.rect.width,'pending retains the canonical button width');assert.equal(busyStart.rect.height,normalStart.rect.height);assert.equal(busyStart.iconVisibility,'visible','canonical progress retains the leading icon');assert(busyStart.pseudoRect&&busyStart.labelRect);assert(busyStart.pseudoRect.x-(busyStart.labelRect.x+busyStart.labelRect.width)>=busyStart.progressGap-0.1,'spinner owns its reserved gap beside the label');console.log(JSON.stringify({receiptBoundary:'PASS',progressGeometry:'PASS',elapsedMs:receivedAt-touchedAt,originalRequestId:receipt.requestId}));
  // Observe only the ordinary existing home poll; no forced read or UI state edit.
  let observedCleaning=false;try{await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state.devices.some(d=>d.id==='vacuum.qrevo'&&d.live===true&&!d.stale&&d.status==='cleaning'),undefined,{timeout:20000});observedCleaning=true;}catch{}
  const observed=await page.locator('pv-widget-host').evaluate(h=>({at:Date.now(),devices:h.state.devices.filter(d=>d.kind==='vacuum').map(d=>({id:d.id,status:d.status,stale:d.stale,telemetry:d.telemetry})),panelText:h.liveControls.robotPanel?.innerText??'',liveHomeAt:h.liveHomeAt}));await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-slow-start-observed.png')});await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-slow-start-observed.json'),JSON.stringify({receiptBoundary:'PASS',progressGeometry:'PASS',observedCleaning,observed},null,2));assert(observedCleaning,'ordinary existing home observation eventually shows the inert native cleaning state');assert.match(observed.panelText,/Rengør/);assert.deepEqual(errors,[]);console.log(JSON.stringify({outcome:'PASS',actualStartOutlivesOriginalLease:true,settingHttpDelays:4,settingDelayMs:4000,oneStart:true,observedCleaning:true,servedBundleSha256:proof.servedBundleSha256}));return;
 }
 if(process.env.ROBOT_DRAFT_TEST==='1'){
  await testEnv.openOverview(page);
  const card=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
  await card.waitFor({timeout:15000});
  await card.tap();
  const host=page.locator('pv-widget-host'),panel=page.locator('pv-robot-control-panel');
  const room=panel.getByRole('button',{name:'Køkkenalrum',exact:true});
  const setting=key=>panel.locator(`[data-setting-concept=${key}]`);
  const choice=(key,name)=>setting(key).getByRole('radio',{name,exact:true});
  const modeNames=['Støvsug og vask','Støvsug','Vask'];
  const both=choice('mode',modeNames[0]),vacuum=choice('mode',modeNames[1]),mop=choice('mode',modeNames[2]);
  const extreme=choice('water','Extreme'),max=choice('suction','Maks.');
  const fast=choice('mop_mode','Hurtig'),twice=choice('repeat','2×');
  await room.waitFor({state:'visible',timeout:15000});
  await room.tap();
  assert.equal(await room.getAttribute('aria-pressed'),'true');
  assert.deepEqual(await setting('mode').locator('label:visible').allTextContents(),modeNames);
  assert.equal(await setting('repeat').getByRole('radio').count(),2);
  assert.equal(await choice('repeat','3×').count(),0);
  const geometry=()=>panel.locator('.robot-type-options').evaluate(group=>{
   const {x,y}=group.getBoundingClientRect();
   return ['mop_mode','repeat'].map(key=>{
    const {left,top}=group.querySelector(`[data-setting-concept=${key}]`).getBoundingClientRect();
    return {x:left-x,y:top-y};
   });
  });
  if(process.env.ROBOT_WATER_RECOVERY_TEST!=='1'&&process.env.ROBOT_LONG_SESSION_TEST!=='1'){
   const quiet=choice('suction','Stille');
   await vacuum.tap();await quiet.tap();await both.tap();await mop.tap();
   const previous=await host.evaluate(h=>{
    const panel=h.liveControls.robotPanel;
    window.robotModeBeforeRenewal=panel.cleaningSubmit;
    return panel.value.task.taskId;
   });
   const renewed=page.waitForResponse(response=>{
    const request=response.request();
    return response.ok()&&new URL(request.url()).pathname==='/view/api/control/setup'
     &&request.postDataJSON()?.renewTaskId===previous;
   },{timeout:15000});
   // Change the inert owner's raw state while the panel displays the same robot.
   // The active draft can still be restored, but the old form cannot rebind.
   await update({robotState:'idle'});
   await host.evaluate(h=>h.loadLiveHome());
   const setup=(await (await renewed).json()).setup;
   assert.equal(setup.rebind?.status,'not_restored');
   assert.equal(setup.draft?.status,'restored');
   await page.waitForFunction(old=>{
    const panel=document.querySelector('pv-widget-host')?.liveControls?.robotPanel;
    return panel?.value?.task?.taskId&&panel.value.task.taskId!==old
     &&panel.cleaningSubmit!==window.robotModeBeforeRenewal;
   },previous);
   assert(await mop.isChecked(),'the rebuilt form retains the current mode');
   await vacuum.tap();
   assert(await quiet.isChecked(),'the rebuilt form restores Stille for the earlier vacuum mode');
   assert.equal(await room.getAttribute('aria-pressed'),'true');
   assert.deepEqual((await state()).robot.writes,[]);
   assert.equal(requests.filter(r=>new URL(r.url).pathname==='/view/api/control/actions').length,0);
   await update({robotState:'docked'});
   await both.tap();
  }
  const positions={both:await geometry()};
  await vacuum.tap();
  assert.equal(await setting('water').isVisible(),false);
  positions.vacuum=await geometry();
  await mop.tap();
  assert.equal(await setting('suction').isVisible(),false);
  positions.mop=await geometry();
  for(const mode of ['vacuum','mop']){
   for(const [index,{x,y}] of positions[mode].entries()){
    const previous=positions.both[index];
    assert(Math.abs(x-previous.x)<0.05&&Math.abs(y-previous.y)<0.05,`${mode} preserves route and repeat positions`);
   }
  }
  await extreme.tap();
  assert(await extreme.isChecked());
  await both.tap();
  for(const option of [extreme,max,fast,twice])await option.tap();
  const chosenOptions=[both,extreme,max,fast,twice];
  for(const option of chosenOptions)assert(await option.isChecked());
  const waterRecovery=process.env.ROBOT_WATER_RECOVERY_TEST==='1';
  const longSession=process.env.ROBOT_LONG_SESSION_TEST==='1';
  assert(!(waterRecovery&&longSession),'select the water recovery or 600 s journey');
  const before=await host.evaluate(h=>({task:h.liveControls.task?.taskId,
   expiresAt:h.liveControls.task?.expiresAt,now:Date.now()/1000,
   bootId:h.liveControls.task?.bootId,roomId:h.liveControls.task?.roomId,
   optionId:h.liveControls.robotPanel?.cleaningOptionId,
   draft:h.liveControls.robotPanel?.readCleaningDraft?.(),documentStartedAt:performance.timeOrigin}));
  assert(before.task&&before.expiresAt>before.now&&before.expiresAt-before.now<=8.5);
  assert.equal(before.draft.areaIds.length,1);
  assert.equal(before.draft.repeat,2);
  assert.deepEqual((await state()).robot.writes,[]);

  const waitingSince=performance.now();
  if(longSession){
   console.log('S4: waiting 600 s with the original robot Start settings');
   await waitForIdleRo(page,waitingSince);
  }else{
   await page.locator('#header-title-action').tap();
   await page.locator('#show-photo').tap();
   await page.locator('#photo-view').waitFor({state:'visible'});
   if(!waterRecovery){
    for(let n=0;Date.now()/1000<=before.expiresAt+0.25;n++){
     if(n>120)throw Error('server-issued task did not expire');
     await sleep(100);
    }
   }
  }
  const reportWater=kind=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({robotWaterReport:kind})}).then(response=>response.json());
  if(waterRecovery)await reportWater('stale');
  await testEnv.openOverview(page);
  await card.waitFor({timeout:15000});
  await card.tap();
  await room.waitFor({state:'visible',timeout:15000});
  if(waterRecovery){
   await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveControls?.task?.draft?.status==='awaiting_water');
   assert(await panel.getByText('Dine valg er bevaret. Start afventer en aktuel vandstatus.').isVisible());
   assert(await extreme.isChecked());
   assert(await extreme.isDisabled());
   assert.equal(await room.getAttribute('aria-pressed'),'true');
   assert(await twice.isChecked());
   const start=panel.getByRole('button',{name:'Start i Køkkenalrum',exact:true});
   assert(await start.isDisabled());
   const posts=()=>requests.filter(item=>new URL(item.url).pathname==='/view/api/control/actions');
   const deferred=await host.evaluate(async h=>{
    const task=h.liveControls.task;
    const start=task.options.find(option=>option.action==='start');
    const schema=start.argsSchema;
    const args={areaIds:[schema.areas[0].id],repeat:2,
     settingChoices:schema.settings.map(setting=>({settingId:setting.id,
      choiceId:setting.current||setting.choices[0].id}))};
    await h.liveControls.send(start.id,args);
    return {bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,optionId:start.id,args};
   });
   assert.deepEqual(posts(),[]);
   const original={bootId:before.bootId,roomId:before.roomId,taskId:before.task,optionId:before.optionId,
    args:{areaIds:before.draft.areaIds,repeat:before.draft.repeat,settingChoices:[]}};
   const refusals=await page.evaluate(async offers=>Promise.all(offers.map(async offer=>{
    const response=await fetch('/view/api/control/actions',{method:'POST',credentials:'same-origin',
     headers:{'Content-Type':'application/json','X-PodView-Request':'1'},
     body:JSON.stringify({...offer,revision:1,requestId:crypto.randomUUID()})});
    return response.json();
   })),[original,deferred]);
   for(const refusal of refusals)assert.deepEqual(refusal,{ok:false,error:'draft_awaiting_water',retryAllowed:false});
   assert.equal(posts().length,2);
   assert.deepEqual((await state()).robot.writes,[]);
   await reportWater('fresh');
  }
  await page.waitForFunction(old=>{
   const task=document.querySelector('pv-widget-host')?.liveControls?.task;
   return task?.taskId&&task.taskId!==old&&task.draft?.status==='restored';
  },before.task,{timeout:15000});
  assert.equal(await room.getAttribute('aria-pressed'),'true','fresh server remap retains the selected room');
  for(const option of chosenOptions)assert(await option.isChecked());
  let lastRead;
  if(longSession){
   assert.equal(await page.evaluate(()=>performance.timeOrigin),before.documentStartedAt);
  }else if(!waterRecovery){
   lastRead=await host.evaluate(h=>({task:h.liveControls.task.taskId,expiresAt:h.liveControls.task.expiresAt,
    observedAt:h.state.devices.find(d=>d.id==='vacuum.qrevo').observedAt}));
   const readPath=url=>url.pathname==='/view/api/home';
   await page.route(readPath,route=>route.fulfill({status:503,json:{error:'inert_robot_read_transient'}}),{times:1});
   const failedRead=page.waitForResponse(r=>readPath(new URL(r.url()))&&r.status()===503,{timeout:5000});
   await host.evaluate(h=>h.loadLiveHome());
   assert.deepEqual(await (await failedRead).json(),{error:'inert_robot_read_transient'});
   assert(await host.evaluate(h=>h.liveTransport.connected&&h.state.devices.find(d=>d.id==='vacuum.qrevo')?.stale));
   assert.equal(await room.count(),1,'same-owner read failure keeps the dirty room controls mounted');
   assert.equal(await room.getAttribute('aria-pressed'),'true');
   assert.equal(await room.isDisabled(),true,'retained draft has no authority while robot observation is stale');
   const staleAt=await host.evaluate(h=>h.state.devices.find(d=>d.id==='vacuum.qrevo').observedAt);
   assert.equal(staleAt,lastRead.observedAt);
   const expectedClock=await page.evaluate(at=>new Date(at*1000)
    .toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),staleAt);
   assert(await panel.getByText(`Sidst opdateret kl. ${expectedClock}`,{exact:false}).isVisible());
   for(const [index,{x,y}] of (await geometry()).entries()){
    assert(Math.abs(x-positions.both[index].x)<0.5&&Math.abs(y-positions.both[index].y)<0.5);
   }
   assert.deepEqual((await state()).robot.writes,[]);
   // The ordinary next home poll restores the draft even when its old offer has expired.
   await page.waitForFunction(old=>{
    const h=document.querySelector('pv-widget-host');
    const device=h?.state.devices.find(d=>d.id==='vacuum.qrevo');
    const start=h?.liveControls.robotPanel?.cleaningSubmit;
    const task=h?.liveControls.task;
    return device?.live&&!device.stale&&start&&!start.disabled&&task?.taskId!==old.task
     &&task?.draft?.status==='restored'&&Date.now()>=old.expiresAt*1000;
   },lastRead,{timeout:25000});
   assert.equal(await room.getAttribute('aria-pressed'),'true','recovery retains the unsent draft without reload');
   for(const option of [both,extreme,max,fast,twice])assert(await option.isChecked());
   await mop.tap();
   assert(await extreme.isChecked(),'the other mode draft remains independently retained');
   await both.tap();
   for(const option of [extreme,max,fast,twice])assert(await option.isChecked());
   const beforeOffline=await host.evaluate(h=>({task:h.liveControls.task.taskId,
    observedAt:h.state.devices.find(d=>d.id==='vacuum.qrevo').observedAt,
    documentStartedAt:performance.timeOrigin}));
   await page.context().setOffline(true);
   assert.equal(server.kill('SIGSTOP'),true,'suspend only the spawned inert server');
   serverSuspended=true;
   await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveTransport?.connected===false,
    undefined,{timeout:15000});
   assert.equal(await room.getAttribute('aria-pressed'),'true','offline retains selected room');
   for(const option of [both,extreme,max,fast,twice])assert(await option.isChecked());
   assert(await room.isDisabled(),'offline draft grants no control authority');
   assert.equal(await host.evaluate(h=>h.state.devices.find(d=>d.id==='vacuum.qrevo').observedAt),
    beforeOffline.observedAt,'disconnect preserves actual observation time');
   assert.equal(server.kill('SIGCONT'),true);
   serverSuspended=false;
   assert.deepEqual((await state()).robot.writes,[]);
   await page.context().setOffline(false);
   await page.waitForFunction(old=>{
    const h=document.querySelector('pv-widget-host'),task=h?.liveControls?.task;
    const device=h?.state.devices.find(d=>d.id==='vacuum.qrevo');
    return h?.liveTransport?.connected&&device?.live&&!device.stale&&task?.taskId!==old.task
     &&task?.draft?.status==='restored'&&!h.liveControls.robotPanel.cleaningSubmit.disabled;
   },beforeOffline,{timeout:30000});
   assert.equal(await page.evaluate(()=>performance.timeOrigin),beforeOffline.documentStartedAt);
   assert.equal(await room.getAttribute('aria-pressed'),'true','reconnect retains room in same document');
   for(const option of [both,extreme,max,fast,twice])assert(await option.isChecked());
   assert.deepEqual((await state()).robot.writes,[],'reconnect never starts the retained draft');
  }
  assert.deepEqual((await state()).robot.writes,[]);

  const response=page.waitForResponse(r=>r.url().endsWith('/view/api/control/actions')
   &&r.request().method()==='POST',{timeout:15000});
  await panel.getByRole('button',{name:'Start i Køkkenalrum',exact:true}).tap();
  const receipt=await (await response).json();
  assert.equal(receipt.outcome,'accepted',JSON.stringify(receipt));
  const final=(await state()).robot;
  assert.deepEqual(final.writes,[
   ['services/select/select_option',{entity_id:'select.qrevo_mode',option:'vacuum_and_mop'}],
   ['services/select/select_option',{entity_id:'select.qrevo_mop',option:'custom_water_flow'}],
   ['services/vacuum/send_command',{entity_id:'vacuum.qrevo',command:'set_water_box_distance_off',
    params:{distance_off:60}}],
   ['services/select/select_option',{entity_id:'select.qrevo_mop_mode',option:'fast'}],
   ['services/vacuum/set_fan_speed',{entity_id:'vacuum.qrevo',fan_speed:'max'}],
   ['services/vacuum/send_command',{entity_id:'vacuum.qrevo',command:'app_segment_clean',
    params:[{segments:[16],repeat:2}]}],
  ]);
  assert.equal(final.state,'cleaning');
  assert.deepEqual(errors,[]);
  assert(loadedBundleSha256&&loadedCssSha256);
  const proof={outcome:'PASS',actualServerTaskExpiry:!waterRecovery,hiddenThenReopened:true,serverRemapped:true,
   modeNames,positions,receipt,inertHAWrites:final.writes,loadedBundleSha256,loadedCssSha256};
  if(longSession)Object.assign(proof,{story:'S4',realElapsedMs:Math.floor(performance.now()-waitingSince),
   wokeFromRoInSameDocument:true,originalSelection:{room:'Køkkenalrum',mode:modeNames[0],water:'Extreme',
    suction:'Maks.',route:'Hurtig',repeat:before.draft.repeat}});
  else if(waterRecovery)Object.assign(proof,{retainedWhileWaterUnavailable:true,
   freshIndependentWaterObservation:true,directOwnerRefusals:2,automaticWrites:0});
  else Object.assign(proof,{retainedThroughStaleRead:true,recoveredOnPassivePoll:true,
   offlineDraftRetainedDisabled:true,sameDocumentOfflineRecovery:true,noWritesBeforeExplicitStart:true,lastRead});
  const proofFile=longSession?'podview-robot-long-session-start.json':'podview-robot-draft-start-proof.json';
  await fs.writeFile(path.join(testEnv.artifactDir(),proofFile),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
  return;
 }
 await testEnv.openOverview(page);
 const card=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
 const pause=page.locator('.resource-card[data-kind="vacuum"] .resource-direct-action[data-action-id="pause"]');
 await pause.waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>{const b=document.querySelector('.resource-card[data-kind="vacuum"] .resource-direct-action');return b&&!b.disabled},undefined,{timeout:15000});
 // A slow music command must leave a different physical resource operable.
 await fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delayMs:1800})});
 await page.locator('#play-pause').tap();
 await pause.tap();
 for(let n=0;(await state()).robot.state!=='paused';n++){if(n>50)throw Error('robot did not pause');await sleep(100)}
 assert.equal((await state()).robot.writes.filter(x=>x[0].endsWith('/pause')).length,1);
 await assertRobotObservation(page,requests,'pause');
 await card.tap();
 const resume=page.locator('pv-robot-control-panel [data-direct-robot="true"][data-action-id="resume"]');
 await resume.waitFor({state:'visible',timeout:15000});
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-paused-detail.png')});
 await resume.tap();
 for(let n=0;(await state()).robot.state!=='cleaning';n++){if(n>50)throw Error('robot did not resume');await sleep(100)}
 await page.locator('pv-robot-control-panel [data-direct-robot="true"][data-action-id="pause"]').waitFor({state:'visible',timeout:15000});
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-cleaning-detail.png')});
 await assertRobotObservation(page,requests,'resume');
 const panel=page.locator('pv-robot-control-panel');assert(await panel.getByText('Rengøringsvalg',{exact:true}).isVisible());
 assert.equal(await panel.getByRole('radio',{name:'Støvsug og vask',exact:true}).count(),0,'active job mode is read-only');
 const max=panel.getByRole('radio',{name:'Maks.',exact:true});await max.waitFor({state:'visible',timeout:10000});assert(await max.isEnabled(),'current source offers active suction adjustment');
 await update({robotBattery:77});await max.tap();for(let n=0;(await state()).robot.fan!=='max';n++){if(n>60)throw Error('fan adjustment not observed');await sleep(100)}
 assert.equal((await state()).robot.writes.filter(x=>x[0]==='services/vacuum/set_fan_speed').length,1);assert.deepEqual((await state()).robot.writes.find(x=>x[0]==='services/vacuum/set_fan_speed')[1],{entity_id:'vacuum.qrevo',fan_speed:'max'});
 console.log('afterBatterySetting',JSON.stringify(await state()));
 for(let n=0;!(await max.isChecked());n++){if(n>80)throw Error('accepted setting did not become observed without reopening');await sleep(100)}await max.scrollIntoViewIfNeeded();await page.evaluate(async()=>{await Promise.all(document.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-setting-observed.png')});
 // One distinct setting changes at HA after the current offer; the requested suction target remains unchanged.
 await update({robotMop:'extreme'});const balanced=panel.getByRole('radio',{name:'Balanceret',exact:true});const receipt=page.waitForResponse(r=>r.url().includes('/view/api/control/actions')&&r.request().method()==='POST',{timeout:10000});await balanced.tap();const otherSettingReceipt=await (await receipt).json();console.log('unrelatedSettingReceipt',JSON.stringify(otherSettingReceipt));assert.equal(otherSettingReceipt.outcome,'accepted');for(let n=0;(await state()).robot.fan!=='balanced';n++){if(n>60)throw Error('independent suction adjustment not observed');await sleep(100)}for(let n=0;!(await balanced.isChecked());n++){if(n>80)throw Error('observed balanced setting not projected');await sleep(100)}assert.equal((await state()).robot.writes.filter(x=>x[0]==='services/vacuum/set_fan_speed').length,2);
 const stop=panel.locator('[data-direct-robot="true"][data-action-id="stop"]').first();await stop.tap();const confirm=panel.locator('dialog.robot-action-confirm');await confirm.waitFor({state:'visible'});assert.match(await confirm.innerText(),/sendes ikke til basen/i);await confirm.getByRole('button',{name:'Afslut rengøring',exact:true}).tap();
 for(let n=0;(await state()).robot.state!=='idle';n++){if(n>60)throw Error('stop not observed');await sleep(100)}assert.equal((await state()).robot.writes.filter(x=>x[0]==='services/vacuum/stop').length,1);console.log('afterStop',JSON.stringify((await state()).robot));
 // A fresh external observation restores cleaning solely in the inert fixture; it is not a new robot start.
 await update({robotState:'cleaning',robotEffectDelayMs:1300});
 await page.reload({waitUntil:'domcontentloaded'});
 await testEnv.openOverview(page);
 const nextCard=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
 await nextCard.waitFor({timeout:15000});
 await nextCard.tap();
 const nextPanel=page.locator('pv-robot-control-panel');
 await nextPanel.locator('[id^=robot-base-][id$=-trigger]').waitFor({timeout:20000});
 await nextPanel.locator('[id^=robot-base-][id$=-trigger]').tap();
 await nextPanel.getByRole('button',{name:'Kør til basen',exact:true}).tap();
 const baseConfirm=nextPanel.locator('dialog.robot-action-confirm');
 await baseConfirm.waitFor({state:'visible'});
 await baseConfirm.getByRole('button',{name:'Kør til basen',exact:true}).tap();
 await nextPanel.getByText('På vej til basen',{exact:true}).waitFor({state:'visible',timeout:300});
 assert.equal((await state()).robot.state,'cleaning','status changes visibly before the held robot effect');
 for(let n=0;(await state()).robot.state!=='returning';n++){
  if(n>60)throw Error('base return not observed');
  await sleep(100);
 }
 assert.equal((await state()).robot.writes.filter(x=>x[0]==='services/vacuum/return_to_base').length,1);
 assert.equal((await state()).robot.writes.filter(x=>x[0]==='services/vacuum/start').length,1,'external state change and settings never start a job');
 assert.equal(otherSettingReceipt.outcome,'accepted','unrelated mop telemetry must not reject valid suction choice');

 const {createHash}=require('node:crypto'),expected=['stop','return'].map(action=>{
  const request=requests.find(row=>row.body?.domain==='vacuum'&&row.body?.action===action);assert(request,`${action} actual request`);
  return {action,requestRef:createHash('sha256').update(request.body.requestId).digest('hex').slice(0,16)};
 });
 const serverProof=expected.map(({action,requestRef})=>{
  const rows=serverLog.split('\n').filter(line=>line.includes('control_command ')&&line.includes('request_ref='+requestRef));
  assert.equal(rows.length,2,`${action} has exactly one server admission/receipt pair despite immediate reload`);
  assert(rows.some(line=>line.includes('phase=admission')&&line.includes('outcome=admitted')));
  assert(rows.some(line=>line.includes('phase=receipt')&&line.includes('outcome=accepted')&&line.includes('delivery=new')));
  assert(rows.every(line=>line.includes('physical_result_verified=false')));return {action,requestRef,rows};
 });
 const settingsRequests=requests.filter(row=>row.body?.args?.choiceId);
 assert.equal(settingsRequests.length,2,'two explicit task-based setting inputs');
 const taskServerProof=settingsRequests.map(({body})=>{
  const requestRef=createHash('sha256').update(body.requestId).digest('hex').slice(0,16);
  const rows=serverLog.split('\n').filter(line=>line.includes('control_command ')&&line.includes('request_ref='+requestRef));
  assert.equal(rows.length,2,'task setting has one server admission/receipt pair');
  assert(rows.every(line=>line.includes('kind=task')&&line.includes('domain=vacuum')&&line.includes('action=set_option')));
  assert(rows.some(line=>line.includes('phase=receipt')&&line.includes('outcome=accepted')&&line.includes('delivery=new')));return {requestRef,rows};
 });
 // Stop is authoritatively traceable even when reload precedes client upload.
 // Restored browser rows remain untrusted; do not claim they reached the store.
 const expectedClient=expected.filter(row=>row.action==='return');
 let journal;for(let n=0;n<120;n++){
  journal=await readJournal(page);
  if(expectedClient.every(({action,requestRef})=>['start','accepted'].every(code=>journal.records?.some(({row})=>row.stage==='control_action'&&row.domain==='vacuum'&&row.action===action&&row.code===code&&row.requestRef===requestRef))))break;
  await sleep(500);
 }
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-journal-witness.json'),JSON.stringify({journal,uploads,client:await page.locator('pv-widget-host').evaluate(h=>({diagnostics:h.liveTransport.diagnostics(),stopped:h.liveTransport.diagnosticUploadStopped,batch:h.liveTransport.diagnosticUploadBatch,acked:[...h.liveTransport.diagnosticUploadAcked]}))},null,2));
 for(const {action,requestRef}of expectedClient)for(const code of ['start','accepted'])assert(journal.records?.some(({row})=>row.stage==='control_action'&&row.domain==='vacuum'&&row.action===action&&row.code===code&&row.requestRef===requestRef),`persisted correlated ${action} ${code}`);
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-stop-return-journal.json'),JSON.stringify(journal,null,2));
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-robot-server-trace.json'),JSON.stringify({direct:serverProof,settings:taskServerProof},null,2));
 await fs.writeFile(path.join(testEnv.artifactDir(),'server.log'),serverLog);
 const value=await state();
 assert.equal(value.robot.writes.filter(x=>x[0].endsWith('/start')).length,1);
 assert.equal(requests.filter(x=>x.body?.domain==='vacuum'&&x.body?.action==='pause').length,1);
 assert.equal(requests.filter(x=>x.body?.domain==='vacuum'&&x.body?.action==='resume').length,1);
 assert.deepEqual(errors,[]);
 const bundle=await fetch(base+'/view/podview.bundle.js').then(r=>r.arrayBuffer());console.log(JSON.stringify({servedBundleSha256:crypto.createHash('sha256').update(Buffer.from(bundle)).digest('hex'),outcome:'PASS',actualPackagedPodView:true,inertFinalServices:true,pauseWhileMusicPending:true,detailResume:true,cleaningHeaderPause:true,serverOwnedStopReturnTrace:true,persistedReturnClientJournal:true,robotWrites:value.robot.writes,pageErrors:errors}));
 }catch(error){if(browser){const pages=browser.contexts().flatMap(c=>c.pages());if(pages[0]){await pages[0].screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-failure.png')});console.log('visibleUI',await pages[0].locator('body').innerText())}}throw error;
 }finally{if(serverSuspended)server.kill('SIGCONT');if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await closed;}}
})().catch(e=>{console.error(e);process.exitCode=1});
