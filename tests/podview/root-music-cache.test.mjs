import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialWidgetState,widgetTransition,resultsFor} from '../../podview/widget-model.js';
import {previewScene} from '../../podview/preview-scenes.js';
import {initialScene,sceneTransition} from '../../podview/scene-model.js';
const body=(prefix='Actual',account='account')=>({ok:true,data:{config_entry_id:account,tracks:Array.from({length:9},(_,index)=>({name:`${prefix} ${index}`,artist:'Source artist',uri:`spotify:track:${String(index).padStart(22,'0')}`,artwork:{kind:'album_cover',provider:'spotify',url:`https://i.scdn.co/image/${prefix}${index}`}}))}});
const content=cards=>cards.map(({id,name,description,artwork})=>({id,name,description,artwork}));
function fixture(){const reads=[],renders=[],host={state:{focus:'music'},liveStatus:'connected',liveSnapshot:{bootId:'boot',roomId:'room'},liveTransport:{connected:true},musicResults:{render:vm=>renders.push(vm)}};const view=new LiveMusicCatalogueView(host,kind=>reads.push(kind));view.updateCapabilities(true,['top','recent','recent']);view.resetAccount('account');return {view,host,reads,renders};}
function overviewMusicClick(host){
 const binding=readFileSync(new URL('../../podview/widget-view.js',import.meta.url),'utf8').split('\n').find(line=>line.includes("$('home-music').addEventListener('click'"));
 assert.ok(binding,'exercise the actual WidgetHost overview entry binding');let click;
 new Function('$',binding).call(host,id=>{assert.equal(id,'home-music');return {addEventListener(type,handler){assert.equal(type,'click');click=handler;}};});
 return ()=>click();
}
test('actual overview music entry defaults to Stemning and reopens every last local tab without changing playback or fixtures',()=>{
 const host={live:false,state:initialScene(),focusCount:0,dispatch(event){this.state=sceneTransition(this.state,event);},music(event){this.dispatch({type:'music',event});},focusHeading(){this.focusCount++;}},click=overviewMusicClick(host);
 host.dispatch({type:'show',id:'now'});click();assert.equal(host.state.music.collection,'mood');
 for(const collection of ['feeling','top','recent','mood']){
  host.music({type:'collection',value:collection});const music=host.state.music,options=resultsFor(music),playback=music.playback;
  for(const focus of ['now','photo']){host.dispatch({type:'show',id:focus});click();assert.equal(host.state.focus,'music');assert.equal(host.state.music,music);assert.deepEqual(resultsFor(host.state.music),options);assert.equal(host.state.music.playback,playback);assert.equal(host.state.music.pending,null);}
 }
 for(const stage of ['top','recent']){host.state=previewScene(stage);const music=host.state.music;host.dispatch({type:'show',id:'now'});click();assert.equal(host.state.music,music,'explicit library fixture remains deterministic');}
 assert.ok(host.focusCount>0);
});

test('local collection pages survive round trips and only explicit completed refresh changes their exact options',()=>{let s=initialWidgetState();const snapshots=new Map();for(const collection of ['mood','feeling','top','recent']){s=widgetTransition(s,{type:'collection',value:collection});s=widgetTransition(s,{type:'refresh',revision:s.revision});s=widgetTransition(s,{type:'refresh-result',...s.refreshPending,status:'ready'});snapshots.set(collection,resultsFor(s).map(({id,art,name})=>({id,art,name})));}for(let n=0;n<3;n++)for(const collection of ['top','mood','feeling','recent']){s=widgetTransition(s,{type:'collection',value:collection});assert.deepEqual(resultsFor(s).map(({id,art,name})=>({id,art,name})),snapshots.get(collection));}const before=resultsFor(s);s=widgetTransition(s,{type:'refresh',revision:s.revision});s=widgetTransition(s,{type:'refresh-result',...s.refreshPending,status:'error'});assert.deepEqual(resultsFor(s),before);assert.equal(widgetTransition(s,{type:'filter',value:'jazz'}),s);});
test('local navigation, clock ticks, pause and session lifecycle preserve the chosen source IDs and artwork',()=>{let s=previewScene('top');s=sceneTransition(s,{type:'music',event:{type:'refresh',revision:s.music.revision}});s=sceneTransition(s,{type:'music',event:{type:'refresh-result',...s.music.refreshPending,status:'ready'}});const options=resultsFor(s.music);for(const event of [{type:'show',id:'now'},{type:'show',id:'photo'},{type:'show',id:'music'},{type:'tick',now:Date.now()+3600000},{type:'music',event:{type:'toggle'}},{type:'session-ended'}]){s=sceneTransition(s,event);assert.deepEqual(resultsFor(s.music),options);}});
