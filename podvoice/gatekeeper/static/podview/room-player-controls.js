import {roomObservationDisplay} from './media-observation.js';
import {renderPlayerControls} from './player-view.js';

// The player's buttons: each tap is one direct call to the room's media_player (via PodVoice).
// A tap shows its effect at once, waits its turn behind a running call (never a locked button),
// and the next room read shows what really happened. Last command wins; nothing is retried.
const OPTIMISTIC_MS=6000,MOVE_MS=15000;
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
  // A room that could not be read is shown as last known, never controlled.
  return !!p&&p.stale!==true&&this.host.liveTransport?.connected===true&&p.controls.actions.includes(action);
 }
 wish(p=this.playback()){
  const d=this.desired;
  return d&&d.scope===this.scope(p)?d:null;
 }
 busy(){return !!this.running||this.queue.length>0;}
 // "Flyt til <rum>" was tapped and the room does not play it yet.
 moving(){return this.wish()?.moving===true;}
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
  if(action==='move_here')wish.moving=true;
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
   if(result.outcome==='accepted')(this.observing??=[]).push(row.action);
   if(result.outcome!=='accepted'){
    // An honest outcome, never an automatic retry. Waiting taps were meant for the state before.
    for(const waiting of this.queue)waiting.done(false);
    // No text stays in the player or queue. The next room read decides: if the room shows what
    // the user wished (the pause did happen), nothing is shown; otherwise one short toast.
    this.queue=[];
    this.failed={at:Date.now(),wish:this.desired,action:row.action,message:FAILED[result.outcome]||FAILED.unknown};
    this.desired=null;
   }
  }
  this.render();this.host.liveMedia?.render?.();
  void this.host.liveMedia?.refresh?.({immediate:true})?.catch?.(()=>{});
 }
 // A fresh room read: the optimistic wish yields once the room shows it, or after a short while.
 observe(next){
  // A refused tap whose effect the room shows anyway (Speakers may report a pause as failed) is
  // silent. Only an effect that did not happen gives one short toast; nothing stays on screen.
  const f=this.failed;
  if(f){
   this.failed=null;
   const happened=typeof f.wish?.playing==='boolean'?(next.state==='playing')===f.wish.playing
    :Number.isInteger(f.wish?.volume)?next.volume===f.wish.volume:false;
   if(!happened&&Date.now()-f.at<=OPTIMISTIC_MS){
    this.host.showFeedback?.('',false,{source:'music-toast'});
    this.host.showFeedback?.(f.message,false,{source:'music-toast'});
   }
  }
  // The first room read after accepted calls is their observed effect (diagnostics only).
  if(!this.busy()&&this.observing?.length){
   for(const action of this.observing)
    this.host.liveTransport?.recordDiagnostic?.('playback_confirmation',{domain:'music',action,code:'confirmed'});
   this.observing=[];
  }
  const d=this.desired;
  // A move is shown until the room plays (or a short while passes); then the room player decides.
  if(!d||this.busy())return;
  // A seek is reached when the room reports the same song near the chosen position (no hop back).
  const seekReached=!d.seek||next.item?.uri===d.seek.uri&&Number.isSafeInteger(next.progressMs)
   &&next.progressMs>=d.seek.positionMs-1000&&next.progressMs<=d.seek.positionMs+4000;
  const reached=(!d.moving||next.elsewhere!==true)
   &&(typeof d.playing!=='boolean'||(next.state==='playing')===d.playing)
   &&(!Number.isInteger(d.volume)||next.volume===d.volume)&&seekReached;
  if(reached||Date.now()-d.at>(d.moving?MOVE_MS:OPTIMISTIC_MS))this.desired=null;
 }
 invalidate(){
  for(const row of this.queue)row.done(false);
  this.queue=[];this.desired=null;this.status='';this.observing=[];
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
  const transportBusy=String(!!active&&!['volume','seek'].includes(active));
  for(const selector of ['.player .transport','#music-detail .transport']){
   const node=this.host.querySelector?.(selector)||document.querySelector?.(selector);
   if(node&&node.getAttribute('aria-busy')!==transportBusy)node.setAttribute('aria-busy',transportBusy);
  }
  for(const id of ['volume','detail-volume']){
   const node=document.getElementById(id),busy=String(active==='volume');
   if(node&&node.getAttribute('aria-busy')!==busy)node.setAttribute('aria-busy',busy);
  }
  return {transport:has('pause')||has('resume')||has('next')||has('previous'),canVolume};
 }
}
