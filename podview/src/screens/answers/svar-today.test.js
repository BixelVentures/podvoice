// Ported from tests/podview/svar-lys-canvas-parity.test.mjs (node:test + fake DOM) to Vitest with a real DOM when the
// Svar column (#svar-today) moved to React. Same assertions. Adaptations: svar() builds the column's real markup from
// index.html in the document (the fake had a bare header and list); the fake's children arrays are spread from the
// real HTMLCollections; the fake list.dispatch('scroll') is a real scroll event; stylesheets are read by path; the
// module is ./SvarToday (old svar-today-view.js) and owner-answers.js keeps its path.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, test} from 'vitest';
import {SvarTodayView,svarUnseenCount,svarNewLabel} from './SvarToday';

const podview=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
afterEach(()=>{document.body.replaceChildren();});
function svar(){const root=document.createElement('aside');root.id='svar-today';root.className='svar-today';root.hidden=true;
 root.setAttribute('aria-labelledby','svar-today-title');
 root.innerHTML='<header><h2 id="svar-today-title">I dag</h2><span>Nyeste øverst</span></header>'+
  '<div class="svar-today-rows" role="group" aria-labelledby="svar-today-title"></div>';
 document.body.append(root);const opened=[];const view=new SvarTodayView(root,id=>opened.push(id));
 return {root,list:view.list,view,opened};}
const row=(id,current=false)=>({id,title:id,kindLabel:'Fakta',time:'11.32',today:true,current});

test('»↑ 1 nyt svar« counts only answers that arrived while an older answer is read',()=>{
 const {view,opened}=svar();
 view.render([row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,true,'reading an older answer that was already listed is not news');
 view.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,false);assert.equal(view.newer.textContent,'1 nyt svar');
 view.render([row('d'),row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.textContent,'2 nye svar');
 view.newer.click();
 assert.deepEqual(opened,['d'],'tapping opens the newest answer');assert.equal(view.newer.hidden,true);
});

test('a new answer while the list is scrolled away shows the pill; at the top on the newest it does not',()=>{
 const {view,list,opened}=svar();
 view.render([row('a',true)],true);
 view.render([row('b',true),row('a')],true);
 assert.equal(view.newer.hidden,true,'the new answer is the one on screen and the list is at the top');
 list.scrollTop=200;list.dispatchEvent(new Event('scroll'));
 view.render([row('c'),row('b',true),row('a')],true);
 assert.equal(view.newer.textContent,'1 nyt svar');
 view.newer.click();assert.equal(list.scrollTop,0);assert.deepEqual(opened,['c']);
});

test('the count starts over when the Svar page is left',()=>{
 const {view}=svar();
 view.render([row('b'),row('a',true)],true);view.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,false);
 view.render([],false);view.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.hidden,true);
 assert.equal(svarUnseenCount([row('x')],null),0);assert.equal(svarNewLabel(1),'1 nyt svar');assert.equal(svarNewLabel(3),'3 nye svar');
});

