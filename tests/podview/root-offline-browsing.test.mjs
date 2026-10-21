import test from 'node:test';
import assert from 'node:assert/strict';
import {initialScene,sceneTransition,deviceActions} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {liveLocalEvent} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {updateResourceTile} from '../../podvoice/gatekeeper/static/podview/ui/resource-tile.js';
test('offline collection navigation preserves playback while every music effect remains rejected',()=>{
 let state=sceneTransition(initialScene(),{type:'offline'});const playback=state.music.playback;
 state=sceneTransition(state,{type:'show',id:'music'});state=sceneTransition(state,{type:'music',event:{type:'collection',value:'recent'}});assert.equal(state.focus,'music');assert.equal(state.music.collection,'recent');assert.equal(state.music.playback,playback);assert.equal(state.music.pending,null);
 for(const event of [{type:'select',id:'top:heartless',revision:state.music.revision},{type:'toggle'},{type:'skip',delta:1},{type:'volume',value:90},{type:'target',targetId:'kitchen'},{type:'refresh',revision:state.music.revision}])assert.equal(sceneTransition(state,{type:'music',event}),state);
});
test('offline empty device navigation exposes only the honest existing unavailable detail and cannot start any control',()=>{
 for(const [id,kind] of [['podview-light-empty','light'],['podview-vacuum-empty','vacuum']]){
  const offline=sceneTransition(initialScene(),{type:'offline'});assert.equal(liveLocalEvent({type:'show',id},offline),true);const shown=sceneTransition(offline,{type:'show',id}),device=shown.devices[0];assert.equal(shown.focus,id);assert.equal(device.kind,kind);assert.equal(device.status,'unavailable');assert.equal(device.presentationOnly,true);assert.equal(device.live,true);assert.deepEqual(deviceActions(device),[]);
  for(const action of ['start','pause','resume','turn_on','turn_off'])assert.equal(sceneTransition(shown,{type:'device-action',sessionId:shown.sessionId,taskId:id,revision:device.revision,action}),shown);
  const overview=sceneTransition(shown,{type:'back'});assert.equal(overview.focus,'now');assert.equal(overview.devices,shown.devices);assert.equal(overview.music,shown.music);assert.equal(sceneTransition(overview,{type:'back'}).focus,'photo');
 }
});
test('a stale resource still opens retained detail; command-disabled data does not disable its navigation button',()=>{
 const parts=new Map(['strong','small','.resource-value','.resource-visual img','svg'].map(key=>[key,{textContent:'',hidden:false,style:{display:''},getAttribute(){return null;}}]));const attrs=new Map(),values=new Map(),node={disabled:true,dataset:{},style:{getPropertyValue:k=>values.get(k),setProperty:(k,v)=>values.set(k,v)},querySelector:k=>parts.get(k),getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,String(v)),removeAttribute:k=>attrs.delete(k)};
 updateResourceTile(node,{kind:'light',target:'retained-light',title:'Lys',status:'unavailable',detail:'Sidst kendt: Lysstatus ukendt',disabled:true});assert.equal(node.disabled,false);assert.equal(node.dataset.target,'retained-light');
 updateResourceTile(node,{kind:'light',target:undefined,title:'Lys',status:'unavailable',disabled:true});assert.equal(node.disabled,true);
});
