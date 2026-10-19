import {LiveQueueView} from './live-queue-view.js';
import {roomPlaybackObservation,roomObservationBound,roomObservationCurrent,roomObservationDisplay} from './media-observation.js';
import {livePlayerModel,liveQueueModel} from './player-view.js';
const $=id=>document.getElementById(id);
// A transient source read may retain the exact-bound display, never controls.
// Explicit denials, unavailable envelopes and invalid ownership still clear it.
export class LiveMediaView{
 constructor(host){this.host=host;this.queueControls=new LiveQueueView(host);this.generation=0;this.rows=new Map();this.account=null;this.lastRead=0;this.pending=false;this.queuePending=false;this.accounts=document.createElement('pv-choice-list');this.accounts.hidden=true;this.accounts.data={items:[],selected:null,stateText:''};this.accounts.setAttribute('aria-label','Musikkonto');this.accounts.addEventListener('pv-action',event=>{if(event.target!==this.accounts||event.detail?.action_id!=='choose')return;event.stopPropagation();this.selectAccount(event.detail.option_id);});$('music-response').prepend(this.accounts);}

 setAccount(account){if(this.account===account)return;this.account=account;this.host.liveMusicAccountChanged?.(account);this.accounts.data={...this.accounts.data,selected:account};}
 selectAccount(account){const choices=this.accounts.data?.items||[];if(!choices.some(b=>b.id===account)||this.account===account)return;this.invalidate(true,true);this.setAccount(account);this.refresh();}
 invalidate(revoke=false,preserveChoices=false){if(this.host.liveTransport?.recoveryBlocked===true)revoke=true;if(this.playback&&!roomObservationBound(this.playback,this.host.liveSnapshot,this.account))revoke=true;this.queueControls.invalidate(revoke);this.generation++;this.readState='offline';this.lastRead=0;this.pending=false;if(this.playback)this.playback={...this.playback,stale:true,displayRetained:!revoke};if(revoke){this.establishedReadScope=null;this.playback=null;this.queue=null;this.queueError=false;this.setAccount(null);if(!preserveChoices){this.accounts.data={items:[],selected:null,stateText:''};this.accounts.hidden=true;}$('queue').replaceChildren();this.rows.clear();}this.queuePending=false;if(this.queue)this.queue={...this.queue,stale:true};this.render();}
 clearRoom(){this.establishedReadScope=null;this.generation++;this.pending=false;this.playback=null;this.queue=null;this.queuePending=false;this.queueError=false;this.rows.clear();this.queueControls.invalidate(true);this.host.liveControls?.invalidateMusic(undefined,false);}
 async refresh(){
  this.host.liveOutputs?.refreshConfiguredLabel();
  const host=this.host,snap=host.liveSnapshot,allowed=snap?.capabilities.musicRead||[],bindingScope=JSON.stringify([snap?.bootId,snap?.roomId,snap?.mediaRoomBindings]),readScope=JSON.stringify([bindingScope,this.account]);if(this.bindingScope!==undefined&&this.bindingScope!==bindingScope){this.clearRoom();this.lastRead=0;}this.bindingScope=bindingScope;if(this.playback&&!roomObservationBound(this.playback,snap,this.account))this.clearRoom();if(!allowed.includes('playback')){this.establishedReadScope=null;if(this.playback||this.account)this.invalidate(true);return;}if(this.pending||Date.now()-this.lastRead<(this.refreshInterval||8000))return;if(this.playback&&!roomObservationCurrent(this.playback,snap)){this.playback={...this.playback,displayRetained:true};this.queueControls.invalidate(false);}this.pending=true;this.refreshInterval=8000;if(!this.playback&&this.establishedReadScope!==readScope)this.readState='loading';this.render();this.lastRead=Date.now();const generation=this.generation,boot=snap.bootId,room=snap.roomId,capabilities=JSON.stringify(allowed);let playbackResponse=false;
  const current=()=>host.isConnected&&host.liveTransport.connected&&generation===this.generation&&host.liveSnapshot.bootId===boot&&host.liveSnapshot.roomId===room&&host.liveSnapshot.capabilities.musicRead.includes('playback')&&JSON.stringify(host.liveSnapshot.capabilities.musicRead)===capabilities&&JSON.stringify([host.liveSnapshot.bootId,host.liveSnapshot.roomId,host.liveSnapshot.mediaRoomBindings])===bindingScope;
  try{
   if(!this.account){if(!allowed.includes('targets')){this.readState='unavailable';return;}const response=await host.liveTransport.music('targets');if(!current())return;const raw=response.ok===true?response.data?.accounts:null;if(!Array.isArray(raw)||raw.length>64)throw Error('invalid_accounts');if(!raw.length){this.readState='unavailable';return;}const seen=new Set(),options=raw.filter(row=>{if(typeof row?.config_entry_id!=='string'||!row.config_entry_id||row.config_entry_id.length>128||seen.has(row.config_entry_id)||typeof row.title!=='string'||!row.title||row.title.length>256)return false;seen.add(row.config_entry_id);return true;});if(!options.length)throw Error('invalid_accounts');this.accounts.data={items:options.map(row=>({id:row.config_entry_id,label:row.title})),selected:this.account,stateText:''};this.accounts.hidden=options.length===1;if(options.length!==1){this.readState='account-selection';return;}this.setAccount(options[0].config_entry_id);this.host.liveOutputs?.refreshConfiguredLabel();}
   const account=this.account,response=await host.liveTransport.music('playback',account);if(!current()||this.account!==account)return;playbackResponse=true;if(response.ok!==true)throw Error('unavailable_playback');const next=roomPlaybackObservation(response,account,host.liveSnapshot,this.playback);if(!next){this.clearRoom();this.establishedReadScope=JSON.stringify([bindingScope,this.account]);this.readState='unavailable';this.render();return;}if(this.playback&&next.owner_epoch!==this.playback.owner_epoch){this.queue=null;this.queueControls.invalidate(true);$('queue').replaceChildren();this.rows.clear();this.host.liveMusicAccountChanged?.(account);}this.playback=next;this.refreshInterval=Math.max(1000,Math.min(8000,Math.floor((next.expiresAt-Date.now())/2)));this.readState='ready';host.liveSelection?.observePlayback?.(next);this.render();
  }catch(error){if(current()){if(!playbackResponse&&(error?.code==='read_transient'||error instanceof TypeError||['AbortError','TimeoutError'].includes(error?.name))&&roomObservationBound(this.playback,this.host.liveSnapshot,this.account)){this.playback={...this.playback,stale:true,displayRetained:true};this.queueControls.invalidate(false);}else this.clearRoom();this.establishedReadScope=JSON.stringify([bindingScope,this.account]);this.readState='error';this.render();}}finally{if(generation===this.generation){this.pending=false;if(this.readState==='loading')this.readState='unavailable';this.establishedReadScope=JSON.stringify([bindingScope,this.account]);if(this.host.isConnected)this.render();}}
 }
 async loadQueue(){
  if(!roomObservationCurrent(this.playback,this.host.liveSnapshot)||!this.host.liveTransport?.connected){this.queueControls.invalidate(!roomObservationDisplay(this.playback,this.host.liveSnapshot,this.account));this.renderQueue();return;}
  await this.queueControls.load(this.account,this.playback);
 }

