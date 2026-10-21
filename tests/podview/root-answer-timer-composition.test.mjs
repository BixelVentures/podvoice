import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewScene} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {TimerView,timerPresentation} from '../../podvoice/gatekeeper/static/podview/timer-view.js';
import {timersFor,timerStateLabel,timerTime} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
import {devicePresentation,lightSelection} from '../../podvoice/gatekeeper/static/podview/scene-model.js';

const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const start=source.indexOf(' renderResourceRail(){'),end=source.indexOf('\n render(){',start);
const railMethod=new Function('$','timerPresentation','timersFor','timerStateLabel','timerTime','devicePresentation','lightSelection','createResourceTile','updateResourceTile',`return ({${source.slice(start,end)}}).renderResourceRail;`);
function fixture(state){
 const rail={hidden:false,children:[],append(node){this.children.push(node);},insertBefore(node,before){const previous=this.children.indexOf(node);if(previous>=0)this.children.splice(previous,1);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}},updates=[],actions=[];
 const tile={hidden:false,dataset:{},kind:'timer'};
 const host={state,resourceButtons:new Map([[state.timer.id,tile]]),dispatch:event=>actions.push(event),focusHeading(){}};
 host.renderRail=railMethod(()=>rail,timerPresentation,timersFor,timerStateLabel,timerTime,devicePresentation,lightSelection,()=>({hidden:false,dataset:{}}),(node,resource)=>updates.push(resource));
 return {host,rail,tile,updates,actions};
}

test('canonical answer composition omits inline timer through running, paused and finished states without stopping the resource',()=>{
 for(const status of ['running','paused','done']){
  const state=previewScene('conversation-followup',100000);state.devices=[];state.timer={...state.timer,status};const timer=state.timer,f=fixture(state);
  f.host.renderRail();f.host.renderRail();
  assert.equal(f.rail.hidden,true,status);assert.equal(f.tile.hidden,true,status);assert.deepEqual(f.updates,[]);assert.deepEqual(f.actions,[]);assert.equal(f.host.state.timer,timer);assert.equal(f.host.state.timer.deadline,622000);
 }
});

test('Back from an answer sends the same running timer to the actual overview bar renderer and retains music',()=>{
 const state=previewScene('conversation-followup',100000);state.devices=[];const timer=state.timer,music=state.music,f=fixture(state);f.host.renderRail();
 const returned=sceneTransition(state,{type:'back'});assert.equal(returned.focus,'now');assert.equal(returned.timer,timer);assert.equal(returned.music,music);
 const cards=[],finish={disabled:false},view={overviewList:{hidden:true},shortcut:{hidden:false},overview:{dataset:{}},nodes:new Map(),canCancel:true,card(current,container,key){cards.push({current,container,key});return {querySelector:()=>finish};}};
 TimerView.prototype.renderOverviewActivities.call(view,returned);
 assert.equal(view.overviewList.hidden,false);assert.equal(view.overview.dataset.activityKind,'timer');assert.equal(cards.length,1);assert.equal(cards[0].current,timer);assert.equal(cards[0].key,`overview:${timer.id}`);assert.equal(cards[0].current.status,'running');assert.equal(cards[0].current.deadline,622000);assert.equal(cards[0].current.remaining,522);
 // Ro keeps its established supporting rail; hiding a visual answer never cancels its timer.
 f.host.state={...returned,focus:'photo'};f.host.renderRail();assert.equal(f.rail.hidden,false);assert.equal(f.tile.hidden,false);assert.equal(f.updates[0].id,timer.id);assert.deepEqual(f.actions,[]);
});
