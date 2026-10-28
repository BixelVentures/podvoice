import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateHome,scopedLightDevice} from '../../podvoice/gatekeeper/static/podview/home-model.js';
import {lightAreasObservation,scopedLightsObservation} from '../../podvoice/gatekeeper/static/podview/ha-home-observation.js';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),body=source.slice(source.indexOf(' onLightActionStatus(state,operation){'),source.indexOf(' renderLightAdjustments(light){'));
const Host=new Function('validateHome','scopedLightDevice','lightAreasObservation','scopedLightsObservation',`return class{${body}}`)(validateHome,scopedLightDevice,lightAreasObservation,scopedLightsObservation);
function fixture(){
 const now=Math.floor(Date.now()/1000),epoch='a'.repeat(64),bindingId='b'.repeat(64),items=[{areaId:'own',areaName:'Køkken'},{areaId:'other',areaName:'Stue'}];
 const areas={status:'observed',source:'home_assistant_area_registry',sourceEpoch:epoch,observedAt:now,validUntil:now+15,bindingId,placementRevision:1,ownAreaId:'own',selectedAreaId:'own',items},placement={status:'bound',areaId:'own',areaName:'Køkken',bindingId,placementRevision:1};
 const observation=area=>({status:'observed',source:'home_assistant_state',sourceEpoch:epoch,observedAt:now,validUntil:now+15,scope:{kind:'ha_area',areaId:area,areaName:items.find(row=>row.areaId===area).areaName,bindingId,placementRevision:1,isOwnArea:area==='own'},complete:true,items:[{entityId:`light.${area}`,areaId:area,name:area==='own'?'Loft':'Gulvlampe',state:'on',brightness:128,supportsBrightness:true}],countUnit:'light_entities'});
 const response=area=>({schema:'podview.home.v1',bootId:'boot',roomId:'controller',revision:2,observedAt:now,vacuum:{status:'unavailable',items:[]},lightAreas:{...areas,selectedAreaId:area},lightPlacement:placement,lights:observation(area)});
 const host=new Host(),calls=[];Object.assign(host,{live:true,isConnected:true,liveSnapshot:{bootId:'boot',roomId:'controller',capabilities:{homeRead:['light'],controlSetup:['light']}},liveTransport:{connected:true,home:async args=>{calls.push(args);return response(args.lightArea);}},state:{sessionId:'s',connected:true,focus:'podview-ha-lights',devices:[scopedLightDevice(observation('own'),1)],lightAreas:areas,lightPlacement:placement,music:{identity:'keep'},timer:{id:'keep'},liveWeather:{identity:'keep'}},closeLightDetail(){this.closed=(this.closed||0)+1;},render(){this.syncLightArea();},showFeedback(message){this.feedback=message;}});
 return {host,calls,response,observation,cleanup(){clearTimeout(host.lightAreaExpiry);}};
}
test('explicit area browse changes detail only and issues no control setup or other read',async()=>{const f=fixture();try{const before=f.host.state;await f.host.readLightArea('other');assert.deepEqual(f.calls,[{lightArea:'other'}]);assert.equal(f.host.currentLightDevice().lightScope.areaId,'other');for(const key of ['devices','music','timer','liveWeather','lightAreas','lightPlacement'])assert.equal(f.host.state[key],before[key],key);assert.equal(f.host.state.devices[0].lightScope.areaId,'own');assert.equal(f.host.lightAreaPending,false);}finally{f.cleanup();}});
test('foreign choices are inert and late response after placement or transport replacement cannot adopt',async()=>{for(const change of ['placement','transport','boot','disconnect']){const f=fixture();try{await f.host.readLightArea('foreign');assert.equal(f.calls.length,0);let finish;f.host.liveTransport.home=()=>new Promise(resolve=>finish=resolve);const pending=f.host.readLightArea('other');if(change==='placement')f.host.state.lightPlacement={...f.host.state.lightPlacement,placementRevision:2};if(change==='transport')f.host.liveTransport={...f.host.liveTransport};if(change==='boot')f.host.liveSnapshot={...f.host.liveSnapshot,bootId:'other'};if(change==='disconnect')f.host.liveTransport.connected=false;f.host.syncLightArea();finish(f.response('other'));await pending;assert.equal(f.host.state.liveLightDetail,null);assert.equal(f.host.lightAreaPending,false);}finally{f.cleanup();}}});
test('latest chosen area wins even if older read returns later',async()=>{const f=fixture();try{const finish=[];f.host.liveTransport.home=()=>new Promise(resolve=>finish.push(resolve));const first=f.host.readLightArea('other'),second=f.host.readLightArea('own');finish[1](f.response('own'));await second;finish[0](f.response('other'));await first;assert.equal(f.host.currentLightDevice().lightScope.areaId,'own');assert.equal(f.host.lightAreaPending,false);}finally{f.cleanup();}});
test('explicit control click passes exact selected entity and fresh observation; expiry revokes callback',async()=>{const f=fixture();try{await f.host.readLightArea('other');let args;f.host.liveControls={openLight(...value){args=value;}};const opener={};f.host.openLiveLightControl('light.other',opener);assert.deepEqual(args[0],{areaId:'other',entityId:'light.other'});assert.equal(args[1].scope.areaId,'other');assert.equal(args[2],opener);assert.equal(args[3]().scope.areaId,'other');f.host.state.liveLightDetail={...f.host.state.liveLightDetail,stale:true};assert.equal(args[3](),null);args=null;f.host.openLiveLightControl('light.own',opener);assert.equal(args,null);}finally{f.cleanup();}});
test('expired own-area data becomes stale offscreen and closes only light controls',()=>{const f=fixture();try{f.host.state.focus='now';f.host.state.devices[0]={...f.host.state.devices[0],validUntil:Date.now()/1000-1};const controls={domain:'light',invalidated:0,dialog:{close(){this.closed=true;}},invalidate(){this.invalidated++;}};f.host.liveControls=controls;f.host.syncLightArea();assert.equal(f.host.state.devices[0].stale,true);assert.equal(controls.invalidated,1);assert.equal(controls.dialog.closed,true);assert.deepEqual(f.calls,[]);}finally{f.cleanup();}});
test('mismatched explicit-area response cannot replace retained selected detail',async()=>{const f=fixture();try{await f.host.readLightArea('other');const previous=f.host.state.liveLightDetail;f.host.liveTransport.home=async()=>f.response('own');await f.host.readLightArea('other');assert.equal(f.host.state.liveLightDetail,previous);assert.match(f.host.lightLocalFeedback(f.host.currentLightDevice()).text,/Lysstatus for Stue kunne ikke hentes/);assert.equal(f.host.feedback,'Hent lysstatus igen.');assert.equal(f.host.lightAreaPending,false);}finally{f.cleanup();}});

