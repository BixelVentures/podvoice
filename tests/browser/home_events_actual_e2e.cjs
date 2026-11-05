'use strict';
const {chromium}=require('playwright');
const testEnv=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const root=testEnv.root,port=18978,base=`http://127.0.0.1:${port}`;
let server,browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const emit=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const readOwnerJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-home-events-'));
 server=spawn(testEnv.python,[path.join(__dirname,'home_events_e2e_server.py')],{cwd:testEnv.runtimeRoot,env:testEnv.pythonEnv({HOME_EVENT_TEST_PORT:String(port),HOME_EVENT_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server startup');await sleep(100)}
 browser=await chromium.launch(testEnv.browserOptions());
 const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}}),errors=[],homeRequests=[];
 let releaseInitialSetup,initialSetupHeld=false;
 const initialSetupGate=new Promise(resolve=>{releaseInitialSetup=resolve});
 await page.route('**/view/api/control/setup',async route=>{const response=await route.fetch();if(!initialSetupHeld){initialSetupHeld=true;await initialSetupGate;}await route.fulfill({response});});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(new URL(r.url()).pathname==='/view/api/home')homeRequests.push(Date.now())});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>{window.homeTestClicks=[];document.addEventListener('click',e=>window.homeTestClicks.push({target:e.target.outerHTML?.slice(0,200),focus:document.querySelector('pv-widget-host')?.state?.focus}),true)});
 await testEnv.openOverview(page);
 const card=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
 await card.waitFor({state:'visible',timeout:15000});console.log('beforeCard',await card.evaluate(b=>({button:b.outerHTML,focus:document.querySelector('pv-widget-host')?.state?.focus})));await card.tap();await sleep(100);console.log('afterCard',await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,status:h.liveStatus,pending:h.liveHomePending,devices:h.state.devices.map(d=>({id:d.id,live:d.live,status:d.status}))})));
 const panel=page.locator('pv-robot-control-panel');await panel.waitFor({state:'visible'});
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.liveSnapshot?.homeRevision&&h.liveHomePending===false},undefined,{timeout:15000});
 for(let n=0;(await state()).subscriptions<4;n++){if(n>100)throw Error('HA subscription ACKs missing');await sleep(100)}
 await sleep(300);
 assert(initialSetupHeld,'the first actual setup response is held');
 const baseButton=panel.getByRole('button',{name:'Base',exact:true});await baseButton.tap();await baseButton.focus();
 assert(await baseButton.evaluate(b=>b.ownerDocument.activeElement===b),'Base is focused before setup completion');
 assert.equal(await baseButton.getAttribute('aria-expanded'),'true','touch opens Base while setup is held');
 console.log('heldSetupBefore',await panel.evaluate(p=>({task:p.value?.task?.taskId,focused:document.activeElement===p.baseDisclosure?.trigger,expanded:p.baseDisclosure?.trigger.getAttribute('aria-expanded')})));
 releaseInitialSetup();await page.waitForFunction(()=>!!document.querySelector('pv-robot-control-panel')?.value?.task,undefined,{timeout:10000});
 console.log('heldSetupAfter',await panel.evaluate(p=>({task:p.value?.task?.taskId,focused:document.activeElement===p.baseDisclosure?.trigger,expanded:p.baseDisclosure?.trigger.getAttribute('aria-expanded')})));
 assert(await baseButton.evaluate(b=>b.ownerDocument.activeElement===b),'focus survives first setup completion');
 assert.equal(await baseButton.getAttribute('aria-expanded'),'true','touch-open Base survives first setup completion');
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-robot-base-first-setup-retained.png')});
 await baseButton.tap();await baseButton.focus();const beforeGeometry=await baseButton.boundingBox();
 await baseButton.evaluate(b=>{b.dataset.testContinuity='retained'});
 const before=await page.locator('pv-widget-host').evaluate(h=>h.liveSnapshot.homeRevision);
 const readsBefore=homeRequests.length;
 await emit({irrelevant:true});await sleep(400);
 const irrelevant=await page.locator('pv-widget-host').evaluate(h=>h.liveSnapshot.homeRevision);
 assert.deepEqual(irrelevant,before,'unrelated HA entity does not leak a client revision');
 assert.equal(homeRequests.length,readsBefore,'unrelated event does not trigger home read');
 const started=Date.now();await emit({state:'paused'});
 await page.waitForFunction(()=>document.querySelector('pv-robot-control-panel')?.textContent.includes('Rengøring på pause'),undefined,{timeout:4000});
 const latency=Date.now()-started;
 const after=await page.locator('pv-widget-host').evaluate(h=>h.liveSnapshot.homeRevision);
 assert.equal(after.scope,before.scope);assert(after.revision>before.revision);
 const domRetained=await baseButton.getAttribute('data-test-continuity')==='retained';
 assert(await baseButton.evaluate(b=>b.ownerDocument.activeElement===b),'focus survives a passive state update');
 const afterGeometry=await baseButton.boundingBox();for(const k of ['x','y','width','height'])assert(Math.abs(afterGeometry[k]-beforeGeometry[k])<2,'control geometry remains stable: '+k);
 assert.deepEqual((await state()).writes,[],'external observation has no service write');
 await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-home-push-paused.png')});
 // One old read may complete; a burst schedules one follow-up, without starvation.
 await emit({holdRead:true});await emit({state:'cleaning'});
 for(let n=0;!(await state()).readHeld;n++){if(n>60)throw Error('controlled old read was not reached');await sleep(50)}
 await emit({state:'paused'});await emit({state:'cleaning'});await emit({releaseRead:true});
 await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return h?.state.devices.find(d=>d.kind==='vacuum')?.status==='cleaning'&&!h.liveHomePending},undefined,{timeout:4000});
 assert.deepEqual((await state()).writes,[]);
 const connections=(await state()).connections;
 await emit({disconnect:true});
 for(let n=0;(await state()).connections<=connections;n++){if(n>100)throw Error('HA read stream did not reconnect');await sleep(100)}
 await emit({state:'paused'});
 await page.waitForFunction(()=>document.querySelector('pv-robot-control-panel')?.textContent.includes('Rengøring på pause'),undefined,{timeout:4000});
 // The real root/view documents run inside a Supervisor-shaped opaque prefix.
 // Only the outer HA properties/navigation protocol is an inert fixture.
 const shell=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});
 shell.on('pageerror',e=>errors.push(e.message));
 await shell.goto(base+'/app/inert_podvoice/view',{waitUntil:'domcontentloaded'});
 const frame=shell.frameLocator('#ha-frame');
 await frame.locator('pv-widget-host').waitFor({state:'visible',timeout:15000});
 await testEnv.openOverview(frame);
 await frame.locator('#header-ro').tap();
 await frame.locator('#screen-device-more-summary').tap();
 const admin=frame.getByRole('link',{name:'Administration',exact:true});
 await admin.waitFor({state:'visible',timeout:10000});
 assert.equal(await admin.getAttribute('href'),base+'/api/hassio_ingress/inert-session/');
 const dialog=frame.locator('#quick-sheet'),scrollEvidence=[];
 const recordScroll=async (width,height,stage)=>{const geometry=await dialog.evaluate(d=>{const a=[...d.querySelectorAll('a')].find(node=>node.textContent==='Administration'),box=d.getBoundingClientRect(),button=a.getBoundingClientRect();return {dialog:{top:box.top,bottom:box.bottom,height:box.height},admin:{top:button.top,bottom:button.bottom,height:button.height},padding:Number.parseFloat(getComputedStyle(d).paddingBottom),scrollTop:d.scrollTop,scrollHeight:d.scrollHeight,clientHeight:d.clientHeight};});scrollEvidence.push({width,height,stage,...geometry});await fs.writeFile(path.join(testEnv.artifactDir(),'podview-screen-admin-scroll.json'),JSON.stringify(scrollEvidence,null,2));};
 for(const [width,height] of [[1280,800],[768,600]]){
  await shell.setViewportSize({width,height});await dialog.evaluate(async d=>{await Promise.all(d.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await recordScroll(width,height,'initial');for(let swipe=0;swipe<4&&await dialog.evaluate(d=>d.scrollTop>0);swipe++){await testEnv.touchScroll(shell,dialog,{dy:-800});await recordScroll(width,height,`up-${swipe}`);}
  for(let gesture=0;gesture<4;gesture++){await testEnv.touchScroll(shell,dialog,{dy:800});await recordScroll(width,height,`down-${gesture}`);const fits=await dialog.evaluate(d=>{const a=[...d.querySelectorAll('a')].find(node=>node.textContent==='Administration'),box=d.getBoundingClientRect(),button=a.getBoundingClientRect();return button.bottom<=box.bottom-Number.parseFloat(getComputedStyle(d).paddingBottom)+1;});if(fits)break;}
  await shell.waitForFunction(()=>document.querySelector('#ha-frame')?.contentDocument?.querySelector('#quick-sheet')?.scrollTop>0,undefined,{timeout:5000});
  const geometry=await dialog.evaluate(d=>{const a=[...d.querySelectorAll('a')].find(node=>node.textContent==='Administration'),box=d.getBoundingClientRect(),button=a.getBoundingClientRect();return {left:box.left,top:box.top,width:box.width,height:box.height,bottom:box.bottom,buttonTop:button.top,buttonBottom:button.bottom,scrollTop:d.scrollTop,padding:Number.parseFloat(getComputedStyle(d).paddingBottom)};});
  await shell.screenshot({path:path.join(testEnv.artifactDir(),`podview-next-screen-admin-${width}.png`)});
  assert.equal(geometry.width,520);assert(Math.abs(geometry.left-(width-geometry.width)/2)<1);assert(Math.abs(geometry.top-(height-geometry.height)/2)<1);assert(geometry.scrollTop>0);assert(geometry.buttonTop>=geometry.top);assert(geometry.buttonBottom<=geometry.bottom-geometry.padding+1,'manual scroll reveals whole Administration control with bottom padding');
 }
 await shell.setViewportSize({width:1280,height:800});
 await admin.tap();
 await shell.waitForURL(base+'/app/inert_podvoice',{timeout:10000});
 await frame.getByRole('link',{name:'Åbn PodView',exact:true}).waitFor({state:'visible',timeout:10000});
 await sleep(500);assert.equal(new URL(shell.url()).pathname,'/app/inert_podvoice','admin does not bounce back into /view');
 await frame.getByRole('link',{name:'Åbn PodView',exact:true}).tap();
 await shell.waitForURL(base+'/app/inert_podvoice/view',{timeout:10000});
 await frame.locator('pv-widget-host').waitFor({state:'visible',timeout:10000});
 await shell.reload({waitUntil:'domcontentloaded'});
 await shell.frameLocator('#ha-frame').locator('pv-widget-host').waitFor({state:'visible',timeout:10000});
 let journal;
 for(let n=0;n<60;n++){journal=await readOwnerJournal(page);if(journal.records?.some(record=>record.row.stage==='home_read'&&record.row.code==='ok'&&record.row.readHash))break;await sleep(250);}
 const read=journal.records.map(record=>record.row).find(row=>row.stage==='home_read'&&row.code==='ok'&&row.readHash);assert(read,'actual HA event read is persisted');assert.equal(read.source,'home_assistant');assert.equal(read.trust,'state_observation');assert(journal.records.some(record=>record.row.stage==='request'&&record.row.endpoint==='home'&&record.row.code==='ok'&&record.row.readHash===read.readHash),'owner and actual HTTP read share local diagnostic correlation');await fs.writeFile(path.join(testEnv.artifactDir(),'podview-home-read-journal.json'),JSON.stringify(journal,null,2));
 assert.deepEqual(errors,[]);assert.deepEqual((await state()).writes,[]);
 console.log(JSON.stringify({outcome:'PASS',persistedHomeReadJournal:true,actualPackagedPodView:true,actualHAWebSocketProtocol:true,inertHAEntities:true,haShellProtocolFixture:true,adminRoundTrip:true,stableParentRouteReload:true,externalUpdateLatencyMs:latency,unrelatedEventIgnored:true,focusRetained:true,firstSetupTouchDisclosureRetained:true,domRetained,controlGeometryRetained:true,burstFollowup:true,reconnect:true,serviceWrites:0,pageErrors:errors}));
 }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(testEnv.artifactDir(),'podview-home-events-failure.png')});console.log('failureState',JSON.stringify({server:await state(),ui:await page.locator('body').innerText(),debug:await page.locator('pv-widget-host').evaluate(h=>({focus:h.state.focus,active:document.activeElement?.outerHTML?.slice(0,400),status:h.liveStatus,pending:h.liveHomePending,clicks:window.homeTestClicks,revision:h.liveSnapshot?.homeRevision}))}))}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
