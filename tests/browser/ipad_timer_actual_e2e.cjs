'use strict';
// iPad Timer (lærred »A-Timer«, »Timer-pause«, »Timer-faerdig«, »Timer-Alarm«): the dark 744×458 hero carries the
// kicker »Timer · 10 min«, »af 10:00« under the time, »Færdig kl. HH.MM« under the state and the actions in one row
// (+1 min, −1 min, Annuller for the native timer). Under the hero »Tidligere timere« fills the column to 784 with the
// product's own timer history (time in 18 mono, »Seneste« for the newest, »Tidligere« for the rest). Without history
// the card is not shown. The full-screen alarm shows the kicker over the title and the time as »0:00«.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_TIMER_TEST_PORT||19007),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DAY=new Date('2026-11-09T13:10:00Z');
let server,browser;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),bg:s.backgroundColor,
  size:s.fontSize,weight:s.fontWeight,color:s.color,family:s.fontFamily,radius:s.borderTopLeftRadius,
  text:n.innerText?.trim()};});
async function open(stage){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.clock.setFixedTime(DAY);
 await page.goto(`${base}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
 await page.locator('pv-widget-host').waitFor({state:'attached'});await sleep(800);
 return page;
}
const shot=(page,name)=>page.screenshot({path:path.join(env.artifactDir(),name)});
(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());

 // A-Timer (kører): kicker, total, finish time and the history card under the hero.
 let page=await open('timer-detail-running');
 const panel=page.locator('#timers-view .timer-panel:not([hidden])');
 const kicker=await box(panel.locator('.timer-copy strong'));
 assert.equal(kicker.text,'Timer · 10 min');assert.equal(kicker.size,'17px');
 const total=await box(panel.locator('.timer-total'));
 assert.equal(total.text,'af 10:00');assert.equal(total.size,'17px');
 const count=await box(panel.locator('.timer-count'));assert(total.y>count.y+count.h-4,'total under the time');
 assert.match((await box(panel.locator('.timer-state'))).text,/^Færdig kl\. \d\d\.\d\d$/);
 const recent=await box(page.locator('#timers-view .timer-recent'));
 assert.deepEqual([recent.x,recent.y,recent.w],[24,88+458+16,744],'history card 16 under the hero');
 near(recent.y+recent.h,784,'history card fills the column');
 assert.equal(recent.radius,'24px');assert.equal(recent.bg,'rgb(247, 246, 243)');
 const title=await box(page.locator('#timers-view .timer-recent>h2'));
 assert.equal(title.text,'Tidligere timere');assert.equal(title.size,'24px');assert.equal(title.weight,'800');
 assert.equal((await box(page.locator('#timers-view .timer-recent-note'))).text,'Justér før start');
 const chips=page.locator('#timers-view .timer-recent [data-recent-seconds]');
 assert.equal(await chips.count(),1,'one timer in the product history');
 const chip=await box(chips.first());
 assert.equal(chip.h,56);assert.equal(chip.radius,'999px');assert.equal(chip.bg,'rgb(239, 237, 232)');
 assert.equal((await box(chips.first().locator('.timer-recent-time'))).text,'10:00');
 assert.match((await box(chips.first().locator('.timer-recent-time'))).family,/IBM Plex Mono/);
 assert.equal((await box(chips.first().locator('.timer-recent-label'))).text,'Seneste');
 assert.equal(await chips.first().isDisabled(),true,'a timer is running: the history waits');
 await shot(page,'podview-ipad-timer-koerer.png');
 assert.deepEqual(page.errors,[]);await page.close();

 // Several earlier timers: newest first, »Seneste« then »Tidligere«.
 page=await open('timer-detail-multiple');
 const many=page.locator('#timers-view .timer-recent [data-recent-seconds]');
 assert.deepEqual(await many.locator('.timer-recent-time').allInnerTexts(),['3:00','5:00','10:00']);
 assert.deepEqual(await many.locator('.timer-recent-label').allInnerTexts(),['Seneste','Tidligere','Tidligere']);
 assert.deepEqual(page.errors,[]);await page.close();

 // Timer-pause.
 page=await open('timer-detail-paused');
 const paused=page.locator('#timers-view .timer-panel:not([hidden])');
 assert.equal((await box(paused.locator('.timer-copy strong'))).text,'Timer på pause');
 assert.equal((await box(paused.locator('.timer-state'))).text,'Ringen står stille, til du fortsætter.');
 await shot(page,'podview-ipad-timer-pause.png');
 assert.deepEqual(page.errors,[]);await page.close();

 // Timer-Alarm: kicker over the title and »0:00«.
 page=await open('timer-detail-finished');
 assert.equal((await box(page.locator('#timer-alert-kicker'))).text,'Timer · 10 min');
 assert.equal((await box(page.locator('#timer-alert .notice-copy>strong'))).text,'0:00');
 await shot(page,'podview-ipad-timer-alarm.png');
 // Timer-faerdig: »Luk visning« leaves the page with the ring full, 0:00 and »Tiden er gået« in coral.
 await page.locator('#timer-alert-open').tap();await sleep(500);
 const done=page.locator('#timers-view .timer-panel:not([hidden])');
 assert.equal((await box(done.locator('.timer-count'))).text,'0:00');
 assert.equal(await done.locator('.timer-copy').getAttribute('data-state-label'),'Tiden er gået');
 await shot(page,'podview-ipad-timer-faerdig.png');
 assert.deepEqual(page.errors,[]);await page.close();

 // No history: the card is not shown and the new-timer form stands alone.
 page=await open('timer-detail-empty');
 assert.equal(await page.locator('#timers-view .timer-recent:visible').count(),0,'no invented history');
 assert.deepEqual(page.errors,[]);await page.close();
 console.log('ipad timer ok');
}finally{await browser?.close();server?.kill();}})().catch(error=>{console.error(error);process.exit(1);});
