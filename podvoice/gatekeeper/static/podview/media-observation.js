import {spotifyArtwork,spotifyItemUrl} from './spotify-artwork.js';
// Account-owned provider observations. No room inference or mutation authority.
const txt=(v,n=1024)=>{if(typeof v!=='string'||!v.length||v.length>n)throw Error('invalid_media_text');return v;};
const timestamp=v=>{txt(v,64);if(!Number.isFinite(Date.parse(v)))throw Error('invalid_media_timestamp');return v;};
const item=v=>{if(v===null)return null;if(!['track','episode'].includes(v?.type)||!v.uri?.startsWith(`spotify:${v.type}:`)||!Array.isArray(v.artists)||v.artists.length>20)throw Error('invalid_media_item');return {type:v.type,uri:txt(v.uri),name:txt(v.name),artists:v.artists.map(x=>txt(x)),duration_ms:Number.isInteger(v.duration_ms)&&v.duration_ms>=0?v.duration_ms:null,artwork:spotifyArtwork(v.artwork),spotifyUrl:spotifyItemUrl(v.uri)};};
export function playbackObservation(v,account,previous){
 if(v?.ok!==true||v.schema!=='podconnect.playback.v1'||v.config_entry_id!==account||v.physical_result_verified!==false||!Number.isInteger(v.poll_sequence)||v.poll_sequence<1||v.observation?.status!=='fresh'||v.observation.source!=='spotify_web_api'||!Number.isFinite(v.observation.age_ms)||!Number.isFinite(v.observation.max_age_ms)||v.observation.max_age_ms<=0||v.observation.max_age_ms>15000||v.observation.age_ms<0||v.observation.age_ms>v.observation.max_age_ms)throw Error('unavailable_playback');
 const observedAt=timestamp(v.observation.observed_at),receivedAt=Date.now();if(Date.parse(observedAt)>receivedAt+5000)throw Error('future_playback');const expiresAt=Math.min(Date.parse(observedAt)+v.observation.max_age_ms,receivedAt+v.observation.max_age_ms-v.observation.age_ms);if(expiresAt<receivedAt)throw Error('expired_playback');
 const epoch=txt(v.owner_epoch,128);if(previous?.config_entry_id===account&&previous.owner_epoch===epoch&&previous.poll_sequence>v.poll_sequence)throw Error('stale_playback');
 const state=v.playback?.state;if(!['playing','paused','no_active_playback'].includes(state))throw Error('invalid_playback_state');
 if(state==='no_active_playback'&&(v.playback.item!==null||v.playback.target!==null))throw Error('contradictory_empty_playback');
 const target=v.playback.target;if(target!==null&&(target?.kind!=='spotify_device'||typeof target.target_id!=='string'||!target.target_id))throw Error('invalid_playback_target');
 return {config_entry_id:account,owner_epoch:epoch,poll_sequence:v.poll_sequence,observedAt,expiresAt,ageMs:v.observation.age_ms,maxAgeMs:v.observation.max_age_ms,receivedAt,state,progressMs:state!=='no_active_playback'&&Number.isSafeInteger(v.playback.progress_ms)&&v.playback.progress_ms>=0?v.playback.progress_ms:null,item:item(v.playback.item),target:target?{id:txt(target.target_id),name:target.name===null?null:txt(target.name)}:null};
}
export function queueObservation(v,account){
 if(v?.ok!==true||v.schema!=='podconnect.queue.v1'||v.config_entry_id!==account||v.scope!=='account'||v.relation_to_playback!=='not_atomic'||!Array.isArray(v.items)||v.items.length>20||v.returned_count!==v.items.length)throw Error('invalid_queue');
 const epoch=txt(v.owner_epoch,128),snapshot=txt(v.snapshot_id),seen=new Set();const items=v.items.map(row=>{const id=txt(row.option_id);if(seen.has(id)||!id.startsWith(snapshot+':'))throw Error('invalid_queue_occurrence');seen.add(id);return {id,...item(row)};});
 return {account,epoch,snapshot,observedAt:timestamp(v.observed_at),items,truncated:v.truncated===true};
}
export const observationFresh=p=>!!p&&!p.stale&&Date.now()<=p.expiresAt;

