import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewScene,previewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {visualFamilies,validateVisualContent} from '../../podvoice/gatekeeper/static/podview/visual-content.js';
import {FORMATS,sceneTransition,focusedAnswer,initialScene} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {ownedAnswers} from '../../podvoice/gatekeeper/static/podview/owner-answers.js';

test('explicit QA history has one coherent saved household example for each canonical visual family',()=>{
 const state=previewScene('visual-history');assert(previewStates.includes('visual-history'));assert.equal(state.pendingAnswer,null);assert.equal(state.focus,'now');assert.deepEqual(state.answers.map(a=>a.kind),FORMATS);assert.equal(new Set(state.answers.map(a=>a.id)).size,10);
 for(const answer of state.answers){assert.equal(answer.exampleOnly,true);assert.equal(answer.status,'ready');assert.equal(answer.live,undefined);assert.equal(answer.receiptId,undefined);assert.equal(answer.ownerReceiptIds,undefined);if(visualFamilies.includes(answer.kind)){assert.equal(validateVisualContent(answer.kind,answer.content).summary,answer.content.summary);assert(answer.content.sources.every(s=>s.url==='example-sources.html'||answer.kind==='simple-diagram'&&s.url==='https://www.rei.com/learn/expert-advice/bike-gears-and-shifting.html'));}}
});
test('each existing history choice routes to same retained canonical answer without creating or requesting data',()=>{
 const state=previewScene('visual-history');for(const saved of state.answers){const next=sceneTransition(state,{type:'show',id:saved.id});assert.equal(focusedAnswer(next).id,saved.id);assert.equal(focusedAnswer(next).kind,saved.kind);assert.deepEqual(focusedAnswer(next).content,saved.content);assert.equal(next.answers.length,10);assert.equal(next.pendingAnswer,null);}
});
test('normal and live-start quiet scenes remain unpopulated; local examples cannot pass owner receipt admission',()=>{
 assert.equal(initialScene().answers.length,0);assert.equal(previewScene('quiet').answers.length,0);assert.equal(previewScene('nothing').answers.length,0);const state=previewScene('visual-history');assert.throws(()=>ownedAnswers({schema:'podview.answers.v1',roomId:'r0',revision:1,items:state.answers},{roomId:'r0',answers:{revision:1,sessionId:'s'},voice:{sessionId:'s'}}));
});
test('an ordinary local answer remains an explicit example through completion and history',()=>{
 let state=sceneTransition(initialScene(),{type:'request',kind:'comparison'});
 const pending=focusedAnswer(state);assert.equal(pending.exampleOnly,true);assert.equal(pending.live,undefined);
 state=sceneTransition(state,{type:'answer-result',id:pending.id,generation:state.generation,status:'ready'});
 state=sceneTransition(state,{type:'show',id:'now'});
 assert.equal(state.answers[0].exampleOnly,true);assert.equal(state.answers[0].status,'ready');assert.equal(state.answers[0].live,undefined);
});
test('header reuses one history dialog/control and reserves far-right clock after weather',()=>{
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8'),nav=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));assert.equal((html.match(/id="history"/g)||[]).length,1);assert.equal((nav.match(/id="open-history"/g)||[]).length,1);assert(nav.indexOf('header-activity')<nav.indexOf('header-context'));assert(nav.indexOf('header-context')<nav.indexOf('open-history'));assert(nav.indexOf('open-history')<nav.indexOf('header-weather'));assert(nav.indexOf('header-weather')<nav.indexOf('header-clock'));assert(!nav.includes('disabled'));
});
test('header phase previews are explicit local stages, never normal scene activity',()=>{for(const [stage,phase] of Object.entries({listening:'LISTENING',thinking:'THINKING',speaking:'AI_SPEAKING',ready:'LOUNGE_WINDOW',waiting:'UNKNOWN'})){const state=previewScene(`header-${stage}`);assert.equal(state.voicePreviewPhase,phase);assert.equal(state.pendingAnswer,null);assert.equal(state.answers.length,0);}assert.equal(previewScene('quiet').voicePreviewPhase,undefined);assert.equal(initialScene().voicePreviewPhase,undefined);});

test('explicit top and now QA entries expose ten examples without changing their intended focus',()=>{for(const [stage,focus]of [['top','music'],['now','now']]){const state=previewScene(stage);assert.equal(state.focus,focus);assert.equal(state.answers.length,10);assert.equal(state.pendingAnswer,null);assert(state.answers.every(answer=>answer.exampleOnly&&!answer.live));}});

test('history gallery reuses canonical inert previews and one same-ID open control without row example prefixes',()=>{const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');assert(source.includes("const retained=document.createElement('article')"));assert(source.includes("viewport.inert=true"));assert(source.includes("viewport.setAttribute('aria-hidden','true')"));assert(source.includes("const preview=document.createElement('pv-answer')"));assert(!source.includes("preview.update({...s,connected:false},a)"),"Inert previews must preserve actual connectivity rather than inventing offline state");assert(source.includes("preview.inert=true"));assert(source.includes("this.dispatch({type:'show',id:a.id})"));assert(source.includes("format.textContent=answerCatalog[a.kind]"));assert(!source.includes("b.textContent=(a.exampleOnly?'Eksempel"));});
test('history gallery layout is scoped, two-column at device width and scrolls inside existing dialog',()=>{const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/frame-layout.css',import.meta.url),'utf8');assert(css.includes('#history #retained{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'));assert(css.includes('max-height:calc(100dvh - 32px)'));assert(css.includes('#history .history-preview'));assert(css.includes('pointer-events:none'));assert(css.includes('#history .history-open:focus-visible'));});