 renderQueue(){
  const snapshot=this.host.liveSnapshot,read=snapshot?.capabilities?.musicRead||[];
  if(this.playback&&!read.includes('playback'))this.clearRoom();
  if(!read.includes('queue')||!roomObservationDisplay(this.playback,snapshot,this.account)){
   if(this.queueControls.retained||this.queueControls.offer||this.queueControls.pending)this.queueControls.invalidate(true);
   this.host.playerView.renderQueue([],{status:'unavailable',empty:!read.includes('queue')?'Køen er ikke tilgængelig med den aktuelle adgang.':'Køen kunne ikke bekræftes for rummet.'});
   return;
  }
  const native=this.queueControls.model(this.account,this.playback);
  if(native){
   const status=native.status,empty=status==='ready'?'Ingen sange i køen.':status==='stale'?'Ingen sange i den sidst kendte kø.':status==='error'?'Køen kunne ikke hentes.':status==='unknown'?'Køvalg kunne ikke bekræftes.':status==='loading'||status==='pending'?'':'Ingen bekræftet kø at vise.';
   this.host.playerView.renderQueue(native.items,{status,empty});return;
  }
  const admitted=snapshot?.capabilities?.queueSelection===true,connected=!!this.host.liveTransport?.connected,current=roomObservationCurrent(this.playback,snapshot);
  const status=admitted&&connected&&current?this.queueControls.status:'unavailable';
  const empty=!admitted?'Køen er ikke tilgængelig med den aktuelle adgang.':!connected?'Forbindelsen mangler for køen.':!current?'Køen kunne ikke bekræftes for rummet.':status==='error'?'Køen kunne ikke hentes.':status==='unknown'?'Køvalg kunne ikke bekræftes.':status==='loading'||status==='pending'?'':'Ingen bekræftet kø at vise.';
  this.host.playerView.renderQueue([],{status,empty});
 }

 render(){
  if(this.playback&&!this.host.liveSnapshot?.capabilities?.musicRead?.includes('playback'))this.clearRoom();
  if(this.playback&&!roomObservationBound(this.playback,this.host.liveSnapshot,this.account))this.clearRoom();
  if(this.playback&&roomObservationBound(this.playback,this.host.liveSnapshot,this.account)&&!roomObservationCurrent(this.playback,this.host.liveSnapshot)&&this.playback.displayRetained!==true){
   // Snapshot and navigation render before refresh; keep only the old display, never its offer.
   this.playback={...this.playback,displayRetained:true};this.queueControls.invalidate(false);
  }
  if(!this.host.liveSnapshot?.capabilities.musicRead.includes('queue')&&this.queue){this.queue=null;this.queueError=false;}
  const p=roomObservationDisplay(this.playback,this.host.liveSnapshot,this.account)?this.playback:null;this.host.playerView.renderPlayer({...livePlayerModel(p,!!this.host.liveTransport?.connected,this.readState,this.host.liveSnapshot,this.host.liveOutputs?.configuredLabel()||''),feedback:this.host.liveSelection?.feedback});
  this.host.playerView.renderControls({playing:p?.state==='playing',blocked:true,gesture:this.host.liveControls?.musicVolumeGesture});
  this.renderQueue();this.host.liveControls?.render();this.host.liveCatalogue?.render();
 }
}
