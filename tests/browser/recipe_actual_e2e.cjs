'use strict';
// Inert HA/session/source, real packaged UI, proxy, importer and isolated disk.
const {chromium}=require('playwright');
const testEnv=require('./podview_actual_env.cjs');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const {mkdtemp,rm}=fs;
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const SHARE_HINT='Tilføj opskrift: Del → Home Assistant fra Safari eller Chrome på iPhone.';
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
const widgetStyle=widget=>widget.evaluate(el=>{
 const css=getComputedStyle(el);
 return {background:css.backgroundColor,color:css.color,border:css.borderColor,variant:el.getAttribute('data-kit-variant')};
});
async function newRecipePage(browser){
 const page=await browser.newPage({hasTouch:true,viewport:{width,height}});
 if(sourceMode==='inert-fixture'){
  await page.context().route(/^https?:\/\//,route=>{
   if(new URL(route.request().url()).origin===base)return route.continue();
   if(route.request().resourceType()!=='image')return route.abort();
   return route.fulfill({contentType:'image/svg+xml',body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="tan"/></svg>'});
  });
 }
 return page;
}
async function observeColdCatalog(page,widget,bundleSHA){
 const catalogPath=url=>url.pathname==='/view/api/recipes';
 let releaseRead;
 const readGate=new Promise(resolve=>{releaseRead=resolve;});
 await page.route(catalogPath,async route=>{await readGate;await route.continue();},{times:1});
 await widget.evaluate(button=>button.addEventListener('click',event=>{
  if(!event.isTrusted)return;
  const clickedAt=performance.now(),frames=window.coldRecipeFrames=[];
  const visible=node=>node?.checkVisibility({visibilityProperty:true,opacityProperty:true})===true;
  const sample=()=>{
   const host=document.querySelector('pv-widget-host');
   const recipe=host.querySelector('#recipe-view');
   if(visible(recipe)){
    const layout=recipe.querySelector('[data-recipe-layout=catalog]');
    const entries=visible(layout)?layout.firstElementChild:null,clip=entries?.getBoundingClientRect();
    const rows=[...(entries?.querySelectorAll('[data-recipe]')??[])].filter(visible);
    const covers=rows.flatMap(row=>{
     const box=row.getBoundingClientRect();
     if(box.top<Math.max(clip.top,0)||box.bottom>Math.min(clip.bottom,innerHeight))return [];
     const image=row.querySelector('img');
     const rect=image?.getBoundingClientRect();
     const onScreen=visible(image)&&Math.min(rect.bottom,clip.bottom,innerHeight)>Math.max(rect.top,clip.top,0)
      &&Math.min(rect.right,clip.right,innerWidth)>Math.max(rect.left,clip.left,0);
     return [{title:row.dataset.recipe,loaded:onScreen&&image.complete&&image.naturalWidth>0,
      fallback:image?.hasAttribute('data-recipe-fallback')??false,src:image?.currentSrc??null}];
    });
    const status=host.recipeView.catalogStatus??null;
    const messages=[...(entries?.querySelectorAll('p')??[])].filter(visible).map(node=>node.textContent.trim());
    const state={status,rows:rows.map(row=>row.dataset.recipe),covers,messages};
    const previous=frames.at(-1);
    if(!previous||JSON.stringify(previous.state)!==JSON.stringify(state)){
     frames.push({elapsedMs:performance.now()-clickedAt,state});
    }
   }
   if(!window.stopColdRecipeFrames)requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
 },{capture:true,once:true}));
 const request=page.waitForRequest(req=>req.method()==='GET'&&catalogPath(new URL(req.url())));
 const response=page.waitForResponse(res=>res.request().method()==='GET'&&catalogPath(new URL(res.url())));
 try{
  await widget.tap();
  await request;
  await page.waitForFunction(()=>window.coldRecipeFrames?.length>0);
  const first=await page.evaluate(()=>window.coldRecipeFrames[0].state);
  assert.deepEqual(first.rows,[],'cold view has not received the held catalogue');
  // Changed: the catalogue always says how to add a recipe (Del → Home Assistant).
  assert.deepEqual(first.messages,['Henter opskrifter …',SHARE_HINT],'first visible frame explicitly loads');
  assert.notEqual(first.status,'ready');
 }finally{releaseRead();}
 const published=await response;
 assert.equal(published.status(),200);
 const recipes=(await published.json()).recipes;
 const titles=recipes.map(recipe=>recipe.title).sort();
 assert(titles.includes('Burgerboller')&&titles.length>1,'fixture catalogue contains known recipes');
 await page.waitForFunction(()=>{
  const state=window.coldRecipeFrames?.at(-1)?.state;
  return state?.status==='ready'&&state.covers.length>0
   &&state.covers.every(cover=>cover.loaded&&!cover.fallback);
 });
 const frames=await page.evaluate(async()=>{
  const covers=window.coldRecipeFrames.at(-1).state.covers;
  const images=[...document.querySelectorAll('#recipe-view [data-recipe]')];
  await Promise.all(covers.map(cover=>images.find(row=>row.dataset.recipe===cover.title).querySelector('img').decode()));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  window.stopColdRecipeFrames=true;
  return window.coldRecipeFrames;
 });
 assert(frames.every(({state})=>!state.messages.includes('Der er ingen opskrifter endnu.')
  &&(state.rows.length>0||state.messages.includes('Henter opskrifter …'))),
  'known content never appears empty or blank');
 const ready=frames.filter(({state})=>state.status==='ready');
 for(const {state} of ready){
  assert.deepEqual([...state.rows].sort(),titles,'every observed ready frame contains the catalogue');
  assert.deepEqual(state.messages,[SHARE_HINT],'ready catalogue never shows a substitute message');
 }
 const covers=ready.at(-1).state.covers;
 assert(covers.some(cover=>cover.title==='Burgerboller')&&covers.every(cover=>cover.loaded&&!cover.fallback));
 assert(covers.every(cover=>cover.src===recipes.find(recipe=>recipe.title===cover.title).image),
  'visible images use the corresponding catalogue source slots');
 const screenshot=path.join(testEnv.artifactDir(),`podview-recipe-${shot}-cold-catalogue.png`);
 await page.screenshot({path:screenshot});
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-recipe-cold-catalogue-proof.json'),
  JSON.stringify({outcome:'PASS',story:'O1',sourceMode,bundleSHA,heldFirstRead:true,viewport:shot,frames,screenshot},null,2));
}
async function openCatalog(page,{observeCold=false}={}){
 const bundle=observeCold?page.waitForResponse(response=>
  new URL(response.url()).pathname==='/view/podview.bundle.js'&&response.ok()):null;
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});
 await testEnv.openOverview(page);
 const widget=page.locator('#home-recipes');
 await widget.waitFor({state:'visible'});
 homeBaseline ||= await widgetStyle(widget);
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 if(bundle){
  const bundleSHA=createHash('sha256').update(await (await bundle).body()).digest('hex');
  if(process.env.RECIPE_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.RECIPE_EXPECTED_BUNDLE);
  await observeColdCatalog(page,widget,bundleSHA);
 }else await widget.tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor({state:'visible'});
 await page.locator('#recipe-view [data-recipe]').first().waitFor({state:'visible'});
}
async function checkHistoryOnlyRefresh(page){
 assert.equal(sourceMode,'inert-fixture');
 const history=page.locator('#recipe-upload-history-trigger');
 const panel=page.locator('#recipe-upload-history-panel');
 await history.scrollIntoViewIfNeeded();
 await history.tap();
 await panel.getByText('Der er ingen uploads endnu.',{exact:true}).waitFor();
 await history.focus();
 const url='https://example.com/podview-invalid';
 const result=await page.evaluate(async url=>{
  const response=await fetch('/api/podvoice/recipe-submissions',{method:'POST',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+'x'.repeat(32)},body:JSON.stringify({url})});
  return response.json();
 },url);
 assert.equal(result.status,'rejected');
 await panel.getByText(url,{exact:true}).waitFor({state:'visible',timeout:16000});
 assert.equal(await history.getAttribute('aria-expanded'),'true');
 assert.equal(await history.evaluate(node=>document.activeElement===node),true);
 console.log(JSON.stringify({outcome:'PASS',historyOnlyRefresh:true,disclosureFocusPreserved:true,sourceMode}));
}
async function readAndResumeBurgerboller(page){
 const recipe=page.locator('#recipe-view');
 const catalog=recipe.locator('[data-recipe-layout=catalog]');
 const row=catalog.locator('[data-recipe="Burgerboller"]');
 const back=page.locator('#header-title-action');
 const widget=page.locator('#home-recipes');
 const steps=recipe.locator('[data-recipe-layout=reading] li');
 const ingredients=recipe.locator('#recipe-ingredients-trigger');
 const photo=row.locator('img');
 await row.waitFor({state:'visible'});
 await photo.evaluate(image=>image.decode());
 assert.equal(await photo.getAttribute('data-recipe-fallback'),null,'catalogue displays the original photo slot');
 await row.tap();
 await ingredients.waitFor({state:'visible'});
 assert.match(await recipe.locator('[data-recipe-layout=summary]').innerText(),/15 stk\./);
 await recipe.getByRole('button',{name:'350 ml koldt vand',exact:true}).waitFor({state:'visible'});
 assert.equal(await steps.count(),5);
 assert.match(await steps.first().innerText(),/1\.\s*Æltning\s*Vælg én metode/);
 const source=recipe.getByRole('button',{name:/Om opskriften/});
 await source.tap();
 await recipe.getByText('Udbytte',{exact:true}).waitFor({state:'visible'});
 await source.tap();
 assert.equal(await source.getAttribute('aria-expanded'),'false');
 const gallery=page.getByRole('dialog',{name:'Billeder af Burgerboller'});
 await recipe.locator('[data-recipe-layout=gallery-trigger]').tap();
 await gallery.waitFor({state:'visible'});
 const next=gallery.getByRole('button',{name:'Næste',exact:true});
 const previous=gallery.getByRole('button',{name:'Forrige',exact:true});
 const firstBox=await previous.boundingBox();
 assert.equal(await gallery.getByRole('status').innerText(),'1 af 3');
 await next.tap();
 assert.equal(await gallery.getByRole('status').innerText(),'2 af 3');
 assert.deepEqual(await previous.boundingBox(),firstBox,'gallery navigation stays anchored across images');
 await gallery.getByRole('button',{name:'Luk',exact:true}).tap();
 await gallery.waitFor({state:'hidden'});

 await recipe.getByRole('button',{name:'Start opskrift',exact:true}).tap();
 assert.equal(await steps.first().getAttribute('aria-current'),'step');
 await steps.first().getByRole('button').tap();
 assert.equal(await steps.nth(1).getAttribute('aria-current'),'step');
 await ingredients.tap();
 assert.equal(await ingredients.getAttribute('aria-expanded'),'false');
 await back.tap();
 await catalog.waitFor({state:'visible'});
 const entries=catalog.locator(':scope > div').first();
 const scones=catalog.locator('[data-recipe="Scones med hytteost og blåbær"]');
 await scones.scrollIntoViewIfNeeded();
 const catalogueOffset=await entries.evaluate(node=>node.scrollTop);
 assert(catalogueOffset>0,'Scones is reached by scrolling the actual recipe catalogue');
 assert.equal(await recipe.locator('input[type=radio]:checked').inputValue(),'');
 const readActiveSession=()=>page.evaluate(()=>{
  const raw=localStorage.getItem('podview.recipe-session.v1');
  if(!raw)return null;
  const session=JSON.parse(raw);
  delete session.savedAt;
  return session;
 });
 const activeSession=await readActiveSession();
 assert(activeSession,'Burgerboller already owns a persisted cooking session');
 await scones.tap();
 await page.getByRole('button',{name:'Scones med hytteost og blåbær · Tilbage',exact:true}).waitFor();
 await back.tap();
 await catalog.waitFor({state:'visible'});
 assert.equal(await entries.evaluate(node=>node.scrollTop),catalogueOffset,
  'Tilbage restores the catalogue position even while another recipe is active');
 assert.equal(await recipe.locator('input[type=radio]:checked').inputValue(),'');
 assert.equal(await row.getAttribute('aria-current'),'true');
 assert.deepEqual(await readActiveSession(),activeSession);
 console.log(JSON.stringify({outcome:'PASS',story:'G4',catalogueDetailBack:true,
  catalogueOffset,category:'Alle',sameActiveRecipe:true,sourceMode}));
 await recipe.locator('input[type=radio][value="Aftensmad"]').locator('..').tap();
 assert.equal(await catalog.locator('[data-recipe]').first().getAttribute('data-recipe'),'Burgerboller');
 assert.equal(await row.getAttribute('aria-current'),'true');
 assert.equal(await row.getAttribute('data-kit-variant'),'resume');
 assert.match(await row.innerText(),/I gang\s+Burgerboller af Meyers\s+1 af 5 trin · Fortsæt/);
 const activeGeometry=await row.evaluate(el=>{
  const css=getComputedStyle(el),color=document.createElement('canvas').getContext('2d');
  // Changed (issue 398, lærred »A-Opskrifter«): the active recipe is a 96-high band in the recipe tone #F2E4D3
  // with a 56 photo, no longer the dark ListRow.
  color.fillStyle=css.getPropertyValue('--pv-recipe').trim();
  const tone=color.fillStyle;
  color.fillStyle=css.backgroundColor;
  const photo=el.querySelector('img').getBoundingClientRect();
  return {recipe:color.fillStyle===tone,rowHeight:el.getBoundingClientRect().height,photoWidth:photo.width,
   photoHeight:photo.height};
 });
 assert.equal(activeGeometry.recipe,true,'active row uses the recipe tone');
 if(shot==='1280x800')assert.deepEqual(activeGeometry,{recipe:true,rowHeight:96,photoWidth:56,photoHeight:56});
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-burgerboller-active.png`)});
 await row.tap();
 assert.equal(await steps.nth(1).getAttribute('aria-current'),'step');
 assert.equal(await steps.first().getByRole('button').getAttribute('aria-pressed'),'true');
 assert.equal(await ingredients.getAttribute('aria-expanded'),'false');
 await back.tap();
 await catalog.waitFor({state:'visible'});
 await back.tap();
 await widget.locator('.pv-step-bar:not([hidden])').waitFor({state:'visible'});
 assert.match(await widget.innerText(),/Burgerboller/);
 assert.deepEqual(await widgetStyle(widget),homeBaseline,'widget keeps its own style during cooking');
 await widget.tap();
 assert.equal(await steps.nth(1).getAttribute('aria-current'),'step');
 await recipe.getByRole('button',{name:'Nulstil opskrift',exact:true}).tap();
 await recipe.getByRole('button',{name:'Nulstil',exact:true}).tap();
 await catalog.waitFor({state:'visible'});
 assert.equal(await catalog.locator('[data-recipe][aria-current=true]').count(),0);
 console.log('Burgerboller: photo, reading, current step, catalogue resume and widget resume',activeGeometry);
}
async function finishRecipeWithTimer(page,widget,bundleSHA){
 const back=page.locator('#header-title-action');
 const recipe=page.locator('#recipe-view');
 const catalog=recipe.locator('[data-recipe-layout=catalog]');
 const recipeRow=catalog.locator('[data-recipe="Nem chokoladekage i bradepande"]');
 const timerState=()=>fetch(base+'/lab/timers').then(response=>response.json());
 const timerPosts=[];
 page.on('request',request=>{
  if(request.method()==='POST'&&new URL(request.url()).pathname==='/view/api/actions'){
   timerPosts.push(request.postDataJSON()?.action);
  }
 });
 await back.tap();
 await catalog.waitFor({state:'visible'});
 assert.equal(await recipeRow.getAttribute('aria-current'),'true');
 await back.tap();
 await widget.locator('.pv-step-bar:not([hidden])').waitFor({state:'visible'});
 await page.locator('#open-timers').tap();
 await page.getByRole('form',{name:'Ny timer'}).getByRole('button',{name:'Start timer'}).tap();
 const activeTimer=page.locator('#now-view .timer-active-list .timer-finish');
 await activeTimer.waitFor({state:'visible',timeout:15000});
 const started=await timerState();
 assert.equal(started.running.length,1);
 assert.equal(started.starts,1);
 assert.deepEqual(started.commands,['start']);
 await widget.tap();
 await recipe.locator('[data-recipe-layout=reading]').waitFor({state:'visible'});
 const remaining=recipe.locator('ol li button[aria-pressed=false]');
 const remainingCount=await remaining.count();
 assert.ok(remainingCount>0);
 for(let index=0;index<remainingCount;index++)await remaining.first().tap();
 await recipe.getByText('Alle trin færdige',{exact:true}).waitFor({state:'visible'});
 await recipe.getByRole('button',{name:'Afslut madlavning',exact:true}).tap();
 await catalog.waitFor({state:'visible'});
 assert.equal(await recipeRow.count(),1);
 assert.equal(await catalog.locator('[data-recipe][aria-current=true]').count(),0);
 assert.notEqual(await recipeRow.getAttribute('data-kit-variant'),'resume');
 assert.equal(await page.evaluate(()=>localStorage.getItem('podview.recipe-session.v1')),null);
 const catalogueHistory=catalog.locator('#recipe-history-trigger');
 const completedRow=catalog.locator('#recipe-history-panel [data-kit-variant=read-only]')
  .filter({hasText:'Nem chokoladekage i bradepande'});
 assert.equal(await catalogueHistory.getAttribute('aria-expanded'),'false');
 await catalogueHistory.tap();
 await completedRow.waitFor({state:'visible'});
 assert.equal(await completedRow.count(),1);
 const completedAt=await completedRow.locator('time').getAttribute('datetime');
 assert(Number.isFinite(Date.parse(completedAt)));
 const checkCatalogueHistory=async()=>{
  assert.equal(await catalogueHistory.getAttribute('aria-expanded'),'true');
  assert(await completedRow.isVisible());
  assert.equal(await completedRow.locator('time').getAttribute('datetime'),completedAt);
 };
 await checkCatalogueHistory();
 const entries=catalog.locator(':scope > div').first();
 await testEnv.touchScroll(page,entries,{dy:80});
 await page.evaluate(()=>{
  window.readRecipeCatalogue=()=>{
   const layout=document.querySelector('#recipe-view [data-recipe-layout=catalog]');
   const visible=node=>node?.checkVisibility({visibilityProperty:true,opacityProperty:true})===true;
   if(!visible(layout))return null;
   const entries=layout.querySelector(':scope > div');
   const history=layout.querySelector('#recipe-history-trigger');
   const historyPanel=layout.querySelector('#recipe-history-panel');
   return {rows:[...entries.querySelectorAll('[data-recipe]')].map(row=>row.dataset.recipe),
    scroll:entries.scrollTop,historyOpen:history?.getAttribute('aria-expanded')==='true',
    historyVisible:visible(historyPanel),completedAt:historyPanel?.querySelector('time')?.dateTime??null,
    substitute:[...entries.querySelectorAll('p')].some(node=>visible(node)
     &&/Henter opskrifter|Der er ingen opskrifter endnu/.test(node.textContent))};
  };
 });
 const catalogueBefore=await page.evaluate(()=>window.readRecipeCatalogue());
 assert(catalogueBefore.scroll>0,'touch moved the real catalogue scroll before leaving');
 assert(catalogueBefore.rows.length>1);
 assert.equal(catalogueBefore.historyOpen,true);
 assert.equal(catalogueBefore.historyVisible,true);
 assert.equal(catalogueBefore.completedAt,completedAt);
 assert.equal(catalogueBefore.substitute,false);
 await back.tap();
 await widget.getByText('Se katalog',{exact:true}).waitFor({state:'visible'});
 assert.equal(await widget.locator('.pv-step-bar:not([hidden])').count(),0);
 assert.equal(await widget.locator('.resource-value').isVisible(),false);
 await activeTimer.waitFor({state:'visible'});
 assert.deepEqual(await timerState(),started,'recipe finish leaves the same running timer with its owner');
 assert.deepEqual(timerPosts,['timer.start'],'recipe finish sends no timer command');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-finished-timer-running.png`)});
 await activeTimer.tap();
 await activeTimer.waitFor({state:'hidden',timeout:15000});
 assert.deepEqual(await timerState(),{running:[],starts:1,commands:['start','cancel']});
 assert.deepEqual(timerPosts,['timer.start','timer.cancel']);
 await page.bringToFront();
 const catalogPath=url=>url.pathname==='/view/api/recipes';
 let releaseRefresh,markHeld;
 const refreshGate=new Promise(resolve=>{releaseRefresh=resolve;});
 const heldRefresh=new Promise(resolve=>{markHeld=resolve;});
 const hold=async route=>{
  const response=await route.fetch();
  markHeld(response.status());
  await refreshGate;
  await route.fulfill({response});
 };
 await page.route(catalogPath,hold,{times:1});
 await widget.evaluate(button=>button.addEventListener('click',event=>{
  if(!event.isTrusted)return;
  const startedAt=performance.now();
  const sample=()=>{
   const state=window.readRecipeCatalogue();
   if(state)window.recipeCatalogueFirstFrame={state,elapsedMs:performance.now()-startedAt};
   else if(performance.now()-startedAt<2000)requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
 },{capture:true,once:true}));
 let firstFrame,whileHeld;
 try{
  const catalogRefresh=page.waitForResponse(response=>catalogPath(new URL(response.url()))
   &&response.request().method()==='GET'&&response.ok(),{timeout:10000});
  await widget.tap();
  let timeout;
  try{
   assert.equal(await Promise.race([heldRefresh,new Promise((_,reject)=>{
    timeout=setTimeout(()=>reject(Error('real catalogue refresh was not held')),8000);
   })]),200);
  }finally{clearTimeout(timeout);}
  await page.waitForFunction(()=>window.recipeCatalogueFirstFrame,undefined,{timeout:2500});
  firstFrame=await page.evaluate(()=>window.recipeCatalogueFirstFrame);
  whileHeld=await page.evaluate(()=>window.readRecipeCatalogue());
  assert(await page.evaluate(()=>Boolean(document.querySelector('pv-widget-host').recipeView.publishedCatalogRead)));
  releaseRefresh();
  assert.equal(await (await catalogRefresh).finished(),null);
 }finally{releaseRefresh();}
 await page.waitForFunction(()=>{
  const view=document.querySelector('pv-widget-host')?.recipeView;
  return view?.catalogStatus==='ready'&&!view.publishedCatalogRead;
 },undefined,{timeout:5000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const catalogueAfter=await page.evaluate(()=>window.readRecipeCatalogue());
 assert.deepEqual(firstFrame.state,catalogueBefore,'first visible catalogue frame retains prior rows and position');
 assert.deepEqual(whileHeld,catalogueBefore,'held refresh does not reset the catalogue');
 assert.deepEqual(catalogueAfter,catalogueBefore,'completed refresh does not reset the catalogue');
 const reopenEvidence={outcome:'PASS',story:'G4',bundleSHA,catalogueBefore,firstFrame,whileHeld,catalogueAfter};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-recipe-catalogue-reopen-proof.json'),
  JSON.stringify(reopenEvidence,null,2));
 await checkCatalogueHistory();
 await completedRow.scrollIntoViewIfNeeded();
 const catalogueHistoryScreenshot=path.join(testEnv.artifactDir(),`podview-recipe-${shot}-catalog-completion-history.png`);
 await page.screenshot({animations:'disabled',path:catalogueHistoryScreenshot});
 await recipeRow.tap();
 const history=recipe.getByRole('button',{name:/Om opskriften/});
 await history.tap();
 await recipe.getByText('Senest gennemført',{exact:true}).waitFor({state:'visible'});
 await recipe.getByRole('button',{name:'Start opskrift',exact:true}).tap();
 assert.equal(await page.evaluate(()=>window.recipeTimerAudioCalls),0);
 const proof={outcome:'PASS',story:'O7',bundleSHA,activeCatalogueMarkerCleared:true,widgetReturnedToCatalogue:true,
  completionHistoryVisible:true,catalogueHistoryOpenAcrossRefreshAndNavigation:true,
  catalogueCompletionTimestamp:completedAt,catalogueHistoryScreenshot,
  sameIndependentTimerRetained:true,ownerCommands:['start','cancel'],
  recipeFinishTimerCommands:0,browserAudioCalls:0,inertFinalTimerOwner:true};
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-recipe-completion-proof.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}
(async()=>{try{
 dir=await mkdtemp(path.join(os.tmpdir(),'podview-recipe-browser-'));await start();
 browser=await chromium.launch(testEnv.browserOptions());
 let page=await newRecipePage(browser); const errors=[];
 await page.addInitScript(()=>{
  window.recipeTimerAudioCalls=0;
  window.Audio=class {
   play(){window.recipeTimerAudioCalls++;return Promise.resolve();}
   pause(){}
  };
 });
 page.on('pageerror',e=>errors.push(e.message));
 await openCatalog(page,{observeCold:sourceMode==='inert-fixture'&&process.env.RECIPE_HISTORY_REFRESH_TEST!=='1'});
 if(process.env.RECIPE_HISTORY_REFRESH_TEST==='1'){
  await checkHistoryOnlyRefresh(page);
  assert.deepEqual(errors,[]);
  return;
 }
 await readAndResumeBurgerboller(page);
 const entries=page.locator('#recipe-view [data-recipe-layout=catalog] > div').first();
 const all=page.locator('#recipe-view input[type=radio][value=""]');await all.locator('..').tap();
 await testEnv.touchScroll(page,entries,{dy:80});const before=await entries.evaluate(e=>({scroll:e.scrollTop,maximum:e.scrollHeight-e.clientHeight}));
 assert(before.maximum>0&&before.scroll>0,'touch must move the real catalog scroll');
 const focusBefore=await page.evaluate(()=>({name:document.activeElement.name,value:document.activeElement.value}));
 const rejectedToken='r'.repeat(32);
 const denied=await page.evaluate(async ({source,rejectedToken})=>{
  return Promise.all([{}, {Authorization:`Bearer ${rejectedToken}`}].map(async authorization=>{
   const response=await fetch('/api/podvoice/recipe-submissions',{method:'POST',
    headers:{'Content-Type':'application/json',...authorization},body:JSON.stringify({url:source})});
   return {status:response.status,message:(await response.json()).message};
  }));
 },{source,rejectedToken});
 // Changed: a refused code tells the user where to get the right one.
 const wrongCode='Forkert upload-kode \u2013 åbn PodView \u2192 Opskrifter \u2192 Tilføj genvej';
 assert.deepEqual(denied,[{status:401,message:wrongCode},{status:403,message:wrongCode}]);
 assert.doesNotMatch(productLog,/stage=submit/,'denied phone upload never reaches the submission store');
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
 // The active widget retains its styling and opens the same cooking session directly.
 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 const widget=page.locator('#home-recipes');
 await widget.locator('.pv-step-bar:not([hidden])').waitFor({state:'visible'});
 assert.match(await widget.innerText(),/Nem chokoladekage i bradepande/);
 assert.notEqual(await widget.getAttribute('data-kit-variant'),'resume');
 assert.deepEqual(await widgetStyle(widget),homeBaseline,'active Home widget retains its approved visual styling');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-active-home.png`)});
 await widget.tap();
 await page.locator('#recipe-view [data-recipe-layout=reading]').waitFor({state:'visible',timeout:3000});
 assert.match(await page.locator('#recipe-view').innerText(),/Trin 2 af 7/);
 // A reload hydrates Home before opening Recipes, without focusing hidden UI or polling.
 const reads=[];
 page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname.endsWith('/view/api/recipes'))reads.push(request.url());});
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#home-recipes .resource-value')?.textContent==='Nem chokoladekage i bradepande',null,{timeout:16000});
 assert.equal(await page.evaluate(()=>document.querySelector('#recipe-view').contains(document.activeElement)),false);
 assert.equal(await page.evaluate(()=>document.querySelector('pv-widget-host')?.state?.focus),'photo');
 await testEnv.openOverview(page);
 await widget.locator('.pv-step-bar:not([hidden])').waitFor({state:'visible'});
 await sleep(1000);
 assert.equal(reads.length,1,'home hydration performs one catalogue read and no hidden polling');
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-restored-home.png`)});
 await widget.tap();
 await page.locator('#recipe-view [data-recipe-layout=reading]').waitFor({state:'visible',timeout:3000});
 assert.match(await page.locator('#recipe-view').innerText(),/Trin 2 af 7/);
 assert.match(await page.locator('#recipe-view').innerText(),/1 af 11 fundet frem/);
 assert.equal(await page.locator('#recipe-ingredients-trigger').getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#recipe-view').evaluate(el=>el.scrollTop),cookingScroll);
 await page.screenshot({path:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-after-reload.png`)});
 // G2: real browser network loss/resume preserves the active recipe without a reload.
 const lifecycleWrites=[];
 const observeWrite=request=>{
  const pathname=new URL(request.url()).pathname;
  if(request.method()==='POST'&&!pathname.endsWith('/client-diagnostics'))lifecycleWrites.push(pathname);
 };
 page.on('request',observeWrite);
 const beforeLifecycle=await page.locator('pv-widget-host').evaluate(host=>{
  const view=host.recipeView,session=view.sessions.get(view.active);
  window.recipeLifecycleOwner={host,view,active:view.active,session};
  return {title:view.active.title,steps:[...session.steps],ingredients:[...session.ingredients],
   expanded:session.ingredientsExpanded,scroll:host.querySelector('#recipe-view').scrollTop,
   acceptedReadAt:host.liveTransport.acceptedReadAt,origin:performance.timeOrigin};
 });
 try{
  await page.context().setOffline(true);
  await sleep(250);
  await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.browserOffline===true);
  await page.context().setOffline(false);
  await page.waitForFunction(previous=>{
   const host=document.querySelector('pv-widget-host');
   return host?.liveTransport?.connected&&host.liveTransport.acceptedReadAt>previous&&!host.browserOffline;
  },beforeLifecycle.acceptedReadAt,{timeout:20000});
 }finally{await page.context().setOffline(false);}
 const afterLifecycle=await page.locator('pv-widget-host').evaluate(host=>{
  const prior=window.recipeLifecycleOwner,view=host.recipeView,session=view.sessions.get(view.active);
  return {title:view.active.title,steps:[...session.steps],ingredients:[...session.ingredients],
   expanded:session.ingredientsExpanded,scroll:host.querySelector('#recipe-view').scrollTop,
   acceptedReadAt:host.liveTransport.acceptedReadAt,origin:performance.timeOrigin,
   sameOwners:prior.host===host&&prior.view===view&&prior.active===view.active&&prior.session===session,
   admission:host.liveSnapshot.admission.kind};
 });
 assert(afterLifecycle.sameOwners,'resume retains the exact recipe/session objects');
 assert.deepEqual({...afterLifecycle,acceptedReadAt:0,sameOwners:undefined,admission:undefined},
  {...beforeLifecycle,acceptedReadAt:0,sameOwners:undefined,admission:undefined});
 assert.equal(afterLifecycle.admission,'ha_ingress');
 assert.deepEqual(lifecycleWrites,[],'resume cannot enroll a screen or send a product effect');
 page.off('request',observeWrite);
 const lifecycleBundle=await fetch(base+'/view/podview.bundle.js').then(response=>response.arrayBuffer());
 const bundleSHA=createHash('sha256').update(Buffer.from(lifecycleBundle)).digest('hex');
 if(process.env.RECIPE_EXPECTED_BUNDLE)assert.equal(bundleSHA,process.env.RECIPE_EXPECTED_BUNDLE);
 await fs.writeFile(path.join(testEnv.artifactDir(),'podview-recipe-lifecycle.json'),JSON.stringify({
  outcome:'PASS',beforeLifecycle,afterLifecycle,lifecycleWrites,inertHA:true,physicalIPadSleepVerified:false,
  bundleSHA,
 },null,2));
 await finishRecipeWithTimer(page,widget,bundleSHA);
 // Reset the new session, keeping all original import assertions.
 await page.getByRole('button',{name:'Nulstil opskrift',exact:true}).tap();
 await page.getByRole('button',{name:'Nulstil',exact:true}).tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('podview.recipe-session.v1')),null);
 assert.equal(await page.locator('#recipe-view [data-recipe][aria-current=true]').count(),0);
 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');
 assert.equal(await widget.locator('.pv-step-bar:not([hidden])').count(),0);
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
 assert.equal(duplicate.id,saved.body.id);assert.equal(duplicate.status,'duplicate');
 assert.match(duplicate.message,/^Findes allerede: /);
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
 page=await newRecipePage(browser); page.on('pageerror',e=>errors.push(e.message));
 await openCatalog(page);
 assert.equal(await page.locator('#recipe-view [data-recipe="Nem chokoladekage i bradepande"]').count(),1);
 const recoveredReceipt=await page.evaluate(async ({base,id})=>{const r=await fetch(base+'/api/podvoice/recipe-status?id='+id,{headers:{'Authorization':'Bearer '+'x'.repeat(32)}});return r.json();},{base,id:saved.body.id});
 assert.equal(recoveredReceipt.status,'saved');assert.equal(recoveredReceipt.id,saved.body.id);
 assert.match(productLog,new RegExp(`recipe stage=submit outcome=received ref=${reference}`));
 assert.match(productLog,new RegExp(`recipe stage=import outcome=started ref=${reference}`));
 assert.match(productLog,new RegExp(`recipe stage=duplicate outcome=duplicate ref=${reference}`));
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
 assert(!productLog.includes(rejectedToken)&&!productLog.includes('x'.repeat(32)),'journal never contains upload tokens');
 console.log(JSON.stringify({outcome:'PASS',sourceMode,receipt:saved.body.message,autoVisibleWithoutNavigation:true,category:'Alle',focusAndScrollPreserved:true,scroll:before.scroll,duplicate:'same receipt',serverRestart:'catalog retained',productJournalCorrelated:true,pageErrors:errors,viewport:shot,screenshot:path.join(testEnv.artifactDir(),`podview-recipe-${shot}-saved.png`),testStore:dir}));
 }finally{if(browser)await browser.close();await stop();if(dir)await rm(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