function actionFixture(){
 const f=fixture(),{host}=f,context=host.lightAreaContext(),focus=host.state.focus,light=host.currentLightDevice(),observation=light.lightObservation,toasts=[];
 const operation={identity:'one-light-operation',target:{areaId:light.lightScope.areaId,sceneId:'scene-one'},context:{sourceEpoch:observation.sourceEpoch,sourceObservedAt:observation.observedAt,current:()=>{const current=host.lightAreaContext();return host.state.focus===focus&&current?.key===context.key&&current.transport===context.transport;}}};
 host.liveControls={lightActionFeedbackOperation:operation,lightUnknowns:new Map()};
 host.showFeedback=(...args)=>{toasts.push(args);host.feedback=args[0];};
 // Retain the canonical status slot; this test exercises projection without a browser DOM.
 const attrs=new Map();host.lightSceneStatus={textContent:'',dataset:{},hidden:true,setAttribute:(key,value)=>attrs.set(key,String(value)),getAttribute:key=>attrs.get(key)??null};
 return {...f,operation,toasts};
}

test('routine light progress and service acceptance emit no toast or local problem',()=>{
 const f=actionFixture();try{
  for(const phase of ['preparing','sending','accepted']){
   f.host.onLightActionStatus({phase,target:f.operation.target},f.operation);
   assert.equal(f.toasts.length,0,phase);assert.equal(f.host.lightActionProblem,undefined,phase);
   const status=f.host.renderLightStatus(f.host.currentLightDevice());assert.equal(status.hidden,true,phase);assert.equal(status.textContent,'',phase);
  }
 }finally{f.cleanup();}
});

