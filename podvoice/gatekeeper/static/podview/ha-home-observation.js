// Closed passive HA extension. Observation never grants command authority.
const admission=Symbol('HA vehicle observation');
export const isVehicleObservation=value=>value?.[admission]===true;
const finite=(v,min=0,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
export function lightsObservation(v){
 if(v?.status!=='observed'||v.source!=='home_assistant_state'||finite(v.observedAt)===null||!Array.isArray(v.items)||!v.items.length||v.items.length>64)return null;
 const seen=new Set(),items=[];for(const row of v.items){if(!/^light\.[a-z0-9_]+$/.test(row?.entityId)||seen.has(row.entityId)||!['on','off','unknown','unavailable'].includes(row.state))return null;seen.add(row.entityId);items.push({entityId:row.entityId,name:typeof row.name==='string'?row.name.slice(0,120):'Lys',state:row.state,brightness:finite(row.brightness,0,255)});}
 return {source:v.source,observedAt:v.observedAt,items};
}
// Legacy lightsObservation above is for authored examples only. Live consumers
// admit the closed controller/HA-area projection below and join its catalogue.
const lightExact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const lightText=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\p{C}\p{Z}]/u.test(value.replaceAll(' ',''));
const lightAreaId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const lightHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const lightRevision=value=>Number.isSafeInteger(value)&&value>=0;
const lightTime=(v,now)=>Number.isFinite(now)&&finite(v.observedAt)!==null&&finite(v.validUntil)!==null&&v.validUntil===v.observedAt+15&&v.observedAt*1000<=now&&now<v.validUntil*1000;
export function lightAreasObservation(v,now=Date.now()){
 const keys=['status','source','sourceEpoch','observedAt','validUntil','bindingId','placementRevision','ownAreaId','selectedAreaId','items'];
 if(!lightExact(v,keys)||!['observed','unavailable','unbound'].includes(v.status)||v.source!=='home_assistant_area_registry'||!Array.isArray(v.items))return null;
 if(v.status!=='observed')return v.items.length===0&&keys.filter(key=>!['status','source','items'].includes(key)).every(key=>v[key]===null)?{...v,items:[]}:null;
 if(!lightHash(v.sourceEpoch)||!lightHash(v.bindingId)||!lightRevision(v.placementRevision)||!lightTime(v,now)||!lightAreaId(v.ownAreaId)||!(v.selectedAreaId===null||lightAreaId(v.selectedAreaId))||v.items.length<1||v.items.length>64)return null;
 const seen=new Set(),items=[];for(const row of v.items){if(!lightExact(row,['areaId','areaName'])||!lightAreaId(row.areaId)||seen.has(row.areaId)||!lightText(row.areaName,160))return null;seen.add(row.areaId);items.push({...row});}
 if(!seen.has(v.ownAreaId)||v.selectedAreaId!==null&&!seen.has(v.selectedAreaId))return null;
 return {...v,items};
}
export function lightPlacementObservation(v,areas=null){
 const keys=['status','areaId','areaName','bindingId','placementRevision'];
 if(!lightExact(v,keys)||!['bound','unavailable','unbound'].includes(v.status))return null;
 if(v.status!=='bound')return keys.filter(key=>key!=='status').every(key=>v[key]===null)&&(!areas||areas.status===v.status)?{...v}:null;
 if(!lightAreaId(v.areaId)||!lightText(v.areaName,160)||!lightHash(v.bindingId)||!lightRevision(v.placementRevision))return null;
 if(areas&&(areas.status!=='observed'||v.areaId!==areas.ownAreaId||v.areaName!==areas.items.find(row=>row.areaId===v.areaId)?.areaName||v.bindingId!==areas.bindingId||v.placementRevision!==areas.placementRevision))return null;
 return {...v};
}
// Passive Hue catalogue: stable opaque identity and exact admitted light members.
// A scene entry is never evidence that it is active or that a command is offered.
export function lightScenesObservation(value,entityIds){
 if(!Array.isArray(value)||value.length>64||!Array.isArray(entityIds))return null;
 const members=new Set(entityIds),seen=new Set(),scenes=[];
 for(const row of value){
  if(!lightExact(row,['id','name','entityIds'])||!lightHash(row.id)||seen.has(row.id)||!lightText(row.name,160)||!Array.isArray(row.entityIds)||!row.entityIds.length||row.entityIds.length>64||new Set(row.entityIds).size!==row.entityIds.length||row.entityIds.some(id=>!members.has(id)))return null;
  seen.add(row.id);scenes.push({id:row.id,name:row.name,entityIds:[...row.entityIds]});
 }
 return scenes;
}
export function scopedLightsObservation(v,{now=Date.now(),areas=null,placement=null}={}){
 const keys=['status','source','sourceEpoch','observedAt','validUntil','scope','complete','items','countUnit',...(Object.hasOwn(v??{},'scenes')?['scenes']:[])];
 if(!lightExact(v,keys)||!['observed','unavailable','unbound'].includes(v.status)||v.source!=='home_assistant_state'||v.countUnit!=='light_entities'||!Array.isArray(v.items))return null;
 if(v.status!=='observed')return (v.sourceEpoch===null||lightText(v.sourceEpoch,256))&&v.observedAt===null&&v.validUntil===null&&v.scope===null&&v.complete===false&&v.items.length===0&&(!Object.hasOwn(v,'scenes')||Array.isArray(v.scenes)&&v.scenes.length===0)?{...v,items:[],...(Object.hasOwn(v,'scenes')?{scenes:[]}: {})}:null;
 const scope=v.scope;
 if(!lightText(v.sourceEpoch,256)||v.complete!==true||!lightTime(v,now)||v.items.length>64||!lightExact(scope,['kind','areaId','areaName','bindingId','placementRevision','isOwnArea'])||scope.kind!=='ha_area'||!lightAreaId(scope.areaId)||!lightText(scope.areaName,160)||!lightText(scope.bindingId,256)||!lightRevision(scope.placementRevision)||typeof scope.isOwnArea!=='boolean')return null;
 if(areas&&(areas.status!=='observed'||!lightTime(areas,now)||v.sourceEpoch!==areas.sourceEpoch||scope.areaId!==areas.selectedAreaId||scope.areaName!==areas.items.find(row=>row.areaId===scope.areaId)?.areaName||scope.bindingId!==areas.bindingId||scope.placementRevision!==areas.placementRevision||scope.isOwnArea!==(scope.areaId===areas.ownAreaId)))return null;
 if(placement&&(placement.status!=='bound'||scope.bindingId!==placement.bindingId||scope.placementRevision!==placement.placementRevision||scope.isOwnArea!==(scope.areaId===placement.areaId)||scope.isOwnArea&&scope.areaName!==placement.areaName))return null;
 const seen=new Set(),items=[];for(const row of v.items){if(!lightExact(row,['entityId','areaId','name','state','brightness','supportsBrightness'])||typeof row.entityId!=='string'||!/^light\.[a-z0-9_]+$/.test(row.entityId)||seen.has(row.entityId)||row.areaId!==scope.areaId||!lightText(row.name,160)||!['on','off','unknown','unavailable'].includes(row.state)||typeof row.supportsBrightness!=='boolean'||!(row.brightness===null||Number.isInteger(row.brightness)&&row.brightness>=0&&row.brightness<=255))return null;seen.add(row.entityId);items.push({...row});}
 const scenes=Object.hasOwn(v,'scenes')?lightScenesObservation(v.scenes,[...seen]):null;if(Object.hasOwn(v,'scenes')&&!scenes)return null;
 return {...v,scope:{...scope},items,...(scenes?{scenes}: {})};
}
export function scopedLightSummary(v,now=Date.now()){
 const value=scopedLightsObservation(v,{now});
 if(!value)return {status:v?.status==='observed'?'stale':'unavailable',onCount:null,knownCount:null,unknownCount:null,totalCount:null,countUnit:'light_entities'};
 if(value.status!=='observed')return {status:value.status,onCount:null,knownCount:null,unknownCount:null,totalCount:null,countUnit:value.countUnit};
 const totalCount=value.items.length,onCount=value.items.filter(row=>row.state==='on').length,knownCount=value.items.filter(row=>['on','off'].includes(row.state)).length,unknownCount=totalCount-knownCount,status=!totalCount?'empty':unknownCount?'unknown':onCount===totalCount?'on':onCount===0?'off':'mixed';
 return {status,onCount,knownCount,unknownCount,totalCount,countUnit:value.countUnit};
}
export function vehicleObservation(v){
 if(!['observed','stale'].includes(v?.status)||!['home_assistant_state','tesla_fleet_snapshot'].includes(v.source)||finite(v.observedAt)===null||!Array.isArray(v.entityIds)||!v.entityIds.length||v.entityIds.length>12||new Set(v.entityIds).size!==v.entityIds.length||v.entityIds.some(id=>!/^(sensor|binary_sensor|climate|lock|switch|select|cover)\.[a-z0-9_]+$/.test(id))||!v.data)return null;
 if(v.historicalFields!==undefined&&(!Array.isArray(v.historicalFields)||v.historicalFields.some(x=>typeof x!=='string')||new Set(v.historicalFields).size!==v.historicalFields.length))return null;
 const d=v.data,charging=['charging','complete','stopped','disconnected','starting'].includes(d.charging?.status)?d.charging.status:null;
 return {[admission]:true,kind:'vehicle',mode:'observed',historicalFields:v.historicalFields||[],fieldObservedAt:v.fieldObservedAt||{},...(v.status==='stale'?{stale:true}:{}),source:v.source,observedAt:v.observedAt,title:'Tesla',context:d.modelName==='Model Y'?'Model Y':'Home Assistant',...(d.modelName==='Model Y'?{modelName:'Model Y'}:{}),status:charging==='charging'?'Lader':charging==='complete'?'Opladning færdig':typeof d.locked==='boolean'?(d.locked?'Låst':'Ulåst'):charging==='disconnected'?'Oplader frakoblet':'Status ukendt',batteryPercent:finite(d.batteryPercent,0,100),rangeKm:finite(d.rangeKm),locked:typeof d.locked==='boolean'?d.locked:null,charging:{status:charging,powerKw:finite(d.charging?.powerKw),endsAt:v.status==='observed'&&charging==='charging'?finite(d.charging?.endsAt):null},climate:{status:['off','heat','cool','auto','heat_cool','fan_only','dry'].includes(d.climate?.status)?d.climate.status:null,temperatureC:finite(d.climate?.temperatureC,-50,70),targetTemperatureC:finite(d.climate?.targetTemperatureC,-50,70),minTemperatureC:finite(d.climate?.minTemperatureC,-50,70),maxTemperatureC:finite(d.climate?.maxTemperatureC,-50,70),temperatureStepC:d.climate?.temperatureStepC===0.5?0.5:null,defrost:typeof d.climate?.defrost==='boolean'?d.climate.defrost:null,driverSeatHeat:['off','low','medium','high'].includes(d.climate?.driverSeatHeat)?d.climate.driverSeatHeat:null,passengerSeatHeat:['off','low','medium','high'].includes(d.climate?.passengerSeatHeat)?d.climate.passengerSeatHeat:null},...(['open','closed'].includes(d.trunk)?{access:{rearTrunk:d.trunk}}:{}),history:[],actions:[]};
}
