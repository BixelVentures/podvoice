'use strict';
// iPad Lys (issue 396, lærred v190 »A-Lys«, »Lys-Taendt«, »Lys-Slukket«, »Lys-Ukendt«, »W-lys-*«): rooms first, then
// the chosen room's scenes, brightness and lamps. A 44-px »Rum« line with »Sluk alt« at the right
// (no room chips: a tap on a room card chooses the room, its switch turns the room on or off),
// the rooms as 364×128 cards in two columns (#FBEBC6 when lit, the screen's own room tagged »Denne skærms rum«, a
// 56×34 switch bottom right, the chosen room ringed 3 px); one #F7F6F3 card with the room name in 24/800, scenes as
// 72-px tiles in three columns (the chosen one dark), »Lysstyrke« as one 44-px row and »Lamper« as a 56-px line. The card
// runs to the bottom of the column. With nothing connected the card is a 221 hero in #FBEBC6 with the glow. The S widget is
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
// The iPad frame (ui-kit.css): edges 24, the content column 744 (--pv-column), 32, the player 356; y 104 to 796.
const EDGE=24,COLUMN=744,TOP=104,BOTTOM=796,RIGHT=EDGE+COLUMN,GAP=16,ROOM_W=(COLUMN-GAP)/2,ROOMS_Y=TOP+44+GAP;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=(node,pseudo=null)=>node.evaluate((n,pseudo)=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n,pseudo);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,family:s.fontFamily,image:s.backgroundImage,size:s.fontSize,weight:s.fontWeight,color:s.color,display:s.display,
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
 assert.deepEqual([bar.x,bar.y,bar.w,bar.h],[EDGE,TOP,COLUMN,44],'the »Rum« line first, column×44 at the top');
 const home=await box(page.locator('#device-view .light-home-power'));
 assert.equal(home.h,44,'»Sluk alt« 44');assert.equal(home.radius,'999px');near(home.x+home.w,RIGHT,'»Sluk alt« right');
 assert.equal(home.bg,'rgb(247, 246, 243)','»Sluk alt« #F7F6F3');
 const rows=page.locator('#device-view .light-room-row'),own=await box(rows.first()),other=await box(rows.nth(1));
 assert.deepEqual([own.x,own.y,own.w,own.h],[EDGE,ROOMS_Y,ROOM_W,128],'rooms 16 under the line, half-column×128');
 assert.deepEqual([other.x,other.y],[EDGE+ROOM_W+GAP,ROOMS_Y],'two room columns 16 apart');
 const ownTile=await box(rows.first());
 assert.equal(ownTile.radius,'24px');assert.equal(ownTile.bg,'rgb(251, 235, 198)','lit room #FBEBC6');
 assert.match(ownTile.shadow,/rgb\(23, 23, 26\) 0px 0px 0px 3px inset/,'chosen room ringed 3 px');
 assert.doesNotMatch((await box(rows.nth(1))).shadow,/0px 0px 0px 3px/,'only the chosen');
 // The card chooses the room; the switch (a 44-px target bottom right) is the product's room power.
 const select=await box(rows.first().locator('.light-room-select'));
 assert.deepEqual([select.x,select.y,select.w,select.h],[EDGE,ROOMS_Y,ROOM_W,128],'the whole card chooses the room');
 const power=await box(rows.first().locator('.light-room-power'));
 assert(power.h>=44&&power.w>=56,'switch target at least 44 high');near(power.x+power.w,EDGE+ROOM_W-18,'switch right',2);
 const tag=await box(rows.first().locator('.light-room-tag'));
 assert.equal(tag.text,'Denne skærms rum');assert.equal(tag.size,'15px');assert.equal(tag.color,'rgb(122, 82, 5)');
 assert.equal((await box(rows.nth(1).locator('.light-room-tag'))).text,'Rum');
 const name=await box(rows.first().locator('.light-room-name'));
 assert.equal(name.size,'26px');assert.equal(name.weight,'800');near(name.x,24+24,'name 24 in');
 const status=await box(rows.first().locator('.light-room-status'));
 assert.equal(status.size,'16px');near(status.y+status.h,ROOMS_Y+128-24,'status at the bottom',3);
 assert.equal((await box(rows.first().locator('.light-room-icon'))).display,'none','a switch, not a bulb icon');
 const track=await box(rows.first().locator('.light-room-power'),'::after');
 assert.equal(track.pw,'56px');assert.equal(track.ph,'34px');assert.equal(track.bg,'rgb(23, 23, 26)','switch on');
 const panel=await box(page.locator('#device-view #light-room-controls'));
 assert.deepEqual([panel.x,panel.y,panel.w],[EDGE,ROOMS_Y+128+32,COLUMN],'room card 32 under the rooms');
 assert.equal(panel.radius,'24px');assert.equal(panel.bg,'rgb(247, 246, 243)');
 const heading=await box(page.locator('#device-view #light-room-panel-title'));
 assert.equal(heading.size,'24px');assert.equal(heading.weight,'800');assert.equal(heading.text,'Køkken');
 const scenes=page.locator('#device-view .light-scene-choices>button:not([hidden])');
 const first=await box(scenes.first()),second=await box(scenes.nth(1));
 assert.equal(first.h,72,'72-px scenes');assert.equal(first.radius,'20px');near(first.w,(COLUMN-48-24)/3,'three columns',1);
 assert.equal(first.bg,'rgb(23, 23, 26)','chosen scene dark');assert.equal(second.bg,'rgb(251, 235, 198)','scene #FBEBC6');
 assert.equal(first.size,'19px');assert.equal(first.weight,'800');
 const level=await box(page.locator('#device-view .light-scenes>.pv-kit-slider-field'));
 assert.equal(level.h,44,'brightness one 44 row');
 const label=await box(page.locator('#light-scene-level-label'));
 near(label.y,level.y+(44-label.h)/2,'label beside the slider',3);assert.equal(label.size,'17px');
 const lamps=await box(page.locator('#light-lamps-trigger'));
 assert.equal(lamps.h,56,'»Lamper« 56 line');assert.equal(lamps.bg,'rgba(0, 0, 0, 0)','no lamp box');
 assert.equal((await box(page.locator('#device-view'))).mask,'none','no fold fade: the card ends at the 796 baseline');
 // A-Lys (PR lys/timer): topbar »Lys«, no room chips, the room card runs to the bottom of the column (796), the
 // header carries »N af M lamper tændt«, each scene its level in 15 mono, »Lamper« the count and opens itself for ≤2.
 assert.equal((await page.locator('#header-title').innerText()).trim(),'Lys','topbar heading »Lys«');
 assert.equal(await page.locator('#device-view .light-room-navigation:visible').count(),0,'no room chips');
 near(panel.y+panel.h,BOTTOM,'room card fills the column to the baseline');
 const panelStatus=await box(page.locator('#device-view .light-room-panel-status'));
 assert.equal(panelStatus.text,'2 af 2 lamper tændt');assert.equal(panelStatus.size,'15px');
 assert(panelStatus.y>=heading.y&&panelStatus.y+panelStatus.h<=heading.y+heading.h,'status on the heading line');
 near(panelStatus.x+panelStatus.w,RIGHT-24,'status at the right');
 const sceneLevel=await box(scenes.first().locator('.light-scene-level'));
 assert.equal(sceneLevel.text,'60 %');assert.equal(sceneLevel.size,'15px');assert.match(sceneLevel.family,/IBM Plex Mono/);
 assert.equal((await box(scenes.nth(1).locator('.light-scene-level'))).text,'100 %');
 assert.equal((await box(page.locator('#light-lamps-trigger .light-lamp-count'))).text,'2 stk.');
 assert.equal(await page.locator('#light-lamps-trigger').getAttribute('aria-expanded'),'true','two lamps open by default');
 const lampRows=page.locator('#device-view .light-lamp-row:not([hidden])');
 assert.equal(await lampRows.count(),2);
 // v193: the state alone under the name; the level sits beside the lamp's slider in mono.
 assert.equal((await lampRows.first().locator('.light-lamp-state').innerText()).trim(),'Tændt');
 assert.equal((await lampRows.first().locator('.light-lamp-level output').innerText()).trim(),'60 %');
 const lampA=await box(lampRows.first()),lampB=await box(lampRows.nth(1));
 assert.equal(lampA.y,lampB.y,'lamps in two columns');assert(lampB.x>lampA.x+300,'second lamp in the right column');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-lys-taendt.png')});
 // A tap on the other room's card chooses it; its six lamps start folded.
 await rows.nth(1).locator('.light-room-select').tap();await sleep(500);
 assert.equal((await page.locator('#device-view #light-room-panel-title').innerText()).trim(),'Stue · 1. sal');
 assert.equal(await rows.nth(1).getAttribute('data-selected'),'true');
 assert.equal((await box(page.locator('#light-lamps-trigger .light-lamp-count'))).text,'6 stk.');
 assert.equal(await page.locator('#light-lamps-trigger').getAttribute('aria-expanded'),'false','six lamps folded');
 assert.equal((await box(rows.nth(1))).bg,'rgb(251, 235, 198)','choosing does not switch');
 assert.deepEqual(page.errors,[]);await page.close();

 // Lys-Slukket: the switch off and the room on the paper surface.
 page=await open('hue-kitchen');
 await page.locator('#device-view .light-room-power').first().tap();await sleep(900);
 const off=await box(page.locator('#device-view .light-room-row').first());
 assert.equal(off.bg,'rgb(247, 246, 243)','unlit room on paper');
 assert.equal((await box(page.locator('#device-view .light-room-power').first(),'::after')).bg,'rgba(23, 23, 26, 0.16)');
 assert.deepEqual(page.errors,[]);await page.close();

 // Not connected: the card is the hero with the glow.
 page=await open('light-detail-empty');
 const hero=await box(page.locator('#device-view #light-room-controls'));
 assert.deepEqual([hero.x,hero.y,hero.w,hero.h],[EDGE,TOP,COLUMN,221],'column×221 hero');
 assert.equal(hero.bg,'rgb(251, 235, 198)');
 assert.match((await box(page.locator('#device-view #light-room-controls'),'::after')).image,/light-glow-hero\.svg/);
 assert.equal((await box(page.locator('#light-room-panel-title'))).size,'40px');
 // Lys »Ikke forbundet«: the title, the board's copy and »Opdater lys« at the bottom of the hero.
 assert.equal((await page.locator('#light-room-panel-title').innerText()).trim(),'Ikke forbundet');
 assert.equal((await page.locator('#device-view #light-room-controls>p').innerText()).trim(),
  'Forbind lys i Home Assistant for at se og styre dem her.');
 const refresh=await box(page.locator('#device-view .light-room-refresh'));
 assert.equal(refresh.text,'Opdater lys');assert.equal(refresh.h,56);assert.equal(refresh.bg,'rgb(23, 23, 26)');
 near(refresh.y+refresh.h,TOP+221-24,'»Opdater lys« at the bottom of the hero');near(refresh.x,48,'left in the hero');
 // The column runs from 104 to the 796 baseline and cannot scroll the hero up under the topbar.
 const column=await box(page.locator('#device-view'));
 assert.deepEqual([column.y,column.y+column.h],[TOP,BOTTOM],'Lys column 104–796');
 await page.locator('.responses').evaluate(n=>{n.scrollTop=40;});
 assert.equal((await box(page.locator('#device-view #light-room-controls'))).y,TOP,'the hero stays at 104');
 // »<rum> · denne skærms rum« above the title when Home Assistant names the screen's light area.
 assert.equal(await page.locator('#light-room-controls .light-room-kicker').isVisible(),false,
  'no eyebrow without a known area');
 await page.evaluate(()=>{const h=document.querySelector('pv-widget-host');
  h.state={...h.state,lightPlacement:{status:'bound',areaName:'Køkkenalrum'}};
  h.lightRoomView.render(h.state.devices.find(d=>d.id===h.state.focus));});
 const kicker=await box(page.locator('#light-room-controls .light-room-kicker'));
 assert.equal(kicker.text,'Køkkenalrum · denne skærms rum');assert.equal(kicker.size,'17px');
 assert.equal(kicker.weight,'600');assert.equal(kicker.color,'rgb(111, 106, 94)');
 near(kicker.y,TOP+24,'the eyebrow opens the hero, 24 in');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-lys-ikkeforbundet.png')});
 await page.close();
 // Lys-Ukendt (stale): the rooms and lamps keep their place, nothing can be switched.
 page=await open('hue-stale');
 assert.equal(await page.locator('#device-view .light-room-power:not([disabled])').count(),0,'stale rooms locked');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-lys-ukendt.png')});
 assert.deepEqual(page.errors,[]);await page.close();

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
