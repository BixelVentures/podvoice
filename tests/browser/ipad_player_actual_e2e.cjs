'use strict';
// iPad afspiller (issue 391, lærred v190 »A-Player«, »Player-Radio«, »Player-Tom«, »Player-Offline«):
// the player is a 372×695 card with the speaker chip on top, a 252 cover, a 24/800 title, a 4-px progress line,
// 56/80/56 transport and the volume row at the bottom; radio shows its live state; nothing playing shows a
// 324×220 placeholder, the product's own text and a black »Vælg musik« pill at the bottom.
// "Flyt til <rum>" for the user's own music on another device is proven in music_actual_e2e (live fixture).
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_PLAYER_TEST_PORT||18989),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
let server,browser;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  bg:s.backgroundColor,size:s.fontSize,weight:s.fontWeight,color:s.color,text:n.innerText?.trim()};});
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

 // A-Player: own music in the room.
 let page=await open('now');
 const card=await box(page.locator('.player'));
 assert.deepEqual([card.x,card.y,card.w,card.h],[784,88,372,695],'the player card keeps the #388 frame');
 assert.equal(card.radius,'26px','card radius 26');
 assert.equal(card.bg,'rgb(247, 246, 243)','card surface #F7F6F3');
 const chip=await box(page.locator('#output'));
 near(chip.y,106,'chip starts 18 under the card top');near(chip.h,44,'chip is 44 high');
 const cover=await box(page.locator('.player .cover-button'));
 assert.deepEqual([cover.w,cover.h],[252,252],'cover 252');near(cover.x,844,'cover is centred');
 near(cover.y,170,'cover 20 under the chip');assert.equal(cover.radius,'14px');
 const title=await box(page.locator('#track-name'));
 assert.equal(title.size,'24px');assert.equal(title.weight,'800');near(title.y,450,'title 28 under the cover',3);
 const artist=await box(page.locator('#track-artist'));
 assert.equal(artist.size,'17px');assert.equal(artist.color,'rgb(95, 94, 90)');
 const elapsed=await box(page.locator('#player-elapsed'));
 assert.equal(elapsed.size,'15px','times 15 px');
 assert.match(await page.locator('#player-elapsed').evaluate(n=>getComputedStyle(n).fontFamily),/Schibsted/,
  'times in the UI font, not mono');
 const [prev,play,next]=await Promise.all(['#previous','#play-pause','#next'].map(s=>box(page.locator('.player '+s))));
 assert.deepEqual([prev.w,prev.h,play.w,play.h,next.w,next.h],[56,56,80,80,56,56],'transport 56/80/56');
 near(play.x+play.w/2,970,'play is centred');
 const mute=await box(page.locator('#volume-mute'));
 assert.deepEqual([mute.w,mute.h],[44,44],'mute is a 44 target');
 near(mute.y+mute.h,751,'volume row sits at the bottom of the card');
 assert.equal(await page.locator('#move-here').isVisible(),false,'no move button for music in the room');
 assert.deepEqual(page.errors,[]);
 await page.close();

 // Player-Radio: logo 252/24, live state under the station, a centred 80 stop/play.
 page=await open('radio-selected');
 const logo=await box(page.locator('.player .cover-button'));
 assert.deepEqual([logo.w,logo.h],[252,252],'station logo 252');assert.equal(logo.radius,'24px');
 const live=page.locator('#radio-live');
 assert.equal(await live.isVisible(),true,'radio shows its live state');
 const playing=(await page.locator('#play-pause').getAttribute('aria-label'))==='Stop radio';
 assert.equal((await live.innerText()).trim().toLowerCase(),playing?'direkte':'stoppet');
 const radioPlay=await box(page.locator('.player #play-pause'));
 assert.deepEqual([radioPlay.w,radioPlay.h],[80,80]);near(radioPlay.x+radioPlay.w/2,970,'radio play is centred');
 assert.deepEqual(page.errors,[]);
 await page.close();

 // Player-Tom: nothing plays.
 page=await open('player-active-empty',{overview:true});
 const art=await box(page.locator('#player-empty .player-empty-art'));
 assert.deepEqual([art.w,art.h],[324,220],'placeholder 324×220');assert.equal(art.radius,'16px');
 near(art.y,166,'placeholder 16 under the chip');
 const copy=await box(page.locator('#player-empty>.player-empty-copy>p'));
 assert.equal(copy.size,'22px');assert.equal(copy.weight,'800');near(copy.y,402,'copy 16 under the placeholder',3);
 const find=await box(page.locator('#empty-find-music'));
 assert.equal(find.h,56,'pill 56');assert.equal(find.bg,'rgb(23, 23, 26)','black pill');
 near(find.y+find.h,759,'pill at the bottom of the card');
 assert.equal(find.text,'Vælg musik');
 assert.deepEqual(page.errors,[]);
 await page.close();
 console.log('ipad player journey ok');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.kill();}})();
