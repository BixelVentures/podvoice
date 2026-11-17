'use strict';
// iPad Robot (issue 395, lærred v190 »A-Robot«, »Robot-*«, »Robot-Sticky*«, »W-robot-*«): a 744×221 hero in #F6D8E1
// (#F6D3DE while a turn runs) with the title in 40/800, the product's line in 19/600, the corner arcs to the right and
// the actions at the bottom right: the primary action as a dark 56 pill and »Mere ▾« beside it (the product's base
// disclosure). Rum as 64-px tiles in four columns with a dot, Rengøringsvalg as segmented rows (Type 56, the rest 44),
// and the page fades out at the fold. When the hero has scrolled away, a 72-px line slides down under the topbar with
// the same title, line, primary action and »Mere ▾«. The M widget has the arcs, 20/800 + 15 and a dark 56 pill.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_ROBOT_TEST_PORT||19003),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
const HERO='#device-view pv-vacuum-widget[data-detail-zone=hero]',ZONE='#device-view .robot-settings-zone';
let server,browser;
// The iPad frame (ui-kit.css): edges 24, the content column 744 (--pv-column), 32, the player 356; y 104 to 796.
// The topbar ends at 88.
const EDGE=24,COLUMN=744,TOP=104,TOPBAR_END=88,RIGHT=EDGE+COLUMN,HALF=(COLUMN-16)/2;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,size:s.fontSize,weight:s.fontWeight,color:s.color,display:s.display,shadow:s.boxShadow,
  mask:s.maskImage||s.webkitMaskImage,text:n.innerText?.trim()};});
