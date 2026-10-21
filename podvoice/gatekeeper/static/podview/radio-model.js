import {TARGETS} from './widget-model.js';
// Station names are navigation choices, never stream URLs or playback authority.
export const stations=Object.freeze([
 {id:'p3',label:'P3'},
 {id:'p1',label:'P1'},
 {id:'p4-ostjylland',label:'P4 Østjylland'},
 {id:'p6-beat',label:'P6 Beat'},
 {id:'p8-jazz',label:'P8 Jazz'},
].map(station=>Object.freeze(station)));

const byId=new Map(stations.map(station=>[station.id,station]));
export function radioStation(id){return typeof id==='string'?byId.get(id)??null:null;}

// A local-only content preview for the existing PlayerView. The player anatomy
// stays in place; local controls are examples, never observed audio or authority.
export function localRadioPlayerModel(stationId,baseVm={},radio={}){
 const station=radioStation(stationId);
 if(!station)return null;
 return {
  active:true,playing:radio.playing===true,fresh:false,title:station.label,artist:'Direkte radio',
  target:typeof baseVm?.target==='string'?baseVm.target:'',
  volume:baseVm?.volume??null,
  fixtureArt:`assets/radio-${station.id}.svg`,artwork:null,canOutput:radio.connected===true,canDiscover:radio.connected===true,
  exampleOnly:true,sourceKind:'radio',previewLabel:radio.playing?'Radio · ingen lyd':'Radio på pause · ingen lyd',
 };
}

// Only the explicitly local host calls this reducer. It has no transport or URLs.
export function localRadioTransition(state,event){
 if(!state.connected||state.music.pending)return state;
 if(event.type==='radio-select'){
  if(!radioStation(event.stationId))return state;
  return {...state,radioStationId:event.stationId,radioPlaying:true,music:{...state.music,playback:{...state.music.playback,active:false,playing:false}}};
 }
 if(!radioStation(state.radioStationId))return state;
 if(event.type==='toggle')return {...state,radioPlaying:!state.radioPlaying};
 if(event.type==='volume'){
  const volume=Number(event.value);if(!Number.isInteger(volume)||volume<0||volume>100||volume===state.music.playback.volume)return state;
  return {...state,music:{...state.music,playback:{...state.music.playback,volume}}};
 }
 if(event.type==='target'){
  const target=TARGETS.find(t=>t.accountId===event.accountId&&t.kind===event.kind&&t.targetId===event.targetId);
  if(event.revision!==state.music.revision||!target?.available)return state;
  return {...state,music:{...state.music,playback:{...state.music.playback,room:target.name,accountId:target.accountId,kind:target.kind,targetId:target.targetId}}};
 }
 return state;
}
export function localRadioControlModel(state){return {sourceKind:'radio',playing:state.radioPlaying===true,previous:false,next:false,toggle:true,blocked:!state.connected||!!state.music.pending,volume:state.music.playback.volume,canVolume:true};}
