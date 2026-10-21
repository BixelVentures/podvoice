import {isVehicleObservation} from './ha-home-observation.js';
// Tesla is a read-only UI extension. No Tesla owner is connected yet: no live
// snapshot, Spotify player or nearby device may supply a vehicle state here.
export const VEHICLE_ARTWORK='assets/vehicle-gray-model-y-2023.webp';

export function unconnectedVehicleModel(){
 return {kind:'vehicle',mode:'unconnected',title:'Tesla',context:'Bil',modelName:null,modelYear:null,status:'Ikke forbundet',parked:null,locked:null,batteryPercent:null,rangeKm:null,charging:{status:null,powerKw:null},climate:{status:null,temperatureC:null},history:[],source:'',actions:[]};
}

// Explicit local fixture only. It never grants a household/remote action.
export function vehicleFixture({charging=false,now=Date.now(),controls=false}={}){
 return {...unconnectedVehicleModel(),mode:'fixture',revision:1,controlsPreview:controls,fixtureCase:charging?'charging':'parked',exampleOnly:true,context:'Model Y · 2023',modelName:'Model Y',modelYear:2023,status:charging?'Lader':'Parkeret · Låst',parked:true,locked:true,batteryPercent:72,rangeKm:312,charging:{status:charging?'charging':'disconnected',powerKw:charging?11:null,endsAt:charging?Math.floor(now/1000)+2700:null},climate:{status:'off',temperatureC:null,targetTemperatureC:21},source:'Lokalt eksempel'};
}

export function vehicleModel(value){
 // No accepted live owner contract exists. Fail closed for every remote shape,
 // even if it happens to contain plausible battery/lock/temperature fields.
 if(isVehicleObservation(value))return value.stale?{...value,status:`Sidst kendt: ${value.status}`} :value;
 if(value?.kind!=='vehicle'||value.mode!=='fixture')return unconnectedVehicleModel();
 const base=vehicleFixture({charging:value.fixtureCase==='charging',now:Number.isFinite(value.charging?.endsAt)?(value.charging.endsAt-2700)*1000:Date.now(),controls:value.controlsPreview===true});
 if(!base.controlsPreview)return base;
 return {...base,revision:Number.isSafeInteger(value.revision)?value.revision:1,locked:typeof value.locked==='boolean'?value.locked:true,climate:{...base.climate,status:value.climate?.status==='heat'?'heat':'off',targetTemperatureC:Number.isInteger(value.climate?.targetTemperatureC)&&value.climate.targetTemperatureC>=16&&value.climate.targetTemperatureC<=30?value.climate.targetTemperatureC:21},charging:{...base.charging,limitPercent:Number.isInteger(value.charging?.limitPercent)&&value.charging.limitPercent>=50&&value.charging.limitPercent<=100?value.charging.limitPercent:80}};
}

// Explicit preview control state. Observed HA data never enters this reducer.
export function vehiclePreviewAction(value,{action,value:amount,confirmed=false,revision}={}){
 if(value?.mode!=='fixture'||value.controlsPreview!==true||revision!==value.revision)return value;
 const model=vehicleModel(value);let patch;
 if(action==='climate')patch={climate:{...model.climate,status:model.climate.status==='off'?'heat':'off'}};
 if(action==='temperature'&&Number.isInteger(amount)&&amount>=16&&amount<=30)patch={climate:{...model.climate,targetTemperatureC:amount}};
 if(action==='charge-limit'&&Number.isInteger(amount)&&amount>=50&&amount<=100)patch={charging:{...model.charging,limitPercent:amount}};
 if(action==='lock'&&confirmed===true)patch={locked:!model.locked};
 return patch?{...model,...patch,revision:model.revision+1}:value;
}
