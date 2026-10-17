// Tesla is a read-only UI extension. No Tesla owner is connected yet: no live
// snapshot, Spotify player or nearby device may supply a vehicle state here.
export const VEHICLE_ARTWORK='assets/vehicle-gray-model-y-2023.png';

export function unconnectedVehicleModel(){
 return {kind:'vehicle',mode:'unconnected',title:'Tesla',context:'Model Y · 2023',status:'Ikke tilsluttet endnu',parked:null,locked:null,batteryPercent:null,rangeKm:null,charging:{status:null,powerKw:null},climate:{status:null,temperatureC:null},history:[],source:'',actions:[]};
}

// Explicit local fixture only. It never grants a household/remote action.
export function vehicleFixture(){
 return {...unconnectedVehicleModel(),mode:'fixture',context:'Model Y · 2023',status:'Parkeret · Låst',parked:true,locked:true,batteryPercent:72,rangeKm:312,charging:{status:'disconnected',powerKw:null},climate:{status:'off',temperatureC:null},source:'Lokalt eksempel'};
}

export function vehicleModel(value){
 // No accepted live owner contract exists. Fail closed for every remote shape,
 // even if it happens to contain plausible battery/lock/temperature fields.
 return value?.kind==='vehicle'&&value.mode==='fixture'?vehicleFixture():unconnectedVehicleModel();
}
