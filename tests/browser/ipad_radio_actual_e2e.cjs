'use strict';
// iPad Radio (issue 393, lærred v190 »A-Radio«, »Radio-Starter«, »Radio-Spiller«, »Radio-IkkeTilg«, »W-radio-*«):
// a 744×458 hero with the station logo, status line, 56/800 title, description and a station scale with a needle;
// under it »Radiostationer« with »Afspilles på <højttaler>« and five 56-px logo tiles in one row. Radio plays in the
// right-hand media player. When radio is not available the hero says so, the scale fades and the tiles are grey;
// the small Radio widget in the overview is dimmed and says »Ikke tilgængelig«.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_RADIO_TEST_PORT||18997),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
let server,browser;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,size:s.fontSize,weight:s.fontWeight,color:s.color,opacity:s.opacity,filter:s.filter,
  shadow:s.boxShadow,display:s.display,text:n.innerText?.trim()};});
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
const hero=page=>page.locator('#radio-view .radio-hero');
const text=(page,selector)=>page.locator(`#radio-view ${selector}`).innerText().then(value=>value.trim());
(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());

 // A-Radio »vaelg«: no station chosen (stage radio-ready).
 let page=await open('radio-ready');
 const card=await box(hero(page));
 assert.deepEqual([card.x,card.y,card.w,card.h],[24,88,744,458],'hero 744×458 at the top of the column');
 assert.equal(card.radius,'24px','hero radius 24');
 assert.equal(card.bg,'rgb(247, 246, 243)','no station: plain #F7F6F3');
 assert.equal(await text(page,'.radio-hero-status'),'Ingen station valgt');
 const title=await box(page.locator('#radio-view .radio-hero h2'));
 assert.equal(title.text,'Vælg station');assert.equal(title.size,'56px');assert.equal(title.weight,'800');
 assert.equal(await text(page,'.radio-hero-sub'),'5 stationer');
 assert.equal(await page.locator('#radio-view .radio-scale-tick').count(),61,'61 ticks on the scale');
 assert.equal(await page.locator('#radio-view .radio-scale-mark').count(),5,'one mark per station');
 assert.equal(await page.locator('#radio-view .radio-scale-needle').isVisible(),false,'no needle without a station');
 assert.equal((await box(page.locator('#radio-view .radio-hero-art'))).display,'none','no logo without a station');
 const heading=await box(page.locator('#radio-view .radio-stations-title'));
 assert.equal(heading.text,'Radiostationer');assert.equal(heading.size,'24px');assert.equal(heading.weight,'800');
 near(heading.y,88+458+32,'the list starts 32 under the hero',4);
 const tiles=page.locator('#radio-view .radio-station-tiles .pv-list>button');
 assert.equal(await tiles.count(),5);
 const boxes=await Promise.all([0,1,2,3,4].map(index=>box(tiles.nth(index))));
 assert(boxes.every(tile=>tile.y===boxes[0].y),'five tiles in one row');
 assert(boxes.every(tile=>Math.abs(tile.w-136)<=2),`tiles share the width: ${boxes.map(tile=>tile.w)}`);
 near(boxes[4].x+boxes[4].w,768,'the row fills the column');
 assert.equal(boxes[0].radius,'24px','tile radius 24');
 const logo=await box(tiles.nth(0).locator('img'));
 assert.deepEqual([logo.w,logo.h],[56,56],'56-px station logo');
 assert.equal((await box(tiles.nth(0).locator('.pv-meta'))).display,'none','tiles carry only logo and name');
 assert.deepEqual(page.errors,[]);
 // A tap is answered at once in the hero, and the player takes the station.
 const tapAt=Date.now();await tiles.nth(1).click();
 await page.waitForFunction(()=>document.querySelector('#radio-view .radio-hero h2')?.textContent==='P1',undefined,
  {timeout:300});
 assert(Date.now()-tapAt<300,'own choice shown < 300 ms');
 assert.match(await text(page,'.radio-hero-status'),/^(Starter P1…|Spiller på .+)$/);
 assert.equal(await page.locator('#track-name').innerText(),'P1','radio plays in the media player');
 await page.close();

 // Radio-Spiller: the station's logo, its colour on the hero, the needle at the station and a ring on its tile.
 page=await open('radio-selected');
 assert.match(await text(page,'.radio-hero-status'),/^Spiller på .+/);
 assert.equal(await text(page,'.radio-hero h2'),'P3');
 assert.equal(await text(page,'.radio-hero-sub'),'Musik og underholdning');
 const art=await box(page.locator('#radio-view .radio-hero-art'));
 assert.deepEqual([art.w,art.h],[144,144],'144 logo');assert.equal(art.radius,'24px');
 assert.match(await page.locator('#radio-view .radio-hero-art').getAttribute('src'),/radio-p3\.svg$/);
 assert.notEqual((await box(hero(page))).bg,'rgb(247, 246, 243)','the hero takes the station colour');
 const needle=await box(page.locator('#radio-view .radio-scale-needle'));
 assert.equal(needle.bg,'rgb(229, 38, 30)','live needle is red');
 const scale=await box(page.locator('#radio-view .radio-scale'));
 near(needle.x+needle.w/2,scale.x+scale.w*0.1,'needle at the first station',3);
 const selected=await box(page.locator('#radio-view .pv-list>button[aria-pressed=true]'));
 assert.match(selected.shadow,/^rgb\(77, 255, 77\) 0px 0px 0px 3px inset$/,'selected tile has a 3-px ring in the station colour');
 assert.match(await text(page,'.radio-stations-speaker'),/^Afspilles på .+/);
 await page.close();

 // Radio-Starter: the needle turns yellow and the hero says »Starter …«.
 page=await open('radio-request-pending');
 assert.match(await text(page,'.radio-hero-status'),/^Starter .+…$/);
 assert.equal((await box(page.locator('#radio-view .radio-scale-needle'))).bg,'rgb(201, 162, 39)','yellow needle');
 await page.close();

 // Radio-IkkeTilg: the reason in the hero, the scale faded and grey tiles that cannot be pressed.
 page=await open('radio-offline');
 assert.equal(await text(page,'.radio-hero-status'),'Ikke tilgængelig');
 assert.equal(await text(page,'.radio-hero h2'),'Radio');
 assert.match(await text(page,'.radio-hero-sub'),/Ikke forbundet/);
 assert.equal((await box(page.locator('#radio-view .radio-scale'))).opacity,'0.3','scale fades');
 assert.equal(await page.locator('#radio-view .radio-scale-needle').isVisible(),false);
 const off=await box(page.locator('#radio-view .pv-list>button').first().locator('img'));
 assert.match(off.filter,/grayscale\(1\)/,'grey logos');
 await page.close();

 // W-radio »ikketilg«: the small overview widget is dimmed and says so.
 page=await open('radio-offline',{overview:true});
 assert.equal(await page.locator('#home-radio').getAttribute('data-kit-state'),'unavailable');
 assert.equal((await page.locator('#home-radio small .overview-media-title').innerText()).trim(),'Ikke tilgængelig');
 assert.equal((await box(page.locator('#home-radio small'))).color,'rgb(140, 138, 133)','grey primary line');
 await page.close();

 console.log(JSON.stringify({outcome:'PASS',journey:'ipad_radio'}));
}finally{await browser?.close();server?.kill();}})().catch(error=>{console.error(error);process.exitCode=1;});
