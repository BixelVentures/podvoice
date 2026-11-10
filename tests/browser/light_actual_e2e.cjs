'use strict';
const {chromium}=require('playwright');
const env=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const port=Number(process.env.LIGHT_TEST_PORT||18979),base=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
const update=body=>fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
let server,browser;
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-light-e2e-'));
 server=spawn(env.python,[path.join(__dirname,'light_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({LIGHT_TEST_PORT:String(port),LIGHT_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(/\/view\/api\/(home|control)/.test(r.url()))console.log('API',Date.now(),r.status(),r.url(),(await r.text().catch(()=>'' )));});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);
 const card=page.locator('.resource-preview[data-kind="light"]:visible').first();await card.waitFor({timeout:15000});await card.tap();
 const row=page.locator('.light-room-power').first();await row.waitFor({state:'visible',timeout:15000});
 console.log('initial',await page.locator('#device-view').innerText());
 assert.deepEqual((await state()).writes,[],'navigation has no HA effects');
 await page.waitForFunction(()=>{const b=document.querySelector('.light-room-power');return b&&!b.disabled},undefined,{timeout:15000});
 await page.waitForFunction(()=>{
  const host=document.querySelector('pv-widget-host');
  return host?.liveHomeApplied?.revision>0&&!host.liveHomePending;
 },undefined,{timeout:5000});
 await update({holdRead:true});await page.getByRole('button',{name:'Opdater lys'}).tap();for(let n=0;!(await state()).readHeld;n++){if(n>30)throw Error('light read not held');await sleep(25)}
 await update({voice:true});await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.sessionId==='s2',undefined,{timeout:1500});assert(await row.isVisible(),'light control remains visible during voice update and held read');await update({releaseRead:true});await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return !h.lightAreaPending&&!h.liveHomePending},undefined,{timeout:8000});
 assert(await row.isEnabled(),'light controls remain enabled after unrelated voice turn');assert.equal((await state()).writes.length,0);
 await row.evaluate(element=>{
  element.addEventListener('click',()=>{
   const start=performance.now();
   new MutationObserver((_,observer)=>{
    if(element.getAttribute('aria-busy')!=='true')return;
    window.lightFeedbackMs=performance.now()-start;observer.disconnect();
   }).observe(element,{attributes:true,attributeFilter:['aria-busy']});
  },{once:true,capture:true});
 });
 await update({holdIntent:true});await row.tap();for(let n=0;!(await state()).intentHeld;n++){if(n>100)throw Error('intent not held');await sleep(25)}
 const roomFeedbackMs=await page.evaluate(()=>window.lightFeedbackMs);
 assert(roomFeedbackMs>=0&&roomFeedbackMs<100,`room button responds during the held HA command: ${roomFeedbackMs} ms`);
 assert.equal(await row.getAttribute('aria-pressed'),'true','pending feedback is distinct from observed room power');
 assert.equal(await row.isEnabled(),true,'same-room power remains available for a second touch');
 await row.tap();
 assert.equal((await state()).writes.length,1,'the second touch waits for the first observation');
 await update({voice:true,voiceSession:'s3'});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.sessionId==='s3',
  undefined,{timeout:2000});
 await update({releaseIntent:true});
 await page.waitForFunction(()=>{
  const controls=document.querySelector('pv-widget-host')?.liveControls;
  return [...(controls?.lightActions?.values()||[])].every(entry=>!entry.queue&&!entry.operation);
 },undefined,{timeout:5000});
 assert.deepEqual((await state()).writes.map(write=>write.name),['HassTurnOff','HassTurnOn']);
 assert.equal((await state()).light.state,'on');
 console.log('afterOn',await page.locator('#device-view').innerText());
 await page.locator('#light-lamps-trigger').tap();console.log('lamps',await page.locator('#device-view').innerText());
 const slider=page.locator('input[type=range]:visible').first();await slider.waitFor({timeout:5000});
 await update({holdIntent:true});
 await env.touchRange(page,slider,49,{thumbSize:32,beforeRelease:async()=>{
  assert.equal(await slider.inputValue(),'49','active finger drag previews the selected level');
 }});
 for(let n=0;!(await state()).intentHeld;n++){if(n>100)throw Error('brightness intent not held');await sleep(25)}
 assert.equal(await slider.inputValue(),'49','released slider keeps selected brightness during the held response');
 assert.equal(await slider.locator('..').getAttribute('data-field-state'),'pending');
 assert.equal(await slider.isEnabled(),true,'the pending dimmer accepts another drag');
 await env.touchRange(page,slider,62,{thumbSize:32});
 assert.equal(await slider.inputValue(),'62','shows the newly queued absolute choice');
 await env.touchRange(page,slider,37,{thumbSize:32});
 assert.equal(await slider.inputValue(),'37','latest absolute choice supersedes the older queued choice');
 assert.equal((await state()).writes.length,3);
 await update({releaseIntent:true});
 await page.waitForFunction(()=>{
  const host=document.querySelector('pv-widget-host');
  return [...(host?.liveControls?.lightActions?.values()||[])].every(entry=>!entry.queue)&&host?.currentLightDevice()?.observedLights?.[0]?.brightness===94;
 },undefined,{timeout:5000});
 assert.deepEqual((await state()).writes.slice(2).map(write=>[write.name,write.args.brightness]),
  [['HassLightSet',49],['HassLightSet',37]]);
 assert((await state()).writes.every(write=>write.args.name==='light.kitchen_ceiling'));
 for(let n=0;!(await state()).sourceConnected;n++){
  if(n>100)throw Error('inert HA event subscription not connected');
  await sleep(25);
 }
 const externalStarted=performance.now();
 await update({externalLight:{state:'off'}});
 await page.waitForFunction(()=>document.querySelector('.light-room-power')?.getAttribute('aria-pressed')==='false',
  undefined,{timeout:1500});
 const externalChangeMs=performance.now()-externalStarted;
 assert(externalChangeMs<1500,`external source → room display took ${externalChangeMs} ms`);
 assert.equal(await slider.inputValue(),'0');
 await update({externalLight:{state:'unavailable',brightness:null}});
 await page.waitForFunction(()=>document.querySelector('.light-lamp-state')?.textContent==='Ikke tilgængelig');
 assert.equal(await row.isEnabled(),false,'unknown room state revokes room power authority');
 assert.equal(await slider.isEnabled(),false,'missing lamp state revokes brightness authority');
 await page.context().setOffline(true);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.browserOffline===true);
 await update({externalLight:{state:'on',brightness:153}});
 await page.context().setOffline(false);
 await page.waitForFunction(()=>{
  const host=document.querySelector('pv-widget-host');
  return host?.liveTransport?.connected&&!host.browserOffline;
 });
 await page.locator('#header-title-action').tap();
 await card.waitFor({state:'visible'});
 await card.tap();
 await row.waitFor({state:'visible'});
 await page.waitForFunction(()=>{
  const button=document.querySelector('.light-room-power');
  return button&&!button.disabled&&button.getAttribute('aria-pressed')==='true';
 },undefined,{timeout:10000});
 if(await page.locator('#light-lamps-trigger').getAttribute('aria-expanded')!=='true'){
  await page.locator('#light-lamps-trigger').tap();
 }
 assert.equal(await slider.inputValue(),'60','reopened scope displays the latest observed brightness');
 assert.equal((await state()).writes.length,4,'passive reads, outage, reconnect and reopening never send an effect');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-light-success.png')});
 await update({holdIntent:true,unknownIntent:true});
 await row.tap();
 for(let n=0;!(await state()).intentHeld;n++){if(n>100)throw Error('unknown intent not held');await sleep(25)}
 await row.tap();
 assert.equal((await state()).writes.length,5);
 await update({releaseIntent:true});
 await page.waitForFunction(()=>{
  const controls=document.querySelector('pv-widget-host')?.liveControls;
  const lights=[...(controls?.lightActions?.values()||[])];
  return lights.some(entry=>entry.state?.outcome==='unknown')&&lights.every(entry=>!entry.queue);
 },undefined,{timeout:5000});
 await update({externalLight:{state:'off'}});
 await page.waitForFunction(()=>document.querySelector('.light-room-power')?.getAttribute('aria-pressed')==='false');
 assert.equal((await state()).writes.length,5,'UNKNOWN discards the queued tap even after a fresh observation');
 await update({externalLight:{state:'on'}});
 await page.waitForFunction(()=>document.querySelector('.light-room-power')?.getAttribute('aria-pressed')==='true');
 await update({holdIntent:true});
 await row.tap();
 for(let n=0;!(await state()).intentHeld;n++){if(n>100)throw Error('intent not held before read failure');await sleep(25)}
 await row.tap();
 await update({externalLight:{state:'off'}});
 await page.waitForFunction(()=>document.querySelector('.light-room-power')?.getAttribute('aria-pressed')==='false');
 await page.route('**/view/api/home?*',route=>new URL(route.request().url()).searchParams.has('lightArea')
  ?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.continue());
 await update({releaseIntent:true});
 await page.waitForFunction(()=>{
  const controls=document.querySelector('pv-widget-host')?.liveControls;
  const lights=[...(controls?.lightActions?.values()||[])];
  return lights.some(entry=>entry.state?.outcome==='accepted')&&lights.every(entry=>!entry.queue);
 },undefined,{timeout:5000});
 assert.equal((await state()).writes.length,6,'a prior matching push cannot replace the failed post-action read');
 await page.unroute('**/view/api/home?*');
 await page.locator('input[type=radio][name=light-room][value=living-id]').locator('..').tap();
 const living=page.locator('.light-lamp-row[data-lamp-id="light.living_floor"]');
 await living.getByText('Tændt',{exact:true}).waitFor({state:'visible'});
 const foreignStarted=performance.now();
 await update({area:'living-id',externalLight:{state:'off'}});
 await living.getByText('Slukket',{exact:true}).waitFor({state:'visible',timeout:1500});
 const foreignChangeMs=performance.now()-foreignStarted;
 assert(foreignChangeMs<1500,`foreign source → selected light detail took ${foreignChangeMs} ms`);
 assert.equal(await page.locator('#light-room-panel-title').innerText(),'Stuen');
 let intercepted=false,captured=false,releaseScoped;
 const release=new Promise(resolve=>{releaseScoped=resolve;});
 await page.route('**/view/api/home?*',async route=>{
  if(intercepted||!new URL(route.request().url()).searchParams.has('lightArea'))return route.continue();
  intercepted=true;
  const response=await route.fetch();
  captured=true;
  await release;
  await route.fulfill({response});
 });
 try{
  await page.getByRole('button',{name:'Opdater lys'}).tap();
  for(let n=0;!captured;n++){
   if(n>100)throw Error('foreign scoped read was not captured');
   await sleep(25);
  }
  const previous=await page.locator('pv-widget-host').evaluate(host=>host.liveHomeApplied.revision);
  await update({area:'living-id',externalLight:{state:'on'}});
  await page.waitForFunction(revision=>document.querySelector('pv-widget-host')?.liveHomeApplied?.revision>revision,
   previous,{timeout:1500});
 }finally{releaseScoped();}
 await living.getByText('Tændt',{exact:true}).waitFor({state:'visible',timeout:1500});
 assert.equal((await state()).writes.length,6,'foreign source observation is read only');
 // The real Python broker admits one action at a time per area, even for different target keys.
 await page.locator('input[type=radio][name=light-room][value=kitchen-id]').locator('..').tap();
 await page.waitForFunction(()=>{
  const host=document.querySelector('pv-widget-host');
  return host?.currentLightDevice()?.lightScope?.areaId==='kitchen-id'&&!host.lightAreaPending;
 });
 const beforeLane=(await state()).writes.length;
 await update({holdIntent:true});
 await row.tap();
 for(let n=0;!(await state()).intentHeld;n++){
  if(n>100)throw Error('same-area first intent not held');
  await sleep(25);
 }
 await env.touchRange(page,slider,45,{thumbSize:32});
 assert.equal((await state()).writes.length,beforeLane+1,'lamp intent waits behind the room action');
 await update({releaseIntent:true});
 await page.waitForFunction(()=>{
  const controls=document.querySelector('pv-widget-host')?.liveControls;
  return [...(controls?.lightActions?.values()||[])].every(entry=>!entry.queue&&!entry.operation);
 },undefined,{timeout:5000});
 assert.deepEqual((await state()).writes.slice(beforeLane).map(write=>write.name),['HassTurnOn','HassLightSet']);
 assert.equal((await state()).light.brightness,115);
 assert.deepEqual(errors,[]);
 const servedBundle=await fetch(base+'/view/podview.bundle.js').then(r=>r.arrayBuffer()),servedBundleSha256=crypto.createHash('sha256').update(Buffer.from(servedBundle)).digest('hex');
 console.log(JSON.stringify({servedBundleSha256,roomFeedbackMs,externalChangeMs,foreignChangeMs,voiceDuringHeldIntent:true,outcome:'PASS',actualPackagedPodView:true,actualBridgeAndToolRouter:true,inertHABoundary:true,musicUnconfigured:true,navigationEffects:0,intents:(await state()).writes,voiceDuringHeldRead:true}));
 }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(env.artifactDir(),'podview-light-failure.png')});console.log('failureState',JSON.stringify({server:await state(),ui:await page.locator('body').innerText(),host:await page.locator('pv-widget-host').evaluate(h=>({light:h.currentLightDevice(),areas:h.state.lightAreas,problem:h.lightReadProblem?.text,feedback:h.liveControls?.lightActionState}))}));}throw error}
 finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
