import {scopedLightsObservation,scopedLightSummary,lightAreasObservation,lightPlacementObservation,vehicleObservation} from './ha-home-observation.js';
import {weatherObservation,hourlyWeather,weatherAdviceCapability} from './weather-observation.js';
import {robotObservation} from './robot-observation.js';
// Closed passive projection. It never issues capabilities, stores HA keys,
// infers a cleaning area, or treats an accepted command as observed cleaning.
const text=(v,max=120)=>typeof v==='string'?v.slice(0,max):'';
const states=new Set(['cleaning','paused','returning','docked','idle','error','unavailable','unknown']);
export function validateHome(value,roomId,bootId){
 if(bootId!==undefined&&value?.bootId!==bootId)throw new Error('home_boot_changed');
 if(value?.bootId!==undefined&&(typeof value.bootId!=='string'||!value.bootId||value.bootId.length>160))throw new Error('invalid_home_boot');
 if(value?.schema!=='podview.home.v1'||value.roomId!==roomId||!Number.isInteger(value.revision)||value.revision<1||!Number.isFinite(value.observedAt)||!['observed','unavailable'].includes(value.vacuum?.status)||!Array.isArray(value.vacuum.items)||value.vacuum.items.length>12)throw new Error('invalid_home_observation');
 const seen=new Set(),items=[];
 if(value.vacuum.status==='observed')for(const row of value.vacuum.items){
  if(!/^vacuum\.[a-z0-9_]+$/.test(row.entityId)||seen.has(row.entityId)||!states.has(row.state)||row.source!=='home_assistant_state'||!Number.isFinite(row.observedAt))throw new Error('invalid_vacuum_observation');
  seen.add(row.entityId);items.push({entityId:row.entityId,name:text(row.name)||'Robotstøvsuger',state:row.state,battery:Number.isFinite(row.battery)&&row.battery>=0&&row.battery<=100?row.battery:null,observedAt:row.observedAt,source:row.source,history:historyObservation(row.history),telemetry:robotObservation(row.telemetry,row.entityId),telemetryUnavailable:row.telemetry?.status==='unavailable'});
 }
 // Settings/actions are deliberately excluded until their separate owner
 // contract is implemented. Extra remote fields cannot silently enable controls.
 let weather=null;try{if(value.weather?.status==='observed')weather=weatherObservation(value.weather.data);}catch{}
 const lightAreas=lightAreasObservation(value.lightAreas),lightPlacement=lightPlacementObservation(value.lightPlacement,lightAreas),lights=lightAreas&&lightPlacement?scopedLightsObservation(value.lights,{areas:lightAreas,placement:lightPlacement}):null;
 return {schema:value.schema,bootId:value.bootId,roomId,revision:value.revision,observedAt:value.observedAt,vacuum:{status:value.vacuum.status,items},weather,weatherAdvice:weatherAdviceCapability(value.weatherAdvice,weather,{bootId:value.bootId,roomId}),lights,lightAreas,lightPlacement,vehicle:vehicleObservation(value.vehicle)};
}
// This projector also serves explicitly browsed detail. Only applyHome decides
// whether an observation is the controller's own area for overview admission.
export function scopedLightDevice(observation,revision,now=Date.now()){
 const value=scopedLightsObservation(observation,{now});if(value?.status!=='observed')return null;
 const summary=scopedLightSummary(value,now),displayState=summary.status==='empty'?'Ingen lys i rummet':summary.unknownCount?(summary.knownCount?`${summary.onCount} af ${summary.totalCount} bekræftet tændt · ${summary.unknownCount} ${summary.unknownCount===1?'ukendt':'ukendte'}`:'Lysstatus ukendt'):`${summary.onCount} af ${summary.totalCount} tændt`;
 return {id:'podview-ha-lights',kind:'light',name:`Lys · ${value.scope.areaName}`,scope:'ha_area',lightScope:value.scope,lightSourceEpoch:value.sourceEpoch,lightObservation:value,validUntil:value.validUntil,live:true,source:value.source,observedAt:value.observedAt,revision,status:summary.status,displayState,observedLights:value.items,...summary,pending:null,hidden:false,timeline:[]};
}
export function orderHomeDevices(devices){const slot=d=>d.kind==='vacuum'?0:d.kind==='light'?1:2;return [...devices].sort((a,b)=>slot(a)-slot(b));}
export function applyHome(scene,home,allowed=["vacuum","weather"]){
 const scope=typeof home.bootId==='string'&&home.bootId&&typeof home.roomId==='string'&&home.roomId?JSON.stringify([home.bootId,home.roomId]):null,sameScope=scope!==null&&scope===scene.homeScope,scopeChanged=(scope!==null||scene.homeScope!=null)&&scope!==scene.homeScope;
 const previous=scene.devices.filter(d=>d.source==='home_assistant_state'&&d.kind==='vacuum');
 const rows=!allowed.includes('vacuum')?[]:home.vacuum.status==='observed'?home.vacuum.items.map(item=>{const prior=sameScope?previous.find(d=>d.id===item.entityId&&d.source===item.source):null,telemetry=item.telemetryUnavailable===true&&item.telemetry?.status==='unavailable'&&prior?.telemetry?.status==='observed'?{...prior.telemetry,items:prior.telemetry.items.map(row=>({...row,stale:true}))}:item.telemetry;return {id:item.entityId,kind:'vacuum',name:item.name,source:item.source,history:item.history,telemetry,observedAt:item.observedAt,battery:item.battery,revision:home.revision,live:true,status:({returning:'docking',idle:'stopped',error:'fault'})[item.state]||item.state,pending:null,hidden:false,timeline:[]};}):scopeChanged?[]:previous.map(d=>({...d,stale:true}));
 // Stable family slots match the approved overview, regardless of which
 // observation arrives first. Activity or urgency never reorders them.
 const priorWeather=scene.liveWeather,incoming=home.weather,identity=incoming?.observationScope,oldIdentity=priorWeather?.observationScope,priorHourly=priorWeather?hourlyWeather(priorWeather):null;
 const retainHourly=sameScope&&incoming?.forecastType==='daily'&&incoming.hourlyUnavailable===true&&!incoming.hourly&&identity&&oldIdentity&&identity.entityId===oldIdentity.entityId&&identity.ownerEpoch===oldIdentity.ownerEpoch&&priorHourly?.observationScope?.entityId===identity.entityId&&priorHourly.observationScope.ownerEpoch===identity.ownerEpoch&&incoming.source===priorWeather.source&&incoming.location===priorWeather.location&&['temperature','precipitation','windSpeed'].every(key=>incoming.units?.[key]===priorWeather.units?.[key]);
 const weather=retainHourly?{...incoming,hourly:{...priorHourly,stale:true}}:incoming;
 const priorLights=scene.devices.filter(d=>d.kind==='light'&&d.source==='home_assistant_state'),areas=home.lightAreas,placement=home.lightPlacement,lightAllowed=allowed.includes('light'),currentBinding=lightAllowed&&areas?.status==='observed'&&placement?.status==='bound'&&lightPlacementObservation(placement,areas),priorBinding=scene.lightAreas?.status==='observed'&&scene.lightPlacement?.status==='bound'&&lightPlacementObservation(scene.lightPlacement,scene.lightAreas),sameLightBinding=!!(sameScope&&currentBinding&&priorBinding&&areas.sourceEpoch===scene.lightAreas.sourceEpoch&&['areaId','bindingId','placementRevision'].every(key=>placement[key]===scene.lightPlacement[key]));
 const ownLight=lightAllowed&&home.lights?.scope?.isOwnArea===true&&currentBinding?scopedLightDevice(home.lights,home.revision):null,lights=ownLight?[ownLight]:lightAllowed&&sameLightBinding&&home.lights?.status==='unavailable'?priorLights.filter(d=>d.lightScope?.isOwnArea===true&&d.lightScope.areaId===placement.areaId&&d.lightScope.bindingId===placement.bindingId&&d.lightScope.placementRevision===placement.placementRevision&&d.lightSourceEpoch===areas.sourceEpoch).map(d=>({...d,stale:true})):[];
 const devices=orderHomeDevices([...scene.devices.filter(d=>d.source!=='home_assistant_state'&&!(d.kind==='light'&&lights.length)),...rows,...lights]),removed=[...previous,...priorLights].some(d=>d.id===scene.focus)&&!devices.some(d=>d.id===scene.focus);
 return {...scene,lightAreas:lightAllowed?areas:null,lightPlacement:lightAllowed?placement:null,liveLightDetail:sameLightBinding?scene.liveLightDetail:null,weatherAdvice:allowed.includes('weather')?home.weatherAdvice:null,vehicle:!allowed.includes('vehicle')?null:home.vehicle||(sameScope&&scene.vehicle?{...scene.vehicle,stale:true}:null),liveWeather:!allowed.includes('weather')?null:weather|| (!scopeChanged&&scene.liveWeather?{...scene.liveWeather,stale:true}:null),devices,focus:removed?'now':scene.focus,homeRevision:home.revision,homeScope:scope};
}

function historyObservation(v){
 const unavailable={status:'unavailable',items:[]};if(v?.status!=='observed'||v.source!=='device_control_start_journal'||!Array.isArray(v.items)||v.items.length>3)return unavailable;
 const ids=new Set(),items=[];for(const row of v.items){const r=row.recipe;if(typeof row.id!=='string'||!row.id||ids.has(row.id)||!Number.isFinite(row.recordedAt)||row.recordedAt<0||!['accepted_by_ha','unknown'].includes(row.outcome)||row.physicalResultVerified!==false||!Array.isArray(r?.areaIds)||r.areaIds.length<1||r.areaIds.length>32||r.areaIds.some(x=>typeof x!=='string'||x.length>128)||![1,2,3].includes(r.repeat))return unavailable;ids.add(row.id);items.push({id:row.id,recordedAt:row.recordedAt,outcome:row.outcome,recipe:{areaIds:r.areaIds,mapName:text(r.mapName),repeat:r.repeat}});}
 items.sort((a,b)=>b.recordedAt-a.recordedAt);return {status:'observed',items};
}
