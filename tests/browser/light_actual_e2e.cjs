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
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await page.locator('#photo-view').tap();
 const card=page.locator('.resource-preview[data-kind="light"]:visible').first();await card.waitFor({timeout:15000});await card.tap();
 const row=page.locator('.light-room-power').first();await row.waitFor({state:'visible',timeout:15000});
 console.log('initial',await page.locator('#device-view').innerText());
 assert.deepEqual((await state()).writes,[],'navigation has no HA effects');
 await page.waitForFunction(()=>{const b=document.querySelector('.light-room-power');return b&&!b.disabled},undefined,{timeout:15000});
 await update({holdRead:true});await page.getByRole('button',{name:'Opdater lys'}).tap();for(let n=0;!(await state()).readHeld;n++){if(n>30)throw Error('light read not held');await sleep(25)}
 await update({voice:true});await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.sessionId==='s2',undefined,{timeout:1500});assert(await row.isVisible(),'light control remains visible during voice update and held read');await update({releaseRead:true});await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host');return !h.lightAreaPending&&!h.liveHomePending},undefined,{timeout:8000});
 assert(await row.isEnabled(),'light controls remain enabled after unrelated voice turn');assert.equal((await state()).writes.length,0);
 await update({holdIntent:true});await row.tap();for(let n=0;!(await state()).intentHeld;n++){if(n>100)throw Error('intent not held');await sleep(25)}
 assert.equal((await state()).writes.length,1);await update({voice:true,voiceSession:'s3'});await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.voice?.sessionId==='s3',undefined,{timeout:2000});await update({releaseIntent:true});
 await page.waitForFunction(()=>{const b=document.querySelector('.light-room-power');return b&&!b.disabled&&b.getAttribute('aria-label')==='Tænd alle lys i Køkkenet'},undefined,{timeout:5000});
 assert.equal((await state()).writes.length,1);assert.equal((await state()).writes[0].name,'HassTurnOff');assert.equal((await state()).light.state,'off');
 await row.tap();await page.waitForFunction(()=>{const b=document.querySelector('.light-room-power');return b&&!b.disabled&&b.getAttribute('aria-label')==='Sluk alle lys i Køkkenet'},undefined,{timeout:5000});
 assert.equal((await state()).writes.length,2);assert.equal((await state()).writes[1].name,'HassTurnOn');assert.equal((await state()).light.state,'on');
 console.log('afterOn',await page.locator('#device-view').innerText());
 await page.locator('#light-lamps-trigger').tap();console.log('lamps',await page.locator('#device-view').innerText());
 const slider=page.locator('input[type=range]:visible').first();await slider.waitFor({timeout:5000});await env.touchRange(page,slider,49,{thumbSize:32});
 for(let n=0;(await state()).writes.length<3;n++){if(n>100)throw Error('brightness command not sent');await sleep(100)}
 assert.equal((await state()).writes.length,3);assert.equal((await state()).writes[2].name,'HassLightSet');assert.equal((await state()).writes[2].args.brightness,49);await page.waitForFunction(()=>{const h=document.querySelector('pv-widget-host'),v=h?.currentLightDevice()?.observedLights?.[0];return v?.brightness===125},undefined,{timeout:5000});assert.deepEqual((await state()).writes.map(w=>w.args.name),['light.kitchen_ceiling','light.kitchen_ceiling','light.kitchen_ceiling']);
 assert.equal((await state()).writes.length,3);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(env.artifactDir(),'podview-light-success.png')});
 const servedBundle=await fetch(base+'/view/podview.bundle.js').then(r=>r.arrayBuffer()),servedBundleSha256=crypto.createHash('sha256').update(Buffer.from(servedBundle)).digest('hex');
 console.log(JSON.stringify({servedBundleSha256,voiceDuringHeldIntent:true,outcome:'PASS',actualPackagedPodView:true,actualBridgeAndToolRouter:true,inertHABoundary:true,musicUnconfigured:true,navigationEffects:0,intents:(await state()).writes,voiceDuringHeldRead:true}));
 }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(env.artifactDir(),'podview-light-failure.png')});console.log('failureState',JSON.stringify({server:await state(),ui:await page.locator('body').innerText(),host:await page.locator('pv-widget-host').evaluate(h=>({light:h.currentLightDevice(),areas:h.state.lightAreas,problem:h.lightReadProblem?.text,feedback:h.liveControls?.lightActionState}))}));}throw error}
 finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}}
})().catch(e=>{console.error(e);process.exitCode=1});
