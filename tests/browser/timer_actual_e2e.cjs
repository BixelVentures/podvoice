'use strict';
// Shipped UI -> real PodView/ToolRouter -> inert HA timer owner; no audio or hardware.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const env=require('./podview_actual_env.cjs');
const port=18981,base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
let server,browser,data,serverLog='';
const readOwnerJournal=async page=>{let result,after=0;const records=[];for(let count=0;count<8;count++){result=await (await page.request.get(base+'/view/api/client-diagnostics?room=kitchen&after='+after)).json();records.push(...(result.records||[]));if(!result.hasMore)break;after=result.nextAfter;}return {...result,records};};
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-timer-'));
 server=spawn(env.python,[path.join(__dirname,'timer_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({TIMER_TEST_PORT:String(port),TIMER_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',data=>{serverLog+=data.toString();process.stderr.write(data)});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('timer fixture exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('timer fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());
 const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}}),errors=[],actions=[];
 await page.addInitScript(()=>{window.timerTestAudioCalls=0;window.Audio=class {play(){window.timerTestAudioCalls++;return Promise.resolve();}pause(){}};});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname==='/view/api/actions')actions.push(request.postDataJSON())});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.locator('#open-timers').tap();
 const form=page.getByRole('form',{name:'Ny timer'});
 await form.getByRole('button',{name:'1 minut mere'}).tap();
 assert.equal(await form.getByLabel('Valgt tid').innerText(),'6:00');
 await form.getByRole('button',{name:'Start timer'}).tap();
 for(let n=0;(await state()).timers.length!==1;n++){if(n>100)throw Error('owner did not observe timer start');await sleep(100)}
 const started=await state();assert.equal(started.starts,1);assert.equal(started.timers[0].seconds,360);assert.equal(started.timers[0].active,true);
 await page.waitForFunction(id=>document.querySelector('pv-widget-host')?.liveSnapshot?.timers?.items?.some(t=>t.id===id&&t.status==='running'),started.timers[0].id,{timeout:15000});
 await page.locator('#now-view .timer-active-list .timer-finish').waitFor({state:'visible',timeout:15000});
 assert.equal(started.commands.filter(c=>c.action==='start').length,1);
 assert.equal(actions.filter(c=>c.action==='timer.start').length,1);
 // A message must not own an overview row or move the next target while it is dismissed.
 const feedback=await page.locator('pv-widget-host').evaluate(h=>{const toast=document.querySelector('#playback-status'),t=toast.getBoundingClientRect(),cancel=document.querySelector('#now-view .timer-finish').getBoundingClientRect();window.timerNavigationWitness=[];for(const type of ['pointerdown','touchstart'])document.addEventListener(type,event=>{if(!event.composedPath().some(node=>node.id==='home-recipes'))return;const card=document.querySelector('#home-recipes').getBoundingClientRect(),pane=document.querySelector('#now-view').getBoundingClientRect();window.timerNavigationWitness.push({type,x:card.x-pane.x,y:card.y-pane.y});},{capture:true});return {local:!!h.feedbackLocal,visible:!toast.hidden,message:toast.textContent,overlap:!toast.hidden&&t.left<cancel.right&&t.right>cancel.left&&t.top<cancel.bottom&&t.bottom>cancel.top};});
 assert.equal(feedback.local,false,'feedback stays outside overview layout');assert.equal(feedback.visible,true,'actual timer result remains readable before dismissal');assert.equal(feedback.overlap,false,'toast does not cover the real timer cancel control');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-timer-toast-before-touch.png')});
 // Navigate to recipes while the native timer persists with music unconfigured.
 await page.locator('#home-recipes').tap();
 const witness=await page.evaluate(()=>window.timerNavigationWitness);assert.equal(witness.length,2);assert(Math.abs(witness[0].x-witness[1].x)<1&&Math.abs(witness[0].y-witness[1].y)<1,'dismissing feedback cannot move the touched navigation target');

 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='recipes');
 assert.equal((await state()).timers[0].id,started.timers[0].id);
 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 const cancel=page.locator('#now-view .timer-active-list .timer-finish');await cancel.waitFor({state:'visible'});await cancel.tap();
 for(let n=0;(await state()).timers.length;n++){if(n>100)throw Error('owner did not observe timer cancellation');await sleep(100)}
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.liveSnapshot?.timers?.items?.length===0,undefined,{timeout:15000});
 const ended=await state();assert.equal(ended.starts,1);assert.equal(ended.commands.filter(c=>c.action==='cancel').length,1);assert.equal(actions.filter(c=>c.action==='timer.cancel').length,1);
 // An explicit inert Core callback exercises finished -> UI stop -> owner acknowledgement.
 await page.locator('#open-timers').tap();await form.getByRole('button',{name:'Start timer'}).tap();
 for(let n=0;(await state()).timers.length!==1;n++){if(n>100)throw Error('second timer did not start');await sleep(100)}
 const second=(await state()).timers[0];assert.notEqual(second.id,started.timers[0].id);
 await page.waitForFunction(id=>document.querySelector('pv-widget-host')?.liveSnapshot?.timers?.items?.some(t=>t.id===id&&t.status==='running'),second.id,{timeout:15000});
 const finished=await fetch(base+'/lab/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timer_id:second.id})});assert.equal(finished.status,200);
 await page.locator('#timer-alert').waitFor({state:'visible',timeout:15000});
 assert.equal((await state()).finished[0].id,second.id);
 await page.locator('#timer-alert-dismiss').tap();
 for(let n=0;(await state()).finished.length;n++){if(n>100)throw Error('finished timer not acknowledged by owner');await sleep(100)}
 const final=await state();assert.equal(final.starts,2);assert.equal(final.commands.filter(c=>c.action==='start').length,2);assert.equal(final.commands.filter(c=>c.action==='cancel').length,2);assert.equal(final.commands.filter(c=>c.action==='acknowledge_finished').length,1);assert.equal(actions.filter(c=>c.action==='timer.start').length,2);assert.equal(actions.filter(c=>c.action==='timer.cancel').length,2);assert.equal(await page.evaluate(()=>window.timerTestAudioCalls),0);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-timer-cancelled.png')});
 let journal;const ref=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
 for(let n=0;n<180;n++){journal=await readOwnerJournal(page);if(actions.every(command=>journal.records?.some(record=>record.row.stage==='control_observation'&&record.row.domain==='timer'&&record.row.code==='observed'&&record.row.requestRef===ref(command.requestId))))break;await sleep(250);}
 for(const command of actions){const rows=journal.records.filter(record=>record.row.requestRef===ref(command.requestId)).map(record=>record.row);assert(rows.some(row=>row.stage==='control_intent'&&row.action===command.action&&row.requestedValue===(command.action==='timer.start'?command.args.seconds:false)),'persisted timer intent matches actual wire request');assert(rows.some(row=>row.stage==='control_action'&&row.code==='accepted'));const observed=rows.find(row=>row.stage==='control_observation'&&row.code==='observed');assert(observed,'persisted exact timer observation');assert.equal(observed.source,'snapshot');assert.equal(observed.trust,'state_observation');assert.match(observed.resourceRef,/^[a-f0-9]{16}$/);if(command.action==='timer.cancel')assert.equal(observed.observedValue,false);else assert(observed.observedValue>=0&&observed.observedValue<=command.args.seconds);}
 const serverProof=actions.map(command=>{
  const requestRef=ref(command.requestId),lines=serverLog.split('\n').filter(line=>line.includes('podview_timer ')&&line.includes('request_ref='+requestRef));
  assert(lines.some(line=>line.includes('stage=dispatch')&&line.includes('action='+command.action)&&line.includes('outcome=started')),'timer owner records validated dispatch');
  assert(lines.some(line=>line.includes('stage=receipt')&&line.includes('outcome=accepted')),'timer owner records receipt without asserting physical effect');return {requestRef,lines};
 });
 await fs.writeFile(path.join(env.artifactDir(),'podview-timer-server-trace.json'),JSON.stringify(serverProof,null,2));
 await fs.writeFile(path.join(env.artifactDir(),'podview-timer-journal.json'),JSON.stringify(journal,null,2));
 console.log(JSON.stringify({outcome:'PASS',persistedTimerJournal:true,actualPackagedPodView:true,inertTimerOwner:true,selectedSeconds:360,starts:final.starts,cancels:final.commands.filter(c=>c.action==='cancel').length,acknowledgements:final.commands.filter(c=>c.action==='acknowledge_finished').length,observedRunningAndRemoved:true,otherNavigationWithMusicUnconfigured:true,runningAdjustment:'not offered by live owner',finishedAndAcknowledged:true,audio:false,pageErrors:errors}));
 }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(env.artifactDir(),'podview-timer-failure.png')});console.log('visibleUI',await page.locator('body').innerText());console.log('owner',JSON.stringify(await state().catch(()=>null)));}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed;}if(data)await fs.rm(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
