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
let server,browser,serverLog='';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const update=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
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
 server=spawn(testEnv.python,[path.join(__dirname,'music_e2e_server.py')],{cwd:testEnv.runtimeRoot,env:testEnv.pythonEnv({MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,ROBOT_TEST:'1',ROBOT_DRAFT_TEST:process.env.ROBOT_DRAFT_TEST||'0',PODVIEW_TEST_NONCE:testNonce}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{serverLog+=b.toString();process.stderr.write(b)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server start timeout');await sleep(100)}
 assert.equal((await (await fetch(base+'/lab/identity')).json()).nonce,testNonce,'own isolated Python runtime nonce');
 browser=await chromium.launch(testEnv.browserOptions());
 const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}}),errors=[],requests=[],uploads=[];
 page.on('response',async response=>{if(response.url().includes('/client-diagnostics')&&response.request().method()==='POST')uploads.push({atMs:Date.now(),status:response.status(),body:await response.text().catch(()=>null)});});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/control/'))requests.push({url:r.url(),body:r.postDataJSON()})});
 if(server.exitCode!==null)throw Error('own isolated server exited before navigation');
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 if(process.env.ROBOT_DRAFT_TEST==='1'){
  await page.locator('#photo-view').tap();const card=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();await card.waitFor({timeout:15000});await card.tap();const panel=page.locator('pv-robot-control-panel'),room=panel.getByRole('button',{name:'Køkkenalrum',exact:true});await room.waitFor({state:'visible',timeout:15000});await room.tap();assert.equal(await room.getAttribute('aria-pressed'),'true');const mop=panel.getByRole('radio',{name:'Vask',exact:true}),both=panel.getByRole('radio',{name:'Støvsug og vask',exact:true}),extreme=panel.getByRole('radio',{name:'Extreme',exact:true});await mop.tap();await extreme.tap();assert(await extreme.isChecked());await both.tap();
  const before=await page.locator('pv-widget-host').evaluate(h=>({task:h.liveControls.task?.taskId,expiresAt:h.liveControls.task?.expiresAt,now:Date.now()/1000,draft:h.liveControls.robotPanel?.readCleaningDraft?.()}));console.log('draftInitial',JSON.stringify(before));assert(before.task&&before.expiresAt>before.now&&before.expiresAt-before.now<=8.5);assert.equal(before.draft.areaIds.length,1);assert.deepEqual((await state()).robot.writes,[]);
  await page.locator('#header-title-action').tap();await page.locator('#show-photo').tap();await page.locator('#photo-view').waitFor({state:'visible'});for(let n=0;Date.now()/1000<=before.expiresAt+0.25;n++){if(n>120)throw Error('server-issued task did not expire');await sleep(100)}
  const hidden=await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,task:h.liveControls.task?.taskId??null,draft:h.liveControls.expiredRobot?.draft??null}));console.log('draftHidden',JSON.stringify({before,hidden}));
  await page.locator('#photo-view').tap();await card.waitFor({timeout:15000});await card.tap();await room.waitFor({state:'visible',timeout:15000});await page.waitForFunction(old=>{const h=document.querySelector('pv-widget-host');return h?.liveControls?.task?.taskId&&h.liveControls.task.taskId!==old},before.task,{timeout:15000});
  const after=await page.locator('pv-widget-host').evaluate(h=>({task:h.liveControls.task?.taskId,draft:h.liveControls.task?.draft??null,pressed:[...document.querySelectorAll('pv-robot-control-panel button[name=areaIds]')].map(b=>({name:b.innerText,pressed:b.getAttribute('aria-pressed')})),text:document.querySelector('pv-robot-control-panel')?.innerText}));console.log('draftReopened',JSON.stringify(after));assert.equal(await room.getAttribute('aria-pressed'),'true','fresh server remap retains the selected room');assert.equal(after.draft?.status,'restored');await mop.tap();console.log('reopenedMopExtreme',await extreme.isChecked());assert(await extreme.isChecked(),'the other mode draft remains independently retained');assert.deepEqual((await state()).robot.writes,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({outcome:'PASS',actualServerTaskExpiry:true,hiddenThenReopened:true,serverRemapped:true,serviceWrites:0}));return;
 }
 await page.locator('#photo-view').waitFor({state:'visible'});await page.locator('#photo-view').tap();
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
 await update({robotState:'cleaning'});await page.reload({waitUntil:'domcontentloaded'});await page.locator('#photo-view').tap();const nextCard=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();await nextCard.waitFor({timeout:15000});await nextCard.tap();const nextPanel=page.locator('pv-robot-control-panel');await nextPanel.locator('[id^=robot-base-][id$=-trigger]').waitFor({timeout:20000});await nextPanel.locator('[id^=robot-base-][id$=-trigger]').tap();await nextPanel.getByRole('button',{name:'Kør til basen',exact:true}).tap();const baseConfirm=nextPanel.locator('dialog.robot-action-confirm');await baseConfirm.waitFor({state:'visible'});await baseConfirm.getByRole('button',{name:'Kør til basen',exact:true}).tap();for(let n=0;(await state()).robot.state!=='returning';n++){if(n>60)throw Error('base return not observed');await sleep(100)}assert.equal((await state()).robot.writes.filter(x=>x[0]==='services/vacuum/return_to_base').length,1);
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
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await closed;}}
})().catch(e=>{console.error(e);process.exitCode=1});
