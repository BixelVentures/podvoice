'use strict';
// iPad Musik-siden (issue 392, lærred v190 »A-MusikHjem«, »Musik-Starter«, »Musik-Spiller«, »Musik-Koe«):
// one page without tabs. The collections are section headings in the canvas order (Til <ugedag> <tid> · Fortsæt ·
// Vibe · Jeres playlister); the first mood card is the 744×252 »Lige nu« hero with an Afspil pill; the other cards
// are a rail of 160 cards (Fortsæt: 72-px rows in three columns, Vibe 120). A tap shows »starter« (scrim and dots) at once and »spiller«
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
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
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

 // A-Musik / Musik-Hjem-Hel: one page, the first mood card is the hero at 88, then every collection is open
 // under its heading in the canvas order (Fortsæt · Til <ugedag> <tid> · Vibe · Jeres playlister).
 let page=await open('music-prototype-afternoon');
 assert.equal(await page.locator('#header-title').innerText(),'Musik','the topbar says Musik');
 assert.equal((await box(page.locator('#music-refinements'))).display,'contents','no tab bar');
 const heads=await page.locator('#music-refinements>[data-collection]').evaluateAll(nodes=>nodes
  .map(n=>({id:n.dataset.collection,y:Math.round(n.getBoundingClientRect().y),text:n.textContent.trim(),
   size:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight}))
  .sort((a,b)=>a.y-b.y));
 assert.deepEqual(heads.map(h=>h.text),['Fortsæt','Til mandag eftermiddag','Vibe','Jeres playlister'],
  'section headings in the canvas order');
 for(const h of heads){assert.equal(h.size,'22px');assert.equal(h.weight,'800');}
 assert.equal(heads[0].y,372,'Fortsæt starts 32 under the hero');
 assert.equal(heads[1].y,515,'Til <ugedag> <tid> starts 32 under the Fortsæt rail');
 // The heading's note is the product's own: mood is chosen from the hour and the room.
 assert.equal(await page.locator('[data-collection=mood]').getAttribute('data-note'),'Ud fra tidspunkt og rum');

 // Lige nu: the first mood card is the 744×252 hero at the top of the column, no heading above it.
 const hero=page.locator('#music-hero>.result');
 const heroBox=await box(hero);
 assert.deepEqual([heroBox.x,heroBox.y,heroBox.w,heroBox.h,heroBox.radius],[24,88,744,252,'28px'],
  'Lige nu hero 744×252 at 88, radius 28');
 assert.equal(await hero.locator('.result-copy').getAttribute('data-eyebrow'),'Til eftermiddagen · valgt til jer');
 const heroArt=await box(hero.locator('.result-art'));assert.deepEqual([heroArt.w,heroArt.h],[212,212]);
 const heroName=await box(hero.locator('h2'));
 assert.equal(heroName.size,'36px');
 assert.equal(heroName.weight,'800');
 const pill=await box(hero.locator('.result-play'));
 assert.equal(pill.h,56,'Afspil pill 56 high');assert(pill.w>=132,'Afspil pill at least 132 wide');
 assert.equal(await hero.locator('.result-play').evaluate(n=>getComputedStyle(n,'::after').content),'"Afspil"');
 const rows=page.locator('#result-list>.result');
 const card=await box(rows.nth(0));assert.equal(card.w,160,'rail cards are 160 wide');
 assert.equal(card.y,573,'the mood rail starts 12 under its heading and note');
 const art=await box(rows.nth(0).locator('.result-art'));
 assert.deepEqual([art.w,art.h,art.radius],[160,160,'14px'],'rail cover 160, radius 14');
 assert.equal(await rows.nth(0).locator('.result-play').evaluate(n=>getComputedStyle(n).display),'none',
  'no play circle on rail cards');

 // The other collections are open too: their last read as rails under their headings.
 const fortsaet=page.locator('.music-shelf[data-music-shelf=recent]>.result');
 const fortsaetBox=await box(fortsaet.first());
 assert.deepEqual([fortsaetBox.x,fortsaetBox.y,fortsaetBox.w,fortsaetBox.h,fortsaetBox.radius],
  [24,411,260,72,'16px'],'Fortsæt is an open rail of 260×72 rows');
 const vibeShelf=page.locator('.music-shelf[data-music-shelf=feeling]>.result');
 assert.deepEqual(await box(vibeShelf.first().locator('.result-art')).then(b=>[b.w,b.h,b.radius]),[120,120,'18px'],
  'Vibe is an open rail of 120 tiles');
 assert(await page.locator('.music-shelf[data-music-shelf=top]>.result').count()>0,'Jeres playlister is open');

 // Musik-Starter → Musik-Spiller: the tapped card shows starter at once, then spiller with the player on it.
 const tapped=await rows.nth(0).locator('h2').innerText();
 const started=Date.now();await rows.nth(0).click();
 await page.waitForFunction(()=>document.querySelectorAll('#result-list>.result')[0]?.dataset.pending==='true',null,
  {timeout:300});
 assert(Date.now()-started<300,'starter is visible within 300 ms');
 assert.notEqual(await rows.nth(0).evaluate(n=>getComputedStyle(n,'::after').content),'none',
  'starter scrim on the cover');
 await page.waitForFunction(()=>document.querySelectorAll('#result-list>.result')[0]?.dataset.playing==='true',null,
  {timeout:8000});
 assert.notEqual(await rows.nth(0).evaluate(n=>getComputedStyle(n,'::after').content),'none','equalizer mark');
 assert.equal(await hero.getAttribute('data-playing'),'false','only the chosen card plays');
 assert(tapped.length>0);

 // A tap on a card in another open section chooses that collection and starts the card at once.
 const vibeName0=await vibeShelf.first().locator('h2').innerText();
 const shelfTap=Date.now();await vibeShelf.first().click();
 await page.waitForFunction(name=>{
  const row=[...document.querySelectorAll('#result-list>.result')].find(n=>n.querySelector('h2')?.textContent===name);
  return document.querySelector('#music-response')?.dataset.discoveryCollection==='feeling'
   &&row?.dataset.pending==='true';
 },vibeName0,{timeout:300});
 assert(Date.now()-shelfTap<300,'the shelf card starts within 300 ms');
 assert.equal(await page.locator('#music-hero>.result h2').innerText(),heroName.text,'the hero stays at the top');
 await page.locator('[data-collection=mood]').click();await sleep(400);

 // Fortsæt: 260×72 rows; Vibe: 120 tiles with the name on the tile.
 await page.locator('[data-collection=recent]').click();await sleep(500);
 const recent=await box(page.locator('#result-list>.result').first());
 assert.deepEqual([recent.w,recent.h,recent.radius],[237,72,'16px'],'Fortsæt rows 72 high in three columns');
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
 // The head: »Kø« in 24/800 and »N numre · <højttaler>« on the right; the playing row has the accent equaliser.
 const queueTitle=await box(page.locator('#queue-title'));
 assert.equal(queueTitle.text,'Kø');assert.equal(queueTitle.size,'24px');assert.equal(queueTitle.weight,'800');
 const rowsShown=await page.locator('#queue>.queue-track:not([data-placeholder])').count();
 const queueMeta=await box(page.locator('#queue-meta'));
 assert.equal(queueMeta.text,`${rowsShown} numre · ${await page.locator('#player-room').innerText()}`);
 assert.equal(queueMeta.size,'15px');assert.equal(queueMeta.color,'rgb(95, 94, 90)');
 near(queueMeta.x+queueMeta.w,768,'the count ends at the right edge of the queue card');
 near(queueMeta.y+queueMeta.h/2,queueTitle.y+queueTitle.h/2,'count and title share a line',6);
 // The column ends on the 784 baseline like every other page; »Kø« opens it at 88, the card from 136.
 assert.equal(queueTitle.y,88,'»Kø« at the top of the column');
 assert.equal(queue.y,136,'the queue card 16 under »Kø«');
 assert.equal(queue.y+queue.h,784,'the queue card ends on the 784 baseline');
 // »Spiller på …« is not drawn above »Kø«: the player at the right already names the speaker.
 await page.evaluate(()=>{document.getElementById('detail-status').textContent='Spiller på MacBook Pro';});
 assert.equal(await page.locator('#music-detail>.response-heading').evaluate(n=>n.getBoundingClientRect().height),1,
  'the status line is only for screen readers');
 assert.equal((await box(page.locator('#queue-title'))).y,88,'»Kø« keeps its place with a status line');
 const eq=page.locator('#queue>.queue-track[data-current=true] .queue-eq');
 assert.equal(await eq.locator('i').count(),3,'three equaliser bars on the playing track');
 assert.equal(await eq.locator('i').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(180, 83, 42)');
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-koe.png')});
 assert.deepEqual(page.errors,[]);await page.close();

 // #389 leftover: in the small Musik slot the context line no longer sits on the »Musik« head.
 page=await open('now');
 await page.evaluate(()=>document.querySelector('pv-widget-host').dispatch({type:'show',id:'now'}));await sleep(500);
 assert.equal(await page.locator('#home-music .resource-context').evaluate(n=>getComputedStyle(n).display),'none',
  'no context line over the Musik head');
 assert.deepEqual(page.errors,[]);await page.close();
 console.log('ipad_musik_actual_e2e: ok');
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server?.kill();}})();