const kitCss=()=>readFileSync(resolve(podview,'ui-kit.css'),'utf8');
test('the pill is the canvas K-Btn 44: primary, up icon 18, floating 8 under the list top without pushing it',()=>{
 const css=kitCss();
 assert.match(css,/#svar-today>\.svar-today-new\.svar-today-new\{position:absolute;z-index:3;left:50%;top:56px;transform:translateX\(-50%\);\s*height:44px;[^}]*border-radius:999px;background:#17171A;\s*color:#F7F6F3;[^}]*box-shadow:0 10px 24px -10px rgba\(23,23,26,\.55\)/);
 const {view}=svar();view.render([row('b'),row('a',true)],true);view.render([row('c'),row('b'),row('a',true)],true);
 assert.equal(view.newer.getAttribute('data-kit-size'),'44');assert.equal(view.newer.getAttribute('data-kit-variant'),'primary');
 const icon=[...view.newer.children].find(child=>child.getAttribute('aria-hidden')==='true');
 assert.match(icon.getAttribute('style'),/chevron-up\.svg/);assert.equal(icon.hidden,false);
});

test('»Tidligere svar« rows are one line: category chip with the kind icon, the title, the time',()=>{
 const {view,list}=svar();
 view.render([{...row('a',true),icon:'cloud-sun',domain:'weather'},{...row('b'),icon:'music-note-beamed',domain:'music'},row('c')],true);
 const [first,second,third]=[...list.children];
 assert.equal(first.dataset.domain,'weather');assert.equal(second.dataset.domain,'music');assert.equal(third.dataset.domain,'answer');
 const [chip,title,time]=[...first.children];assert.equal(chip.className,'svar-today-chip');
 assert.equal(chip.children[0].getAttribute('src'),'assets/icons/cloud-sun.svg');
 assert.equal(title.textContent,'a');assert.equal(time.tagName,'TIME');assert.equal(time.textContent,'11.32');
 assert.equal(first.getAttribute('aria-label'),'Fakta · a · 11.32','the kind stays in the spoken label');
 assert.equal(first.getAttribute('aria-current'),'true');assert.equal(second.getAttribute('aria-current'),null);
 assert.equal(third.querySelector('.svar-today-icon').getAttribute('src'),'assets/icons/chat-circle.svg');
 // A row is kept per answer: a new answer is added in front of the same nodes; selection moves without rebuilding.
 view.render([row('d'),{...row('a'),icon:'cloud-sun',domain:'weather'},{...row('b',true),icon:'music-note-beamed',
  domain:'music'},row('c')],true);
 assert.deepEqual([...list.children].slice(1),[first,second,third]);
 assert.equal(first.getAttribute('aria-current'),null);assert.equal(second.getAttribute('aria-current'),'true');
});

test('row time: »19.04« today, »i går 19.04« yesterday, otherwise »12. nov. 19.04«',async()=>{
 const {svarTime}=await import('./SvarToday');
 const now=new Date(2026,10,17,21,0),at=(d,h,m)=>new Date(2026,10,d,h,m).getTime()/1000;
 assert.equal(svarTime(at(17,19,4),now),'19.04');
 assert.equal(svarTime(at(16,19,4),now),'i går 19.04');
 assert.equal(svarTime(at(12,19,4),now),'12. nov. 19.04');
});

test('every saved answer is its own row, newest first; the live copy of the answer being read is not doubled',
 async()=>{
 const {svarTodayRows}=await import('./SvarToday');
 const now=new Date(2026,10,17,21,0),t=(h,m)=>new Date(2026,10,17,h,m).getTime()/1000;
 const answer=(id,observedAt,extra={})=>({id:'receipt:'+id,receiptId:id,title:id,kind:'key-points',observedAt,
  ...extra});
 const groups=[{items:[answer('sport',t(19,4),{kind:'sport-result'}),answer('assist',t(19,5))]},
  {items:[answer('weather',t(20,1),{kind:'fact-card',provenance:{kind:'ha_weather'}})]}];
 const live={...answer('assist',t(19,5)),id:'live:assist',live:true};
 const rows=svarTodayRows(groups,[live],'live:assist',now);
 assert.deepEqual(rows.map(row=>[row.title,row.time,!!row.current,row.domain]),
  [['weather','20.01',false,'weather'],['assist','19.05',true,'answer'],['sport','19.04',false,'answer']]);
 assert.equal(rows[2].kindLabel,'Resultat');
});

test('a round is every answer of one voice session, whatever its topic; another session never joins',async()=>{
 const {answerThread}=await import('../../../owner-answers.js');
 const answer=(id,sessionId,observedAt,extra={})=>({id,receiptId:id,sessionId,observedAt,presentation:true,
  status:'ready',kind:'key-points',...extra});
 const answers=[answer('sport','s1',10),answer('weather','s1',20,{kind:'fact-card',provenance:{kind:'ha_weather'}}),
  answer('assist','s1',30),answer('other','s2',25)];
 assert.deepEqual(answerThread(answers,'assist').items.map(item=>item.id),['sport','weather','assist']);
 assert.deepEqual(answerThread(answers,'sport').items.map(item=>item.id),['sport','weather','assist'],
  'an older answer opens its whole round');
 assert.equal(answerThread(answers,'other'),null,'a single answer is no round');
});

test('svarDomain reads the tone from the answer\'s own data only',async()=>{
 const {svarDomain}=await import('./SvarToday');
 assert.equal(svarDomain({provenance:{kind:'ha_weather'}}),'weather');
 assert.equal(svarDomain({kind:'sourced-image',content:{image:{kind:'album_cover'}}}),'music');
 assert.equal(svarDomain({kind:'sourced-image',content:{image:{kind:'photo'}}}),'answer');
 assert.equal(svarDomain({kind:'fact-card',title:'Tænd lyset i køkkenet'}),'answer','no home card without home data');
});

test('SvarK-Spec numbers: cards fit their content, 16 apart; compact rows of 64; one colour rule',()=>{
 const css=kitCss();
 assert.match(css,/#answer-host#answer-host:has\(>pv-answer:not\(\[hidden\]\)\)\{box-sizing:border-box;\s*display:flex;flex:0 0 auto;flex-direction:column;gap:16px;min-height:0;[^}]*background:transparent/);
 assert.match(css,/#answer-host#answer-host>pv-answer\.answer-widget\.response-widget\{position:relative;\s*box-sizing:border-box;flex:0 0 auto;height:auto!important;[^}]*border-radius:24px!important;\s*background:var\(--pv-surface\)!important/);
 assert.match(css,/#answer-host#answer-host>pv-answer\.answer-widget\.response-widget\{padding:32px!important;\s*--pv-svar-chip:var\(--pv-answer\)\}/);
 assert.match(css,/\.pv-visual-summary\{margin:8px 0 -4px!important;\s*padding:0 0 4px!important;font:800 44px\/48px var\(--pv-font\)!important;letter-spacing:-\.03em\}/);
 assert.doesNotMatch(css,/#answer-host#answer-host:has\([^{]*\)\{[^}]*background:#(E9E6F4|DDE6FB|F6DCCB)/,'no card tint per kind');
 assert.match(css,/#svar-today:not\(\[hidden\]\)\{display:flex;\s*position:relative;flex-direction:column;gap:16px;[^}]*width:var\(--pv-player-w\);height:var\(--pv-content-h\)/);
 assert.match(css,/#svar-today \.svar-today-rows\{display:grid;grid-auto-rows:64px;align-content:start;gap:8px;/);
 assert.match(css,/#svar-today \.svar-today-row\{display:grid;grid-template-columns:32px minmax\(0,1fr\) auto;[^}]*height:64px;[^}]*background:var\(--pv-surface\);/);
 assert.match(css,/#svar-today \.svar-today-row\[aria-current=true\]\{background:var\(--pv-line\);box-shadow:none\}/);
 assert.match(css,/#svar-today \.svar-today-title\{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;/);
 assert.match(css,/pv-sourced-image\[data-image-kind=album_cover\] \.pv-answer-image\{\s*display:grid;grid-template-columns:200px minmax\(0,1fr\)/);
});

test('v193 kit and page rules: icon slot sizes, alarm variant, +N pill, queue columns and inert lamp slider',()=>{
 const css=kitCss();
 assert.match(css,/\[data-kit-size="56"\]>\.pv-kit-icon\{flex:0 0 20px;\s*width:20px!important;height:20px!important/);
 assert.match(css,/\[data-kit-size="44"\]>\.pv-kit-icon\{flex:0 0 18px;\s*width:18px!important;height:18px!important/);
 assert.match(css,/\[data-kit-size="56"\]\{gap:10px\}/);assert.match(css,/\[data-kit-size="44"\]\{gap:8px\}/);
 assert.match(css,/\.pv-kit\.pv-kit-button\[data-kit-variant=alarm\]\{background:#FF7A5C;color:#17171A\}/);
 assert.match(css,/\.resource-card>\.overview-more:not\(\[hidden\]\)\{position:absolute;z-index:3;top:20px;right:48px;box-sizing:border-box;\s*height:26px;min-height:0;max-height:26px;min-width:26px;padding:0 8px;[^}]*background:rgba\(23,23,26,\.08\)/);
 assert.match(css,/:is\(#timer-card,\.resource-card\)>:not\(\[hidden\]\):not\(\.overview-more\)\{box-sizing:border-box;height:100%/,'the chip keeps its own height');
 assert.doesNotMatch(css,/:is\(#timer-card,\.resource-card\)>:not\(\[hidden\]\)\{/);
 assert.match(css,/#music-detail #queue>\.queue-track\{grid-template-columns:32px 56px 1fr!important\}/);
 assert.match(css,/#music-detail #queue>\.queue-track>\.queue-play\{display:none!important\}/);
 assert.match(css,/\.light-lamp-level\[data-lamp-live=false\]\{opacity:\.4;pointer-events:none\}/);
});
