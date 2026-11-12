import {roomObservationDisplay} from './media-observation.js';
import {renderPlayerControls} from './player-view.js';

// The player's buttons: each tap is one direct call to the room's media_player (via PodVoice).
// A tap shows its effect at once, waits its turn behind a running call (never a locked button),
// and the next room read shows what really happened. Last command wins; nothing is retried.
const OPTIMISTIC_MS=6000;
const FAILED={
 rejected:'Højttaleren afviste handlingen. Prøv igen.',
 unknown:'Højttaleren svarede ikke. Tjek afspilleren, før du prøver igen.',
};

export class RoomPlayerControls{
 constructor(host){
  this.host=host;this.queue=[];this.running=null;this.desired=null;this.status='';
 }
 playback(){
  const media=this.host.liveMedia,p=media?.playback;
  return roomObservationDisplay(p,this.host.liveSnapshot,media?.account)?p:null;
 }
 scope(p=this.playback()){
  return p?JSON.stringify([p.bootId,p.roomId,p.config_entry_id,this.host.liveTransport?.generation??null]):null;
 }
 can(action,p=this.playback()){
  return !!p&&this.host.liveTransport?.connected===true&&p.controls.actions.includes(action);
 }
 wish(p=this.playback()){
  const d=this.desired;
  return d&&d.scope===this.scope(p)?d:null;
 }
 busy(){return !!this.running||this.queue.length>0;}
 optimisticPlaying(observed){
  const d=this.wish();
  return d&&typeof d.playing==='boolean'?d.playing:observed;
 }
 volume(p=this.playback()){
  const d=this.wish(p);
  return Number.isInteger(d?.volume)?d.volume:p?.volume??null;
 }
 seekState(trackUri){
  const p=this.playback();
  if(!this.can('seek',p)||!trackUri||p.item?.uri!==trackUri||!Number.isSafeInteger(p.item.duration_ms))return null;
  const d=this.wish(p),transport=this.host.liveTransport;
  return {
   witness:{key:JSON.stringify([this.scope(p),trackUri]),transport,trackUri,durationMs:p.item.duration_ms},
   positionMs:d?.seek?.uri===trackUri?d.seek.positionMs:null,
  };
 }
 // One tap. Returns a promise of whether HA accepted it.
 intent(action,input={}){
  const p=this.playback(),scope=this.scope(p),toggle=action==='pause'||action==='resume';
  if(!p||!(this.can(action,p)||toggle&&(this.can('pause',p)||this.can('resume',p))))return Promise.resolve(false);
  let value;
  if(action==='volume'){
   value=Math.round(Number(input.percent));
   if(!Number.isInteger(value)||value<0)return Promise.resolve(false);
   value=Math.min(value,p.controls.maxVolume??0);
  }
  if(action==='seek'){
   value=input.positionMs;
   if(!Number.isSafeInteger(value)||value<0||input.witness?.trackUri&&input.witness.trackUri!==p.item?.uri)
    return Promise.resolve(false);
  }
  const wish={...(this.wish(p)||{}),scope,at:Date.now()};
  if(toggle)wish.playing=action==='resume';
  if(action==='volume')wish.volume=value;
  if(action==='seek')wish.seek={uri:p.item?.uri,positionMs:value};
  if(action==='next'||action==='previous')delete wish.seek;
  this.desired=wish;this.status='';this.failed=null;
  // An absolute value replaces the one still waiting; every toggle/skip tap is its own action.
  if(action==='volume'||action==='seek')this.queue=this.queue.filter(row=>row.action!==action);
  let done;const promise=new Promise(resolve=>done=resolve);
  this.queue.push({action,value,scope,account:p.config_entry_id,done});
  this.host.liveTransport?.recordDiagnostic?.('control_intent',{domain:'music',action,code:'queued'});
  this.render();this.host.liveMedia?.render?.();
  void this.drain();
  return promise;
 }
 async drain(){
  if(this.running)return;
  while(this.queue.length){
   const row=this.queue.shift();
   if(row.scope!==this.scope()){row.done(false);continue;}
   this.running=row;this.render();
   let result;
   try{result=await this.host.liveTransport.playerAction(row.account,row.action,row.value);}
   catch{result={outcome:'unknown'};}
   this.running=null;
   row.done(result.outcome==='accepted');
   if(result.outcome!=='accepted'){
    // An honest outcome, never an automatic retry. Waiting taps were meant for the state before.
    for(const waiting of this.queue)waiting.done(false);
    this.queue=[];this.desired=null;this.status=FAILED[result.outcome]||FAILED.unknown;
    this.failed={at:Date.now(),uri:this.playback()?.item?.uri??null,state:this.playback()?.state};
    this.host.showFeedback?.(this.status,false,{source:'music-intent'});
   }
  }
  this.render();this.host.liveMedia?.render?.();
  void this.host.liveMedia?.refresh?.({immediate:true})?.catch?.(()=>{});
 }
 // A fresh room read: the optimistic wish yields once the room shows it, or after a short while.
 observe(next){
  // The failure note stays until the room moves on (another song or state) or a short while passes.
  const f=this.failed;
  if(f&&(next.item?.uri!==f.uri||next.state!==f.state||Date.now()-f.at>OPTIMISTIC_MS)){
   this.failed=null;this.status='';
  }
  const d=this.desired;
  if(!d||this.busy())return;
  const reached=(typeof d.playing!=='boolean'||(next.state==='playing')===d.playing)
   &&(!Number.isInteger(d.volume)||next.volume===d.volume)&&!d.seek;
  if(reached||Date.now()-d.at>OPTIMISTIC_MS)this.desired=null;
 }
 invalidate(){
  for(const row of this.queue)row.done(false);
  this.queue=[];this.desired=null;this.status='';
 }
 render(){
  const p=this.playback(),playing=!!p&&this.optimisticPlaying(p.state==='playing');
  const toggle=playing?'pause':'resume',has=action=>this.can(action,p);
  const volume=this.volume(p),canVolume=has('volume')&&Number.isInteger(volume);
  renderPlayerControls(this.host,{
   playing,previous:has('previous'),next:has('next'),toggle:has(toggle),
   blocked:!p,volumeBlocked:!p,volume,canVolume,min:0,max:p?.controls.maxVolume??100,
   gesture:this.host.liveControls?.musicVolumeGesture,
  });
  // A running call shows on its button; the buttons stay usable and further taps queue.
  const active=this.running?.action??null;
  for(const [id,action]of [['play-pause',toggle],['detail-toggle',toggle],['previous','previous'],
   ['detail-previous','previous'],['next','next'],['detail-next','next']]){
   const node=document.getElementById(id);
   const busy=active===action||(id.endsWith('toggle')||id==='play-pause')&&['pause','resume'].includes(active);
   if(node&&node.getAttribute('aria-busy')!==String(busy))node.setAttribute('aria-busy',String(busy));
  }
  return {transport:has('pause')||has('resume')||has('next')||has('previous'),canVolume};
 }
}
