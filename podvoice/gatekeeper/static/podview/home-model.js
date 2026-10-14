import {weatherObservation} from './weather-observation.js';
// Closed passive projection. It never issues capabilities, stores HA keys,
// infers a cleaning area, or treats an accepted command as observed cleaning.
const text=(v,max=120)=>typeof v==='string'?v.slice(0,max):'';
const states=new Set(['cleaning','paused','returning','docked','idle','error','unavailable','unknown']);
export function validateHome(value,roomId){
 if(value?.schema!=='podview.home.v1'||value.roomId!==roomId||!Number.isInteger(value.revision)||value.revision<1||!Number.isFinite(value.observedAt)||!['observed','unavailable'].includes(value.vacuum?.status)||!Array.isArray(value.vacuum.items)||value.vacuum.items.length>12)throw new Error('invalid_home_observation');
 const seen=new Set(),items=[];
 if(value.vacuum.status==='observed')for(const row of value.vacuum.items){
  if(!/^vacuum\.[a-z0-9_]+$/.test(row.entityId)||seen.has(row.entityId)||!states.has(row.state)||row.source!=='home_assistant_state'||!Number.isFinite(row.observedAt))throw new Error('invalid_vacuum_observation');
  seen.add(row.entityId);items.push({entityId:row.entityId,name:text(row.name)||'Robotstøvsuger',state:row.state,battery:Number.isFinite(row.battery)&&row.battery>=0&&row.battery<=100?row.battery:null,observedAt:row.observedAt,source:row.source,history:historyObservation(row.history)});
 }
 // Settings/actions are deliberately excluded until their separate owner
 // contract is implemented. Extra remote fields cannot silently enable controls.
 let weather=null;try{if(value.weather?.status==='observed')weather=weatherObservation(value.weather.data);}catch{}
 return {schema:value.schema,roomId,revision:value.revision,observedAt:value.observedAt,vacuum:{status:value.vacuum.status,items},weather};
}
export function applyHome(scene,home,allowed=["vacuum","weather"]){
 const previous=scene.devices.filter(d=>d.source==='home_assistant_state');
 const rows=!allowed.includes('vacuum')?[]:home.vacuum.status==='observed'?home.vacuum.items.map(item=>({id:item.entityId,kind:'vacuum',name:item.name,source:item.source,history:item.history,observedAt:item.observedAt,battery:item.battery,revision:home.revision,live:true,status:({returning:'docking',idle:'stopped',error:'fault'})[item.state]||item.state,pending:null,hidden:false,timeline:[]})):previous.map(d=>({...d,stale:true}));
 const devices=[...scene.devices.filter(d=>d.source!=='home_assistant_state'),...rows],removed=previous.some(d=>d.id===scene.focus)&&!devices.some(d=>d.id===scene.focus);
 return {...scene,liveWeather:!allowed.includes('weather')?null:home.weather|| (scene.liveWeather?{...scene.liveWeather,stale:true}:null),devices,focus:removed?'now':scene.focus,homeRevision:home.revision};
}

function historyObservation(v){
 const unavailable={status:'unavailable',items:[]};if(v?.status!=='observed'||v.source!=='device_control_start_journal'||!Array.isArray(v.items)||v.items.length>3)return unavailable;
 const ids=new Set(),items=[];for(const row of v.items){const r=row.recipe;if(typeof row.id!=='string'||!row.id||ids.has(row.id)||!Number.isFinite(row.recordedAt)||row.recordedAt<0||!['accepted_by_ha','unknown'].includes(row.outcome)||row.physicalResultVerified!==false||!Array.isArray(r?.areaIds)||r.areaIds.length<1||r.areaIds.length>32||r.areaIds.some(x=>typeof x!=='string'||x.length>128)||![1,2,3].includes(r.repeat))return unavailable;ids.add(row.id);items.push({id:row.id,recordedAt:row.recordedAt,outcome:row.outcome,recipe:{areaIds:r.areaIds,mapName:text(r.mapName),repeat:r.repeat}});}
 items.sort((a,b)=>b.recordedAt-a.recordedAt);return {status:'observed',items};
}
