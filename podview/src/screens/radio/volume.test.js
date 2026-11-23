// Ported from tests/podview/radio-volume-live.test.mjs (node:test against the shell's LiveRadioView) when radio moved to a
// Zustand store (source.ts). Same assertions; the radio is radioOf(host) (source-fixture.js), its state is read with
// getState() and written with setState(), and the shell's redraw is a store subscription (shellRender).
// Volume during radio (Green 12 Nov): never greys controls, coalesces to the last value, and a
// rejected value returns the slider to the observed volume with a short message.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {radioOf, shellRender} from './source-fixture.js';
import {stations,ownerStationIds,radioStation} from '../../lib/api/radio';

const now=Date.now(),snapshot={bootId:'boot',roomId:'room'};
const value=()=>({ok:true,schema:'podview.radio.v1',...snapshot,revision:1,enabled:true,blockedReasons:[],
 stations:ownerStationIds.map(id=>({id,name:radioStation(id).label})),
 targets:[{id:'stuen',name:'Stuen',availability:'available',selectable:true,default:true}],
 actions:['start','stop','move','volume'],state:{status:'playing',stationId:'p3',targetId:'stuen',generation:1,
  sourceKind:'radio',ownerGeneration:1,volumePercent:30,observedAt:now/1000},
 retrievedAt:now/1000,validUntil:now/1000+30,physicalResultVerified:false});

function fixture(){
 const calls=[],host={isConnected:true,liveSnapshot:snapshot,liveTransport:{connected:true},
  playerView:{renderPlayer(){},renderControls:vm=>calls.push(vm),renderQueue(){}}};
 const radio=radioOf(host);host.liveRadio=radio;radio.setState({value:value()});radio.subscribe(()=>radio.renderControls());
 const sent=[];let release=null;
 radio.act=function(action,args){
  sent.push(action==='volume'?['volume',args.volumePercent]:[action]);radio.setState({pending:true,pendingRequest:{action}});
  return new Promise(resolve=>{release=rejected=>{radio.setState({pending:false,pendingRequest:null,
   feedbackKind:rejected?'error':null});resolve();};});
 };
 return {radio,calls,sent,release:rejected=>release(rejected)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('radio volume keeps Stop and the slider live and coalesces changes to the last value',async()=>{
 const f=fixture();
 const done=f.radio.control({type:'volume',value:'40'});
 f.radio.renderControls();let controls=f.calls.at(-1);
 assert.equal(controls.blocked,false);assert.equal(controls.toggle,true);assert.equal(controls.canVolume,true);
 assert.equal(controls.volume,40,'the slider stays at the chosen value while sent');
 f.radio.control({type:'volume',value:'42'});f.radio.control({type:'volume',value:'45'});
 assert.deepEqual(f.sent,[['volume',40]],'changes during a sent volume wait');
 f.release(false);await tick();
 assert.deepEqual(f.sent,[['volume',40],['volume',45]],'only the last value is sent next');
 f.release(true);await done;
 f.radio.renderControls();controls=f.calls.at(-1);
 assert.equal(controls.volume,30,'a rejected value returns to the observed volume');
});

test('Stop pressed during a volume command wins and is sent when the volume settles',async()=>{
 const f=fixture();
 const done=f.radio.control({type:'volume',value:'40'});
 f.radio.control({type:'toggle'});
 f.radio.control({type:'volume',value:'50'});
 f.radio.renderControls();
 assert.equal(f.calls.at(-1).toggle,true,'Stop stays pressable');
 f.release(false);await tick();
 assert.deepEqual(f.sent,[['volume',40],['stop']],'Stop wins over a later volume');
 f.release(false);await done;
});
