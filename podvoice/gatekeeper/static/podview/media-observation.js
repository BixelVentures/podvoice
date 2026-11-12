import {spotifyArtwork,spotifyItemUrl} from './spotify-artwork.js';
// Account-owned provider observations. No room inference or mutation authority.
const txt=(v,n=1024)=>{if(typeof v!=='string'||!v.length||v.length>n)throw Error('invalid_media_text');return v;};
const timestamp=v=>{txt(v,64);if(!Number.isFinite(Date.parse(v)))throw Error('invalid_media_timestamp');return v;};
const item=v=>{if(v===null)return null;if(!['track','episode'].includes(v?.type)||!v.uri?.startsWith(`spotify:${v.type}:`)||!Array.isArray(v.artists)||v.artists.length>20)throw Error('invalid_media_item');return {type:v.type,uri:txt(v.uri),name:txt(v.name),artists:v.artists.map(x=>txt(x)),duration_ms:Number.isInteger(v.duration_ms)&&v.duration_ms>=0?v.duration_ms:null,artwork:spotifyArtwork(v.artwork),spotifyUrl:spotifyItemUrl(v.uri)};};
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
 const row=matches[0];
 if(Object.keys(row).sort().join(',')!=='accountId,bindingId,nativeHomepodId,nativeRoomId,roomId,targetId'
  ||row.roomId!==snapshot.roomId||!/^([a-f0-9]{64})$/.test(row.bindingId)
  ||['targetId','nativeRoomId','nativeHomepodId'].some(key=>typeof row[key]!=='string'||!row[key]||row[key].length>1024))
  return null;
 return row;
}

// The room player (podview.room-player.v1) is the PodConnect room's own HA media_player.
// It is one state model: whatever started the music, this is what the room plays.
const PLAYER_STATES=['playing','paused','buffering','idle','unavailable'];
const PLAYER_ACTIONS=['pause','resume','next','previous','seek','volume'];
const PLAYER_FRESH_MS=30000;
const optionalText=(value,n=512)=>value===null?null:txt(value,n);
const optionalCount=value=>value===null||Number.isSafeInteger(value)&&value>=0?value:(()=>{
 throw Error('invalid_player_number');
})();
const sessionBinding=(value,snapshot,account)=>!!value&&typeof value==='object'
 &&value.roomId===snapshot?.roomId&&value.accountId===account&&/^[a-f0-9]{64}$/.test(value.bindingId||'')
 &&['targetId','nativeRoomId','nativeHomepodId'].every(key=>typeof value[key]==='string'&&value[key])
 &&Number.isFinite(value.validUntil);
