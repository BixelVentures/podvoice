'use strict';
// Actual packaged UI, answer receipt owner and Python bridge; no provider or effects.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs'),port=Number(process.env.ANSWERS_TEST_PORT||18982),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>fetch(base+'/lab/state').then(r=>r.json());
let server,browser,data;
(async()=>{try{
 data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-answers-'));
 server=spawn(env.python,[path.join(__dirname,'answers_e2e_server.py')],{cwd:env.runtimeRoot,env:env.pythonEnv({ANSWERS_TEST_PORT:String(port),ANSWERS_TEST_DATA:data}),stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('answer fixture exited');try{if((await fetch(base+'/view/')).ok)break}catch{}if(n>100)throw Error('answer fixture startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());const page=await browser.newPage({hasTouch:true,viewport:{width:1280,height:800}}),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.method()!=='GET')writes.push({path:new URL(r.url()).pathname,body:r.postData()})});
 await page.goto(base+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});await env.openOverview(page);
 if(process.env.ANSWERS_LIVE_TEST==='1'){
  const posted=await fetch(base+'/lab/submit-live-answer',{method:'POST'});
  assert.equal(posted.status,200);
  assert.equal((await posted.json()).inputSubmitted,true);
  const step='Fold papiret på midten.';
  const answerHost=page.locator('#answer-host');
  await answerHost.getByText(step,{exact:true}).waitFor({state:'visible'});
  assert.equal(await answerHost.locator('pv-answer:visible').count(),1);
  const current=await page.request.get(base+'/view/api/answers?room=kitchen');
  assert.equal(current.status(),200);
  const currentId=(await current.json()).items[0].receiptId;
  await page.screenshot({path:path.join(env.artifactDir(),'podview-answer-live.png')});
  const closed=await fetch(base+'/lab/close-live-answer',{method:'POST'});
  assert.equal(closed.status,200);
  assert.deepEqual(await closed.json(),{sourceCalls:0,playbackUrls:0});
  const saved=await page.request.get(base+'/view/api/answers?room=kitchen&history=1');
  assert.equal(saved.status(),200);
  const archived=await saved.json();
  assert.deepEqual(archived.receiptIds,[currentId]);
  await page.reload({waitUntil:'domcontentloaded'});
  await env.openOverview(page);
  await page.locator('#open-history').tap();
  await page.locator('#retained .history-open:visible').getByText('En forklaring',{exact:true}).tap({timeout:5000});
  await answerHost.getByText(step,{exact:true}).waitFor({state:'visible'});
  assert.equal(await answerHost.getAttribute('data-history-group'),'true');
  assert.equal(await answerHost.locator('pv-answer:visible details.sources').isVisible(),false);
  const retainedCompletion=await page.request.get(base+'/view/api/answers?room=kitchen');
  assert.equal((await retainedCompletion.json()).items[0].receiptId,currentId,
   'history remains browsable during the existing read-only completion lease');
  const history=await page.request.get(base+'/view/api/answers?room=kitchen&history=1');
  assert.deepEqual((await history.json()).receiptIds,[currentId]);
  await page.screenshot({path:path.join(env.artifactDir(),'podview-answer-live-history.png')});
  assert.deepEqual(errors,[]);
  assert.equal(writes.filter(x=>x.path==='/view/api/actions').length,0);
  console.log(JSON.stringify({outcome:'PASS',mode:'live-answer-to-history',actualThin:true,
   inertProvider:true,input:'typed',sameReceiptAfterReload:true,browserActionWrites:0,audio:false,pageErrors:errors}));
  return;
 }
 for(let n=0;!(await (await fetch(base+'/lab/history')).json()).held;n++){if(n>100)throw Error('history read not held');await sleep(100)}
 // Unrelated control remains usable while the actual history HTTP read is pending.
 await page.locator('#open-timers').tap();const form=page.getByRole('form',{name:'Ny timer'});await form.getByRole('button',{name:'Start timer'}).tap();
 for(let n=0;(await state()).timers.length!==1;n++){if(n>100)throw Error('timer did not start');await sleep(100)}
 const timer=(await state()).timers[0];await page.waitForFunction(id=>document.querySelector('pv-widget-host')?.liveSnapshot?.timers?.items?.some(t=>t.id===id),timer.id,{timeout:15000});
 await page.locator('#open-history').tap();await fetch(base+'/lab/release',{method:'POST'});
 const rows=page.locator('#retained .history-open:visible');await rows.first().waitFor({state:'visible',timeout:15000});assert.equal(await rows.count(),1,'two final answers in one session are one history group');
 assert(!((await page.locator('#history').innerText()).includes('Jeg undersøger')),'spoken acknowledgement is not a visual history entry');
 await rows.first().tap();await page.waitForFunction(()=>document.querySelector('#answer-host')?.dataset.historyGroup==='true');
 await page.getByText('Faktisk svarindhold 1',{exact:false}).first().waitFor({state:'visible'});await page.getByText('Faktisk svarindhold 2',{exact:false}).first().waitFor({state:'visible'});
 const visibleAnswers=page.locator('#answer-host pv-answer:visible');assert.equal(await visibleAnswers.count(),2);
 for(let i=0;i<2;i++)assert.equal(await visibleAnswers.nth(i).locator('.sources').isVisible(),false,'historical concise receipts deliberately hide source controls');
 assert.equal((await state()).timers[0].id,timer.id);
 const sourceResult=await page.evaluate(async()=>{const h=await (await fetch('api/answers?room=kitchen&history=1')).json();const r=await fetch('api/sources/'+h.items[0].receiptId+'?room=kitchen');return {status:r.status,body:await r.json()};});
 assert.equal(sourceResult.status,200);assert.equal(sourceResult.body.provenance.kind,'ai_explanation');
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
 await page.screenshot({path:path.join(env.artifactDir(),'podview-answer-group.png')});
 // Q2: a new authoritative receipt must not replace the historical reading position.
 const readingArea=page.locator('.frame > .responses');
 await env.touchScroll(page,readingArea,{dy:150});
 const readingBefore=await readingArea.evaluate(element=>{
  const host=document.querySelector('pv-widget-host');
  window.answerReadingNode=document.querySelector('#answer-host pv-answer:not([hidden])');
  window.answerReadingFocus=document.activeElement;
  return {scroll:element.scrollTop,focus:host.state.focus,history:!!host.historyBrowse,
   ids:host.state.answers.map(answer=>answer.id)};
 });
 assert(readingBefore.scroll>0,'history reading point must really be scrolled');
 await page.waitForFunction(()=>Date.now()-document.querySelector('pv-widget-host').lastInteractionAt>1100);
 assert.equal((await fetch(base+'/lab/publish-current?reading=1',{method:'POST'})).status,200);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host').state.answers.some(
  answer=>answer.content?.summary==='Aktuelt kildegrundlag'),null,{timeout:15000});
 const readingAfter=await readingArea.evaluate(element=>{
  const host=document.querySelector('pv-widget-host');
  return {scroll:element.scrollTop,focus:host.state.focus,history:!!host.historyBrowse,
   ids:host.state.answers.map(answer=>answer.id),
   sameNode:window.answerReadingNode===document.querySelector('#answer-host pv-answer:not([hidden])'),
   sameFocus:window.answerReadingFocus===document.activeElement};
 });
 assert.equal(readingAfter.scroll,readingBefore.scroll,'new answer preserves historical reading offset');
 assert.equal(readingAfter.focus,readingBefore.focus,'new answer cannot hijack historical focus');
 assert.equal(readingAfter.history,true);
 assert(readingAfter.sameNode&&readingAfter.sameFocus,'reading DOM and keyboard focus stay stable');
 assert(readingBefore.ids.every(id=>readingAfter.ids.includes(id)),'previous receipts stay retained');
 console.log('historyReading',JSON.stringify({before:readingBefore,after:readingAfter}));

 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 await page.locator('#open-history').tap();await page.locator('#retained .history-open:visible').first().waitFor();
 assert.equal(await page.locator('#retained .history-open:visible').count(),1);
 assert.equal((await state()).timers[0].id,timer.id);assert.equal((await state()).starts,1);
 assert.equal(writes.filter(x=>x.path==='/view/api/actions').length,1,'only explicit timer start writes');assert.deepEqual(errors,[]);
 // A new current owner receipt uses the existing user-facing source disclosure.
 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now'&&!document.querySelector('#history')?.open);
 await page.waitForFunction(()=>Date.now()-(document.querySelector('pv-widget-host')?.lastInteractionAt||0)>1100);
 const published=await fetch(base+'/lab/publish-current',{method:'POST'});assert.equal(published.status,200);
 const current=page.locator('#answer-host pv-answer:visible').filter({hasText:'Aktuelt kildegrundlag'});
 await current.waitFor({state:'visible',timeout:15000});
 const disclosure=current.locator('details.sources');await disclosure.locator('summary').tap();
 const sourceButton=disclosure.getByRole('button',{name:'AI-forklaring fra PodVoice'});await sourceButton.waitFor({state:'visible'});
 const sourceResponse=page.waitForResponse(response=>response.url().includes('/view/api/sources/')&&response.request().method()==='GET');
 await sourceButton.tap();const actualSource=await sourceResponse;assert.equal(actualSource.status(),200);
 const sourceDialog=page.getByRole('dialog',{name:'Kilde og grundlag'});await sourceDialog.waitFor({state:'visible'});
 await sourceDialog.getByText('Aktuelt kildegrundlag',{exact:true}).waitFor({state:'visible'});
 assert.equal((await state()).timers[0].id,timer.id);assert.deepEqual(errors,[]);
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
 await page.screenshot({path:path.join(env.artifactDir(),'podview-answer-current-source.png')});
 await sourceDialog.getByRole('button',{name:'Luk'}).tap();
 console.log(JSON.stringify({outcome:'PASS',actualPackagedPodView:true,finalAnswersGrouped:2,historyGroups:1,spokenAckExcluded:true,slowHistoryDidNotBlockTimer:true,timerPreserved:true,sourceReceiptRead:true,historicalSourceControlOffered:false,currentSourceControlClicked:true,providerEffects:0,pageErrors:errors}));
 }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(env.artifactDir(),'podview-answer-failure.png')});console.log('visibleUI',await page.locator('body').innerText());}throw error;
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){const done=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await done;}if(data)await fs.rm(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
