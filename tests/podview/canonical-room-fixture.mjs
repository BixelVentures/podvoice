// Synthetic room authority for adapter tests only; production must receive server proof.
export function bindRoom(snapshot,account='account',target='device'){const binding={roomId:snapshot.roomId,accountId:account,targetId:target,nativeRoomId:'r0',nativeHomepodId:'fixture-homepod',bindingId:'a'.repeat(64)};snapshot.mediaRoomBindings=[binding];return binding;}
// A room player observation (projectionVersion 4) with PodConnect's account session for queue/move.
export function boundPlayback(snapshot,playback,account='account',target='device'){
 const binding=bindRoom(snapshot,account,target);
 return {state:'playing',controls:{actions:[],maxVolume:null},volume:null,observedAt:new Date().toISOString(),
  expiresAt:Date.now()+15000,...playback,projectionVersion:4,config_entry_id:account,roomBound:true,
  bootId:snapshot.bootId,roomId:snapshot.roomId,roomBinding:{...binding,validUntil:Date.now()/1000+15},
  target:{...playback.target,id:target}};
}
export function targetEnvelope(snapshot,body,account='account',target='device'){return {...body,bootId:snapshot.bootId,roomId:snapshot.roomId,roomBinding:bindRoom(snapshot,account,target)};}
