// Test/preview fixtures only: the existing authored playback scenes, sent in the room player's wire
// shape (podview.room-player.v1). The account session becomes the player's `session` (queue/move).
export function roomPlayerWire(body){
 if(body?.schema==='podview.room-player.v1'||body?.ok!==true)return body;
 const data=body.data,p=data?.playback,item=p?.item;
 const state=body.status==='unavailable'?'unavailable':!p||p.state==='no_active_playback'?'idle':p.state;
 const active=['playing','paused','buffering'].includes(state);
 const until=body.binding?.validUntil??data?.room_proof_valid_until??Date.now()/1000+30;
 const binding=body.binding&&active?{...body.binding,validUntil:until}:null;
 const observedAt=Date.parse(data?.observation?.observed_at);
 return {
  ok:true,schema:'podview.room-player.v1',bootId:body.bootId,roomId:body.roomId,configEntryId:body.configEntryId,
  state,source:active?'spotify':null,title:active?item?.name??null:null,
  artist:active&&item?.artists?.length?item.artists.join(', '):null,album:null,uri:active?item?.uri??null:null,
  artworkUrl:null,positionMs:active&&Number.isSafeInteger(p?.progress_ms)?p.progress_ms:null,
  positionAt:active&&Number.isFinite(observedAt)?observedAt:null,
  durationMs:active&&Number.isSafeInteger(item?.duration_ms)?item.duration_ms:null,
  volumePercent:body.controls?.volume?.base_percent??null,
  actions:active?body.permissions?.actions??[]:[],maxVolume:active?body.permissions?.maxVolume??null:null,
  session:binding?{binding,ownerEpoch:data.owner_epoch,pollSequence:data.poll_sequence,
   targetId:p?.target?.target_id??null,targetName:p?.target?.name??null}:null,
 };
}
