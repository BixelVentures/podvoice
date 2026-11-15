'use strict';
// iPad Tesla (issue 397, lærred v190 »A-Tesla«, »Tesla-*«, »W-tesla-*«). A 744×221 hero in #D5EADD (#CDE8D8 while
// charging) with the status in 40/800, the range under it, the battery in 64 mono top right, charge facts at the bottom
// and the canvas' dot car filled to the battery level. Under it Adgang and Klima side by side (364 each): Adgang as two
// action surfaces (Døre, Bagagerum with a side-view trunk icon) that act on tap, Klima with the switch, temperature, both
// seats always visible and »Afrim ruder« Fra/Til under the seats. The S widget carries the small dot car, the battery in
// 18/800 and the product's status under it.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_TESLA_TEST_PORT||19006),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
let server,browser;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=(node,pseudo=null)=>node.evaluate((n,pseudo)=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n,pseudo);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,size:s.fontSize,weight:s.fontWeight,family:s.fontFamily,color:s.color,display:s.display,
  mask:s.maskImage||s.webkitMaskImage,content:s.content,text:n.innerText?.trim()};},pseudo);
async function open(stage,{overview=false}={}){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.clock.setFixedTime(DAY);
 await page.goto(`${base}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
 await page.locator('pv-widget-host').waitFor({state:'attached'});await sleep(800);
 if(overview){
  await page.evaluate(()=>document.querySelector('pv-widget-host').dispatch({type:'show',id:'now'}));await sleep(600);
 }
 return page;
}
(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());

 // Tesla-Lader: the product's charging example.
 let page=await open('vehicle-charging');
 const hero=page.locator('#vehicle-view>.vehicle-hero'),heroBox=await box(hero);
 assert.deepEqual([heroBox.x,heroBox.y,heroBox.w,heroBox.h],[24,88,744,221],'hero 744×221 at the top of the column');
 assert.equal(heroBox.radius,'24px');assert.equal(heroBox.bg,'rgb(205, 232, 216)','charging hero #CDE8D8');
 const status=await box(hero.locator('.vehicle-status'));
 assert.equal(status.text,'Bilen lader');assert.equal(status.size,'40px');assert.equal(status.weight,'800');
 assert.equal(status.color,'rgb(23, 68, 47)');near(status.x,52,'status 28 in');
 const [battery,range,power,finish]=await Promise.all([1,2,3,4].map(n=>
  box(hero.locator(`.vehicle-metric:nth-child(${n})>dd`))));
 assert.equal(battery.text,'72 %');assert.equal(battery.size,'64px');assert.match(battery.family,/IBM Plex Mono/);
 near(battery.x+battery.w,768-28,'battery 28 from the right',3);
 const rangeLabel=await box(hero.locator('.vehicle-metric:nth-child(2)>dt'));
 assert.equal(range.text,'312 km');assert(rangeLabel.x>range.x,'»312 km rækkevidde«: value, then the label');
 assert.equal(range.size,'17px');
 assert(range.y>status.y+status.h-4,'range under the status');
 assert.equal(power.size,'22px');assert.match(power.family,/IBM Plex Mono/);near(power.y+power.h,309-24,'facts at the bottom',3);
 assert(finish.x>power.x,'charge facts in one row');
 assert.equal((await box(hero.locator('.vehicle-image'))).display,'none','the dot car replaces the photo');
 const dots=await box(hero.locator('.vehicle-dots'));
 assert.deepEqual([dots.w,dots.h],[270,86]);near(dots.x+dots.w,768-20,'car 20 from the right');
 near(dots.y+dots.h,309-16,'car 16 above the bottom');
 const fill=await box(hero.locator('.vehicle-dots>[data-layer=fill]'));
 assert.match(fill.mask,/car-body-flow\.svg/,'charging fill flows');assert.equal(fill.bg,'rgb(47, 122, 85)');
 const clip=await hero.locator('.vehicle-dots>[data-layer=fill]').evaluate(n=>getComputedStyle(n).clipPath);
 assert.match(clip,/inset/,'fill clipped to the battery level');

 // Adgang and Klima side by side.
 const cards=page.locator('#vehicle-view .vehicle-control-tiles>section');
 const access=await box(cards.first()),climate=await box(cards.nth(1));
 assert.deepEqual([access.x,access.y,access.w],[24,325,364],'Adgang 16 under the hero');
 assert.deepEqual([climate.x,climate.y,climate.w],[404,325,364],'Klima beside it');
 assert.equal(access.radius,'24px');assert.equal(access.bg,'rgb(247, 246, 243)');
 assert(access.h>=459,'the cards fill the column');
 const tiles=cards.first().locator('.vehicle-lock-controls>button:visible');
 assert.equal(await tiles.count(),2,'two action surfaces');
 const door=await box(tiles.first()),trunk=await box(tiles.nth(1));
 assert(door.h>=196,'tile at least 196 high');assert.equal(door.radius,'22px');assert.equal(door.y,trunk.y);
 const doorName=await box(tiles.first(),'::before'),doorValue=await box(tiles.first(),'::after');
 assert.equal(doorName.content,'"Døre" / ""');assert.equal(await tiles.first().getAttribute('data-tile-name'),'Døre');
 assert.equal(await tiles.first().getAttribute('data-tile-value'),'Låst');
 assert.equal(await tiles.nth(1).getAttribute('data-tile-name'),'Bagagerum');
 assert.equal(await tiles.nth(1).getAttribute('data-tile-value'),'Lukket');
 assert.equal(doorValue.size,'24px');assert.equal(doorValue.weight,'800');assert.equal(doorName.size,'15px');
 assert.equal(await tiles.first().innerText(),'Lås op','the action label stays the only text');
 await page.getByRole('button',{name:'Lås op',exact:true}).waitFor({state:'visible'});
 assert.match(await tiles.nth(1).locator('[data-kit=icon]').getAttribute('style'),/car-trunk\.svg/,'side-view trunk');
 // Klima: temperature, both seats and »Afrim ruder« in one card, no disclosure to open.
 const temperature=await box(cards.nth(1).locator('.vehicle-temperature-controls'));
 assert.equal((await box(cards.nth(1).locator('.vehicle-temperature-controls'),'::before')).content,'"Temperatur"');
 const seats=cards.nth(1).locator('.pv-kit-choice-group');
 assert.equal(await seats.count(),2);
 assert(await seats.first().isVisible(),'seats visible without opening anything');
 assert.equal(await page.locator('#vehicle-seat-heat-trigger').isVisible(),false,'no disclosure');
 const driver=await box(seats.first()),passenger=await box(seats.nth(1));
 assert(driver.y>temperature.y&&passenger.y>driver.y,'temperature, then the seats');
 const options=await box(seats.first().locator('.pv-kit-choice-options'));
 assert.equal(options.radius,'999px');assert.equal(options.bg,'rgb(233, 231, 226)');
 const defrost=await box(cards.nth(1).locator('.vehicle-climate-actions'));
 assert(defrost.y>passenger.y,'»Afrim ruder« under the seats');
 const defrostButton=cards.nth(1).locator('.vehicle-climate-actions>button');
 assert.equal(await defrostButton.getAttribute('data-defrost'),'off');
 assert.equal((await box(defrostButton,'::before')).bg,'rgb(23, 23, 26)','»Fra« chosen');
 await page.getByRole('button',{name:'Afrim ruder',exact:true}).waitFor({state:'attached'});
 // An action surface acts on tap: »Lås op« asks first, as before.
 await tiles.first().tap();
 await page.locator('dialog.vehicle-confirmation').getByRole('heading',{name:'Lås bilen op?'}).waitFor({timeout:3000});
 assert.deepEqual(page.errors,[]);await page.close();

 // W-tesla-lader: the S widget.
 page=await open('vehicle-charging-overview',{overview:true});
 const widget=page.locator('#home-vehicle'),w=await box(widget);
 assert.equal(w.bg,'rgb(213, 234, 221)','widget #D5EADD');
 const small=await box(widget.locator('.vehicle-dots'));
 assert.deepEqual([small.x-w.x,small.y-w.y,small.w,small.h],[20,80,133,48],'small dot car');
 assert.equal(await widget.getAttribute('data-car-tone'),'charging');
 const prim=await box(widget.locator('.resource-value'));
 assert.equal(prim.text,'72%');assert.equal(prim.size,'18px');assert.equal(prim.weight,'800');
 near(prim.y+prim.h,w.y+w.h-44,'battery line');
 const ctx=await box(widget.locator('#home-vehicle-status'));
 assert.equal(ctx.text,'Lader');assert.equal(ctx.size,'15px');near(ctx.y+ctx.h,w.y+w.h-20,'status line');
 assert.deepEqual(page.errors,[]);await page.close();
 console.log(JSON.stringify({outcome:'PASS',journey:'ipad_tesla'}));
}catch(error){console.error(error);process.exitCode=1}finally{
 if(browser)await browser.close();if(server&&server.exitCode===null)server.kill();
}})();
