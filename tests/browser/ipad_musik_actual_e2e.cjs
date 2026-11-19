'use strict';
// iPad Find musik (concept B »Hylder«) at 1180×820, on the packaged page with the live inert fixture (real Python
// shelves read, tests/music_shelves_fixture.py): the page is the 744 content column at x 24 beside the player, under
// the topbar title »Find musik«; six quick picks in a 3×2 grid of 64-px tiles with 10-px gaps; shelves with 22/800
// headings, the »AI-valgt« badge and PodVoice's reason on AI shelves, 136-px covers (round for artists); a shelf
// wider than the column scrolls sideways and the page scrolls vertically while the player stays.
// Then the queue (»Musik-Koe«) and the overview's Musik slot from the static preview.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const assert=require('node:assert/strict');
const env=require('./podview_actual_env.cjs');
const port=Number(process.env.IPAD_MUSIK_TEST_PORT||18994),base=`http://127.0.0.1:${port}`;
const livePort=Number(process.env.IPAD_MUSIK_LIVE_PORT||18995),live=`http://127.0.0.1:${livePort}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,liveServer,browser;
// The iPad frame (ui-kit.css): edges 24, the content column 744 (--pv-column), 32, the player 356; y 104 to 796.
const EDGE=24,COLUMN=744,TOP=104,BOTTOM=796,RIGHT=EDGE+COLUMN;
const near=(actual,expected,label,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,
 `${label}: ${actual} ≠ ${expected}`);
const box=node=>node.evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);
 return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),radius:s.borderTopLeftRadius,
  display:s.display,size:s.fontSize,weight:s.fontWeight,color:s.color,text:n.innerText?.trim()};});
async function open(stage){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.errors=errors;
 await page.goto(`${base}/index.html?stage=${stage}`,{waitUntil:'domcontentloaded'});
 await page.locator('pv-widget-host').waitFor({state:'attached'});await sleep(700);
 return page;
}
async function findMusik(){
 const page=await browser.newPage({hasTouch:true,viewport:{width:1180,height:820}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Covers get an inert image; nothing outside PodVoice is reached.
 await page.route(/^https:\/\//,route=>/^https:\/\/(i\.scdn\.co|image-cdn-(fa|ak)\.spotifycdn\.com)\//
  .test(route.request().url())?route.fulfill({contentType:'image/svg+xml',
   body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">'
    +'<rect width="64" height="64" fill="teal"/></svg>'})
  :route.abort());
 await page.goto(live+'/view/?room=kitchen',{waitUntil:'domcontentloaded'});
 await env.openOverview(page);
 await page.waitForFunction(()=>{const p=document.querySelector('pv-widget-host')?.liveCatalogue?.page;
  return !!p&&!p.refreshing&&p.shelves.some(shelf=>shelf.ai);},undefined,{timeout:30000});
 await page.locator('#home-music').tap();
 await page.locator('#find-musik .find-tile').first().waitFor({state:'visible'});
 await page.evaluate(()=>Promise.all(document.getAnimations()
  .filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 await sleep(300);
 assert.equal(await page.locator('#header-title').innerText(),'Find musik','the topbar says Find musik');
 // The content column beside the player.
 const column=await box(page.locator('#music-response')),content=await box(page.locator('#find-musik'));
 const player=await box(page.locator('.player'));
 assert.deepEqual([column.x,column.y,column.w],[EDGE,TOP,COLUMN],'Find musik is the 744 column at x 24, y 104');
 assert.deepEqual([content.x,content.w],[EDGE,COLUMN],'the page fills the column');
 assert.equal(player.x,RIGHT+32,'the player 32 to the right of the column');
 // Quick picks: 3 columns × 2 rows of 64-px tiles with 10-px gaps, cover + title.
 const quick=await page.locator('.find-quick .find-quick-tile').evaluateAll(nodes=>nodes.map(n=>{
  const b=n.getBoundingClientRect(),a=n.querySelector('.find-art').getBoundingClientRect();
  return {x:b.x,y:Math.round(b.y),w:b.width,h:b.height,art:[a.width,a.height]};}));
 assert.equal(quick.length,6,'six quick picks');
 assert.equal(new Set(quick.map(q=>q.y)).size,2,'two rows');
 assert.equal(new Set(quick.map(q=>Math.round(q.x))).size,3,'three columns');
 near(quick[0].x,EDGE,'the first quick pick at the column edge',0.5);
 near(quick[0].y,TOP,'the quick picks open the page',1);
 for(const q of quick){assert.equal(q.h,64,'quick tiles are 64 high');assert.deepEqual(q.art,[64,64]);}
 near(quick[1].x-(quick[0].x+quick[0].w),10,'10-px column gap',0.5);
 near(quick[3].y-(quick[0].y+quick[0].h),10,'10-px row gap',1);
 near(quick[2].x+quick[2].w,RIGHT,'the grid spans the column',0.5);
 const aiLine=page.locator('.find-quick .find-ai-line').first();
 assert.match(await aiLine.innerText(),/^AI-valgt · /,'an AI quick pick says why it was chosen');
 // Shelves: headings 22/800; AI shelves carry the badge and PodVoice's reason; library shelves do not.
 const shelves=await page.locator('#find-musik section.find-shelf').evaluateAll(nodes=>nodes.map(n=>{
  const h=n.querySelector('h2'),s=getComputedStyle(h),row=n.querySelector('.find-shelf-row');
  const r=row.getBoundingClientRect();
  return {id:n.dataset.shelf,size:s.fontSize,weight:s.fontWeight,
   badge:n.querySelector('.find-ai-badge')?.textContent??null,
   why:n.querySelector('.find-why')?.textContent??null,row:[Math.round(r.x),Math.round(r.width)],
   overflow:getComputedStyle(row).overflowX,scroll:row.scrollWidth,client:row.clientWidth};}));
 assert(shelves.length>=6,'the shelves are drawn');
 for(const shelf of shelves){
  assert.deepEqual([shelf.size,shelf.weight],['22px','800'],`${shelf.id} heading is 22/800`);
  assert.deepEqual(shelf.row,[EDGE,COLUMN],`${shelf.id} row spans the column`);
  if(shelf.id.startsWith('ai_')){
   assert.equal(shelf.badge,'AI-valgt',`${shelf.id} carries the AI badge`);
   assert.match(shelf.why??'',/^Fordi /,`${shelf.id} says why`);
  }else assert.equal(shelf.badge,null,`${shelf.id} is the household's own (no badge)`);
 }
 assert(shelves.some(s=>s.id.startsWith('ai_'))&&shelves.some(s=>!s.id.startsWith('ai_')),'library and AI shelves');
 const badge=await box(page.locator('.find-ai-badge').first());
 assert.equal(badge.radius,'11px','the badge is a pill');
 // Covers 136 px: round for artists, rounded squares elsewhere.
 const cover=async shelf=>box(page.locator(`section.find-shelf[data-shelf=${shelf}] .find-tile .find-art`).first());
 const artist=await cover('artists'),album=await cover('albums');
 assert.deepEqual([artist.w,artist.h,artist.radius],[136,136,'68px'],'artist covers are round');
 assert.deepEqual([album.w,album.h,album.radius],[136,136,'16px'],'album covers are rounded squares');
 const artistTile=page.locator('section.find-shelf[data-shelf=artists] .find-tile').first();
 assert.equal(await artistTile.getAttribute('data-shape'),'round');
 // A shelf wider than the column scrolls sideways under the finger.
 const wide=shelves.find(s=>s.scroll>s.client+40);
 assert(wide,'a shelf is wider than the column: '+JSON.stringify(shelves.map(s=>[s.id,s.scroll])));
 assert.equal(wide.overflow,'auto');
 const row=page.locator(`section.find-shelf[data-shelf=${wide.id}] .find-shelf-row`);
 await row.evaluate(n=>n.scrollIntoView({block:'center'}));await sleep(300);
 const rowBox=await row.boundingBox(),y=rowBox.y+rowBox.height/3;
 await env.touchDrag(page,{x:rowBox.x+rowBox.width-60,y},{x:rowBox.x+140,y});
 await page.waitForFunction(id=>document.querySelector(`[data-shelf=${id}] .find-shelf-row`).scrollLeft>40,wide.id,
  {timeout:3000});
 // The page scrolls vertically while the player stays.
 const feed=page.locator('#music-response');
 await feed.evaluate(n=>{n.scrollTop=0;});await sleep(200);
 assert(await feed.evaluate(n=>n.scrollHeight>n.clientHeight+200),'Find musik is taller than the column');
 const playerBefore=await box(page.locator('.player'));
 await env.touchScroll(page,feed,{dy:360});
 assert(await feed.evaluate(n=>n.scrollTop)>40,'the page scrolls vertically');
 assert.deepEqual(await box(page.locator('.player')),playerBefore,'the player stays');
 assert.deepEqual([column.x,column.w],[(await box(feed)).x,(await box(feed)).w],'the column does not move');
 await feed.evaluate(n=>{n.scrollTop=0;});await sleep(300);
 await page.screenshot({path:path.join(env.artifactDir(),'podview-ipad-find-musik.png')});
 assert.deepEqual(errors,[]);await page.close();
}
(async()=>{try{
 const root=path.join(env.runtimeRoot,'podvoice/gatekeeper/static/podview');
 server=spawn(env.python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'podview-ipad-musik-'));
 liveServer=spawn(env.python,[path.join(__dirname,'music_selection_e2e_server.py')],{cwd:env.runtimeRoot,
  env:env.pythonEnv({MUSIC_TEST_PORT:String(livePort),MUSIC_TEST_DATA:data,MUSIC_EXTENDED:'1',
   PODVIEW_TEST_NONCE:require('node:crypto').randomUUID()}),stdio:['ignore','ignore','pipe']});
 let log='';liveServer.stderr.on('data',chunk=>{log+=chunk;});
 for(let n=0;;n++){if(server.exitCode!==null)throw Error('static server exited');try{
  if((await fetch(base+'/index.html')).ok)break}catch{}
  if(n>100)throw Error('static server startup');await sleep(100)}
 for(let n=0;;n++){if(liveServer.exitCode!==null)throw Error('live server exited '+log.slice(-2000));
  try{if((await fetch(live+'/view/')).ok)break}catch{}if(n>150)throw Error('live server startup');await sleep(100)}
 browser=await chromium.launch({...env.browserOptions(),args:['--mute-audio']});
 await findMusik();

 let page;
 // Musik-Koe: one card of 72-px rows; the current track is in the accent with a ring round the cover.
 page=await open('now');
 await page.locator('.player .cover-button').click();await sleep(700);
 const queue=await box(page.locator('#queue'));
 assert.equal(queue.radius,'24px','the queue is one card');assert.equal(queue.x,EDGE);assert.equal(queue.w,COLUMN);
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
 near(queueMeta.x+queueMeta.w,RIGHT,'the count ends at the right edge of the queue card');
 near(queueMeta.y+queueMeta.h/2,queueTitle.y+queueTitle.h/2,'count and title share a line',6);
 // The column ends on the 796 baseline like every other page; »Kø« opens it at 104, the card from 152.
 assert.equal(queueTitle.y,TOP,'»Kø« at the top of the column');
 assert.equal(queue.y,TOP+48,'the queue card 16 under the 32-px »Kø« line');
 assert.equal(queue.y+queue.h,BOTTOM,'the queue card ends on the 796 baseline');
 // »Spiller på …« is not drawn above »Kø«: the player at the right already names the speaker.
 await page.evaluate(()=>{document.getElementById('detail-status').textContent='Spiller på MacBook Pro';});
 assert.equal(await page.locator('#music-detail>.response-heading').evaluate(n=>n.getBoundingClientRect().height),1,
  'the status line is only for screen readers');
 assert.equal((await box(page.locator('#queue-title'))).y,TOP,'»Kø« keeps its place with a status line');
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
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();server?.kill();liveServer?.kill();}})();
