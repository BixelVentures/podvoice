// Shipped settings controller, real Chromium, inert API fixtures; no HA writes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=process.env.PODVOICE_UI_ROOT||path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'podvoice/gatekeeper/static/index.html'),'utf8');
const markup=source.replace(/<script>[\s\S]*?<\/script>/g,'');
const settings=source.match(/\/\/ ---- Settings page[\s\S]*?<\/script>/)[0].replace('</script>','');
const tabs=source.match(/\/\/ ---- Tab switching ----[\s\S]*?<\/script>/)[0].replace('</script>','');
const renderer=source.split('var savedWakeWord = null;')[1].split('function renderRooms()')[0];
const script=`var rooms={},connected=true,lastObservedMs=Date.now(),lastStatus={};
function toast(message){document.querySelector('#toast').textContent=message;}
function renderSub(){} function applyStatus(){}
var savedWakeWord=null;${renderer}${settings}${tabs}`;
// Test-only observation bound; production deadlines and state are untouched.
const FIXTURE_WAIT_MS=15000;
function bounded(work,label,ms=FIXTURE_WAIT_MS) {
  let timer;
  return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})])
    .finally(()=>clearTimeout(timer));
}
const initial=()=>({engine:'thin',wake_word:'okay_nabu',idle_timeout_s:4,duck_level:20,
 system_prompt:'Brugerens gemte prompt',system_prompt_default:'Fixture standardprompt',
 rooms:[{voicepe_host:'fixture-speaker.local',room:'fixture-room'}],live_alpha:true,
 live_alpha_active:{'fixture-room':false}});