// A configuration descriptor is read scope, never a control/selection grant.
export function mediaRoomBinding(snapshot,account){
 const rows=snapshot?.mediaRoomBindings;if(!Array.isArray(rows)||rows.length>32)return null;
 const matches=rows.filter(row=>row?.accountId===account);if(matches.length!==1)return null;
 const row=matches[0];if(Object.keys(row).sort().join(',')!=='accountId,bindingId,nativeHomepodId,nativeRoomId,roomId,targetId'||row.roomId!==snapshot.roomId||!/^([a-f0-9]{64})$/.test(row.bindingId)||['accountId','targetId','nativeRoomId','nativeHomepodId','roomId'].some(key=>typeof row[key]!=='string'||!row[key]||row[key].length>1024))return null;
 return row;
}
const sameRoomBinding=(a,b)=>!!a&&!!b&&Object.keys(a).sort().join(',')==='accountId,bindingId,nativeHomepodId,nativeRoomId,roomId,targetId'&&Object.keys(b).sort().join(',')==='accountId,bindingId,nativeHomepodId,nativeRoomId,roomId,targetId'&&['accountId','targetId','nativeRoomId','nativeHomepodId','roomId','bindingId'].every(key=>a[key]===b[key]);
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const v2Scope=(p,s,account=p?.config_entry_id)=>!!([2,3].includes(p?.projectionVersion)&&p.config_entry_id===account&&p.bootId===s?.bootId&&p.roomId===s?.roomId&&s?.capabilities?.musicRead?.includes('playback'));
const actualBinding=(b,p)=>exact(b,['roomId','accountId','targetId','nativeRoomId','nativeHomepodId','bindingId','validUntil'])&&b.roomId===p.roomId&&b.accountId===p.config_entry_id&&b.targetId===p.target?.id&&['roomId','accountId','targetId','nativeRoomId','nativeHomepodId'].every(k=>typeof b[k]==='string'&&b[k].length>0&&b[k].length<=1024)&&/^[a-f0-9]{64}$/.test(b.bindingId)&&Number.isFinite(b.validUntil);
// Actual-output custody is separate from configured/default/NEXT destination.
export function playbackBinding(p,s,account=p?.config_entry_id){if([2,3].includes(p?.projectionVersion))return v2Scope(p,s,account)&&p.observationStatus==='observed'&&actualBinding(p.roomBinding,p)&&p.roomBinding.validUntil*1000>Date.now()?p.roomBinding:null;return roomObservationBound(p,s,account)?p.roomBinding:null;}
export function playbackObservationCurrent(p,s){return [2,3].includes(p?.projectionVersion)?v2Scope(p,s)&&['observed','account_observed','idle'].includes(p.observationStatus)&&observationFresh(p):roomObservationCurrent(p,s)||accountObservationBound(p,s)&&observationFresh(p);}
function roomPlaybackV2(body,account,snapshot,previous){
 if(!exact(body,['ok','schema','bootId','roomId','configEntryId','status','reason','binding','data'])||body.ok!==true||body.bootId!==snapshot?.bootId||body.roomId!==snapshot?.roomId||body.configEntryId!==account||!snapshot?.capabilities?.musicRead?.includes('playback'))throw Error('invalid_room_playback_v2');
 const base={projectionVersion:2,observationStatus:body.status,reason:body.reason,config_entry_id:account,bootId:body.bootId,roomId:body.roomId,roomBinding:null,roomBound:false,accountObserved:false,readOnly:true};
 if(body.status==='unavailable'){if(body.data!==null||body.binding!==null||!['account_unavailable','stale_observation','owner_changed'].includes(body.reason))throw Error('invalid_unavailable_playback');return {...base,state:'unavailable',item:null,target:null,expiresAt:0};}
 const data=body.data;
 if(!exact(data,['ok','schema','config_entry_id','owner_epoch','poll_sequence','observation','playback','physical_result_verified'])||!exact(data.observation,['status','source','observed_at','age_ms','max_age_ms']))throw Error('invalid_provider_playback');
 const idle=body.status==='idle',p=data.playback;
 if(!exact(p,idle?['state','target','item']:['state','target','item','progress_ms','provider_changed_at_ms','shuffle','repeat']))throw Error('invalid_provider_playback');
 if(!idle){if(p.target!==null&&!exact(p.target,['kind','target_id','name'])||p.item!==null&&!exact(p.item,['type','uri','name','artists','duration_ms',...(Object.hasOwn(p.item||{},'artwork')?['artwork']:[])])||!(p.shuffle===null||typeof p.shuffle==='boolean')||![null,'off','track','context'].includes(p.repeat)||['progress_ms','provider_changed_at_ms'].some(k=>p[k]!==null&&(!Number.isSafeInteger(p[k])||p[k]<0))||p.item!==null&&p.item.duration_ms!==null&&(!Number.isSafeInteger(p.item.duration_ms)||p.item.duration_ms<0))throw Error('invalid_provider_playback');}
 const observed=playbackObservation(data,account,previous),result={...observed,...base};if(observed.expiresAt<=Date.now())throw Error('expired_playback');
 if(idle){if(body.reason!==null||body.binding!==null||observed.state!=='no_active_playback')throw Error('invalid_idle_playback');return result;}
 if(!['playing','paused'].includes(observed.state)||observed.item!==null&&!spotifyItemUrl(observed.item.uri))throw Error('invalid_active_playback');
 if(body.status==='account_observed'){if(body.binding!==null||!['route_unavailable','ambiguous_output','output_not_admitted','owner_changed'].includes(body.reason))throw Error('invalid_account_playback');return {...result,accountObserved:true};}
 if(body.status!=='observed'||body.reason!==null||!actualBinding(body.binding,result)||body.binding.validUntil*1000<=Date.now())throw Error('invalid_actual_output');
 return {...result,roomBound:true,readOnly:false,roomBinding:{...body.binding}};
}
// v3 adds readonly facts/policy and optional correlated outcome, never an executable offer.
function roomPlaybackV3(body,account,snapshot,previous,receiptRequestId){
 if(!exact(body,['ok','schema','bootId','roomId','configEntryId','status','reason','binding','data','controls','permissions',...(receiptRequestId===null?[]:['settlement'])]))throw Error('invalid_room_playback_v3');
 const result=roomPlaybackV2({ok:body.ok,schema:'podview.room-playback.v2',bootId:body.bootId,roomId:body.roomId,configEntryId:body.configEntryId,status:body.status,reason:body.reason,binding:body.binding,data:body.data},account,snapshot,previous),controls=body.controls,permissions=body.permissions;
 const actions=value=>Array.isArray(value)&&value.length<=5&&new Set(value).size===value.length&&value.every(action=>['pause','resume','next','previous','volume'].includes(action));
 if(!exact(controls,['status','reason','binding_id','valid_until','supported_actions','volume'])||!exact(permissions,['actions','maxVolume'])||!actions(controls.supported_actions)||!actions(permissions.actions)||controls.supported_actions.length!==permissions.actions.length||controls.supported_actions.some((action,index)=>action!==permissions.actions[index]))throw Error('invalid_readonly_controls');
 if(result.roomBound&&body.binding.validUntil*1000>result.expiresAt||body.data&&!Number.isSafeInteger(body.data.poll_sequence))throw Error('renewed_readonly_controls');
 if(controls.status==='unavailable'){
  if(controls.reason!==(body.reason||'control_not_granted')||controls.binding_id!==null||controls.valid_until!==null||controls.supported_actions.length||controls.volume!==null||permissions.maxVolume!==null)throw Error('invalid_unavailable_controls');
 }else if(controls.status==='observed'){
  if(body.status!=='observed'||controls.binding_id!==result.roomBinding?.bindingId||!Number.isFinite(controls.valid_until)||controls.valid_until!==result.roomBinding.validUntil||controls.valid_until*1000<=Date.now()||controls.valid_until*1000>result.expiresAt)throw Error('foreign_readonly_controls');
  if(controls.reason==='volume_unavailable'){
   if(controls.volume!==null||controls.supported_actions.includes('volume'))throw Error('invalid_readonly_volume');
  }else if(controls.reason!==null||!exact(controls.volume,['base_percent','effective_percent'])||Object.values(controls.volume).some(value=>!Number.isInteger(value)||value<0||value>100))throw Error('invalid_readonly_volume');
  if(controls.supported_actions.includes('volume')? !Number.isInteger(permissions.maxVolume)||permissions.maxVolume<0||permissions.maxVolume>100:permissions.maxVolume!==null)throw Error('invalid_readonly_permissions');
 }else throw Error('invalid_readonly_controls');
 let settlement=null;
 if(receiptRequestId!==null&&body.settlement!==null){
  const value=body.settlement;
  if(!exact(value,['requestId','request_id','command_sequence','owner_epoch','status','effect'])||value.requestId!==receiptRequestId||controls.status!=='observed'||value.owner_epoch!==result.owner_epoch||!Number.isSafeInteger(value.command_sequence)||value.command_sequence<1||value.request_id!==`${value.owner_epoch}:${value.command_sequence}`||!['unknown','pending','rejected','superseded','confirmed'].includes(value.status))throw Error('invalid_playback_settlement');
  if(value.status==='confirmed'){
   if(!exact(value.effect,['source','effect_revision'])||value.effect.source!=='native_bound_state'||typeof value.effect.effect_revision!=='string'||!(/^[1-9][0-9]{0,19}$/).test(value.effect.effect_revision)||BigInt(value.effect.effect_revision)>=18446744073709551616n)throw Error('invalid_confirmed_effect');
  }else if(value.effect!==null)throw Error('unconfirmed_playback_effect');
  settlement={...value,effect:value.effect?{...value.effect}:null};
 }
 return {...result,projectionVersion:3,controls:{...controls,supported_actions:[...controls.supported_actions],volume:controls.volume?{...controls.volume}:null},permissions:{actions:[...permissions.actions],maxVolume:permissions.maxVolume},...(receiptRequestId===null?{}:{settlement})};
}
// Display custody only. Never use this predicate to admit a read, offer or action.
export function roomObservationBound(playback,snapshot,account=playback?.config_entry_id){if([2,3].includes(playback?.projectionVersion))return v2Scope(playback,snapshot,account)&&playback.observationStatus==='observed'&&actualBinding(playback.roomBinding,playback);return !!(playback?.roomBound===true&&playback.config_entry_id===account&&playback.bootId===snapshot?.bootId&&playback.roomId===snapshot?.roomId&&sameRoomBinding(playback.roomBinding,mediaRoomBinding(snapshot,account))&&playback.target?.id===playback.roomBinding.targetId);}
// Only the explicit server account_observed projection can hold this read scope.
// Configured native names bind custody; they are never a physical route proof.
export function accountObservationBound(playback,snapshot,account=playback?.config_entry_id){if([2,3].includes(playback?.projectionVersion))return v2Scope(playback,snapshot,account)&&playback.observationStatus==='account_observed'&&playback.accountObserved===true&&playback.roomBinding===null;return !!(snapshot?.capabilities?.musicRead?.includes('playback')===true&&playback?.accountObserved===true&&playback.readOnly===true&&playback.roomBound===false&&playback.config_entry_id===account&&playback.bootId===snapshot?.bootId&&playback.roomId===snapshot?.roomId&&sameRoomBinding(playback.roomBinding,mediaRoomBinding(snapshot,account))&&playback.target?.id===playback.roomBinding.targetId);}
const playbackReadable=snapshot=>!Array.isArray(snapshot?.capabilities?.musicRead)||snapshot.capabilities.musicRead.includes('playback');
export function roomObservationCurrent(playback,snapshot){return roomObservationBound(playback,snapshot)&&observationFresh(playback)&&(![2,3].includes(playback.projectionVersion)||!!playbackBinding(playback,snapshot));}
export function roomObservationDisplay(playback,snapshot,account=playback?.config_entry_id){if([2,3].includes(playback?.projectionVersion))return v2Scope(playback,snapshot,account)&&['observed','account_observed'].includes(playback.observationStatus)&&(observationFresh(playback)||playback.displayRetained===true);return playbackReadable(snapshot)&&(roomObservationBound(playback,snapshot,account)&&(observationFresh(playback)||playback.displayRetained===true)||accountObservationBound(playback,snapshot,account)&&observationFresh(playback));}
export function roomPlaybackObservation(body,account,snapshot,previous,{receiptRequestId=null}={}){
 if(receiptRequestId!==null&&(typeof receiptRequestId!=='string'||Array.from(receiptRequestId).length<1||Array.from(receiptRequestId).length>120||body?.schema!=='podview.room-playback.v3'))throw Error('invalid_playback_receipt_selector');
 if(body?.schema==='podview.room-playback.v3')return roomPlaybackV3(body,account,snapshot,previous,receiptRequestId);
 if(body?.schema==='podview.room-playback.v2')return roomPlaybackV2(body,account,snapshot,previous);
 if(body?.ok!==true||body.schema!=='podview.room-playback.v1'||Object.keys(body).sort().join(',')!=='binding,bootId,configEntryId,data,ok,roomId,schema,status'||body.bootId!==snapshot?.bootId||body.roomId!==snapshot?.roomId||body.configEntryId!==account)throw Error('invalid_room_playback');
 const bound=mediaRoomBinding(snapshot,account);
 if(body.status==='unavailable'){if(body.data!==null)throw Error('unredacted_room_playback');return null;}
 if(body.status==='account_observed'){
  const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),data=body.data;
  if(!sameRoomBinding(body.binding,bound)||!exact(data,['ok','schema','config_entry_id','owner_epoch','poll_sequence','observation','playback','physical_result_verified'])||!exact(data.observation,['status','source','observed_at','age_ms','max_age_ms'])||!exact(data.playback,['state','target','item','progress_ms','provider_changed_at_ms','shuffle','repeat'])||!exact(data.playback.target,['kind','target_id','name'])||!exact(data.playback.item,['type','uri','name','artists','duration_ms',...(Object.hasOwn(data.playback.item||{},'artwork')?['artwork']:[])]))throw Error('invalid_account_playback');
  if(!(data.playback.shuffle===null||typeof data.playback.shuffle==='boolean')||![null,'off','track','context'].includes(data.playback.repeat)||['progress_ms','provider_changed_at_ms'].some(key=>data.playback[key]!==null&&(!Number.isSafeInteger(data.playback[key])||data.playback[key]<0))||data.playback.item.duration_ms!==null&&(!Number.isSafeInteger(data.playback.item.duration_ms)||data.playback.item.duration_ms<0))throw Error('invalid_account_playback');
  const observed=playbackObservation(data,account,previous);
  if(!['playing','paused'].includes(observed.state)||!observed.item||!spotifyItemUrl(observed.item.uri)||observed.target?.id!==bound.targetId||observed.expiresAt<=Date.now())throw Error('unbound_account_playback');
  return {...observed,accountObserved:true,readOnly:true,roomBound:false,bootId:body.bootId,roomId:body.roomId,roomBinding:{...bound}};
 }
 if(body.status!=='observed'||!sameRoomBinding(body.binding,bound))throw Error('room_binding_changed');
 const observed=playbackObservation(body.data,account,previous),until=body.data?.room_proof_valid_until;
 if(!['playing','paused'].includes(observed.state)||observed.target?.id!==bound.targetId||!Number.isFinite(until)||until*1000<=Date.now())throw Error('unbound_room_playback');
 return {...observed,expiresAt:Math.min(observed.expiresAt,until*1000),roomBound:true,bootId:body.bootId,roomId:body.roomId,roomBinding:{...bound}};
}
