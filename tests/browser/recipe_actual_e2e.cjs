'use strict';
// Inert HA/session/source, real packaged UI, proxy, importer and isolated disk.
const {chromium}=require('playwright');
const testEnv=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const root=testEnv.root, port=Number(process.env.RECIPE_TEST_PORT || 18972), base=`http://127.0.0.1:${port}`;
const python=testEnv.python;
const envBase=testEnv.pythonEnv({RECIPE_TEST_PORT:String(port)});
const width=Number(process.env.RECIPE_VIEW_WIDTH || 1280),height=Number(process.env.RECIPE_VIEW_HEIGHT || 800);
const shot=`${width}x${height}`;
const sourceMode=process.env.PODVIEW_RECIPE_LIVE_SOURCE==='1'?'public-live':'inert-fixture';
const source=sourceMode==='public-live'?'https://www.arla.dk/opskrifter/nem-chokoladekage-i-bradepande/':'https://example.com/podview-recipe';
let dir,server,browser,productLog='',homeBaseline;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
 server=spawn(python,[path.join(__dirname,'recipe_e2e_server.py')],{cwd:testEnv.runtimeRoot,env:{...envBase,RECIPE_TEST_CATALOG:path.join(dir,'catalog.json')},stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',data=>{productLog+=data.toString();process.stderr.write(data);});
 for(let n=0;n<100;n++){if(server.exitCode!==null)throw Error('server exited '+server.exitCode);try{if((await fetch(base+'/view/')).ok)return}catch{} await sleep(100)}throw Error('server not ready');
}
async function stop(){if(!server||server.exitCode!==null)return;const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;server=null}
async function openCatalog(page){
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});
 await testEnv.openOverview(page);
 await page.locator('#home-recipes').waitFor({state:'visible'});
 homeBaseline ||= await page.locator('#home-recipes').evaluate(el=>{const css=getComputedStyle(el);return {background:css.backgroundColor,color:css.color,border:css.borderColor,variant:el.getAttribute('data-kit-variant')};});
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 await page.locator('#home-recipes').tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor({state:'visible'});
 await page.locator('#recipe-view [data-recipe]').first().waitFor({state:'visible'});
}
(async()=>{try{
 dir=await mkdtemp(path.join(os.tmpdir(),'podview-recipe-browser-'));await start();
 browser=await chromium.launch(testEnv.browserOptions());
 let page=await browser.newPage({hasTouch:true,viewport:{width,height}}); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await openCatalog(page);
 const entries=page.locator('#recipe-view [data-recipe-layout=catalog] > div').first();
 const all=page.locator('#recipe-view input[type=radio][value=""]');await all.locator('..').tap();
 await testEnv.touchScroll(page,entries,{dy:80});const before=await entries.evaluate(e=>({scroll:e.scrollTop,maximum:e.scrollHeight-e.clientHeight}));
 assert(before.maximum>0&&before.scroll>0,'touch must move the real catalog scroll');
 const focusBefore=await page.evaluate(()=>({name:document.activeElement.name,value:document.activeElement.value}));
 const saved=await page.evaluate(async ({base,source})=>{const r=await fetch(base+'/api/podvoice/recipe-submissions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+'x'.repeat(32)},body:JSON.stringify({url:source})});return {status:r.status,body:await r.json()}},{base,source});
 assert.equal(saved.status,200);assert.equal(saved.body.status,'saved');assert.match(saved.body.message,/^Gemt: /);
 await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').waitFor({state:'attached',timeout:16000});
 assert.equal(await page.locator('#recipe-view input[type=radio]:checked').inputValue(),'');
 assert.deepEqual(await page.evaluate(()=>({name:document.activeElement.name,value:document.activeElement.value})),focusBefore);
 const after=await entries.evaluate(e=>e.scrollTop);assert.equal(after,before.scroll,'catalog scroll preserved');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-catalog.png`)});
 await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-saved.png`)});
 await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').tap();
 await page.getByRole('heading',{name:'Nem chokoladekage i bradepande'}).waitFor();
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-detail.png`)});
 // Actual imported recipe -> marked progress -> browser reload -> same session.
 await page.getByRole('button',{name:'Start opskrift',exact:true}).tap();
 await page.locator('#recipe-view [data-recipe-layout=ingredients] pv-checklist button').first().tap();
 await page.locator('#recipe-view [data-recipe-layout=reading] li button').first().tap();
 const ingredients=page.locator('#recipe-ingredients-trigger');
 await ingredients.tap();
 assert.equal(await ingredients.getAttribute('aria-expanded'),'false');
 await testEnv.touchScroll(page,page.locator('#recipe-view'),{dy:220});
 const cookingScroll=await page.locator('#recipe-view').evaluate(el=>el.scrollTop);
 const savedSession=await page.evaluate(()=>localStorage.getItem('podview.recipe-session.v1'));
 assert(cookingScroll>0,'touch must scroll the active recipe');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-before-reload.png`)});
 // The active row stays pinned once, even in an unrelated category.
 await page.locator('#header-title-action').tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor();
 await page.locator('#recipe-view input[type=radio][value="Brød og bagværk"]').locator('..').tap();
 const active=page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"][aria-current=true]');
 await active.waitFor({state:'visible',timeout:16000});
 assert.equal(await active.count(),1);
 assert.equal(await active.getAttribute('data-kit-variant'),'resume');
 assert.match(await active.innerText(),/1 af 7 trin · Fortsæt/);
 assert.equal(await page.locator('#recipe-view [data-recipe-layout=catalog] [data-recipe]').first().getAttribute('aria-current'),'true');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-active-filter.png`)});
 // Home retains its established widget, and clicking it always enters the catalogue.
 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 const widget=page.locator('#home-recipes');
 await widget.getByText('I gang',{exact:true}).waitFor({state:'visible'});
 assert.match(await widget.innerText(),/Nem chokoladekage i bradepande/);
 assert.notEqual(await widget.getAttribute('data-kit-variant'),'resume');
 const homeStyle=await widget.evaluate(el=>{const css=getComputedStyle(el);return {background:css.backgroundColor,color:css.color,border:css.borderColor,variant:el.getAttribute('data-kit-variant')};});
 assert.deepEqual(homeStyle,homeBaseline,'active Home widget retains its approved visual styling');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-active-home.png`)});
 await widget.tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor({state:'visible'});
 await active.tap();
 assert.match(await page.locator('#recipe-view').innerText(),/Trin 2 af 7/);
 // A reload hydrates Home before opening Recipes, without focusing hidden UI or polling.
 const reads=[];
 page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname.endsWith('/view/api/recipes'))reads.push(request.url());});
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#home-recipes .resource-value')?.textContent==='Nem chokoladekage i bradepande',null,{timeout:16000});
 assert.equal(await page.evaluate(()=>document.querySelector('#recipe-view').contains(document.activeElement)),false);
 assert.equal(await page.evaluate(()=>document.querySelector('pv-widget-host')?.state?.focus),'photo');
 await testEnv.openOverview(page);
 await widget.getByText('I gang',{exact:true}).waitFor({state:'visible'});
 await sleep(1000);
 assert.equal(reads.length,1,'home hydration performs one catalogue read and no hidden polling');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-restored-home.png`)});
 await widget.tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor({state:'visible'});
 await active.waitFor({state:'visible'});
 await active.tap();
 assert.match(await page.locator('#recipe-view').innerText(),/Trin 2 af 7/);
 assert.match(await page.locator('#recipe-view').innerText(),/1 af 11 fundet frem/);
 assert.equal(await page.locator('#recipe-ingredients-trigger').getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#recipe-view').evaluate(el=>el.scrollTop),cookingScroll);
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-after-reload.png`)});
 // Reset removes the persisted session, keeping all original import assertions.
 await page.getByRole('button',{name:'Nulstil opskrift',exact:true}).tap();
 await page.getByRole('button',{name:'Nulstil',exact:true}).tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('podview.recipe-session.v1')),null);
 assert.equal(await page.locator('#recipe-view [data-recipe][aria-current=true]').count(),0);
 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 assert.equal(await widget.getByText('I gang',{exact:true}).count(),0);
 assert.equal(await widget.locator('.resource-value').isVisible(),false);
 await widget.tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor({state:'visible'});
 // Damaged or changed data must never resume an unrelated recipe.
 for(const raw of ['{invalid',JSON.stringify({...JSON.parse(savedSession),signature:'changed'})]){
  await page.evaluate(value=>localStorage.setItem('podview.recipe-session.v1',value),raw);
  await openCatalog(page);
  await page.waitForFunction(()=>document.querySelector('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]'));
  assert.equal(await page.locator('#recipe-view [aria-current=true][data-recipe]').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('podview.recipe-session.v1')),null);
 }
 const duplicate=await page.evaluate(async ({base,source})=>{const r=await fetch(base+'/api/podvoice/recipe-submissions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+'x'.repeat(32)},body:JSON.stringify({url:source+'?utm_source=test'})});return r.json()},{base,source});
 assert.equal(duplicate.id,saved.body.id);assert.equal(duplicate.status,'saved');
 const reference=createHash('sha256').update('podview-recipe-journal:'+saved.body.id).digest('hex').slice(0,24);
 if(sourceMode==='inert-fixture'){
  const failed=await page.evaluate(async base=>{const r=await fetch(base+'/api/podvoice/recipe-submissions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+'x'.repeat(32)},body:JSON.stringify({url:'https://example.com/podview-invalid'})});return r.json();},base);
  assert.equal(failed.status,'rejected');assert(!failed.message.startsWith('Gemt'));
  const failureRef=createHash('sha256').update('podview-recipe-journal:'+failed.id).digest('hex').slice(0,24);
  assert.match(productLog,new RegExp(`recipe stage=import outcome=rejected ref=${failureRef} .*reason=incomplete`));
  const offline=await page.evaluate(async base=>{const r=await fetch(base+'/api/podvoice/recipe-submissions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+'x'.repeat(32)},body:JSON.stringify({url:'https://example.com/podview-unavailable'})});return r.json();},base);
  assert.equal(offline.status,'failed');assert(!offline.message.startsWith('Gemt'));
  const offlineRef=createHash('sha256').update('podview-recipe-journal:'+offline.id).digest('hex').slice(0,24);
  assert.match(productLog,new RegExp(`recipe stage=import outcome=failed ref=${offlineRef} .*reason=network`));
  const seeded=await (await fetch(base+'/lab/seed-recovery',{method:'POST'})).json();assert.equal(seeded.status,'received');
 }
 await page.close(); await stop(); await start();
 page=await browser.newPage({hasTouch:true,viewport:{width,height}}); page.on('pageerror',e=>errors.push(e.message));
 await openCatalog(page);
 assert.equal(await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').count(),1);
 const recoveredReceipt=await page.evaluate(async ({base,id})=>{const r=await fetch(base+'/api/podvoice/recipe-status?id='+id,{headers:{'Authorization':'Bearer '+'x'.repeat(32)}});return r.json();},{base,id:saved.body.id});
 assert.equal(recoveredReceipt.status,'saved');assert.equal(recoveredReceipt.id,saved.body.id);
 assert.match(productLog,new RegExp(`recipe stage=submit outcome=received ref=${reference}`));
 assert.match(productLog,new RegExp(`recipe stage=import outcome=started ref=${reference}`));
 assert.match(productLog,new RegExp(`recipe stage=duplicate outcome=saved ref=${reference}`));
 const persisted=productLog.match(new RegExp(`recipe stage=catalog_persist outcome=saved ref=${reference} catalog=([a-f0-9]{24})`));assert(persisted,'persisted catalog reference must be logged');
 assert.match(productLog,new RegExp(`recipe stage=catalog_read outcome=observed ref=none catalog=${persisted[1]}`));
 if(sourceMode==='inert-fixture'){
  await page.locator('#recipe-view [data-recipe="Recovered fixture"]').waitFor({state:'attached',timeout:16000});
  const cryptoId=createHash('sha256').update('https://example.com/podview-recovery').digest('hex');
  const recoveryRef=createHash('sha256').update('podview-recipe-journal:'+cryptoId).digest('hex').slice(0,24);
  assert.match(productLog,new RegExp(`recipe stage=recovery outcome=queued ref=${recoveryRef}`));
  assert.match(productLog,new RegExp(`recipe stage=catalog_persist outcome=saved ref=${recoveryRef}`));
  assert(!productLog.includes('example.com')&&!productLog.includes('Nem chokoladekage'),'product journal contains no URL or title');
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({outcome:'PASS',sourceMode,receipt:saved.body.message,autoVisibleWithoutNavigation:true,category:'Alle',focusAndScrollPreserved:true,scroll:before.scroll,duplicate:'same receipt',serverRestart:'catalog retained',productJournalCorrelated:true,pageErrors:errors,viewport:shot,screenshot:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-saved.png`),testStore:dir}));
 }finally{if(browser)await browser.close();await stop();if(dir)await rm(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
