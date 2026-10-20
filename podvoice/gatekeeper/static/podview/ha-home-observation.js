// Closed passive HA extension. Observation never grants command authority.
const admission=Symbol('HA vehicle observation');
export const isVehicleObservation=value=>value?.[admission]===true;
const finite=(v,min=0,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
export function lightsObservation(v){
 if(v?.status!=='observed'||v.source!=='home_assistant_state'||finite(v.observedAt)===null||!Array.isArray(v.items)||!v.items.length||v.items.length>64)return null;
 const seen=new Set(),items=[];for(const row of v.items){if(!/^light\.[a-z0-9_]+$/.test(row?.entityId)||seen.has(row.entityId)||!['on','off','unknown','unavailable'].includes(row.state))return null;seen.add(row.entityId);items.push({entityId:row.entityId,name:typeof row.name==='string'?row.name.slice(0,120):'Lys',state:row.state,brightness:finite(row.brightness,0,255)});}
 return {source:v.source,observedAt:v.observedAt,items};
}
export function vehicleObservation(v){
 if(v?.status!=='observed'||v.source!=='home_assistant_state'||finite(v.observedAt)===null||!Array.isArray(v.entityIds)||!v.entityIds.length||v.entityIds.length>8||new Set(v.entityIds).size!==v.entityIds.length||v.entityIds.some(id=>!/^(sensor|binary_sensor|climate|lock)\.[a-z0-9_]+$/.test(id))||!v.data)return null;
 const d=v.data,charging=['charging','complete','stopped','disconnected','starting'].includes(d.charging?.status)?d.charging.status:null;
 return {[admission]:true,kind:'vehicle',mode:'observed',source:v.source,observedAt:v.observedAt,title:'Tesla',context:'Home Assistant',status:charging==='charging'?'Lader':charging==='complete'?'Opladning færdig':typeof d.locked==='boolean'?(d.locked?'Låst':'Ulåst'):'Status ukendt',batteryPercent:finite(d.batteryPercent,0,100),rangeKm:finite(d.rangeKm),locked:typeof d.locked==='boolean'?d.locked:null,charging:{status:charging,powerKw:finite(d.charging?.powerKw),endsAt:charging==='charging'?finite(d.charging?.endsAt):null},climate:{status:['off','heat','cool','auto','heat_cool','fan_only','dry'].includes(d.climate?.status)?d.climate.status:null,temperatureC:finite(d.climate?.temperatureC,-50,70)},history:[],actions:[]};
}
