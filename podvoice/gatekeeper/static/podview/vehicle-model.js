import {isVehicleObservation} from './ha-home-observation.js';
// Tesla admits the closed passive HA observation below, never command authority.
// Spotify/player data and arbitrary live-shaped objects cannot supply vehicle state.
export const VEHICLE_ARTWORK='assets/vehicle-gray-model-y-2023.webp';

export function unconnectedVehicleModel(){
 return {kind:'vehicle',mode:'unconnected',title:'Tesla',context:'Bil',modelName:null,modelYear:null,status:'Ikke forbundet',parked:null,locked:null,batteryPercent:null,rangeKm:null,charging:{status:null,powerKw:null},climate:{status:null,temperatureC:null},history:[],source:'',actions:[]};
}

// Explicit local fixture only. It never grants a household/remote action.
export function vehicleFixture({charging=false,now=Date.now(),controls=false}={}){
 return {...unconnectedVehicleModel(),mode:'fixture',revision:1,controlsPreview:controls,access:{rearTrunk:'closed'},fixtureCase:charging?'charging':'parked',exampleOnly:true,context:'Model Y · 2023',modelName:'Model Y',modelYear:2023,connectionState:charging?'online':'asleep',status:charging?'Lader':'I dvale · Låst',parked:true,locked:true,batteryPercent:72,rangeKm:312,charging:{status:charging?'charging':'disconnected',powerKw:charging?11:null,endsAt:charging?Math.floor(now/1000)+2700:null},climate:{status:'off',temperatureC:null,targetTemperatureC:21,defrost:false,seats:{driver:0,passenger:0}},source:'Lokalt eksempel'};
}

export function vehicleModel(value){
 // Only the admitted passive HA shape is accepted. Other remote shapes fail
 // closed even when they contain plausible battery/lock/temperature fields.
 if(isVehicleObservation(value))return value.stale&&!value.status.startsWith('Sidst kendt: ')?{...value,status:`Sidst kendt: ${value.status}`} :value;
 if(value?.kind!=='vehicle'||value.mode!=='fixture')return unconnectedVehicleModel();
 const base=vehicleFixture({charging:value.fixtureCase==='charging',now:Number.isFinite(value.charging?.endsAt)?(value.charging.endsAt-2700)*1000:Date.now(),controls:value.controlsPreview===true});
 if(!base.controlsPreview)return base;
 const locked=typeof value.locked==='boolean'?value.locked:true;
 const access={rearTrunk:value.access?.rearTrunk==='open'?'open':'closed'},connectionState=value.connectionState==='online'||value.climate?.status==='heat'||base.charging.status==='charging'?'online':value.connectionState==='asleep'?'asleep':null;
 const status=access.rearTrunk==='open'?`Bagagerum åbent · ${locked?'Låst':'Ulåst'}`:base.charging.status==='charging'?'Lader':`${connectionState==='asleep'?'I dvale · ':''}${locked?'Låst':'Ulåst'}`;
 return {...base,status,access,connectionState,revision:Number.isSafeInteger(value.revision)?value.revision:1,locked,climate:{...base.climate,status:value.climate?.status==='heat'?'heat':'off',targetTemperatureC:Number.isInteger(value.climate?.targetTemperatureC)&&value.climate.targetTemperatureC>=16&&value.climate.targetTemperatureC<=30?value.climate.targetTemperatureC:21,defrost:value.climate?.status==='heat'&&value.climate?.defrost===true,seats:{driver:Number.isInteger(value.climate?.seats?.driver)&&value.climate.seats.driver>=0&&value.climate.seats.driver<=3?value.climate.seats.driver:0,passenger:Number.isInteger(value.climate?.seats?.passenger)&&value.climate.seats.passenger>=0&&value.climate.seats.passenger<=3?value.climate.seats.passenger:0}},charging:{...base.charging,limitPercent:Number.isInteger(value.charging?.limitPercent)&&value.charging.limitPercent>=50&&value.charging.limitPercent<=100?value.charging.limitPercent:80}};
}