test('unknown light effect has one toast and persistent local status without scenes until fresh matched observation',()=>{
 const f=actionFixture(),originalNow=Date.now,clock=Date.now();try{
  const light=f.host.currentLightDevice();light.lightScenes=[];
  const unknown={phase:'unknown',target:f.operation.target};
  f.host.onLightActionStatus(unknown,f.operation);f.host.onLightActionStatus(unknown,f.operation);
  assert.equal(f.toasts.length,1);assert.equal(f.toasts[0][0],'Tjek lyset, før du gør noget igen.');assert.equal(f.toasts[0][1],false);assert.equal(f.toasts[0][2].eventId,f.operation);
  f.host.feedback=null; // Toast dismissal/expiry does not own the retained local error.
  let status=f.host.renderLightStatus(light);assert.equal(status.hidden,false);assert.equal(status.dataset.state,'unknown');assert.equal(status.textContent,'Lysets tilstand er ikke bekræftet.');
  assert.equal(f.host.lightActionProblem.operation,f.operation);
  Date.now=()=>clock+2000;
  const fresher={observedAt:light.lightObservation.observedAt+1,validUntil:light.lightObservation.observedAt+16},otherArea={...f.observation('other'),...fresher};
  assert.ok(scopedLightsObservation(otherArea),'comparison observation is valid');
  assert.equal(f.host.lightLocalFeedback({...light,lightObservation:otherArea}).state,'unknown','another room cannot resolve this effect');
  const otherEpoch={...light.lightObservation,...fresher,sourceEpoch:'c'.repeat(64)};assert.ok(scopedLightsObservation(otherEpoch),'comparison source observation is valid');
  assert.equal(f.host.lightLocalFeedback({...light,lightObservation:otherEpoch}).state,'unknown','another source epoch cannot resolve this effect');
  status=f.host.renderLightStatus(light);assert.equal(status.hidden,false,'same observation cannot resolve unknown');assert.equal(f.toasts.length,1);
  light.lightObservation={...light.lightObservation,...fresher};assert.ok(scopedLightsObservation(light.lightObservation));
  status=f.host.renderLightStatus(light);assert.equal(status.hidden,true);assert.equal(status.textContent,'');assert.equal(f.host.lightActionProblem,null);assert.equal(f.toasts.length,1,'a fresh observation is not a synthetic success toast');
 }finally{Date.now=originalNow;f.cleanup();}
});

test('late action feedback is fenced by focus, transport, producer identity and revoked result',()=>{
 for(const boundary of ['focus','transport','producer','revoked','late','disconnect']){
  const f=actionFixture();try{
   const state={phase:'unknown',target:f.operation.target};
   if(boundary==='focus')f.host.state.focus='now';
   if(boundary==='transport')f.host.liveTransport={...f.host.liveTransport};
   if(boundary==='producer')f.host.liveControls.lightActionFeedbackOperation={};
   if(boundary==='revoked')f.operation.revoked=true;
   if(boundary==='late')state.late=true;
   if(boundary==='disconnect')f.host.liveTransport.connected=false;
   f.host.onLightActionStatus(state,f.operation);
   assert.equal(f.toasts.length,0,boundary);assert.equal(f.host.lightActionProblem,undefined,boundary);
  }finally{f.cleanup();}
 }
});

test('a failed area read after leaving lights neither emits feedback nor adopts a detail',async()=>{
 const f=fixture();try{
  let rejectRead;f.host.liveTransport.home=()=>new Promise((resolve,reject)=>{rejectRead=reject;});
  const before=f.host.state.devices,pending=f.host.readLightArea('other');
  f.host.state.focus='now';rejectRead(Error('read failed after navigation'));await pending;
  assert.equal(f.host.feedback,undefined);assert.equal(f.host.lightReadProblem,undefined);assert.equal(f.host.state.liveLightDetail??null,null);assert.equal(f.host.state.devices,before);assert.equal(f.host.lightAreaPending,false);
 }finally{f.cleanup();}
});
