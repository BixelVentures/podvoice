'use strict';
// Shipped browser and actual Python owners; only final HA/native services are inert.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const root=path.resolve(__dirname,'../..'),port=18975,base=`http://127.0.0.1:${port}`;
let server,browser;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
(async()=>{try{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-robot-e2e-'));
 server=spawn('/Users/madsbachandersen/Documents/PodVoice/.venv/bin/python',[path.join(__dirname,'music_e2e_server.py')],{cwd:root,env:{...process.env,PYTHONPATH:`/private/tmp/pv118-py312all:${root}/podvoice:${root}/tests`,MUSIC_TEST_PORT:String(port),MUSIC_TEST_DATA:data,ROBOT_TEST:'1'},stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('server start timeout');await sleep(100)}
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/control/'))requests.push({url:r.url(),body:r.postDataJSON()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await page.locator('#photo-view').waitFor({state:'visible'});await page.locator('#photo-view').click();
 const card=page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
 const pause=page.locator('.resource-card[data-kind="vacuum"] .resource-direct-action[data-action-id="pause"]');
 await pause.waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>{const b=document.querySelector('.resource-card[data-kind="vacuum"] .resource-direct-action');return b&&!b.disabled},undefined,{timeout:15000});
 // A slow music command must leave a different physical resource operable.
 await fetch(base+'/lab/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delayMs:1800})});
 await page.locator('#play-pause').click();
 await pause.click();
 for(let n=0;(await state()).robot.state!=='paused';n++){if(n>50)throw Error('robot did not pause');await sleep(100)}
 assert.equal((await state()).robot.writes.filter(x=>x[0].endsWith('/pause')).length,1);
 await card.click();
 const resume=page.locator('pv-robot-control-panel [data-direct-robot="true"][data-action-id="resume"]');
 await resume.waitFor({state:'visible',timeout:15000});
 await page.screenshot({path:'/private/tmp/podview-robot-paused-detail.png'});
 await resume.click();
 for(let n=0;(await state()).robot.state!=='cleaning';n++){if(n>50)throw Error('robot did not resume');await sleep(100)}
 await page.locator('pv-robot-control-panel [data-direct-robot="true"][data-action-id="pause"]').waitFor({state:'visible',timeout:15000});
 await page.screenshot({path:'/private/tmp/podview-robot-cleaning-detail.png'});
 const value=await state();
 assert.equal(value.robot.writes.filter(x=>x[0].endsWith('/start')).length,1);
 assert.equal(requests.filter(x=>x.body?.domain==='vacuum'&&x.body?.action==='pause').length,1);
 assert.equal(requests.filter(x=>x.body?.domain==='vacuum'&&x.body?.action==='resume').length,1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',actualPackagedPodView:true,inertFinalServices:true,pauseWhileMusicPending:true,detailResume:true,cleaningHeaderPause:true,robotWrites:value.robot.writes,pageErrors:errors}));
 }catch(error){if(browser){const pages=browser.contexts().flatMap(c=>c.pages());if(pages[0]){await pages[0].screenshot({path:'/private/tmp/podview-robot-failure.png'});console.log('visibleUI',await pages[0].locator('body').innerText())}}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await closed;}}
})().catch(e=>{console.error(e);process.exitCode=1});
