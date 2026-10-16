import {LiveQueueView} from './live-queue-view.js';
import {roomPlaybackObservation,roomObservationCurrent} from './media-observation.js';
import {livePlayerModel,liveQueueModel} from './player-view.js';
const $=id=>document.getElementById(id);
export class LiveMediaView{
 constructor(host){this.host=host;this.queueControls=new LiveQueueView(host);this.generation=0;this.rows=new Map();this.account=null;this.lastRead=0;this.pending=false;this.queuePending=false;this.accounts=document.createElement('div');this.accounts.className='live-accounts';this.accounts.setAttribute('aria-label','Musikkonto');$('music-response').prepend(this.accounts);}

 setAccount(account){if(this.account===account)return;this.account=account;this.host.liveMusicAccountChanged?.(account);for(const b of this.accounts.children)b.setAttribute('aria-pressed',String(b.dataset.account===account));}
 selectAccount(account){const choices=[...this.accounts.children];if(!choices.some(b=>b.dataset.account===account)||this.account===account)return;this.invalidate(true,true);this.setAccount(account);for(const b of choices)b.setAttribute('aria-pressed',String(b.dataset.account===account));this.refresh();}
 invalidate(revoke=false,preserveChoices=false){this.queueControls.invalidate(revoke);this.generation++;this.readState='offline';this.lastRead=0;this.pending=false;if(this.playback)this.playback={...this.playback,stale:true};if(revoke){this.playback=null;this.queue=null;this.queueError=false;this.setAccount(null);if(!preserveChoices)this.accounts.replaceChildren();$('queue').replaceChildren();this.rows.clear();}this.queuePending=false;if(this.queue)this.queue={...this.queue,stale:true};this.render();}
 clearRoom(){this.generation++;this.pending=false;this.playback=null;this.queue=null;this.queuePending=false;this.queueError=false;this.rows.clear();this.queueControls.invalidate(true);this.host.liveControls?.invalidate(undefined,false);}
 async refresh(){
  const host=this.host,snap=host.liveSnapshot,allowed=snap?.capabilities.musicRead||[],bindingScope=JSON.stringify([snap?.bootId,snap?.roomId,snap?.mediaRoomBindings]);if(this.bindingScope!==undefined&&this.bindingScope!==bindingScope){this.clearRoom();this.lastRead=0;}this.bindingScope=bindingScope;if(this.playback&&!roomObservationCurrent(this.playback,snap))this.clearRoom();if(!allowed.includes('playback')){if(this.playback||this.account)this.invalidate(true);return;}if(this.pending||Date.now()-this.lastRead<8000)return;this.pending=true;this.readState='loading';this.render();this.lastRead=Date.now();const generation=this.generation,boot=snap.bootId,room=snap.roomId,capabilities=JSON.stringify(allowed);
  const current=()=>host.isConnected&&host.liveTransport.connected&&generation===this.generation&&host.liveSnapshot.bootId===boot&&host.liveSnapshot.roomId===room&&host.liveSnapshot.capabilities.musicRead.includes('playback')&&JSON.stringify(host.liveSnapshot.capabilities.musicRead)===capabilities&&JSON.stringify([host.liveSnapshot.bootId,host.liveSnapshot.roomId,host.liveSnapshot.mediaRoomBindings])===bindingScope;
  try{
   if(!this.account){if(!allowed.includes('targets')){this.readState='unavailable';return;}const response=await host.liveTransport.music('targets');if(!current())return;const raw=response.ok===true?response.data?.accounts:null;if(!Array.isArray(raw)||raw.length>64)throw Error('invalid_accounts');if(!raw.length){this.readState='unavailable';return;}const seen=new Set(),options=raw.filter(row=>{if(typeof row?.config_entry_id!=='string'||!row.config_entry_id||row.config_entry_id.length>128||seen.has(row.config_entry_id)||typeof row.title!=='string'||!row.title||row.title.length>256)return false;seen.add(row.config_entry_id);return true;});if(!options.length)throw Error('invalid_accounts');this.accounts.replaceChildren();for(const row of options){if(typeof row.config_entry_id!=='string'||typeof row.title!=='string')continue;const b=document.createElement('button');b.type='button';b.className='text-control';b.textContent=row.title;b.dataset.account=row.config_entry_id;b.addEventListener('click',()=>this.selectAccount(row.config_entry_id));this.accounts.append(b);}if(options.length!==1){this.readState='account-selection';return;}this.setAccount(options[0].config_entry_id);}
   const account=this.account,response=await host.liveTransport.music('playback',account);if(!current()||this.account!==account)return;if(response.ok!==true)throw Error('unavailable_playback');const next=roomPlaybackObservation(response,account,host.liveSnapshot,this.playback);if(!next){this.clearRoom();this.readState='unavailable';this.render();return;}if(this.playback&&next.owner_epoch!==this.playback.owner_epoch){this.queue=null;$('queue').replaceChildren();this.rows.clear();this.host.liveMusicAccountChanged?.(account);}this.playback=next;this.readState='ready';this.render();
  }catch{if(current()){this.clearRoom();this.readState='error';this.render();}}finally{if(generation===this.generation){this.pending=false;if(this.readState==='loading')this.readState='unavailable';if(this.host.isConnected)this.render();}}
 }
 async loadQueue(){
  if(!roomObservationCurrent(this.playback,this.host.liveSnapshot)||!this.host.liveTransport?.connected){this.queueControls.invalidate(true);this.renderQueue();return;}
  await this.queueControls.load(this.account,this.playback);
 }

 renderQueue(){if(!roomObservationCurrent(this.playback,this.host.liveSnapshot)){this.host.playerView.renderQueue([],{status:'unavailable',empty:'Køen kunne ikke bekræftes for rummet.'});return;}const native=this.queueControls.model(this.account,this.playback);this.host.playerView.renderQueue(native?.items||[],{status:native?.status||'unavailable',empty:'Køen er endnu ikke hentet.'});}

 render(){
  if(!this.host.liveSnapshot?.capabilities.musicRead.includes('queue')&&this.queue){this.queue=null;this.queueError=false;}
  const p=this.playback;this.host.playerView.renderPlayer(livePlayerModel(p,!!this.host.liveTransport?.connected,this.readState,this.host.liveSnapshot));
  this.host.playerView.renderControls({playing:p?.state==='playing',blocked:true,gesture:this.host.liveControls?.musicVolumeGesture});
  this.renderQueue();this.host.liveControls?.render();this.host.liveCatalogue?.render();
 }
}
