'use strict';
// iPad Vejr (issue 394, lærred v190 »A-Vejr«, »Vejr-Ukendt«, »Vejr-Shadere«, »W-vejr-*«): a 744×458 #DDE6FB hero with
// »<sted> · Vejret i dag«, the temperature in 150/500, the condition in 26/800 and the range; the hour forecast sits in
// the bottom of the hero in 156-wide columns with the kit's right fade and snap. 32 under it »De næste dage« (24/800)
// over one #F7F6F3 card of 64-px rows. The dot material follows the weather type. Data older than the freshness rule
// shows its time as a chip; no data shows »—«, a faded material and the product's reason. The L widget in the overview
// has the 120/500 temperature, the condition in 20/800, the range and five hours at the bottom.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_VEJR_TEST_PORT||18998),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
let server,browser;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,size:s.fontSize,weight:s.fontWeight,color:s.color,opacity:s.opacity,display:s.display,
  snap:s.scrollSnapType,mask:s.maskImage||s.webkitMaskImage,text:n.innerText?.trim()};});
const material=node=>node.evaluate(n=>{const s=getComputedStyle(n,'::before');
 return {image:s.backgroundImage,opacity:s.opacity,w:Math.round(parseFloat(s.width)),
   h:Math.round(parseFloat(s.height))};});
async function open(stage,{overview=false}={}){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.clock.setFixedTime(DAY);
 await page.goto(`${base}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
 await page.locator('pv-widget-host').waitFor({state:'attached'});await sleep(700);
 if(overview){
  await page.evaluate(()=>document.querySelector('pv-widget-host').dispatch({type:'show',id:'now'}));await sleep(500);
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

 // A-Vejr »frisk«.
 let page=await open('weather');
 const heroNode=page.locator('#weather-view .weather-current'),hero=await box(heroNode);
 assert.deepEqual([hero.x,hero.y,hero.w,hero.h],[24,88,744,458],'hero 744×458 at the top of the column');
 assert.equal(hero.radius,'24px','hero radius 24');
 assert.equal(hero.bg,'rgb(221, 230, 251)','hero #DDE6FB');
 const place=await box(page.locator('#weather-title'));
 assert.equal(place.text,'Mårslet');assert.equal(place.size,'17px');assert.equal(place.weight,'600');
 near(place.y,88+32,'place line 32 inside the hero',4);near(place.x,24+32,'place line 32 from the left',2);
 // The preview fixture has no subtitle; live data says »Vejret i dag« (liveWeatherModel), shown after » · «.
 assert.equal((await box(page.locator('#weather-view>.response-heading p'))).display,'none','empty subtitle: no » · «');
 const big=await box(page.locator('#weather-view .weather-current strong'));
 assert.equal(big.size,'150px');assert.equal(big.weight,'500');assert.equal(big.color,'rgb(58, 69, 96)');
 const line=await box(page.locator('#weather-view .weather-current [data-kit-slot=title]'));
 assert.equal(line.size,'26px');assert.equal(line.weight,'800');
 assert.equal((await box(page.locator('#weather-view .weather-current>img'))).display,'none','material, not an icon');
 const mat=await material(heroNode);
 assert.match(mat.image,/assets\/weather\/weather-(cloud|sun|rain|snow|fog|storm)\.svg/,'dot material on the hero');
 const hours=await box(page.locator('#weather-view .weather-hours'));
 assert(hours.y>hero.y+200&&hours.y+hours.h<=hero.y+hero.h,`hours inside the hero: ${hours.y}+${hours.h}`);
 assert.equal(hours.snap,'x mandatory','hours snap');assert.match(hours.mask,/linear-gradient/,'hours fade right');
 const hour=await box(page.locator('#weather-view .weather-hours>[role=group]').first());
 assert.equal(hour.w,156,'156-wide hour columns');
 const hourTemp=await box(page.locator('#weather-view .weather-hours>[role=group] strong').first());
 assert.equal(hourTemp.size,'22px');assert.equal(hourTemp.weight,'800');
 assert.equal((await box(page.locator('#weather-view .weather-hour-rain').first())).display,'none');
 const daysTitle=await box(page.locator('#weather-view .weather-days>h2'));
 assert.equal(daysTitle.text,'De næste dage');assert.equal(daysTitle.size,'24px');assert.equal(daysTitle.weight,'800');
 near(daysTitle.y,88+458+32,'»De næste dage« 32 under the hero',4);
 const day=await box(page.locator('#weather-view .weather-days>[role=group]').first());
 assert.equal(day.h,64,'64-px day rows');
 const view=await box(page.locator('#weather-view'));
 assert(view.y+view.h<=820,'the page scrolls inside the column, not the screen');
 assert.deepEqual(page.errors,[]);
 await page.close();

 // Vejr-Gammel: data past the freshness rule shows its time as a chip on the place line.
 page=await open('weather-stale');
 const chip=await box(page.locator('#weather-view .weather-metadata'));
 assert.notEqual(chip.display,'none','freshness chip shown');assert.match(chip.text,/(Opdateret|Ikke opdateret)/);
 near(chip.y,88+28,'chip on the place line',8);near(chip.x+chip.w,768-32,'chip right in the hero',3);
 await page.close();

 // Vejr-Ukendt: no data shows »—«, a faded material and the product's reason.
 page=await open('weather-connection-error');
 const emptyHero=page.locator('#weather-view .weather-current');
 const empty=await box(emptyHero);
 assert.deepEqual([empty.w,empty.h],[744,458],'the hero keeps its size without data');
 const dash=await page.locator('#weather-view .weather-current strong').evaluate(n=>
  getComputedStyle(n).display!=='none'&&(n.textContent||getComputedStyle(n,'::before').content));
 assert.match(String(dash),/—/,'»—« in place of the temperature');
 assert(Number((await material(emptyHero)).opacity)<=.1,'faded material');
 assert.match(await page.locator('#weather-view .weather-current').innerText(),/Home Assistant svarer ikke lige nu/);
 await page.close();

 // W-vejr »frisk« in the overview.
 page=await open('weather',{overview:true});
 const widget=page.locator('#home-weather'),wbox=await box(widget);
 assert.deepEqual([wbox.w,wbox.h],[364,458],'L widget');
 const temp=await box(widget.locator('.home-temperature'));
 assert.equal(temp.size,'120px');assert.equal(temp.weight,'500');assert.equal(temp.color,'rgb(23, 23, 26)');
 const condition=await box(widget.locator('.home-condition'));
 assert.equal(condition.size,'20px');assert.equal(condition.weight,'800');
 const range=await box(widget.locator('small'));
 assert.equal(range.size,'15px');assert.equal(range.color,'rgb(62, 70, 96)');
 const wHour=await box(widget.locator('.home-forecast-hour strong').first());
 assert.equal(wHour.size,'19px');assert.equal(wHour.weight,'800');assert.equal(wHour.color,'rgb(26, 63, 184)');
 const forecast=await box(widget.locator('.home-forecast'));
 near(forecast.y+forecast.h,wbox.y+wbox.h-20,'hours at the bottom of the widget',3);
 assert.match(await widget.evaluate(n=>getComputedStyle(n).backgroundImage),
   /assets\/weather\/weather-cloud-widget\.svg/,
  'widget material');
 assert.equal(await widget.evaluate(n=>getComputedStyle(n,'::before').display),'block','widget chevron');
 assert.deepEqual(page.errors,[]);
 await page.close();
 console.log('ipad vejr: ok');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.kill();}})();