// Explicit preview control state. Observed HA data never enters this reducer.
export function vehiclePreviewAction(value,event={}){
 const {action,value:amount,confirmed=false,revision,seat,temperatureC,seats}=event;
 if(value?.kind!=='vehicle'||value.mode!=='fixture'||value.controlsPreview!==true||!Number.isSafeInteger(revision)||revision<0||revision!==value.revision)return value;
 const model=vehicleModel(value);let patch;
 if(['climate','defrost','temperature','seat-heat','climate-settings'].includes(action)&&confirmed!==true)return value;
 // Seat heat levels remain selected settings; stopping cabin climate does not
 // assert an undocumented seat-heater side effect. Defrost requires cabin heat.
 if(action==='climate'){
  // New callers send explicit intent. The confirmed legacy toggle remains for
  // existing internal consumers; malformed explicit values never become toggles.
  const enabled=Object.hasOwn(event,'value')?amount:model.climate.status==='off';
  if(typeof enabled==='boolean'&&(enabled!==(model.climate.status==='heat')||model.climate.defrost))patch={climate:{...model.climate,status:enabled?'heat':'off',defrost:false}};
 }
 if(action==='defrost'&&typeof amount==='boolean'&&amount!==model.climate.defrost)patch={climate:{...model.climate,defrost:amount,status:amount?'heat':model.climate.status}};
 if(action==='seat-heat'&&['driver','passenger'].includes(seat)&&Number.isInteger(amount)&&amount>=0&&amount<=3&&amount!==model.climate.seats[seat]){
  const startsClimate=amount>0&&model.climate.status==='off';
  if(!startsClimate||confirmed===true)patch={climate:{...model.climate,status:startsClimate?'heat':model.climate.status,seats:{...model.climate.seats,[seat]:amount}}};
 }
 if(action==='temperature'&&Number.isInteger(amount)&&amount>=16&&amount<=30&&amount!==model.climate.targetTemperatureC)patch={climate:{...model.climate,targetTemperatureC:amount}};
 if(action==='climate-settings'&&Number.isInteger(temperatureC)&&temperatureC>=16&&temperatureC<=30&&seats&&typeof seats==='object'&&!Array.isArray(seats)&&Object.keys(seats).length===2&&Object.hasOwn(seats,'driver')&&Object.hasOwn(seats,'passenger')&&['driver','passenger'].every(key=>Number.isInteger(seats[key])&&seats[key]>=0&&seats[key]<=3)){
  const changed=temperatureC!==model.climate.targetTemperatureC||seats.driver!==model.climate.seats.driver||seats.passenger!==model.climate.seats.passenger;
  if(changed)patch={climate:{...model.climate,targetTemperatureC:temperatureC,seats:{driver:seats.driver,passenger:seats.passenger},status:seats.driver>0||seats.passenger>0?'heat':model.climate.status}};
 }
 if(action==='charge-limit'&&Number.isInteger(amount)&&amount>=50&&amount<=100)patch={charging:{...model.charging,limitPercent:amount}};
 if(action==='lock'&&typeof amount==='boolean'&&amount!==model.locked&&(amount===true||confirmed===true))patch={locked:amount};
 if(action==='rear-trunk'&&confirmed===true&&['open','closed'].includes(amount)&&amount!==model.access.rearTrunk)patch={access:{...model.access,rearTrunk:amount}};
 return patch?vehicleModel({...model,...patch,connectionState:'online',revision:model.revision+1}):value;
}

// A finite display acknowledgement of a new passive source observation, never
// simulated charging progress. Both existing vehicle surfaces use this predicate.
export function vehicleChargeUpdate(previous,model,{connected=false,scope='',sourceScope='',readGranted=false,visible=true,suppress=false}={}){
 const percent=model?.batteryPercent,status=model?.charging?.status,observedAt=model?.observedAt;
 const eligible=connected===true&&readGranted===true&&typeof scope==='string'&&scope.length>0&&scope===sourceScope&&visible===true&&isVehicleObservation(model)&&model.stale!==true&&Number.isFinite(observedAt)&&Number.isFinite(percent)&&percent>=0&&percent<=100;
 const sameScope=previous?.scope===scope,retain= sameScope&&Number.isFinite(previous?.observedAt)&&(!Number.isFinite(observedAt)||observedAt<=previous.observedAt);
 return {scope,eligible,observedAt:retain?previous.observedAt:observedAt,percent:retain?previous.percent:percent,status:retain?previous.status:status,cancel:!eligible||status!=='charging'||!sameScope,cue:!suppress&&eligible&&previous?.eligible===true&&sameScope&&observedAt>previous.observedAt&&status==='charging'&&(previous.status!=='charging'||percent!==previous.percent)};
}

// Ro reuses the existing passive resource tile. Retained charging is explicitly
// last-known; neither the tile nor its optional facts grants command authority.
export function vehicleRailPresentation(value,{live=true,connected=false,readGranted=false,scope='',sourceScope=''}={}){
 const observed=isVehicleObservation(value),local=live===false&&value?.kind==='vehicle'&&value.mode==='fixture'&&value.exampleOnly===true&&value.fixtureCase==='charging'&&scope==='local'&&sourceScope==='local';
 const bound=typeof scope==='string'&&scope.length>0&&scope===sourceScope;
 if(!bound||readGranted!==true||(!observed&&!local)||local&&connected!==true)return null;
 const model=vehicleModel(value);if(model.charging?.status!=='charging')return null;
 const stale=observed&&(model.stale===true||connected!==true),facts=[];
 if(Number.isFinite(model.charging.powerKw)&&model.charging.powerKw>=0)facts.push({id:'power',label:'Ladeeffekt',value:`${model.charging.powerKw.toLocaleString('da-DK')} kW`,stale});
 if(Number.isFinite(model.charging.endsAt)&&model.charging.endsAt>=0)facts.push({id:'ends',label:'Opladning færdig',value:new Date(model.charging.endsAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),stale});
 const battery=model.batteryPercent;
 return {id:'vehicle',target:'vehicle',kind:'vehicle',title:'Tesla',status:stale?'stale':'charging',resourceStatus:stale?'stale':'charging',detail:stale?'Sidst kendt opladning':'Lader',value:Number.isFinite(battery)&&battery>=0&&battery<=100?`${Math.round(battery)} %`:'',stale,observedAt:observed?model.observedAt:null,exampleOnly:local,facts,actions:[]};
}
