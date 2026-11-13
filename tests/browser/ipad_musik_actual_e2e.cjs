'use strict';
// iPad Musik-siden (issue 392, lærred v190 »A-MusikHjem«, »Musik-Starter«, »Musik-Spiller«, »Musik-Koe«):
// one page without tabs. The collections are section headings in the canvas order (Til <ugedag> <tid> · Fortsæt ·
// Vibe · Jeres playlister); the first mood card is the 744×252 »Lige nu« hero with an Afspil pill; the other cards
// are a rail of 160 cards (Fortsæt 260×72, Vibe 120). A tap shows »starter« (scrim and dots) at once and »spiller«
// (equalizer mark) when the player has it. The queue is one card of 72-px rows; the current track is in the accent.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_MUSIK_TEST_PORT||18994),base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Monday 9 Nov 2026 14.10 Europe/Copenhagen: the afternoon period.
const DAY=new Date('2026-11-09T13:10:00Z');
let server,browser;
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  display:s.display,size:s.fontSize,weight:s.fontWeight,color:s.color,text:n.innerText?.trim()};});
async function open(stage){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.clock.setFixedTime(DAY);
 await page.goto(`${base}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
 await page.locator('pv-widget-host').waitFor({state:'attached'});await sleep(700);
 return page;
}
(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 browser=await chromium.launch(env.browserOptions());

 // A-MusikHjem: one page, the collections are section headings in the canvas order.
 let page=await open('music-prototype-afternoon');
 assert.equal(await page.locator('#header-title').innerText(),'Musik','the topbar says Musik');
 assert.equal((await box(page.locator('#music-refinements'))).display,'contents','no tab bar');
 const heads=await page.locator('#music-refinements>[data-collection]').evaluateAll(nodes=>nodes
  .map(n=>({id:n.dataset.collection,y:Math.round(n.getBoundingClientRect().y),text:n.textContent.trim(),
   size:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight}))
  .sort((a,b)=>a.y-b.y));
 assert.deepEqual(heads.map(h=>h.text),['Til mandag eftermiddag','Fortsæt','Vibe','Jeres playlister'],
  'section headings in the canvas order');
 for(const h of heads){assert.equal(h.size,'22px');assert.equal(h.weight,'800');}
 assert.equal(heads[0].y,88,'the first heading starts 16 under the topbar');

 // Lige nu: the first mood card is the 744×252 hero.
 const rows=page.locator('#result-list>.result');
 const hero=await box(rows.nth(0));
 assert.deepEqual([hero.x,hero.w,hero.h,hero.radius],[24,744,252,'28px'],'Lige nu hero 744×252, radius 28');
 assert.equal(await rows.nth(0).locator('.result-copy').getAttribute('data-eyebrow'),
  'Til eftermiddagen · valgt til jer');
 const heroArt=await box(rows.nth(0).locator('.result-art'));assert.deepEqual([heroArt.w,heroArt.h],[212,212]);
 const heroName=await box(rows.nth(0).locator('h2'));
 assert.equal(heroName.size,'36px');
 assert.equal(heroName.weight,'800');
 const pill=await box(rows.nth(0).locator('.result-play'));
 assert.equal(pill.h,56,'Afspil pill 56 high');assert(pill.w>=132,'Afspil pill at least 132 wide');
 assert.equal(await rows.nth(0).locator('.result-play').evaluate(n=>getComputedStyle(n,'::after').content),'"Afspil"');
 const card=await box(rows.nth(1));assert.equal(card.w,160,'rail cards are 160 wide');
 const art=await box(rows.nth(1).locator('.result-art'));
 assert.deepEqual([art.w,art.h,art.radius],[160,160,'14px'],'rail cover 160, radius 14');
 assert.equal(await rows.nth(1).locator('.result-play').evaluate(n=>getComputedStyle(n).display),'none',
  'no play circle on rail cards');

 // Musik-Starter → Musik-Spiller: the tapped card shows starter at once, then spiller with the player on it.
 const tapped=await rows.nth(1).locator('h2').innerText();
 const started=Date.now();await rows.nth(1).click();
 await page.waitForFunction(()=>document.querySelectorAll('#result-list>.result')[1]?.dataset.pending==='true',null,
  {timeout:300});
 assert(Date.now()-started<300,'starter is visible within 300 ms');
 assert.notEqual(await rows.nth(1).evaluate(n=>getComputedStyle(n,'::after').content),'none',
  'starter scrim on the cover');
 await page.waitForFunction(()=>document.querySelectorAll('#result-list>.result')[1]?.dataset.playing==='true',null,
  {timeout:8000});
 assert.notEqual(await rows.nth(1).evaluate(n=>getComputedStyle(n,'::after').content),'none','equalizer mark');
 assert.equal(await rows.nth(0).getAttribute('data-playing'),'false','only the chosen card plays');
 assert(tapped.length>0);

 // Fortsæt: 260×72 rows; Vibe: 120 tiles with the name on the tile.
 await page.locator('[data-collection=recent]').click();await sleep(500);
 const recent=await box(page.locator('#result-list>.result').first());
 assert.deepEqual([recent.w,recent.h,recent.radius],[260,72,'16px'],'Fortsæt rows 260×72');
 assert.equal((await box(page.locator('#music-refinements'))).display,'contents');
 await page.locator('[data-collection=feeling]').click();await sleep(500);
 const vibe=await box(page.locator('#result-list>.result .result-art').first());
 assert.deepEqual([vibe.w,vibe.h,vibe.radius],[120,120,'18px'],'Vibe tiles 120, radius 18');
 const vibeName=await box(page.locator('#result-list>.result h2').first());
 assert.equal(vibeName.color,'rgb(247, 246, 243)','the name sits on the tile');
 assert.deepEqual(page.errors,[]);await page.close();

 // Musik-Koe: one card of 72-px rows; the current track is in the accent with a ring round the cover.
 page=await open('now');
 await page.locator('.player .cover-button').click();await sleep(700);
 const queue=await box(page.locator('#queue'));
 assert.equal(queue.radius,'24px','the queue is one card');assert.equal(queue.x,24);assert.equal(queue.w,744);
 const first=page.locator('#queue>.queue-track').first(),second=page.locator('#queue>.queue-track').nth(1);
 assert.equal((await box(first)).h,72,'queue rows are 72 high');
 assert.equal(await first.getAttribute('data-current'),'true');
 assert.equal((await box(first.locator('strong'))).color,'rgb(180, 83, 42)','current title in the accent');
 assert.equal((await box(second.locator('strong'))).color,'rgb(23, 23, 26)');
 assert.deepEqual(page.errors,[]);await page.close();

 // #389 leftover: in the small Musik slot the context line no longer sits on the »Musik« head.
 page=await open('now');
 await page.evaluate(()=>document.querySelector('pv-widget-host').dispatch({type:'show',id:'now'}));await sleep(500);
 assert.equal(await page.locator('#home-music .resource-context').evaluate(n=>getComputedStyle(n).display),'none',
  'no context line over the Musik head');
 assert.deepEqual(page.errors,[]);await page.close();
 console.log('ipad_musik_actual_e2e: ok');
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server?.kill();}})();
