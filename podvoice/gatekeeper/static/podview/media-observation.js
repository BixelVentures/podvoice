// Account-owned provider observations. No room inference or mutation authority.
const txt=(v,n=1024)=>{if(typeof v!=='string'||!v.length||v.length>n)throw Error('invalid_media_text');return v;};
const timestamp=v=>{txt(v,64);if(!Number.isFinite(Date.parse(v)))throw Error('invalid_media_timestamp');return v;};
const item=v=>{if(v===null)return null;if(!['track','episode'].includes(v?.type)||!v.uri?.startsWith(`spotify:${v.type}:`)||!Array.isArray(v.artists)||v.artists.length>20)throw Error('invalid_media_item');return {type:v.type,uri:txt(v.uri),name:txt(v.name),artists:v.artists.map(x=>txt(x)),duration_ms:Number.isInteger(v.duration_ms)&&v.duration_ms>=0?v.duration_ms:null};};
export function playbackObservation(v,account,previous){
 if(v?.ok!==true||v.schema!=='podconnect.playback.v1'||v.config_entry_id!==account||v.physical_result_verified!==false||!Number.isInteger(v.poll_sequence)||v.poll_sequence<1||v.observation?.status!=='fresh'||v.observation.source!=='spotify_web_api'||!Number.isFinite(v.observation.age_ms)||!Number.isFinite(v.observation.max_age_ms)||v.observation.max_age_ms<=0||v.observation.max_age_ms>15000||v.observation.age_ms<0||v.observation.age_ms>v.observation.max_age_ms)throw Error('unavailable_playback');
 const observedAt=timestamp(v.observation.observed_at),receivedAt=Date.now();if(Date.parse(observedAt)>receivedAt+5000)throw Error('future_playback');const expiresAt=Math.min(Date.parse(observedAt)+v.observation.max_age_ms,receivedAt+v.observation.max_age_ms-v.observation.age_ms);if(expiresAt<receivedAt)throw Error('expired_playback');
 const epoch=txt(v.owner_epoch,128);if(previous?.config_entry_id===account&&previous.owner_epoch===epoch&&previous.poll_sequence>v.poll_sequence)throw Error('stale_playback');
 const state=v.playback?.state;if(!['playing','paused','no_active_playback'].includes(state))throw Error('invalid_playback_state');
 if(state==='no_active_playback'&&(v.playback.item!==null||v.playback.target!==null))throw Error('contradictory_empty_playback');
 const target=v.playback.target;if(target!==null&&(target?.kind!=='spotify_device'||typeof target.target_id!=='string'||!target.target_id))throw Error('invalid_playback_target');
 return {config_entry_id:account,owner_epoch:epoch,poll_sequence:v.poll_sequence,observedAt,expiresAt,ageMs:v.observation.age_ms,maxAgeMs:v.observation.max_age_ms,receivedAt,state,item:item(v.playback.item),target:target?{id:txt(target.target_id),name:target.name===null?null:txt(target.name)}:null};
}
export function queueObservation(v,account){
 if(v?.ok!==true||v.schema!=='podconnect.queue.v1'||v.config_entry_id!==account||v.scope!=='account'||v.relation_to_playback!=='not_atomic'||!Array.isArray(v.items)||v.items.length>20||v.returned_count!==v.items.length)throw Error('invalid_queue');
 const epoch=txt(v.owner_epoch,128),snapshot=txt(v.snapshot_id),seen=new Set();const items=v.items.map(row=>{const id=txt(row.option_id);if(seen.has(id)||!id.startsWith(snapshot+':'))throw Error('invalid_queue_occurrence');seen.add(id);return {id,...item(row)};});
 return {account,epoch,snapshot,observedAt:timestamp(v.observed_at),items,truncated:v.truncated===true};
}
export const observationFresh=p=>!!p&&!p.stale&&Date.now()<=p.expiresAt;
