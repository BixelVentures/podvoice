import {isVehicleObservation} from './ha-home-observation.js';
// Tesla is a read-only UI extension. No Tesla owner is connected yet: no live
// snapshot, Spotify player or nearby device may supply a vehicle state here.
export const VEHICLE_ARTWORK='assets/vehicle-gray-model-y-2023.webp';

export function unconnectedVehicleModel(){
 return {kind:'vehicle',mode:'unconnected',title:'Tesla',context:'Model Y · 2023',status:'Ikke forbundet',parked:null,locked:null,batteryPercent:null,rangeKm:null,charging:{status:null,powerKw:null},climate:{status:null,temperatureC:null},history:[],source:'',actions:[]};
}

// Explicit local fixture only. It never grants a household/remote action.
export function vehicleFixture({charging=false,now=Date.now()}={}){
 return {...unconnectedVehicleModel(),mode:'fixture',fixtureCase:charging?'charging':'parked',exampleOnly:true,context:'Model Y · 2023',status:charging?'Lader':'Parkeret · Låst',parked:true,locked:true,batteryPercent:72,rangeKm:312,charging:{status:charging?'charging':'disconnected',powerKw:charging?11:null,endsAt:charging?Math.floor(now/1000)+2700:null},climate:{status:'off',temperatureC:null},source:'Lokalt eksempel'};
}

export function vehicleModel(value){
 // No accepted live owner contract exists. Fail closed for every remote shape,
 // even if it happens to contain plausible battery/lock/temperature fields.
 if(isVehicleObservation(value))return value.stale?{...value,status:`Sidst kendt: ${value.status}`} :value;
 return value?.kind==='vehicle'&&value.mode==='fixture'?vehicleFixture({charging:value.fixtureCase==='charging',now:Number.isFinite(value.charging?.endsAt)?(value.charging.endsAt-2700)*1000:Date.now()}):unconnectedVehicleModel();
}