(async()=>{
 // Permanent guard counterexamples: missing route entry and rejected navigation
 // must terminate; these verify the helper used by actual owned I/O below.
 await assert.rejects(bounded(new Promise(()=>{}),'injected never-entered',1),/injected never-entered timed out/);
 await assert.rejects(bounded(Promise.reject(new Error('injected failed navigation')),'failed navigation'),/injected failed navigation/);
 const browser=await chromium.launch({headless:true,executablePath:process.env.PODVOICE_TEST_CHROMIUM});
 let browserPrimaryError=null;
 try {
  for(const width of [320,390,1440]) {
   const page=await browser.newPage({viewport:{width,height:1000}});
   const errors=[],posts=[],ownedWork=[],holdReleases=[];page.on('pageerror',e=>errors.push(e.message));
   function own(work){ownedWork.push(work);work.catch(()=>{});return work;}
   let primaryError=null;
   try {
   await page.addInitScript(()=>{window.fixtureSettingsPosts=0;const original=window.fetch;
    window.fetch=function(input,init){if(String(input).endsWith('api/settings')&&init?.method==='POST')window.fixtureSettingsPosts++;return original.apply(this,arguments);};});
   let saved=initial(),mode='ok',restarts=0,holdPost=null,notifyPost=null,holdGet=null,notifyGet=null;
   await page.route('http://panel.test/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/failed-navigation')return route.abort();
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:markup+`<script>${script}</script>`});
    if(url.pathname==='/api/settings') {
     if(req.method()==='GET') {
      if(mode==='getnetwork')return route.abort();
      if(holdGet){notifyGet?.();await holdGet;}
      return route.fulfill({json:saved});
     }
     const body=req.postDataJSON();posts.push(body);notifyPost?.();
     if(holdPost)await holdPost;
     if(mode==='network')return route.abort();
     if(mode==='reject')return route.fulfill({status:400,json:{ok:false,error:'wake_word: invalid'}});
     saved={...saved,...body};return route.fulfill({json:{ok:true,settings:saved}});
    }
    if(url.pathname==='/api/restart'){restarts++;if(mode==='restart-reject')return route.fulfill({status:500,json:{ok:false,error:'fixture-restart'}});}
    return route.fulfill({json:{ok:true,rooms:[]}});
   });
   const dirty=()=>page.evaluate(()=>{const ev=new Event('beforeunload',{cancelable:true});window.dispatchEvent(ev);return ev.defaultPrevented;});
   const waitSave=()=>page.waitForFunction(()=>/^(Gemt|Sendte ændringer gemt|Ikke gemt)/.test(document.querySelector('#s_status').textContent));
   async function reloadDiscard(){const event=own(page.waitForEvent('dialog',{timeout:FIXTURE_WAIT_MS}));const navigation=own(page.reload({timeout:FIXTURE_WAIT_MS}));const dialog=await bounded(event,'reload discard dialog');assert.equal(dialog.type(),'beforeunload');await bounded(dialog.accept(),'reload discard accept');return bounded(navigation,'reload discard navigation');}
   async function save(){await page.locator('#s_save').click();await waitSave();}
   // Navigate the actual tab owner and the actual closed disclosure on every
   // new document, including when its initial settings GET is deliberately held.
   async function enterSettings(){
    await bounded(own(page.waitForLoadState('domcontentloaded',{timeout:FIXTURE_WAIT_MS})),'settings document parsed');
    assert.equal(await page.locator('#tab-home').getAttribute('aria-selected'),'true','navigation starts on actual Home tab');
    assert.equal(await page.locator('#pane-settings').evaluate(e=>e.hidden),true,'settings initially hidden');
    const advanced=page.locator('#pane-settings > .section > details.adv');
    assert.equal(await advanced.count(),1);
    assert.equal(await advanced.evaluate(e=>e.open),false,'new document keeps Avanceret closed');
    await bounded(own(page.getByRole('tab',{name:'Indstillinger',exact:true}).click({timeout:FIXTURE_WAIT_MS})),'actual settings tab click');
    assert.equal(await page.locator('#tab-settings').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#pane-settings').evaluate(e=>e.hidden),false);
    assert.equal(await page.locator('#s_resetprompt').isVisible(),false,'reset is inside closed Avanceret');
    const summary=advanced.locator(':scope > summary');
    assert.equal(await summary.innerText(),'Avanceret');
    await bounded(own(summary.click({timeout:FIXTURE_WAIT_MS})),'actual Avanceret summary click');
    assert.equal(await advanced.evaluate(e=>e.open),true);
    const controls=['s_addroom','s_idle_timeout_s','s_live_alpha','s_live_alpha_active',
      's_resetprompt','s_save','s_saverestart','s_status','s_system_prompt'];
    const envelopes=await page.evaluate(ids=>ids.map(id=>{
      const nodes=document.querySelectorAll('#'+id),e=nodes[0];
      return {id,count:nodes.length,pane:e?.closest('.pane')?.id,
        disclosure:e?.closest('details')?.querySelector(':scope > summary')?.textContent.trim()||null};
    }),controls);
    const advancedIds=new Set(['s_live_alpha','s_live_alpha_active','s_resetprompt','s_system_prompt']);
    assert.deepEqual(envelopes,controls.map(id=>({id,count:1,pane:'pane-settings',
      disclosure:advancedIds.has(id)?'Avanceret':null})),'all nine fixture controls retain actual pane/disclosure owners');
    // Empty status/readback nodes need not have a box while the GET is held.
    // Interactive controls remain visible even when saving is correctly disabled.
    for(const id of controls.filter(id=>!['s_live_alpha_active','s_status'].includes(id)))
      assert.equal(await page.locator('#'+id).isVisible(),true,'visible settings control '+id);
   }
   async function fresh(){saved=initial();mode='ok';await page.goto('http://panel.test/');await enterSettings();await page.waitForFunction(()=>!document.querySelector('#s_save').disabled);}
   // Successful initial refetch is clean; configured preference and effective
   // active-session readback deliberately disagree without being overwritten.
   await fresh();assert.equal(await dirty(),false);
   assert.equal(await page.locator('#s_live_alpha').isChecked(),true);
   assert.match(await page.locator('#s_live_alpha_active').textContent(),/fixture-room: Realtime/);
   await page.locator('#s_addroom').click();assert.equal(await dirty(),true,'adding a row owns an unsaved draft');
   assert.equal(await page.locator('.roomrow').count(),2);
   // Cancel the actual navigation dialog; the draft and page remain intact.
   const dialog=own(page.waitForEvent('dialog',{timeout:FIXTURE_WAIT_MS}));
   // beforeunload blocks this original evaluation until its dialog is handled.
   const navigationRequest=own(page.evaluate(()=>{location.href='http://panel.test/leave';}));
   const pending=await bounded(dialog,'cancel navigation dialog');assert.equal(pending.type(),'beforeunload');await bounded(pending.dismiss(),'cancel navigation dismiss');
   await bounded(navigationRequest,'canceled navigation request join');
   assert.equal(page.url(),'http://panel.test/');assert.equal(await page.locator('.roomrow').count(),2);
   await save();assert.equal(await dirty(),false,'accepted save clears this revision');
   assert.deepEqual(posts.at(-1).rooms,initial().rooms,'blank row adds no persisted room');
   await page.getByRole('button',{name:'Fjern rum',exact:true}).first().click();
   assert.equal(await dirty(),true,'remove owns the same draft');
   mode='reject';const beforeFailure=JSON.stringify(saved);await save();
   assert.match(await page.locator('#s_status').textContent(),/^Ikke gemt — wake_word: invalid/);
   assert.equal(JSON.stringify(saved),beforeFailure);assert.equal(await dirty(),true);assert.equal(restarts,0);
   mode='network';await save();assert.match(await page.locator('#s_status').textContent(),/Ikke gemt — PodVoice kunne ikke nås/);
   assert.equal(await dirty(),true);assert.equal(JSON.stringify(saved),beforeFailure);
   mode='ok';await save();assert.equal(await dirty(),false);assert.deepEqual(saved.rooms,[]);
   await page.locator('#s_resetprompt').click();assert.equal(await dirty(),true,'actual reset changes draft');
   assert.equal(await page.locator('#s_system_prompt').inputValue(),'Fixture standardprompt');
   await save();assert.equal(saved.system_prompt,'Fixture standardprompt');assert.equal(await dirty(),false);
   await page.locator('#s_resetprompt').click();assert.equal(await dirty(),false,'reset to same value has no draft change');
   // A POST owns its captured revision, never later input while awaiting ACK.
   let release;holdPost=new Promise(resolve=>{release=resolve;holdReleases.push(resolve);});
   const entered=new Promise(resolve=>notifyPost=resolve);
   await page.locator('#s_idle_timeout_s').fill('5');
   await page.locator('#s_save').click();await bounded(entered,'held POST entered');
   assert.equal(await page.locator('#s_save').isDisabled(),true);assert.equal(await page.locator('#s_saverestart').isDisabled(),true);
   const sends=await page.evaluate(()=>window.fixtureSettingsPosts);
   await page.evaluate(()=>{document.querySelector('#s_save').onclick();document.querySelector('#s_saverestart').onclick();});
   assert.equal(await page.evaluate(()=>window.fixtureSettingsPosts),sends,'duplicate save entries issue zero requests');
   await page.locator('#s_idle_timeout_s').fill('6');
   release();holdPost=null;notifyPost=null;
   await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('nyere ændringer er ikke gemt'));
   assert.equal(posts.at(-1).idle_timeout_s,5);assert.equal(saved.idle_timeout_s,5);
   assert.equal(await page.locator('#s_idle_timeout_s').inputValue(),'6');assert.equal(await dirty(),true);
   await save();assert.equal(saved.idle_timeout_s,6);assert.equal(await dirty(),false);
   assert.equal(await page.locator('#s_save').isDisabled(),false);assert.equal(await page.locator('#s_saverestart').isDisabled(),false);
   mode='restart-reject';await page.locator('#s_saverestart').click();
   await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('genstarten fejlede'));
   assert.equal(await dirty(),false,'accepted settings remain saved if restart fails');
   assert.equal(await page.locator('#s_save').isDisabled(),false);assert.equal(await page.locator('#s_saverestart').isDisabled(),false);
   assert.equal(restarts,1);mode='ok';
   // Reload/refetch deliberately returns current saved values, without a write.
   const writes=posts.length;await page.reload();await enterSettings();await page.waitForFunction(()=>!document.querySelector('#s_save').disabled);
   assert.equal(await page.locator('#s_idle_timeout_s').inputValue(),'6');assert.equal(await dirty(),false);assert.equal(posts.length,writes);
   // Late initial GET cannot replace a draft made before its reply. Saving stays
   // closed because no complete initial settings baseline has been admitted.
   let releaseGet;holdGet=new Promise(resolve=>{releaseGet=resolve;holdReleases.push(resolve);});
   const enteredGet=new Promise(resolve=>notifyGet=resolve);
   const navigation=own(page.reload({timeout:FIXTURE_WAIT_MS}));await bounded(enteredGet,'held GET add entered');
   await enterSettings();
   await page.locator('#s_addroom').click();releaseGet();holdGet=null;notifyGet=null;await bounded(navigation,'held GET add navigation');
   await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('Dine ændringer er bevaret'));
   assert.equal(await page.locator('.roomrow').count(),1);assert.equal(await dirty(),true);
   assert.equal(await page.locator('#s_save').isDisabled(),true);assert.equal(await page.locator('#s_saverestart').isDisabled(),true);
   assert.equal(posts.length,writes,'late GET introduces no autosave');
   // Fresh initial GET with a field edit has the same revision fence.
   holdGet=new Promise(resolve=>{releaseGet=resolve;holdReleases.push(resolve);});
   const fieldEntered=new Promise(resolve=>notifyGet=resolve);
   const fieldNavigation=own(reloadDiscard());await bounded(fieldEntered,'held GET field entered');
   await enterSettings();
   await page.locator('#s_idle_timeout_s').fill('9');releaseGet();holdGet=null;notifyGet=null;await bounded(fieldNavigation,'held GET field navigation');
   await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('Dine ændringer er bevaret'));
   assert.equal(await page.locator('#s_idle_timeout_s').inputValue(),'9');assert.equal(await dirty(),true);
   assert.equal(await page.locator('#s_save').isDisabled(),true);assert.equal(posts.length,writes);
   // Before the default prompt is loaded, reset is a no-op: it must not
   // fabricate a change or prevent an unchanged initial GET from loading.
   holdGet=new Promise(resolve=>{releaseGet=resolve;holdReleases.push(resolve);});
   const resetEntered=new Promise(resolve=>notifyGet=resolve);
   const resetNavigation=own(reloadDiscard());await bounded(resetEntered,'held GET reset entered');
   await enterSettings();
   await page.locator('#s_resetprompt').click();assert.equal(await dirty(),false);
   releaseGet();holdGet=null;notifyGet=null;await bounded(resetNavigation,'held GET reset navigation');
   await page.waitForFunction(()=>!document.querySelector('#s_save').disabled);
   assert.equal(await page.locator('#s_system_prompt').inputValue(),saved.system_prompt);
   assert.equal(await dirty(),false);assert.equal(posts.length,writes);
   mode='getnetwork';await page.reload();
   await enterSettings();
   await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('Kunne ikke hente de gemte indstillinger'));
   assert.equal(await page.locator('#s_save').isDisabled(),true);assert.equal(await page.locator('#s_saverestart').isDisabled(),true);
   assert.equal(posts.length,writes,'failed initial GET introduces no persistence');
   // Real browser navigation failure also must reject within the owned bound.
   await assert.rejects(bounded(own(page.goto('http://panel.test/failed-navigation',{timeout:FIXTURE_WAIT_MS})),'aborted navigation'),/net::ERR_FAILED|net::ERR_ABORTED/);
   assert.deepEqual(errors,[]);
   } catch(error) {
     primaryError=error;throw error;
   } finally {
     // Cancel pending dialog/evaluation owners before joining their originals.
     // Cleanup findings are retained without replacing the primary assertion.
     holdReleases.splice(0).forEach(release=>release());
     const cleanupErrors=[];
     try { await bounded(page.close(),'settings page cleanup'); }
     catch(error) { cleanupErrors.push(error); }
     try { await bounded(Promise.allSettled(ownedWork),'settings owned-work canceled join'); }
     catch(error) { cleanupErrors.push(error); }
     if(cleanupErrors.length) {
       if(primaryError)primaryError.cleanupErrors=[...(primaryError.cleanupErrors||[]),...cleanupErrors];
       else throw new AggregateError(cleanupErrors,'settings cleanup failed');
     }
   }
  }
  console.log('PASS shipped settings add/remove/reset/no-change, canceled navigation, failed saves, captured POST revision, refetch and held initial GET through actual tabs/Avanceret, nine control owners at320/390/1440');
 }catch(error){browserPrimaryError=error;throw error;}
 finally{
   try {await bounded(browser.close(),'settings browser cleanup');}
   catch(error){
     if(browserPrimaryError)browserPrimaryError.cleanupErrors=[...(browserPrimaryError.cleanupErrors||[]),error];
     else throw error;
   }
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
