'use strict';
// iPad Opskrifter og timer (issue 398, lærred v190 »A-Opskrifter«, »A-Opskrift«, »A-Timer«, »Timer-*«,
// »Timer-Alarm«, »W-opskrift-*«, »W-timer-*«). Recipes fill the whole width (1132, no player): category tabs in one
// track, recipes as 252-high cards in five columns and the active recipe as a 96-high band in #F2E4D3. A recipe opens
// to a 221 hero in #F2E4D3 (photo 160, »Trin N af M · af <kilde>«, the name in 40/800), ingredients in a 400 card and
// the steps beside it with the current step in #F2E4D3 and a 2-px ring. The timer page is a dark 744×458 hero with a
// 340 coral ring, the time in 88 mono and the state in 48/800. A running timer is a chip in the topbar on other pages.
// The finished timer is a full-screen alarm: the title in 88/800 coral, Stop (coral, 88 high) before +1 min.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_RECIPE_TEST_PORT||19007),base=`http://127.0.0.1:${port}`;
const staticPort=Number(process.env.IPAD_TIMER_TEST_PORT||19008),staticBase=`http://127.0.0.1:${staticPort}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
const RECIPE='rgb(242, 228, 211)',CORAL='rgb(255, 122, 92)',INK='rgb(23, 23, 26)';
let server,staticServer,browser,dir;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=(node,pseudo=null)=>node.evaluate((n,pseudo)=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n,pseudo);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,size:s.fontSize,weight:s.fontWeight,family:s.fontFamily,color:s.color,display:s.display,
  shadow:s.boxShadow,stroke:s.stroke,content:s.content,text:n.innerText?.trim()};},pseudo);
async function waitFor(url){
 for(let n=0;;n++){
  try{if((await fetch(url)).ok)return}catch{}
  if(n>150)throw Error('server startup '+url);await sleep(100)
 }
}
async function recipePage(){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.context().route(/^https?:\/\//,route=>{
  if(new URL(route.request().url()).origin===base)return route.continue();
  if(route.request().resourceType()!=='image')return route.abort();
  return route.fulfill({contentType:'image/svg+xml',body:
   '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="tan"/></svg>'});
 });
 await page.goto(base+'/view/',{waitUntil:'domcontentloaded'});await env.openOverview(page);
 await page.locator('#home-recipes').tap();
 await page.locator('#recipe-view [data-recipe="Burgerboller"]').waitFor({state:'visible',timeout:20000});
 await sleep(400);return page;
}
async function stagePage(stage){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.clock.setFixedTime(DAY);
 await page.goto(`${staticBase}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
 await page.locator('pv-widget-host').waitFor({state:'attached'});await sleep(900);return page;
}
(async()=>{try{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'podview-ipad-recipe-'));
 server=spawn(env.python,[path.join(__dirname,'recipe_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({RECIPE_TEST_PORT:String(port),RECIPE_TEST_CATALOG:path.join(dir,'catalog.json')}),stdio:'ignore'});
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 staticServer=spawn(env.python,['-m','http.server',String(staticPort),'--bind','127.0.0.1','--directory',root],
  {stdio:'ignore'});
 await waitFor(base+'/view/');await waitFor(staticBase+'/index.html');
 browser=await chromium.launch(env.browserOptions());

 // A-Opskrifter: the whole width, no player.
 let page=await recipePage();
 const view=await box(page.locator('#recipe-view'));
 assert.deepEqual([view.x,view.w],[24,1132],'recipes use the full 1132 width');
 assert.equal(await page.locator('.frame>.player.pv-card:visible,.frame>#player-empty:visible').count(),0,
  'no player beside the recipes');
 const track=await box(page.locator('#recipe-view fieldset .pv-kit-choice-options'));
 assert.equal(track.bg,'rgb(220, 218, 212)','category tabs sit in one #DCDAD4 track');
 assert.equal(track.radius,'999px');
 const chosen=await box(page.locator('#recipe-view fieldset label:has(input:checked)'));
 assert.equal(chosen.h,44);assert.equal(chosen.bg,INK,'the chosen category is dark');
 const cards=page.locator('#recipe-view [data-recipe-layout=catalog] [data-recipe]:not([data-kit-variant=resume])');
 const first=await box(cards.first());
 assert.equal(first.h,252,'recipe cards are 252 high');assert.equal(first.radius,'24px');
 const photo=await box(cards.first().locator('img'));
 assert.equal(photo.h,140,'photo 140 on top');near(photo.y,first.y+12,'photo 12 in');
 const xs=new Set(await cards.evaluateAll(nodes=>nodes.slice(0,8).map(n=>Math.round(n.getBoundingClientRect().x))));
 assert.equal(xs.size,5,'five recipe columns');
 assert.equal(await page.locator('#recipe-view [data-recipe-layout=catalog] h3:visible').count(),0,
  'no letter headings in the card grid');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-opskrifter.png')});

 // A-Opskrift: hero, ingredients 400, steps.
 await page.locator('#recipe-view [data-recipe="Burgerboller"]').tap();
 await page.locator('#recipe-ingredients-trigger').waitFor({state:'visible'});await sleep(300);
 const hero=await box(page.locator('#recipe-view [data-recipe-layout=intro]'));
 assert.deepEqual([hero.x,hero.y,hero.w,hero.h],[24,88,1132,221],'recipe hero 1132×221 at the top');
 assert.equal(hero.bg,RECIPE);assert.equal(hero.radius,'24px');
 const cover=await box(page.locator('#recipe-view [data-recipe-layout=gallery-trigger] img'));
 assert.deepEqual([cover.w,cover.h],[160,160],'photo 160');
 const name=await box(page.locator('#recipe-view [data-recipe-layout=title]'));
 assert.equal(name.text,'Burgerboller');assert.equal(name.size,'40px');assert.equal(name.weight,'800');
 const ingredients=await box(page.locator('#recipe-view [data-recipe-layout=ingredients]'));
 assert.equal(ingredients.w,400,'ingredients card 400 wide');near(ingredients.y,325,'16 under the hero');
 await page.getByRole('button',{name:'Start opskrift',exact:true}).tap();await sleep(300);
 const current=page.locator('#recipe-view [data-recipe-layout=reading] li[aria-current=step]');
 const step=await box(current);
 assert.equal(step.bg,RECIPE,'the current step is #F2E4D3');assert.match(step.shadow,/168, 98, 44/,'2-px ring');
 const dot=await box(current.locator('[data-recipe-step-number]'),'::before');
 const dotSize=await current.locator('[data-recipe-step-number]').evaluate(n=>{const s=getComputedStyle(n,'::before');
  return [s.width,s.height,s.borderTopLeftRadius];});
 assert.deepEqual(dotSize,['32px','32px','50%'],'step number in a 32 dot');
 assert.equal(dot.bg,INK,'current step number in a dark dot');
 const kicker=await page.locator('#recipe-view [data-recipe-layout=summary] [role=status]').evaluate(n=>
  getComputedStyle(n).color);
 assert.equal(kicker,'rgb(122, 74, 34)','»Trin N af M« in #7A4A22');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-opskrift.png')});

 // The active recipe: a 96-high #F2E4D3 band in the catalog.
 await page.locator('#header-title-action').tap();
 await page.locator('#recipe-view [data-recipe-layout=catalog]').waitFor();
 const band=await box(page.locator('#recipe-view [data-recipe][data-kit-variant=resume]'));
 assert.equal(band.h,96,'active recipe band 96 high');assert.equal(band.bg,RECIPE);assert.equal(band.w,1132);
 await page.locator('#header-title-action').tap();
 await page.waitForFunction(()=>document.querySelector('pv-widget-host')?.state?.focus==='now');await sleep(400);
 // K-Widget: recipes are an entry, a white surface also while cooking (the step bar shows progress).
 assert.equal((await box(page.locator('#home-recipes'))).bg,'rgb(255, 255, 255)','the recipe widget stays white');
 await page.locator('#home-recipes .pv-step-bar').waitFor({state:'visible'});
 const bar=await box(page.locator('#home-recipes .pv-step-bar'));
 const value=await box(page.locator('#home-recipes .resource-value'));
 assert.equal(bar.display,'grid','the step bar is one row of segments');
 assert(bar.y+bar.h<=value.y,'step bar over the title');
 assert.deepEqual(page.errors,[]);await page.close();

 // A-Timer: dark 744×458 hero with the coral ring.
 page=await stagePage('timer-detail-running');
 const panel=page.locator('#timers-view .timer-panel:not([hidden])');
 const timer=await box(panel);
 assert.deepEqual([timer.x,timer.y,timer.w,timer.h],[24,88,744,458],'timer hero 744×458');
 assert.equal(timer.bg,INK);assert.equal(timer.radius,'24px');
 const ring=await box(panel.locator('.timer-instrument'));
 assert.deepEqual([ring.w,ring.h],[340,340],'ring 340');
 assert.equal((await box(panel.locator('.timer-progress'))).stroke,CORAL,'coral progress');
 const count=await box(panel.locator('.timer-count'));
 assert.equal(count.text,'8:42');assert.equal(count.size,'88px');assert.match(count.family,/IBM Plex Mono/);
 const title=await box(panel.locator('.timer-copy'),'::after');
 assert.equal(await panel.locator('.timer-copy').getAttribute('data-state-label'),'Tæller ned','state as the title');
 assert.equal(title.content,'"Tæller ned"');assert.equal(title.size,'48px');
 assert.equal(await page.locator('#header-timer:visible').count(),0,'no timer chip on the timer page');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-timer.png')});
 // The topbar chip on any other page; a tap opens the timer.
 await page.evaluate(()=>document.querySelector('pv-widget-host').dispatch({type:'show',id:'radio'}));await sleep(500);
 const chip=page.locator('#header-timer');
 const chipBox=await box(chip);
 assert.equal(chipBox.h,44);assert.equal(chipBox.bg,INK);assert.equal(chipBox.text,'8:42');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-timer-chip.png')});
 await chip.tap();await sleep(400);
 assert.equal(await page.evaluate(()=>document.querySelector('pv-widget-host').state.focus),'timers');
 assert.deepEqual(page.errors,[]);await page.close();

 // Timer-Alarm: full screen, Stop before +1 min.
 page=await stagePage('timer-detail-finished');
 const alarm=await box(page.locator('#timer-alert'));
 assert.deepEqual([alarm.x,alarm.y,alarm.w,alarm.h],[0,0,1180,820]);assert.equal(alarm.bg,INK);
 const heading=await box(page.locator('#timer-alert-name'));
 assert.equal(heading.size,'88px');assert.equal(heading.color,CORAL);
 const stop=await box(page.locator('#timer-alert-dismiss')),add=await box(page.locator('#timer-alert-add'));
 assert.equal(stop.h,88);assert.equal(stop.bg,CORAL);assert(stop.w>=280,'Stop at least 280 wide');
 assert.equal(add.h,88);assert(add.x>stop.x,'Stop before +1 min');assert.equal(add.y,stop.y);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-timer-alarm.png')});
 assert.deepEqual(page.errors,[]);await page.close();
 console.log(JSON.stringify({outcome:'PASS'}));
}finally{
 await browser?.close();server?.kill();staticServer?.kill();
 if(dir)await fs.rm(dir,{recursive:true,force:true});
}
})().catch(error=>{console.error(error);process.exitCode=1;});
