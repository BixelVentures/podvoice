import {TARGETS} from './widget-model.js';
// The local preview's radio (the shell's scene): station choice, stop/start, volume and output, without a
// transport. The station catalogue is the typed client's (src/lib/api/radio.ts).
import {radioStation} from './src/lib/api/radio.ts';

// A local-only content preview for the shared player (src/screens/player). The player anatomy
// stays in place; local controls are examples, never observed audio or authority.
export function localRadioPlayerModel(stationId,baseVm={},radio={}){
 const station=radioStation(stationId);
 if(!station)return null;
 return {
  active:true,playing:radio.playing===true,fresh:false,title:station.label,artist:'Direkte radio',
  target:typeof baseVm?.target==='string'?baseVm.target:'',
  volume:baseVm?.volume??null,
  fixtureArt:`assets/radio-${station.id}.svg`,artwork:null,canOutput:radio.connected===true,canDiscover:radio.connected===true,
  exampleOnly:true,sourceKind:'radio',previewLabel:radio.playing?'Radio · ingen lyd':'Radio stoppet · ingen lyd',
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

// Requested playback is presentation only; it never replaces an observation.
export function pendingRadioPlayerModel(stationId,volume=null,target=''){const station=radioStation(stationId);return station?{active:true,sourceKind:'radio',playing:false,fresh:false,loading:true,title:station.label,artist:'Direkte radio',fixtureArt:`assets/radio-${station.id}.svg`,target:typeof target==='string'?target:'',volume:Number.isInteger(volume)?volume:null,canOutput:false,canDiscover:false,canSeek:false,feedback:{message:`Starter ${station.label}…`,pending:true}}:null;}