export function roomPlayerObservation(body,account,snapshot){
 if(body?.ok!==true||body.schema!=='podview.room-player.v1'||body.bootId!==snapshot?.bootId
  ||body.roomId!==snapshot?.roomId||body.configEntryId!==account)throw Error('invalid_room_player');
 if(!PLAYER_STATES.includes(body.state)||![null,'spotify','radio'].includes(body.source))
  throw Error('invalid_playback_state');
 const actions=Array.isArray(body.actions)&&body.actions.length<=PLAYER_ACTIONS.length
  &&body.actions.every(action=>PLAYER_ACTIONS.includes(action))?[...new Set(body.actions)]:null;
 if(!actions)throw Error('invalid_player_actions');
 const maxVolume=actions.includes('volume')?body.maxVolume:null;
 if(maxVolume!==null&&!(Number.isInteger(maxVolume)&&maxVolume>=0&&maxVolume<=100))
  throw Error('invalid_player_actions');
 const volume=optionalCount(body.volumePercent),durationMs=optionalCount(body.durationMs);
 const progressMs=optionalCount(body.positionMs),positionAt=optionalCount(body.positionAt);
 const uri=body.uri===undefined||body.uri===null?null:txt(body.uri,256);
 const artworkUrl=typeof body.artworkUrl==='string'&&/^music\/player\/artwork\?[A-Za-z0-9_.~%=&-]{1,1500}$/
  .test(body.artworkUrl)?body.artworkUrl:null;
 const receivedAt=Date.now(),active=['playing','paused','buffering'].includes(body.state);
 const title=optionalText(body.title),artist=optionalText(body.artist),album=optionalText(body.album);
 const session=body.session&&typeof body.session==='object'?body.session:null;
 const binding=session&&sessionBinding(session.binding,snapshot,account)?{...session.binding}:null;
 // The position anchor is HA's own update time; a clock a little ahead is clamped to now.
 const observedAt=new Date(Math.min(receivedAt,positionAt??receivedAt)).toISOString();
 return {
  projectionVersion:4,config_entry_id:account,bootId:body.bootId,roomId:body.roomId,state:body.state,
  source:body.source,observedAt,receivedAt,expiresAt:receivedAt+PLAYER_FRESH_MS,
  item:active?{type:'track',uri,name:title||(body.source==='radio'?'Radio':''),
   artists:artist?[artist]:[],album,duration_ms:durationMs,artworkUrl}:null,
  progressMs:active?progressMs:null,volume,controls:{actions,maxVolume},
  owner_epoch:binding&&typeof session.ownerEpoch==='string'?session.ownerEpoch:null,
  poll_sequence:binding&&Number.isSafeInteger(session.pollSequence)?session.pollSequence:null,
  target:binding&&typeof session.targetId==='string'
   ?{id:session.targetId,name:typeof session.targetName==='string'?session.targetName:''}:null,
  roomBinding:binding,roomBound:true,
 };
}
// Read access is checked where reads happen (LiveMediaView clears the player when it is revoked).
const playerScope=(p,s,account=p?.config_entry_id)=>p?.projectionVersion===4&&p.config_entry_id===account
 &&p.bootId===s?.bootId&&p.roomId===s?.roomId;
// Something is (or was just) playing in this room: show the player.
export function roomObservationDisplay(playback,snapshot,account=playback?.config_entry_id){
 return playerScope(playback,snapshot,account)&&['playing','paused','buffering'].includes(playback.state)
  &&(observationFresh(playback)||playback.displayRetained===true||playback.stale==='transient');
}
// The room entity is the room: an active player read is always bound to it (fresh or not).
export function roomObservationBound(playback,snapshot,account=playback?.config_entry_id){
 return playerScope(playback,snapshot,account)&&['playing','paused','buffering'].includes(playback.state);
}
export function playbackObservationCurrent(playback,snapshot){
 return roomObservationDisplay(playback,snapshot)&&observationFresh(playback);
}
// Current enough to act on. One transient failed read keeps the last known player usable.
export function roomObservationCurrent(playback,snapshot){
 return roomObservationDisplay(playback,snapshot)
  &&(observationFresh(playback)||playback.stale==='transient'&&Date.now()<=playback.expiresAt);
}
// PodConnect's account session in this room. Only the queue and speaker moves use it.
export function playbackBinding(playback,snapshot,account=playback?.config_entry_id){
 const b=playback?.roomBinding;
 return roomObservationDisplay(playback,snapshot,account)&&b&&b.validUntil*1000>Date.now()?b:null;
}

// The music lane admits one action at a time. A queue, Find musik or speaker choice made while
// another music action runs waits here for its turn (K3, F2, A9, H1). Only the latest choice
// waits: an earlier one resolves 'replaced'. When the running action ends UNKNOWN the waiting
// choice resolves 'unknown' and is not sent; otherwise it resolves 'free' and checks again.
export function waitForMusicLane(controls, busy = !!controls?.musicIntentPending) {
 if (!busy) return Promise.resolve('free');
 controls.musicLaneWaiter?.('replaced');
 return new Promise(resolve => { controls.musicLaneWaiter = resolve; });
}
export function releaseMusicLane(controls, turn) {
 const waiter = controls.musicLaneWaiter;
 controls.musicLaneWaiter = null;
 waiter?.(turn);
}