const material=node=>node.evaluate(n=>{const s=getComputedStyle(n,'::after');
 return {image:s.backgroundImage,opacity:Number(s.opacity)};});
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

 // A-Robot »oplader« (docked).
 let page=await open('robot-detail-docked');
 const heroNode=page.locator(HERO),hero=await box(heroNode);
 assert.deepEqual([hero.x,hero.y,hero.w,hero.h],[EDGE,TOP,COLUMN,221],'hero column×221 at the top of the column');
 assert.equal(hero.radius,'24px');assert.equal(hero.bg,'rgb(246, 216, 225)','hero #F6D8E1');
 assert.equal((await box(heroNode.locator('.pv-instrument'))).display,'none','arcs, not an icon');
 // The eyebrow over the title (A-Robot »Ved basen«) in 15/600 #5F5E5A, 24 in.
 const eyebrow=await box(heroNode.locator('.robot-hero-eyebrow'));
 assert.equal(eyebrow.text,'Ved basen');assert.equal(eyebrow.size,'15px');assert.equal(eyebrow.weight,'600');
 assert.equal(eyebrow.color,'rgb(95, 94, 90)');near(eyebrow.y,TOP+24,'eyebrow 24 in');
 const title=await box(heroNode.locator('.pv-resource-value'));
 near(title.y,TOP+58,'title under the eyebrow (58 into the hero)');
 assert.equal(title.size,'40px');assert.equal(title.weight,'800');near(title.x,EDGE+24,'title 24 from the left');
 const line=await box(heroNode.locator('.pv-content>.pv-meta'));
 assert.equal(line.size,'19px');assert.equal(line.weight,'600');assert.equal(line.color,'rgb(63, 62, 59)');
 let mat=await material(heroNode);
 assert.match(mat.image,/assets\/robot\/robot-arcs-hero\.svg/,'still arcs at the base');
 near(mat.opacity,.55,'arcs at .55 at the base',.01);
 const start=await box(heroNode.locator('.transport>button.start'));
 assert.equal(start.h,56,'56 primary');assert.equal(start.bg,'rgb(23, 23, 26)','dark primary');
 near(start.x+start.w,RIGHT-24,'primary at the right edge');near(start.y+start.h,TOP+221-24,'actions at the bottom');
 const more=await box(heroNode.locator('[id^=robot-base-][id$=-trigger]'));
 assert.equal(more.text,'Mere');assert.equal(more.h,56,'56 »Mere«');
 near(more.x+more.w,start.x-12,'»Mere« 12 left of the primary');
 assert.equal(more.bg,'rgba(0, 0, 0, 0)','»Mere« is an outline, not a second dark button');
 assert.equal(await heroNode.locator('.transport>button:visible').count(),1,'one dark button: the primary');
 // The section gap under Rengøringsvalg is 32 (canvas), Seneste hændelser then starts.
 const rooms=await box(page.locator('#device-view .robot-room-heading h2'));
 assert.equal(rooms.text,'Rum');
 assert.equal(await page.getByRole('button',{name:'Vælg alle',exact:true}).count(),1,'»Vælg alle« (canvas)');
 const roomsTitle=await box(page.locator('#device-view .robot-room-heading h2'));
 assert.equal(roomsTitle.text,'Rum');assert.equal(roomsTitle.size,'24px');assert.equal(roomsTitle.weight,'800');
 const tiles=page.locator('#device-view .robot-room-tile'),tile=await box(tiles.first());
 assert.equal(tile.h,64,'64-px room tiles');assert.equal(tile.radius,'20px');
 near(tile.w,(COLUMN-30)/4,'four room columns',1);
 assert.equal(tile.bg,'rgb(246, 216, 225)','chosen room in the robot tint');
 assert.match(tile.shadow,/rgb\(178, 58, 98\)/,'chosen room ring #B23A62');
 assert.equal((await box(tiles.first().locator('.robot-room-icon'))).display,'none','a dot instead of the room icon');
 const settings=await box(page.locator('#device-view .robot-settings-zone>h2'));
 assert.equal(settings.text,'Rengøringsvalg');assert.equal(settings.size,'24px');
 const track=await box(page.locator(ZONE+' [data-setting-concept=mode] .pv-kit-choice-options'));
 assert.equal(track.bg,'rgb(233, 231, 226)','segment track');assert.equal(track.radius,'999px');
 const type=await box(page.locator(ZONE+' [data-setting-concept=mode] label').first());
 assert.equal(type.h,56,'Type 56');
 const suction=await box(page.locator(ZONE+' [data-setting-concept=suction] label').first());
 assert.equal(suction.h,44,'fine settings 44');
 assert.match((await box(page.locator('#device-view'))).mask,/linear-gradient/,'fold fade');
 // Robot-Sticky: the hero leaves; the line slides down under the topbar.
 const sticky=page.locator('#device-view .robot-sticky');
 assert.equal(await sticky.getAttribute('data-shown'),'false','no line while the hero shows');
 await page.locator('#device-view').evaluate(n=>{n.scrollTop=420;});await sleep(800);// the bar arrives on the smooth spring (661 ms)
 assert.equal(await sticky.getAttribute('data-shown'),'true','line once the hero is gone');
 const bar=await box(sticky);
 assert.deepEqual([bar.x,bar.y,bar.w,bar.h],[EDGE,TOPBAR_END,COLUMN,72],'72-px line under the topbar');
 assert.equal(bar.bg,'rgb(246, 216, 225)');
 assert.equal(await sticky.locator('.robot-sticky-title').getAttribute('data-text'),title.text,
  'same title as the hero');
 const proxy=sticky.locator('.robot-sticky-primary');
 assert.equal(await proxy.getAttribute('data-text'),start.text,'same primary as the hero');
 assert.equal(await sticky.getAttribute('aria-hidden'),'true',
  'the hero keeps the only controls for assistive technology');
 assert.equal((await box(proxy)).h,44,'44 in the line');
 await page.evaluate(selector=>{window.__heroStart=0;document.querySelector(selector)
  .addEventListener('click',()=>window.__heroStart++);},HERO+' .transport>button.start');
 await proxy.tap();await sleep(150);
 assert.equal(await page.evaluate(()=>window.__heroStart),1,'the line runs the hero action');
 assert.deepEqual(page.errors,[]);
 await page.close();

 // Robot-Sticky-Mere: »Mere ▾« in the line opens the same base panel.
 page=await open('robot-detail-docked');
 await page.locator('#device-view').evaluate(n=>{n.scrollTop=420;});await sleep(500);
 await page.locator('#device-view .robot-sticky-more').tap();await sleep(500);
 assert.equal(await page.locator('#device-view [id^=robot-base-][id$=-trigger]').getAttribute('aria-expanded'),'true');
 await page.close();

 // A running base operation: its stop leads »Mere« in amber, the hero keeps Start + Mere (A-Robot base »vasker«).
 page=await open('robot-detail-drying');
 const baseHero=page.locator(HERO);
 assert((await baseHero.locator('.transport>button:visible').count())<=1,'at most the primary beside »Mere«');
 assert.equal(await baseHero.locator('.transport>button[data-dock-operation]').count(),0,
  'no base stop in the hero row');
 await baseHero.locator('[id^=robot-base-][id$=-trigger]').tap();await sleep(400);
 const stop=baseHero.locator('[id^=robot-base-][id$=-panel] .pv-actions>button').first();
 assert.match(await stop.getAttribute('data-dock-operation'),/_stop$/,'the running operation\'s stop comes first');
 const stopBox=await box(stop);
 assert.equal(stopBox.bg,'rgb(251, 231, 185)','amber #FBE7B9');assert.match(stopBox.shadow,/226, 176, 74/);
 assert.deepEqual(page.errors,[]);await page.close();

 // Vedligehold beside Seneste hændelser (1.5fr + 1fr), 32 under Rengøringsvalg, from the robot's care counters.
 page=await open('robot-detail-care');
 await page.locator('#device-view').evaluate(n=>{n.scrollTop=n.scrollHeight;});await sleep(400);
 const events=await box(page.locator('#device-view>section.device-history:not(:has(pv-robot-control-panel))'));
 const care=await box(page.locator('#robot-care'));
 assert.deepEqual([events.x,events.w],[EDGE,Math.round((COLUMN-16)*.6)],'Seneste hændelser 1.5fr');
 assert.deepEqual([care.x,care.w],[Math.round(EDGE+(COLUMN-16)*.6+16),Math.round((COLUMN-16)*.4)],'Vedligehold 1fr beside it');
 assert.equal(care.y,events.y,'one row');assert.equal(care.bg,'rgb(247, 246, 243)');assert.equal(care.radius,'24px');
 assert.match(care.text,/^Vedligehold/);
 assert.match(care.text,/Hovedbørste[\s\S]*Sidebørste[\s\S]*Filter[\s\S]*Sensorer/,'the product\'s care rows');
 const above=await page.locator('#device-view>section.device-history:has(pv-robot-control-panel)').evaluate(n=>
  n.getBoundingClientRect().bottom);
 near(events.y-above,32,'32 under Rengøringsvalg',1);
 assert.deepEqual(page.errors,[]);await page.close();

 // W-robot »oplader«: the M widget carries the battery and the last run (»Batteri 76 % · senest …«).
 page=await open('robot-detail-docked',{overview:true});
 const ctxLine=await page.locator('#now-view .resource-card[data-kind=vacuum] .resource-preview small').innerText();
 assert.match(ctxLine,/^Batteri 76 % · senest 12,5 m² · 10 min$/,`robot widget context: ${ctxLine}`);
 await page.close();

 // Robot-Rengoer: the turn runs; the arcs breathe on #F6D3DE.
 page=await open('robot-detail-cleaning');
 const running=page.locator(HERO);
 assert.equal((await box(running)).bg,'rgb(246, 211, 222)','#F6D3DE while a turn runs');
 mat=await material(running);
 assert.match(mat.image,/robot-arcs-hero-active\.svg/);near(mat.opacity,1,'full arcs',.01);
 await page.close();

 // Robot-Fejl: broken grey arcs.
 page=await open('robot-detail-fault');
 assert.match((await material(page.locator(HERO))).image,
  /robot-arcs-hero-broken\.svg/);
 await page.close();

 // W-robot »rengoer« in the overview.
 page=await open('robot-overview-cleaning',{overview:true});
 const card=page.locator('#now-view .resource-card[data-kind=vacuum]'),cbox=await box(card);
 assert.deepEqual([cbox.w,cbox.h],[HALF,220],'M widget: two 174 columns and the gap, one 220 row');
 const preview=card.locator('.resource-preview');
 assert.match((await material(preview)).image,/robot-arcs-widget-active\.svg/,'widget arcs');
 const value=await box(preview.locator('.resource-value'));
 assert.equal(value.size,'20px');assert.equal(value.weight,'800');
 const context=await box(preview.locator('small'));
 assert.equal(context.size,'15px');assert.equal(context.color,'rgb(94, 64, 73)');
 const pill=await box(card.locator('.resource-direct-action'));
 assert.equal(pill.h,56,'56 pill');assert.equal(pill.bg,'rgb(23, 23, 26)','dark pill');assert.equal(pill.text,'Pause');
 near(pill.x+pill.w,cbox.x+cbox.w-20,'pill 20 from the right');
 near(pill.y+pill.h,cbox.y+cbox.h-20,'pill 20 from the bottom');
 assert.deepEqual(page.errors,[]);
 await page.close();

 // W-robot »oplader« (docked): only the arcs, no action pill. A hidden action must never paint as a dark blob (Green).
 page=await open('robot-detail-docked',{overview:true});
 const docked=page.locator('#now-view .resource-card[data-kind=vacuum]');
 assert.equal(await docked.locator('.resource-direct-action').isVisible(),false,'no pill while docked');
 assert.match((await material(docked.locator('.resource-preview'))).image,/robot-arcs-widget/,'docked widget arcs');
 await page.close();
 console.log('ipad robot: ok');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.kill();}})();
