import test from 'node:test';import assert from 'node:assert/strict';
import {newMusicFlow,musicFlow as step} from '../../podvoice/gatekeeper/static/podview/music-flow.js';
const ready=()=>{let s=step(newMusicFlow(),{type:'start',sessionId:'s1',revision:2});s=step(s,{type:'heard',run:s.run});return step(s,{type:'options',run:s.run,revision:2});};
test('voice and touch resolve the identical bound option and correlated receipt',()=>{const s=ready();const e={type:'choose',run:s.run,sessionId:'s1',revision:2,optionId:'italian-favorites',allowed:['smooth-jazz','italian-favorites'],operation:5};const touch=step(s,e),voice=step(s,{...e,source:'voice'});assert.deepEqual(touch,voice);assert.equal(touch.phase,'selecting');assert.equal(step(touch,e),touch);assert.equal(step(touch,{type:'receipt',run:s.run,operation:4}),touch);assert.equal(step(touch,{type:'receipt',run:s.run,operation:5}).phase,'playing');});
test('stale, cross-session, hidden options and late cancelled stages cannot advance',()=>{const s=ready(),e={type:'choose',run:s.run,sessionId:'s1',revision:2,optionId:'jazz',allowed:['jazz'],operation:1};for(const change of [{revision:1},{sessionId:'s2'},{optionId:'other'},{run:0}])assert.equal(step(s,{...e,...change}),s);const cancelled=step(s,{type:'cancel'});assert.equal(step(cancelled,e),cancelled);assert.equal(step(cancelled,{type:'options',run:s.run,revision:2}),cancelled);});


test('journey waiting clears only its queue source while confirmed playback announces its result',async()=>{
 const {MusicJourney}=await import('../../podvoice/gatekeeper/static/podview/flow-controller.js');
 const {initialWidgetState}=await import('../../podvoice/gatekeeper/static/podview/widget-model.js');
 const oldDocument=globalThis.document,oldWindow=globalThis.window;
 const nodes=new Map(['#journey-status','#response-title','#result-count'].map(id=>[id,{textContent:'old',hidden:false}]));
 const fakeWindow={};fakeWindow.parent=fakeWindow;
 globalThis.window=fakeWindow;globalThis.document={querySelector:id=>nodes.get(id)};
 try{
  const notifications=[];const host={state:{connected:true,sessionId:'s1',music:initialWidgetState()},dataset:{},querySelectorAll:()=>[],renderVoice(){},showFeedback(message,pending,options){notifications.push({message,pending,...options});}};
  const journey={host,state:{phase:'selecting',sessionId:'s1',operation:0,optionId:'smooth-jazz'},clear(){throw Error('unexpected cancellation');}};
  for(const phase of ['thinking','selecting']){
   journey.state.phase=phase;MusicJourney.prototype.render.call(journey);
   assert.deepEqual(notifications.at(-1),{message:'',pending:false,source:'journey'});
   assert.equal(host.dataset.journey,phase);
  }
  journey.state.phase='playing';MusicJourney.prototype.render.call(journey);
  assert.equal(notifications.at(-1).source,'journey');assert.match(notifications.at(-1).message,/spiller i stuen/);
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});

test('late local journey render cannot overwrite Find musik heading with collection title',async()=>{
 const {MusicJourney}=await import('../../podvoice/gatekeeper/static/podview/flow-controller.js'),{initialScene}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');const previous={document:globalThis.document,window:globalThis.window};const nodes=new Map(['#response-title','#result-count','#journey-status'].map(id=>[id,{textContent:'',hidden:false}]));globalThis.document={querySelector:id=>nodes.get(id)};const window={};window.parent=window;globalThis.window=window;
 try{const host={state:initialScene(),dataset:{},querySelectorAll:()=>[],renderVoice(){}},journey=Object.assign(Object.create(MusicJourney.prototype),{host,state:newMusicFlow()});for(const collection of ['mood','feeling','top','recent']){host.state.music.collection=collection;journey.render();assert.equal(nodes.get('#response-title').textContent,'Find musik');assert.ok(nodes.get('#result-count').textContent.length>0);}}finally{Object.assign(globalThis,previous);}
});
