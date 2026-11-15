'use strict';
// iPad Lys (issue 396, lærred v190 »A-Lys«, »Lys-Taendt«, »Lys-Slukket«, »Lys-Ukendt«, »W-lys-*«): rooms first, then
// the chosen room's scenes, brightness and lamps. A 44-px »Rum« line with the room choices and »Sluk alt« at the right;
// the rooms as 364×128 cards in two columns (#FBEBC6 when lit, the screen's own room tagged »Denne skærms rum«, a
// 56×34 switch bottom right, the chosen room ringed 3 px); one #F7F6F3 card with the room name in 24/800, scenes as
// 72-px tiles in three columns (the chosen one dark), »Lysstyrke« as one 44-px row and »Lamper« as a 56-px line. The page
// fades out at the fold. With nothing connected the card is a 221 hero in #FBEBC6 with the glow. The S widget is
// #FBEBC6 with the bulb material, the state in 18/800 and the room under it.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_LYS_TEST_PORT||19004),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
let server,browser;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=(node,pseudo=null)=>node.evaluate((n,pseudo)=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n,pseudo);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,image:s.backgroundImage,size:s.fontSize,weight:s.fontWeight,color:s.color,display:s.display,
  shadow:s.boxShadow,mask:s.maskImage||s.webkitMaskImage,pw:s.width,ph:s.height,opacity:Number(s.opacity),
  text:n.innerText?.trim()};},pseudo);
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

 // Lys-Taendt: the product's Hue example (Køkken lit with the scene »Morgen«).
 let page=await open('hue-kitchen');
 const bar=await box(page.locator('#device-view .light-room-toolbar'));
 assert.deepEqual([bar.x,bar.y,bar.w,bar.h],[24,88,744,44],'the »Rum« line first, 744×44 at the top of the column');
 const home=await box(page.locator('#device-view .light-home-power'));
 assert.equal(home.h,44,'»Sluk alt« 44');assert.equal(home.radius,'999px');near(home.x+home.w,768,'»Sluk alt« right');
 assert.equal(home.bg,'rgb(247, 246, 243)','»Sluk alt« #F7F6F3');
 const rows=page.locator('#device-view .light-room-row'),own=await box(rows.first()),other=await box(rows.nth(1));
 assert.deepEqual([own.x,own.y,own.w,own.h],[24,148,364,128],'rooms 16 under the line, 364×128');
 assert.deepEqual([other.x,other.y],[404,148],'two room columns 16 apart');
 const ownTile=await box(rows.first().locator('.light-room-power'));
 assert.equal(ownTile.radius,'24px');assert.equal(ownTile.bg,'rgb(251, 235, 198)','lit room #FBEBC6');
 assert.match(ownTile.shadow,/rgb\(23, 23, 26\) 0px 0px 0px 3px inset/,'chosen room ringed 3 px');
 assert.doesNotMatch((await box(rows.nth(1).locator('.light-room-power'))).shadow,/0px 0px 0px 3px/,'only the chosen');
 const tag=await box(rows.first().locator('.light-room-tag'));
 assert.equal(tag.text,'Denne skærms rum');assert.equal(tag.size,'15px');assert.equal(tag.color,'rgb(122, 82, 5)');
 assert.equal((await box(rows.nth(1).locator('.light-room-tag'))).text,'Rum');
 const name=await box(rows.first().locator('.light-room-name'));
 assert.equal(name.size,'26px');assert.equal(name.weight,'800');near(name.x,24+24,'name 24 in');
 const status=await box(rows.first().locator('.light-room-status'));
 assert.equal(status.size,'16px');near(status.y+status.h,148+128-24,'status at the bottom',3);
 assert.equal((await box(rows.first().locator('.light-room-icon'))).display,'none','a switch, not a bulb icon');
 const track=await box(rows.first().locator('.light-room-power'),'::after');
 assert.equal(track.pw,'56px');assert.equal(track.ph,'34px');assert.equal(track.bg,'rgb(23, 23, 26)','switch on');
 const panel=await box(page.locator('#device-view #light-room-controls'));
 assert.deepEqual([panel.x,panel.y,panel.w],[24,308,744],'room card 32 under the rooms');
 assert.equal(panel.radius,'24px');assert.equal(panel.bg,'rgb(247, 246, 243)');
 const heading=await box(page.locator('#device-view #light-room-panel-title'));
 assert.equal(heading.size,'24px');assert.equal(heading.weight,'800');assert.equal(heading.text,'Køkken');
 const scenes=page.locator('#device-view .light-scene-choices>button:not([hidden])');
 const first=await box(scenes.first()),second=await box(scenes.nth(1));
 assert.equal(first.h,72,'72-px scenes');assert.equal(first.radius,'20px');near(first.w,(744-48-24)/3,'three columns',1);
 assert.equal(first.bg,'rgb(23, 23, 26)','chosen scene dark');assert.equal(second.bg,'rgb(251, 235, 198)','scene #FBEBC6');
 assert.equal(first.size,'19px');assert.equal(first.weight,'800');
 const level=await box(page.locator('#device-view .light-scenes>.pv-kit-slider-field'));
 assert.equal(level.h,44,'brightness one 44 row');
 const label=await box(page.locator('#light-scene-level-label'));
 near(label.y,level.y+(44-label.h)/2,'label beside the slider',3);assert.equal(label.size,'17px');
 const lamps=await box(page.locator('#light-lamps-trigger'));
 assert.equal(lamps.h,56,'»Lamper« 56 line');assert.equal(lamps.bg,'rgba(0, 0, 0, 0)','no lamp box');
 assert.match((await box(page.locator('#device-view'))).mask,/linear-gradient/,'fold fade');
 assert.deepEqual(page.errors,[]);await page.close();

 // Lys-Slukket: the switch off and the room on the paper surface (the product's tile still switches the room).
 page=await open('hue-kitchen');
 await page.locator('#device-view .light-room-power').first().tap();await sleep(900);
 const off=await box(page.locator('#device-view .light-room-power').first());
 assert.equal(off.bg,'rgb(247, 246, 243)','unlit room on paper');
 assert.equal((await box(page.locator('#device-view .light-room-power').first(),'::after')).bg,'rgba(23, 23, 26, 0.16)');
 assert.deepEqual(page.errors,[]);await page.close();

 // Not connected: the card is the hero with the glow.
 page=await open('light-detail-empty');
 const hero=await box(page.locator('#device-view #light-room-controls'));
 assert.deepEqual([hero.x,hero.y,hero.w,hero.h],[24,88,744,221],'744×221 hero');
 assert.equal(hero.bg,'rgb(251, 235, 198)');
 assert.match((await box(page.locator('#device-view #light-room-controls'),'::after')).image,/light-glow-hero\.svg/);
 assert.equal((await box(page.locator('#light-room-panel-title'))).size,'40px');
 await page.close();

 // W-lys: S widget.
 page=await open('hue-kitchen',{overview:true});
 const widget=page.locator('#now-view .resource-card[data-kind=light]>.resource-preview');
 const w=await box(widget);assert.equal(w.bg,'rgb(251, 235, 198)');
 assert.match((await box(widget,'::after')).image,/light-bulb-widget\.svg/,'warm bulb when lit');
 const value=await box(widget.locator('.resource-value'));
 assert.equal(value.size,'18px');assert.equal(value.weight,'800');assert.equal(value.color,'rgb(122, 82, 5)');
 near(value.y+value.h,w.y+w.h-44,'state above the context line');
 const ctx=await box(widget.locator('.resource-fact[data-fact-id=rooms] .resource-fact-value'));
 assert.equal(ctx.text,'Køkken');assert.equal(ctx.size,'15px');near(ctx.y+ctx.h,w.y+w.h-20,'room at the bottom');
 assert.equal((await box(widget.locator('.resource-visual>img'))).w,22,'22 head icon');
 assert.deepEqual(page.errors,[]);await page.close();
 console.log('ipad lys ok');
}finally{await browser?.close();server?.kill();}})().catch(error=>{console.error(error);process.exit(1);});
