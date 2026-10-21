import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialScene,sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';

test('player detail returns to overview from every origin without altering music or timers',()=>{
 for(const origin of ['now','music','weather','timers','photo']){
  const state={...initialScene(),focus:origin,navStack:[],timer:{id:'timer-actual',remaining:48,status:'running'}};
  const detail=sceneTransition(state,{type:'show',id:'player'});
  assert.equal(detail.focus,'player');assert.equal(detail.music,state.music);assert.equal(detail.timer,state.timer);
  assert.equal(sceneTransition(detail,{type:'show',id:'player'}).navStack,detail.navStack);
  const back=sceneTransition(detail,{type:'back'});assert.equal(back.focus,'now');assert.equal(back.music,state.music);assert.equal(back.timer,state.timer);
 }
});

test('actual player opener navigates once, keeps opener and only reads live queue',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),method=source.slice(source.indexOf(' open(id,opener){'),source.indexOf('\n scheduleClock(){')).trim();
 const open=new Function('$','document',`return function ${method}`)(()=>{throw Error('Player must not open a modal');},{}),calls=[],opener={};
 const host={state:{focus:'now'},live:true,openers:new Map(),dispatch(event){calls.push(event);this.state.focus=event.id;},focusHeading(){calls.push('focus');},liveMedia:{loadQueue(){calls.push('queue-read');}}};
 open.call(host,'music-detail',opener);open.call(host,'music-detail',opener);
 assert.deepEqual(calls,[{type:'show',id:'player'},'focus','queue-read']);assert.equal(host.openers.get('music-detail'),opener);
});

test('one canonical player detail lives inside responses and keeps queue, seek, volume and output IDs',()=>{
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8'),detail=html.indexOf('<section id="music-detail"'),responses=html.indexOf('<section class="responses"'),player=html.indexOf('<aside class="player"');
 assert(detail>responses&&detail<player);assert.equal(html.match(/id="music-detail"/g).length,1);assert.doesNotMatch(html,/<dialog id="music-detail"/);assert.match(html,/<h1 id="detail-title" tabindex="-1">Afspiller<\/h1>/);
 for(const id of ['detail-track','queue-title'])assert.match(html,new RegExp(`<h2 id="${id}"`));
 for(const id of ['queue','player-back','detail-progress','detail-volume','detail-output'])assert.equal(html.match(new RegExp(`id="${id}"`,'g')).length,1);
});

test('Ro player cover/title open details, but pause and its bubbling click never navigate',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});return nodes.get(id);};
 const registration=start=>{const begin=source.indexOf(start);return source.slice(begin,source.indexOf('\n',begin));};
 const title=registration("$('track').addEventListener"),cover=registration("$('player-detail').addEventListener"),pause=registration("$('play-pause').addEventListener").split(';')[0]+';';
 const calls=[],host={state:{...initialScene(),focus:'photo',navStack:[]},querySelector:()=>node('player'),open(id,opener){calls.push(['open',id,opener.id]);this.state=sceneTransition(this.state,{type:'show',id:'player'});},music(event){calls.push(['music',event.type]);this.state=sceneTransition(this.state,{type:'music',event});}};
 new Function('$',title+cover+pause).call(host,node);
 const before=host.state.music.playback.playing;
 node('play-pause').handlers.click();node('player').handlers.click({target:{closest:()=>node('play-pause')}});
 assert.equal(host.state.focus,'photo');assert.equal(host.state.music.playback.playing,!before);assert.deepEqual(calls,[['music','toggle']]);
 const paused=host.state.music;
 for(const id of ['track','player-detail']){node(id).handlers.click();node('player').handlers.click({target:{closest:()=>node(id)}});assert.equal(host.state.focus,'player');assert.equal(host.state.music,paused);host.state=sceneTransition(host.state,{type:'back'});assert.equal(host.state.focus,'now');assert.equal(host.state.music,paused);}
 assert.deepEqual(calls.slice(1),[['open','music-detail','track'],['open','music-detail','player-detail']]);
});

test('radio cover detail uses the existing station view and never opens an empty music queue',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),method=source.slice(source.indexOf(' open(id,opener){'),source.indexOf('\n scheduleClock(){')).trim(),open=new Function('$','document',`return function ${method}`)(()=>{throw Error('Radio must not open a dialog');},{});
 for(const origin of ['photo','now','music'])for(const playing of [true,false]){const timer={id:'retained',status:'running'},base={...initialScene(),focus:origin,navStack:[],radioStationId:'p1',radioPlaying:playing,timer},calls=[],host={live:false,state:base,openers:new Map(),playerView:{progressVM:{sourceKind:'radio'}},dispatch(event){calls.push(event);this.state=sceneTransition(this.state,event);},focusHeading(){},liveMedia:{loadQueue(){throw Error('Radio has no music queue');}}};open.call(host,'music-detail',{});assert.equal(host.state.focus,'radio');assert.equal(host.state.radioStationId,'p1');assert.equal(host.state.radioPlaying,playing);assert.equal(host.state.timer,timer);assert.equal(host.state.music,base.music);open.call(host,'music-detail',{});assert.equal(calls.length,1);const back=sceneTransition(host.state,{type:'back'});assert.equal(back.focus,'now');assert.equal(back.radioStationId,'p1');}
});

test('radio Se afspiller focuses the retained transport instead of entering a navigation loop',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),callback=source.split('onOpenPlayer:()=>{')[1].split('},onSelect:')[0],calls=[],run=new Function('$',`return function(){${callback}}`)(id=>{assert.equal(id,'play-pause');return{focus(options){calls.push(options);}};}),host={dispatch(){assert.fail('the right player already exists');}};run.call(host);assert.deepEqual(calls,[{preventScroll:true}]);
});
