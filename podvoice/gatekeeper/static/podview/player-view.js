import {applyKitComponent,applyKitTemplate,syncKitSlider} from './ui/kit.js';
import {TRACKS,LOCAL_POSITION_EXAMPLE} from './widget-model.js';
import {fixtureArtwork} from './music-results.js';
import {renderSpotifyArtwork,renderRetainedArtwork,cancelArtwork,generatedMoodArtwork,spotifyArtwork} from './spotify-artwork.js';
import {roomObservationCurrent,roomObservationDisplay,playbackObservationCurrent,playbackBinding} from './media-observation.js';
const txt=value=>typeof value==='string'?value:'';
const fixtureArt=art=>fixtureArtwork(art?.startsWith('https:')?art:`assets/${art}`);
const playerPreview=state=>state.playerPreview==='empty'&&state.music.playback.active?null:state.playerPreview;
export function localPlayerModel(state){const m=state.music,t=(m.previewTracks||TRACKS)[m.playback.track],base={active:m.playback.active,playing:m.playback.playing,fresh:state.connected,title:t.title,artist:t.artist,target:m.playback.room,configuredTarget:m.playback.room,fixtureArt:fixtureArt(t.art),canOutput:state.connected,canDiscover:state.connected,volume:m.playback.volume,examplePosition:true,trackId:t.id,seekOperation:m.operation,progressMs:m.playback.progressMs??LOCAL_POSITION_EXAMPLE.progressMs,durationMs:LOCAL_POSITION_EXAMPLE.durationMs,positionFresh:state.connected,canSeek:m.playback.active&&state.connected&&!m.pending&&!playerPreview(state)};const preview=playerPreview(state);
 if(!preview&&m.pending?.id&&Number.isInteger(m.pending.track)){const chosen=(m.previewTracks||TRACKS)[m.pending.track];if(chosen)return {...base,active:true,playing:false,fresh:false,loading:true,title:chosen.title,artist:chosen.artist,fixtureArt:fixtureArt(chosen.art),target:m.pending.room,trackId:chosen.id,progressMs:null,durationMs:null,positionFresh:false,canSeek:false,canOutput:false,feedback:{message:'Starter afspilning…',pending:true}};}
 if(!preview)return base;
 if(preview==='missing-art')return {...base,active:true,fixtureArt:null,uri:t.uri,artwork:null};
 if(preview==='offline')return {...base,active:true,fresh:false,canOutput:false,canDiscover:false};
 return {...base,active:false,loading:preview==='loading',emptyState:preview==='error'?'error':preview==='loading'?'loading':'empty',canOutput:preview==='empty'&&state.connected,empty:preview==='loading'?'':preview==='error'?'Afspilningen kunne ikke hentes.':'Vælg en stemning eller sang.'};
}
export function localControlModel(state){const m=state.music,preview=playerPreview(state);return {playing:m.playback.playing,previous:!preview,next:!preview,toggle:!preview,blocked:!state.connected||!!preview||!!m.pending,volume:preview?null:m.playback.volume,canVolume:!preview&&!m.pending};}
// The room player is the room's own media_player: what it shows always plays in this room.
export function livePlayerModel(playback,connected,status,snapshot,configuredTarget='',actualTargetLabel=''){
 const shown=roomObservationDisplay(playback,snapshot),current=playbackObservationCurrent(playback,snapshot);
 const item=shown?playback.item:null,away=shown&&playback.elsewhere===true;
 return {configuredTarget,readOnly:away,placement:away?'elsewhere':'room',canSeek:false,
  emptyState:status==='loading'?'loading':!connected?'offline':status==='error'?'error'
   :status==='account-selection'?'account-selection':'unconfirmed',
  loading:status==='loading',active:shown,playing:shown&&playback.state==='playing',fresh:current&&!!connected,
  positionAnchor:shown?{key:JSON.stringify([snapshot.bootId,snapshot.roomId,playback.config_entry_id,
   item?.uri??null,item?.name??null]),observedAt:Date.parse(playback.observedAt),expiresAt:playback.expiresAt}:null,
  progressMs:shown?playback.progressMs:null,durationMs:shown?item?.duration_ms:null,
  positionFresh:current&&!!connected&&status!=='error',title:shown?(item?.name||'Musik'):'',
  metadataKnown:!!(shown&&typeof item?.name==='string'&&item.name.trim()),
  artist:shown?(item?.artists.join(', ')||''):'',
  target:!shown?'':away?txt(playback.target?.name)
   :(txt(actualTargetLabel)||txt(configuredTarget)||'Højttaleren i rummet'),
  uri:shown?item?.uri??undefined:undefined,artwork:undefined,artworkUrl:shown?item?.artworkUrl??null:null,
  canOutput:!!connected&&snapshot?.capabilities?.musicRead?.includes('targets')===true,
  canDiscover:!!connected&&Array.isArray(snapshot?.capabilities?.musicRead)&&snapshot.capabilities.musicRead
   .some(kind=>['mood','feeling','top','recent','search','account_playlists'].includes(kind)),
  volume:null,empty:status==='loading'?'':status==='error'?'Afspilningen kunne ikke hentes.'
   :status==='account-selection'?'Vælg en musikkonto.':!connected?'Forbindelsen mangler.':'Vælg en stemning eller sang.'};
}
export function localQueueModel(state){if(playerPreview(state)||state.queuePreview&&!['loading','refresh'].includes(state.queuePreview))return [];const m=state.music;return (m.previewTracks||TRACKS).map((track,index)=>({id:track.id,title:track.title,artist:track.artist,fixtureArt:fixtureArt(track.art),order:m.queueOrder?((m.queueOrder.indexOf(track.id)-m.queueOrder.indexOf(TRACKS[m.playback.track].id)+TRACKS.length)%TRACKS.length):(index-m.playback.track+TRACKS.length)%TRACKS.length,reorderable:state.connected&&!m.pending&&index!==m.playback.track,revision:m.revision,current:index===m.playback.track&&m.playback.active,playing:index===m.playback.track&&m.playback.active&&m.playback.playing,selectable:state.connected&&index!==m.playback.track})).filter(row=>state.queuePreview!=='loading'||row.current).sort((a,b)=>a.order-b.order);}
// An occurrence/snapshot identity is an observation, never a play grant.
export function liveQueueModel(queue){return (queue?.items||[]).map((item,index)=>({id:item.id,title:item.name,artist:item.artists.join(', '),uri:item.uri,artwork:item.artwork,order:index+1,selectable:false}));}
export function renderPlayerControls(host,{playing=false,previous=false,next=false,toggle=false,blocked=false,volumeBlocked=blocked,volume=null,canVolume=false,min=0,max=100,gesture=null,sourceKind='music',loadingControlId=null,pendingLabel=null}={}){
 const doc=host.ownerDocument||document,$=id=>doc.getElementById(id);
 for(const[ids,allowed]of [[['previous','detail-previous'],previous],[['next','detail-next'],next],[['play-pause','detail-toggle'],toggle]])for(const id of ids){const button=$(id);if(button){const hidden=sourceKind==='radio'&&id!=='play-pause'&&id!=='detail-toggle';if(button.hidden!==hidden)button.hidden=hidden;const disabled=blocked||!allowed;if(button.disabled!==disabled)button.disabled=disabled;}}
 for(const id of ['play-pause','detail-toggle']){const button=$(id);if(button&&(sourceKind==='radio'||button.dataset?.feedback==='progress')){if(sourceKind==='radio'&&button.radioProgressVariant===undefined)button.radioProgressVariant=button.dataset.kitVariant||'';applyKitComponent(button,'button',{variant:'icon',feedback:'progress',loading:sourceKind==='radio'&&(loadingControlId===id||loadingControlId==='play-pause'&&id==='detail-toggle')});if(sourceKind!=='radio'&&button.radioProgressVariant!==undefined){if(button.radioProgressVariant)button.dataset.kitVariant=button.radioProgressVariant;else {delete button.dataset.kitVariant;button.removeAttribute?.('data-kit-variant');}delete button.radioProgressVariant;}}}
 const toggleLabel=sourceKind==='radio'&&pendingLabel?pendingLabel:sourceKind==='radio'?(playing?'Stop radio':'Start radio ved livepunkt'):(playing?'Sæt musik på pause':'Fortsæt musikken');for(const id of ['play-pause','detail-toggle']){const button=$(id);if(button&&button.getAttribute?.('aria-label')!==toggleLabel)button.setAttribute('aria-label',toggleLabel);}
 for(const selector of ['.player .transport','#music-detail .transport','.player .volume','#music-detail .volume']){const node=host.querySelector(selector)||doc.querySelector?.(selector);const hidden=selector.startsWith('#music-detail');if(node&&node.hidden!==hidden)node.hidden=hidden;}
 for(const row of host.playerView?.rows?.values?.()||[])if(row.queueItem?.current)row.disabled=blocked||!toggle;
 const known=Number.isInteger(volume)&&volume>=0&&volume<=100;
 host.playerView?.syncVolumeMute?.({volume,blocked:volumeBlocked,canVolume,min,max});
 for(const id of ['volume','detail-volume']){const input=$(id);if(!input)continue;const disabled=volumeBlocked||!canVolume||!known,witness=host.playerView?.volumeGestures?.get(input),editing=input===gesture||sourceKind==='radio'&&!disabled&&witness?.sourceKind==='radio'&&(witness.mode!=='pointer'||witness.pointerHeld===true)&&host.playerView?.volumeGestureCurrent?.(witness)===true;if(input.getAttribute?.('aria-label')!=='Lydstyrke')input.setAttribute?.('aria-label','Lydstyrke');const spokenVolume=known?(editing?input.value:volume)+' %':'Ukendt lydstyrke';if(input.getAttribute?.('aria-valuetext')!==spokenVolume)input.setAttribute?.('aria-valuetext',spokenVolume);if(input.disabled!==disabled)input.disabled=disabled;if(input.min!=='0')input.min='0';if(input.max!=='100')input.max='100';for(const [key,bound]of [['actionMin',min],['actionMax',max]])if(input.dataset[key]!==String(bound))input.dataset[key]=String(bound);if(input.dataset.kitValueKnown!==String(known))input.dataset.kitValueKnown=String(known);if(known&&!editing&&input.value!==String(volume))input.value=String(volume);syncKitSlider(input);const output=$(id==='volume'?'volume-value':'detail-volume-value'),label=known?volume+' %':'—';if(output&&(!editing||!known)&&output.textContent!==label)output.textContent=label;}
}
// Position is a display value only; live interpolation never creates seek authority.
export function renderPlayerProgress(doc,vm,seek=null){
 const known=vm.active===true&&Number.isSafeInteger(vm.progressMs)&&vm.progressMs>=0&&Number.isSafeInteger(vm.durationMs)&&vm.durationMs>0&&vm.progressMs<=vm.durationMs;
 const elapsed=known?Math.floor(vm.progressMs/1000):0,total=known?Math.floor(vm.durationMs/1000):0;
 const format=seconds=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 for(const prefix of ['player','detail']){
  const root=doc.getElementById(`${prefix}-progress`);if(!root)continue;
  if(root.hidden===known)root.hidden=!known;
  const rail=doc.getElementById(`${prefix}-progress-meter`),time=doc.getElementById(`${prefix}-elapsed`),duration=doc.getElementById(`${prefix}-duration`);
  const label=known?`${vm.examplePosition===true?'Eksempelposition':vm.positionFresh===true?(vm.interpolatedPosition?'Beregnet position fra seneste observation':'Observeret position'):'Position ikke opdateret'}: ${format(elapsed)} af ${format(total)}. Kun visning.`:'';
  const editable=prefix==='player'&&!!seek&&known&&(vm.examplePosition===true||vm.canSeek===true)&&vm.sourceKind!=='radio';if(rail&&rail.hidden!==editable)rail.hidden=editable;
  if(prefix==='player'&&seek){if(seek.hidden!==!editable)seek.hidden=!editable;const disabled=!editable||vm.canSeek!==true;if(seek.disabled!==disabled)seek.disabled=disabled;const percentage=editable?`${vm.progressMs/vm.durationMs*100}%`:'0%';if(seek.style.getPropertyValue('--seek-progress')!==percentage)seek.style.setProperty('--seek-progress',percentage);for(const [key,text]of [['min','0'],['max',editable?String(vm.durationMs):'1'],['value',editable?String(vm.progressMs):'0']])if(seek[key]!==text)seek[key]=text;const spoken=editable?`${format(elapsed)} af ${format(total)}`:'';if(seek.getAttribute('aria-valuetext')!==spoken)seek.setAttribute('aria-valuetext',spoken);}
  const value=known?String(vm.progressMs):'0',max=known?String(vm.durationMs):'1';
  for(const [name,text]of [['value',value],['max',max],['aria-label',label]])if(rail?.getAttribute(name)!==text)rail?.setAttribute(name,text);
  if(time&&time.textContent!==(known?format(elapsed):''))time.textContent=known?format(elapsed):'';
  if(duration&&duration.textContent!==(known?format(total):''))duration.textContent=known?format(total):'';
  const stale=String(known&&vm.positionFresh!==true);if(root.dataset.stale!==stale)root.dataset.stale=stale;
 }
}
// Reuse the same canonical output control, without a second action identity.
export function placeOutputHeader(view,vm){
 const slot=view.outputPlacement;if(!slot)return;
 const {output,parent,next,emptyTitle,copy}=slot,idle=!vm.active;
 if(idle){if(output.parentNode!==copy)emptyTitle.replaceWith(output);const disabled=vm.loading===true||vm.canOutput!==true,next=txt(vm.nextDestinationLabel),label=next?`Næste afspilning: ${next}`:vm.configuredTarget?`Konfigureret højttaler: ${txt(vm.configuredTarget)}`:vm.canOutput===true?'Musik · Se aktuelle højttalere':'Musik';if(output.disabled!==disabled)output.disabled=disabled;if(output.getAttribute?.('aria-label')!==label)output.setAttribute('aria-label',label);const state=view.doc.getElementById('player-state'),room=view.doc.getElementById('player-room'),name=next||txt(vm.configuredTarget)||'Musik';if(state.textContent!=='')state.textContent='';if(room.textContent!==name)room.textContent=name;}
 else if(output.parentNode!==parent){output.replaceWith(emptyTitle);parent.insertBefore(output,next?.parentNode===parent?next:null);}
}
export class PlayerView{
 constructor(host,{chooseQueue=()=>{},seek=()=>{}}={}){this.host=host;this.doc=host.ownerDocument;this.chooseQueue=chooseQueue;this.volumeGestures=new Map();this.volumeInputListeners=new Map();for(const selector of ['.player','#player-empty'])host.querySelector(selector)&&applyKitComponent(host.querySelector(selector),'card');for(const selector of ['.player .transport button','#music-detail .transport button'])for(const button of (host.querySelectorAll?.(selector)||[]))applyKitComponent(button,'button');for(const id of ['volume','detail-volume']){const input=this.doc.getElementById(id);if(input){applyKitComponent(input,'slider');this.bindVolumeInput(input);}}this.coverTones=new Map();this.coverToneLoad=()=>this.updateCoverTone();this.doc.getElementById('cover')?.addEventListener('load',this.coverToneLoad);this.doc.getElementById('cover')?.addEventListener('error',this.coverToneLoad);
  const root=this.doc.getElementById('player-progress');
  if(root){
   const range=this.doc.createElement('input');
   range.id='detail-seek';
   range.type='range';
   range.step='1000';
   range.hidden=true;
   range.disabled=true;
   range.setAttribute('aria-label','Vælg afspilningsposition');
   root.insertBefore(range,this.doc.getElementById('player-progress-meter'));
   this.seekControl=range;
   range.addEventListener('pointerdown',()=>{this.seekGesture={witness:this.seekState()?.witness};});
   range.addEventListener('input',()=>{
    const vm=this.progressVM,state=this.seekState(),positionMs=Number(range.value);
    if(!state||!Number.isSafeInteger(positionMs)||positionMs<0||positionMs>vm.durationMs
      ||this.seekGesture&&!this.sameSeek(this.seekGesture.witness,state.witness)){
     this.renderTimeline();
     return;
    }
    this.seekDraft={witness:state.witness,progressMs:positionMs};
    this.renderTimeline();
   });
   range.addEventListener('change',()=>{
    const state=this.seekState(),draft=this.seekDraft;
    this.seekDraft=null;
    this.seekGesture=null;
    if(draft&&this.sameSeek(draft.witness,state?.witness)){
     const {progressMs:positionMs,witness}=draft;
     seek(this.host.live?{positionMs,witness}:{positionMs,trackId:witness.trackId,operation:witness.operation});
    }
    this.renderTimeline();
   });
   range.addEventListener('pointerup',()=>{this.seekGesture=null;});
   for(const type of ['pointercancel','blur'])range.addEventListener(type,()=>{
    this.seekDraft=null;
    this.seekGesture=null;
    this.renderTimeline();
   });
  }
  this.volumeMute=this.doc.getElementById('volume-mute');if(this.volumeMute){applyKitComponent(this.volumeMute,'button',{variant:'icon'});this.volumeMuteClick=()=>this.toggleVolumeMute();this.volumeMute.addEventListener('click',this.volumeMuteClick);}
  this.rows=new Map();this.queue=this.doc.getElementById('queue');this.queue.setAttribute('role','group');this.queue.replaceChildren();this.emptyCopy=this.doc.getElementById('player-empty').querySelector('p');this.emptyCopy.setAttribute('role','status');this.emptyCopy.setAttribute('aria-live','polite');this.emptyCopy.setAttribute('aria-atomic','true');const discoveryText=this.doc.getElementById('empty-find-music').firstChild;if(discoveryText?.nodeType===3&&discoveryText.nodeValue!=='Vælg musik')discoveryText.nodeValue='Vælg musik';const output=this.doc.getElementById('output'),emptyTitle=this.doc.getElementById('player-empty').querySelector('h2');if(output?.parentNode&&emptyTitle?.parentNode){const parent=output.parentNode,volume=parent.querySelector('.volume');if(volume&&volume.parentNode===parent)parent.insertBefore(output,volume);this.outputPlacement={output,parent,next:output.nextSibling||volume,emptyTitle,copy:emptyTitle.parentNode};}}
 // One scoped presentation focus; it never grants or repeats an effect.
 sourceScope(){const s=this.host.liveSnapshot;return s?.bootId&&s?.roomId?JSON.stringify([s.bootId,s.roomId]):null;}
 focusSource(kind,target=null){if(!['music','radio'].includes(kind)||!this.sourceScope())return false;const scope=this.sourceScope(),changed=this.sourceFocus?.scope!==scope||this.sourceFocus.kind!==kind;this.sourceFocus=Object.freeze({scope,kind,target:target?Object.freeze({...target}):null});if(kind==='music')this.host.liveRadio?.closeOutputs?.();return changed;}
 beginSourceFocus(kind,target=null){const previous=this.sourceFocus;this.focusSource(kind,target);return Object.freeze({previous,current:this.sourceFocus,scope:this.sourceScope()});}
 finishSourceFocus(ticket,outcome){if(outcome!=='rejected'||!ticket||this.sourceScope()!==ticket.scope||this.sourceFocus!==ticket.current)return false;this.sourceFocus=ticket.previous?.scope===ticket.scope?ticket.previous:null;return true;}
 sourceFocused(kind){const scope=this.sourceScope();if(this.sourceFocus&&this.sourceFocus.scope!==scope)this.sourceFocus=null;return !this.sourceFocus||this.sourceFocus.kind===kind;}
 radioHistorySuperseded(history){if(!history||history.scope!==this.sourceScope())return false;if(history.superseded)return true;const h=this.host,p=h.liveMedia?.playback,s=h.liveSnapshot,b=p?.state==='playing'&&playbackObservationCurrent(p,s)&&roomObservationCurrent(p,s)?playbackBinding(p,s,h.liveMedia?.account):null;if(b&&b.nativeRoomId===history.targetId&&Number.isFinite(history.observedAt)&&Date.parse(p.observedAt)>=(history.observedAt+1)*1000)history.superseded=true;return history.superseded;}
 sourceModel(kind){if(this.host.live!==true)return this.progressVM||{};return (kind==='radio'?this.host.liveRadio?.playerModel?.():this.host.liveMedia?.observedPlayerModel?.())||{};}
 updateCoverTone(sample=null){
  const cover=this.doc.getElementById('cover'),player=this.host.querySelector('.player'),source=this.progressVM?.active===true&&!cover?.classList.contains('live-art-fallback')?(cover?.currentSrc||cover?.src):null;let tone='transparent';
  if(this.coverToneRequest&&this.coverToneRequest.source!==source){this.coverToneRequest.image.onload=null;this.coverToneRequest.image.onerror=null;this.coverToneRequest.image.removeAttribute?.('src');this.coverToneRequest=null;}
  // Keep the visible artwork untouched. Only its optional palette read needs CORS.
  const ImageClass=this.doc.defaultView?.Image;
  if(source&&!sample&&!this.coverTones.has(source)&&ImageClass&&/^https:\/\/(?:i\.scdn\.co|image-cdn-(?:ak|fa)\.spotifycdn\.com)\/image\/[A-Za-z0-9_-]+$/.test(source)){
   if(!this.coverToneRequest){const image=new ImageClass(),request={source,image};this.coverToneRequest=request;image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';image.onload=()=>{if(this.coverToneRequest!==request)return;image.onload=null;image.onerror=null;this.coverToneRequest=null;this.updateCoverTone((cover?.currentSrc||cover?.src)===source?image:null);};image.onerror=()=>{if(this.coverToneRequest!==request)return;image.onload=null;image.onerror=null;this.coverToneRequest=null;this.coverTones.set(source,'transparent');this.updateCoverTone();};image.src=source;}
   for(const name of ['--pv-cover','--player-cover-tone'])if(player?.style.getPropertyValue(name)!==tone)player?.style.setProperty(name,tone);return;
  }
  if(source&&this.coverTones.has(source))tone=this.coverTones.get(source);
  else if(source&&(sample||cover)?.complete&&(sample||cover).naturalWidth>0){
   try{const canvas=this.doc.createElement('canvas');canvas.width=8;canvas.height=8;const context=canvas.getContext?.('2d',{willReadFrequently:true});if(context){context.drawImage(sample||cover,0,0,8,8);const pixels=context.getImageData(0,0,8,8).data,buckets=new Map();for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<128)continue;const key=[pixels[i]>>5,pixels[i+1]>>5,pixels[i+2]>>5].join(','),bucket=buckets.get(key)||[0,0,0,0];bucket[0]++;bucket[1]+=pixels[i];bucket[2]+=pixels[i+1];bucket[3]+=pixels[i+2];buckets.set(key,bucket);}const dominant=[...buckets.values()].sort((a,b)=>b[0]-a[0])[0];if(dominant)tone=`rgb(${Math.round(dominant[1]/dominant[0])} ${Math.round(dominant[2]/dominant[0])} ${Math.round(dominant[3]/dominant[0])} / .12)`;}}catch{/* Cross-origin covers remain neutral; no proxy, guessed color or blocked artwork. */}
   if(this.coverTones.size>=24)this.coverTones.delete(this.coverTones.keys().next().value);this.coverTones.set(source,tone);
  }
  for(const name of ['--pv-cover','--player-cover-tone'])if(player?.style.getPropertyValue(name)!==tone)player?.style.setProperty(name,tone);
 }
 artwork(node,item){const diagnosticOwner=this.host.liveTransport;
  if(item.loading&&/^spotify:playlist:[A-Za-z0-9]{22}$/.test(item.uri||'')&&!spotifyArtwork(item.artwork,item.uri)){
   const illustration=generatedMoodArtwork(item.themeArt,item.themeId)||(item.themeArt?.startsWith('assets/')?fixtureArtwork(item.themeArt):null);
   if(illustration){renderRetainedArtwork(node,{url:illustration,identity:illustration,contentIdentity:item.uri,label:`Illustration til ${txt(item.title)}`,diagnosticOwner});return;}
  }
if(item.sourceKind==='radio'&&/^assets\/radio-(p3|p1|p4-ostjylland|p6-beat|p8-jazz)\.svg$/.test(item.fixtureArt||'')){renderRetainedArtwork(node,{url:item.fixtureArt,identity:`radio|${item.fixtureArt}`,contentIdentity:item.fixtureArt,label:`Stationslogo til ${txt(item.title)}`,diagnosticOwner});}else if(typeof item.artworkUrl==='string'&&item.artworkUrl){
 // The room player's cover, fetched by PodVoice from HA's media_player proxy.
 const url=this.host.liveTransport?.base?new URL(item.artworkUrl,this.host.liveTransport.base).href:item.artworkUrl;
 renderRetainedArtwork(node,{url,identity:`room|${item.artworkUrl}`,contentIdentity:item.uri||item.artworkUrl,
  label:`Albumomslag til ${txt(item.title)}`,diagnosticOwner});
}else if(item.fixtureArt&&fixtureArtwork(item.fixtureArt)){renderRetainedArtwork(node,{url:item.fixtureArt,identity:`fixture|${item.fixtureArt}`,contentIdentity:item.trackId||item.id||item.fixtureArt,diagnosticOwner,label:`Albumomslag til ${txt(item.title)}`});}else renderSpotifyArtwork(node,{uri:item.uri,name:item.title,artwork:item.artwork},undefined,false,diagnosticOwner);}
 seekState(vm=this.progressVM){
  if(this.suspended||!vm?.active||vm.sourceKind==='radio'||vm.loading)return null;
  if(!this.host.live){
   return vm.canSeek&&vm.examplePosition?{witness:{trackId:vm.trackId,operation:vm.seekOperation}}:null;
  }
  if(!vm.fresh||!vm.positionFresh)return null;
  return this.host.liveControls?.musicSeekState?.(vm.uri)??null;
 }
 sameSeek(a,b){
  if(!a||!b)return false;
  return this.host.live?a.key===b.key&&a.transport===b.transport
   :a.trackId===b.trackId&&a.operation===b.operation;
 }
 renderTimeline(){
  const vm=this.progressVM||{};
  if(this.host.live===true){
   this.renderLiveProgress(vm);
   return;
  }
  if(this.seekDraft&&!this.sameSeek(this.seekDraft.witness,this.seekState(vm)?.witness))this.seekDraft=null;
  renderPlayerProgress(this.doc,this.seekDraft?{...vm,progressMs:this.seekDraft.progressMs}:vm,this.seekControl);
 }
 renderLiveProgress(vm){
  const state=this.seekState(vm);
  if(this.seekGesture&&!this.sameSeek(this.seekGesture.witness,state?.witness))this.seekGesture.witness=null;
  if(this.seekDraft&&!this.sameSeek(this.seekDraft.witness,state?.witness))this.seekDraft=null;
  const chosen=this.seekDraft?.progressMs??state?.positionMs;
  const paint=(observed,fresh,interpolated=false)=>renderPlayerProgress(this.doc,{
   ...vm,canSeek:!!state,progressMs:chosen??observed,positionFresh:fresh,interpolatedPosition:chosen==null&&interpolated,
  },this.seekControl);
  const anchor=vm.positionAnchor,now=Date.now(),eligible=this.host.live===true&&!this.suspended&&this.host.isConnected!==false&&this.host.liveTransport?.connected!==false&&vm.active===true&&vm.playing===true&&vm.fresh===true&&vm.positionFresh===true&&vm.examplePosition!==true&&Number.isSafeInteger(vm.progressMs)&&vm.progressMs>=0&&Number.isSafeInteger(vm.durationMs)&&vm.durationMs>0&&vm.progressMs<=vm.durationMs&&Number.isFinite(anchor?.observedAt)&&anchor.observedAt<=now&&Number.isFinite(anchor.expiresAt)&&anchor.expiresAt>anchor.observedAt;
  const key=eligible?JSON.stringify([anchor.key,anchor.observedAt,anchor.expiresAt,vm.progressMs,vm.durationMs]):null;
  if(this.progressClockKey!==key){clearTimeout(this.progressClockTimer);this.progressClockTimer=null;this.progressClockKey=key;}
  if(!eligible){const retained=this.progressDisplay,keep=!!retained&&vm.active===true&&vm.playing===true&&vm.positionFresh!==true&&anchor?.key===retained?.key&&vm.progressMs===retained?.sourceMs&&vm.durationMs===retained?.durationMs;if(!keep)this.progressDisplay=null;paint(keep?retained.displayMs:vm.progressMs,!keep&&vm.positionFresh===true);return;}
  const fresh=now<anchor.expiresAt,progressMs=Math.min(vm.durationMs,vm.progressMs+Math.max(0,Math.min(now,anchor.expiresAt)-anchor.observedAt));
  this.progressDisplay={key:anchor.key,sourceMs:vm.progressMs,durationMs:vm.durationMs,displayMs:progressMs};paint(progressMs,fresh,progressMs!==vm.progressMs);
  if(!fresh||progressMs>=vm.durationMs||this.doc.hidden===true)return;
  if(!this.progressClockTimer){this.progressClockTimer=setTimeout(()=>{if(this.progressClockKey!==key)return;this.progressClockTimer=null;if(this.progressVM)this.renderLiveProgress(this.progressVM);},Math.min(1000,anchor.expiresAt-now));this.progressClockTimer.unref?.();}
 }
 renderPlayer(vm){const duplicate=this.host.querySelector('.now-playing-detail');if(duplicate&&!duplicate.hidden)duplicate.hidden=true;this.progressVM=vm;this.updateCoverTone();this.renderTimeline();const $=id=>this.doc.getElementById(id),feedback=vm.sourceKind==='radio'?'':txt(vm.feedback?.message),controlStatus=vm.sourceKind==='radio'?'':txt(vm.controlStatus),pending=vm.feedback?.pending===true,selection=String(!!feedback);if(this.host.dataset.selectionFeedback!==selection)this.host.dataset.selectionFeedback=selection;for(const [key,value]of [['role','status'],['aria-live','polite'],['aria-atomic','true']])if($('player-state').getAttribute?.(key)!==value)$('player-state').setAttribute(key,value);const playback=vm.active?'active':'empty';if(this.host.dataset.playback!==playback)this.host.dataset.playback=playback;const player=this.host.querySelector('.player'),empty=$('player-empty'),placeholder=!vm.active&&vm.loading===true,playerHidden=!vm.active,emptyFlag=String(placeholder),busy=String(vm.loading===true||pending),state=placeholder?'loading':pending?'pending':vm.emptyState||'empty',emptyBusy=String(placeholder||pending);if(player.dataset.readState!==(vm.emptyState||''))player.dataset.readState=vm.emptyState||'';if(player.hidden!==playerHidden)player.hidden=playerHidden;if(player.dataset.empty!==emptyFlag)player.dataset.empty=emptyFlag;if(player.getAttribute?.('aria-busy')!==busy)player.setAttribute('aria-busy',busy);if($('music-detail').getAttribute?.('aria-busy')!==busy)$('music-detail').setAttribute('aria-busy',busy);if(empty.hidden!==vm.active)empty.hidden=vm.active;if(empty.dataset.state!==state)empty.dataset.state=state;if(empty.getAttribute?.('aria-busy')!==emptyBusy)empty.setAttribute('aria-busy',emptyBusy);const copyHidden=false;if(this.emptyCopy.hidden!==copyHidden)this.emptyCopy.hidden=copyHidden;const discovery=$('empty-find-music'),choosingAccount=vm.emptyState==='account-selection',discoveryDisabled=choosingAccount?vm.canChooseAccount!==true:vm.canDiscover!==true,hideDiscovery=!choosingAccount&&this.host.state?.focus==='music',discoveryLabel=choosingAccount?'Vælg musikkonto':'Vælg musik';if(discovery.firstChild?.nodeType===3&&discovery.firstChild.nodeValue!==discoveryLabel)discovery.firstChild.nodeValue=discoveryLabel;if(discovery.dataset.action!==(choosingAccount?'account':'music'))discovery.dataset.action=choosingAccount?'account':'music';if(discovery.disabled!==discoveryDisabled)discovery.disabled=discoveryDisabled;if(discovery.hidden!==hideDiscovery)discovery.hidden=hideDiscovery;
  if(!vm.active){const message=feedback||(placeholder?'Henter afspilningsstatus':vm.emptyState==='error'?'Afspilningen kunne ikke hentes.':vm.emptyState==='offline'?'Afspilningen kan ikke hentes offline.':vm.empty||'Vælg en stemning eller sang.');if($('detail-title').textContent!=='Afspiller')$('detail-title').textContent='Afspiller';if($('detail-status')&&$('detail-status').textContent!==message)$('detail-status').textContent=message;if(placeholder)for(const id of ['cover','detail-cover'])if($(id).style.visibility!=='hidden')$(id).style.visibility='hidden';for(const id of ['track','player-detail'])if(!$(id).disabled)$(id).disabled=true;for(const id of ['track-name','track-artist','detail-track','detail-artist'])if($(id).textContent!=='')$(id).textContent='';if(!this.outputPlacement)for(const id of ['player-room','player-state'])if($(id).textContent!=='')$(id).textContent='';const detailRoom=$('detail-output').querySelector('span');if(detailRoom.textContent!=='')detailRoom.textContent='';for(const id of this.outputPlacement?['detail-output']:['output','detail-output']){if(!$(id).disabled)$(id).disabled=true;if($(id).getAttribute?.('aria-label')!=='')$(id).setAttribute('aria-label','');}for(const id of ['cover','detail-cover'])this.artwork($(id),{});this.renderControls({blocked:true});if(this.emptyCopy.textContent!==message)this.emptyCopy.textContent=message;placeOutputHeader(this,vm);return;}
  placeOutputHeader(this,vm);if($('track').getAttribute?.('aria-label')!==null)$('track').removeAttribute('aria-label');if($('track').getAttribute?.('aria-description')!=='Åbn afspiller')$('track').setAttribute('aria-description','Åbn afspiller');for(const id of ['cover','detail-cover'])if($(id).style.visibility!=='')$(id).style.visibility='';for(const id of ['track','player-detail'])if($(id).disabled)$(id).disabled=false;
  for(const id of ['track-name','detail-track'])if($(id).textContent!==txt(vm.title))$(id).textContent=txt(vm.title);const artist=(txt(vm.artist)||(vm.sourceKind==='radio'?'Direkte radio':''))+(vm.exampleOnly===true&&vm.sourceKind==='radio'?' · ingen lyd':'');for(const id of ['track-artist','detail-artist'])if($(id).textContent!==artist)$(id).textContent=artist;const displayedTarget=txt(vm.selectedTarget)||txt(vm.target);if($('player-room').textContent!==displayedTarget)$('player-room').textContent=displayedTarget;const previewLabel=vm.exampleOnly===true&&vm.sourceKind==='radio'?txt(vm.previewLabel):'',connectionExplained=this.host.browserOffline===true||this.host.state?.connected===false||['offline','denied'].includes(this.host.connectionNotice?.state),playingLabel=vm.placement==='elsewhere'&&!txt(vm.target)?'Spiller et andet sted':'Spiller på',readOnlyLabel=vm.fresh===false&&!connectionExplained?(vm.playing?'Ikke opdateret':'Ikke opdateret · på pause'):vm.playing?playingLabel:'På pause',stateLabel=vm.selectedTarget?'Skifter til':vm.readOnly?[feedback,readOnlyLabel].filter(Boolean).join(' · '):feedback||controlStatus||(vm.emptyState==='error'?(connectionExplained?'Forbindelsen mangler':'Status kunne ikke hentes'):vm.exampleOnly===true&&vm.sourceKind==='radio'?'':(vm.fresh?(vm.playing?'Spiller på':''):connectionExplained?'':'Ikke opdateret')),detailLabel=vm.readOnly?[feedback,vm.fresh===false&&!connectionExplained?'Afspilningen er ikke opdateret':vm.playing?(vm.placement==='elsewhere'?(txt(vm.target)?`Spiller på ${txt(vm.target)}`:'Spiller et andet sted'):''):'På pause'].filter(Boolean).join(' · '):feedback||controlStatus||(vm.emptyState==='error'?(connectionExplained?'Forbindelsen mangler':'Status kunne ikke hentes'):vm.exampleOnly===true&&vm.sourceKind==='radio'?'':vm.fresh?'':connectionExplained?'':'Afspilningen er ikke opdateret');if($('player-state').getAttribute('data-routine-output')!==String(stateLabel==='Spiller på'))$('player-state').setAttribute('data-routine-output',String(stateLabel==='Spiller på'));if($('player-state').textContent!==stateLabel)$('player-state').textContent=stateLabel;if($('detail-title').textContent!=='Afspiller')$('detail-title').textContent='Afspiller';if($('detail-status')&&$('detail-status').textContent!==detailLabel)$('detail-status').textContent=detailLabel;for(const id of ['player-state','detail-status']){const node=$(id),hidden=vm.sourceKind==='radio';if(node.hidden!==hidden)node.hidden=hidden;}const detailRoom=$('detail-output').querySelector('span');if(detailRoom.textContent!==displayedTarget)detailRoom.textContent=displayedTarget;
  for(const id of ['output','detail-output']){const disabled=!vm.canOutput,label=[id==='output'?(stateLabel||(vm.exampleOnly===true&&vm.sourceKind==='radio'?previewLabel:vm.fresh&&!vm.playing?'På pause':'')):'',vm.selectedTarget?`Valgt: ${txt(vm.selectedTarget)} · skifter højttaler`:txt(vm.target),vm.canOutput?(vm.readOnly?(vm.placement==='elsewhere'&&txt(vm.configuredTarget)?`Flyt til ${txt(vm.configuredTarget)}`:'Vælg højttaler'):`${vm.selectedTarget?'Afventer bekræftelse':vm.fresh?'Aktuelt output':'Seneste output'} · Vælg højttaler`):''].filter(Boolean).join(' · ');if($(id).disabled!==disabled)$(id).disabled=disabled;if($(id).getAttribute?.('aria-label')!==label)$(id).setAttribute('aria-label',label);}
  const icon=`assets/icons/${vm.playing?(vm.sourceKind==='radio'?'stop':'pause'):'play'}-fill.svg`;for(const id of ['play-icon','detail-play-icon'])if($(id).getAttribute?.('src')!==icon)$(id).src=icon;for(const id of ['cover','detail-cover'])this.artwork($(id),vm);
 }
 // A range gesture belongs to the source that was visible at its first input.
 // It may never be retargeted by a later radio/music ownership transition.
 bindVolumeInput(input){if(this.volumeInputListeners.has(input))return;const listeners={pointerdown:()=>this.beginVolumeGesture(input,'pointer'),keydown:event=>{if(!event.repeat&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))this.beginVolumeGesture(input,'key');},input:()=>{if(!this.volumeGestures.has(input))this.beginVolumeGesture(input,'input');},change:()=>this.commitVolumeInput(input),pointerup:()=>{const witness=this.volumeGestures.get(input);if(witness?.mode==='pointer')this.volumeGestures.set(input,Object.freeze({...witness,pointerHeld:false}));},pointercancel:()=>this.volumeGestures.delete(input),blur:()=>this.volumeGestures.delete(input),keyup:()=>this.volumeGestures.delete(input)};for(const[type,listener]of Object.entries(listeners))input.addEventListener(type,listener);this.volumeInputListeners.set(input,listeners);}
 beginVolumeGesture(input,mode='pointer'){if(this.host.live!==true||input.disabled)return null;const binding=this.volumeBinding();if(!binding)return null;const witness=Object.freeze({binding,sourceKind:this.host.liveRadio?.ownsPlayer()?'radio':'music',transport:this.host.liveTransport,transportGeneration:this.host.liveTransport?.generation,mode,pointerHeld:mode==='pointer'});this.volumeGestures.set(input,witness);return witness;}
 volumeGestureCurrent(witness){if(!witness||this.host.live!==true||!this.host.isConnected||!this.host.liveTransport?.connected||witness.transport!==this.host.liveTransport||witness.transportGeneration!==this.host.liveTransport.generation||witness.binding!==this.volumeBinding()||witness.sourceKind!==(this.host.liveRadio?.ownsPlayer()?'radio':'music'))return false;return witness.sourceKind==='radio'?this.host.liveRadio?.can('volume')===true:this.host.liveControls?.player?.can('volume')===true;}
 commitVolumeInput(input){if(this.host.live!==true)return false;const witness=this.volumeGestures.get(input)||this.beginVolumeGesture(input,'change');if(witness?.mode!=='key')this.volumeGestures.delete(input);if(input.disabled||!this.volumeGestureCurrent(witness)){this.host.liveMedia?.render?.();return false;}this.host.music({type:'volume',value:input.value,volumeSource:witness});return true;}
 volumeBinding(){const h=this.host;if(h.live&&h.liveRadio?.ownsPlayer()){if(!h.liveRadio.hasSource())return '';const r=h.liveRadio.value,s=r.state;return JSON.stringify(['radio',r.bootId,r.roomId,r.ownerProcessId,s.targetId,s.ownerGeneration]);}if(h.live){const p=h.liveMedia?.playback,s=h.liveSnapshot;if(!p||!s)return '';return roomObservationDisplay(p,s)?JSON.stringify(['room-player',s.bootId,s.roomId,p.config_entry_id]):'';}const s=h.state,p=s?.music?.playback;return p?JSON.stringify([s.sessionId,p.accountId,p.kind,p.targetId,p.room]):'';}
 syncVolumeMute(vm){const button=this.volumeMute;if(!button)return;const binding=this.volumeBinding();if(binding!==this.volumeMuteBinding){this.volumeMuteBinding=binding;this.volumeRestore=null;this.volumeMuteRequest=null;}const known=Number.isInteger(vm.volume)&&vm.volume>=0&&vm.volume<=100,muted=known&&vm.volume===0;if(known&&vm.volume>0&&binding)this.volumeRestore=vm.volume;if(this.volumeMuteRequest&&known&&vm.volume!==this.volumeMuteRequest.from)this.volumeMuteRequest=null;this.volumeMuteVM=vm;const restore=this.volumeRestore,allowed=!!binding&&known&&!vm.blocked&&!(this.host.live!==true&&this.host.state?.music?.pending)&&vm.canVolume===true&&(vm.min??0)===0&&(!muted||Number.isInteger(restore)&&restore>0&&restore<=(vm.max??100));const disabled=!allowed||!!this.volumeMuteRequest;if(button.disabled!==disabled)button.disabled=disabled;const pressed=String(muted),label=muted?'Slå lyden til':'Slå lyden fra';if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);const image=button.querySelector('img'),source=`assets/icons/${muted?'volume-mute':'volume-up-fill'}.svg`;if(image&&image.getAttribute('src')!==source)image.src=source;}
 toggleVolumeMute(){const button=this.volumeMute,vm=this.volumeMuteVM;if(!button||button.disabled||!vm||this.volumeBinding()!==this.volumeMuteBinding)return;const value=vm.volume===0?this.volumeRestore:0;if(!Number.isInteger(value))return;this.volumeMuteRequest={from:vm.volume,value};button.disabled=true;this.host.music({type:'volume',value});}
 renderRadioProgress(progress){for(const id of ['output','detail-output']){const button=this.doc.getElementById(id);if(button&&(progress?.kind==='output'||button.dataset.radioProgress==='true')){const loading=progress?.kind==='output'&&id==='output';applyKitComponent(button,'button',{feedback:'progress',loading});button.dataset.radioProgress=String(loading);if(loading)button.disabled=true;}}}
 renderControls(vm){renderPlayerControls(this.host,vm);if(this.host.playerView!==this)this.syncVolumeMute(vm);for(const row of this.rows.values())if(row.queueItem?.current)row.disabled=this.doc.getElementById('play-pause').disabled;}
 createRow(id){
  const doc=this.doc,row=doc.createElement('button');
  row.type='button';
  row.className='queue-track pv-row pv-btn';
  applyKitComponent(row,'listrow');
  row.dataset.trackId=id;
  const order=doc.createElement('span'),cover=doc.createElement('img'),copy=doc.createElement('span');
  const title=doc.createElement('strong'),artist=doc.createElement('small'),play=doc.createElement('img');
  order.className='queue-order';
  cover.className='queue-cover';
  cover.alt='';
  copy.className='queue-copy';
  play.className='queue-play';
  play.src='assets/icons/play-fill.svg';
  play.alt='';
  copy.append(title,artist);
  row.append(order,cover,copy,play);
  // A stable display node may receive a new witness before an activation finishes.
  let pressed=null;
  row.addEventListener('pointerdown',()=>{pressed=row.queueItem?.queueTaskId?row.queueItem:null;});
  row.addEventListener('pointercancel',()=>{pressed=null;});
  row.addEventListener('keydown',event=>{
   if(!event.repeat&&['Enter',' '].includes(event.key))pressed=row.queueItem?.queueTaskId?row.queueItem:null;
  });
  row.addEventListener('click',()=>{
   const item=row.queueItem,original=pressed;
   pressed=null;
   if(original&&(original.queueTaskId!==item?.queueTaskId||original.id!==item.id||original.uri!==item.uri))return;
   if(item?.current){
    const toggle=this.doc.getElementById('play-pause');
    if(!toggle.disabled)toggle.click();
   }else if(!row.disabled&&item?.selectable)this.chooseQueue(item);
  });
  return row;
 }
 renderQueue(items,{status='ready',empty='Ingen sange i køen.',sourceKind='music',errorKind=null,placeholders=false}={}){
  const title=this.doc.getElementById('queue-title');
  if(this.host.liveRadio?.pendingStart?.()&&this.host.liveRadio?.presentsPlayer?.()!==false){
   if(!title.hidden)title.hidden=true;
   if(!this.queue.hidden)this.queue.hidden=true;
   for(const row of this.rows.values())if(!row.disabled)row.disabled=true;
   return;
  }
  items=items.filter(item=>typeof item?.title==='string'&&!!item.title.trim());
  const current=this.progressVM;
  if(this.host.live&&sourceKind!=='radio'&&current?.active&&current.fresh&&!current.readOnly
   &&current.metadataKnown!==false&&current.uri&&!items.some(item=>item.current)){
   items=[{
    id:`current:${current.uri}`,uri:current.uri,title:current.title,artist:current.artist,
    artwork:current.artwork,order:0,current:true,playing:current.playing===true,selectable:false,
   },...items];
  }
  const hidden=sourceKind==='radio';
  if(title.hidden!==hidden)title.hidden=hidden;
  if(this.queue.hidden!==hidden)this.queue.hidden=hidden;
  const queueHeading=items.some(item=>item.current)?'Afspilning og kø':'Næste i køen';
  const heading=status==='error'?(errorKind==='choice'?'Køvalget blev afvist':'Køen kunne ikke hentes')
   :status==='unknown'?'Afspilning ikke bekræftet':status==='stale'?'Køen er ikke opdateret':queueHeading;
  const busy=String(['loading','pending'].includes(status));
  const label=status==='stale'?'Køen er ikke opdateret'
   :status==='error'?(errorKind==='choice'?'Køvalget blev afvist':'Køen kunne ikke opdateres'):queueHeading;
  if(title.textContent!==heading)title.textContent=heading;
  if(this.queue.dataset.status!==status)this.queue.dataset.status=status;
  if(this.queue.getAttribute?.('aria-busy')!==busy)this.queue.setAttribute('aria-busy',busy);
  if(this.queue.getAttribute?.('aria-label')!==label)this.queue.setAttribute('aria-label',label);
  const wanted=new Set(items.map(item=>item.displayId??item.id));
  items.forEach((item,index)=>{
   const displayKey=item.displayId??item.id;
   let row=this.rows.get(displayKey);
   if(!row){row=this.createRow(displayKey);this.rows.set(displayKey,row);}
   row.queueItem=item;
   const pending=!item.current&&item.pending===true;
   if(pending){if(row.getAttribute('aria-busy')!=='true')row.setAttribute('aria-busy','true');}
   else if(row.getAttribute('aria-busy')!==null)row.removeAttribute('aria-busy');
   const revision=String(item.revision??''),disabled=item.current?this.doc.getElementById('play-pause').disabled:item.selectable!==true,aria=`${item.current?(item.playing===true?'Spiller nu:':item.playing===false?'På pause:':'Aktuelt nummer:'):pending?'Starter:':item.selectable?'Afspil':'Kun visning:'} ${[item.current?'':String(item.order),txt(item.title),txt(item.artist)].filter(Boolean).join(' · ')}`,order=String(item.order),name=txt(item.title),artist=txt(item.artist);if(row.dataset.current!==String(item.current===true))row.dataset.current=String(item.current===true);const playback=item.current?(item.playing===true?'playing':item.playing===false?'paused':'unknown'):'upcoming';if(row.dataset.playback!==playback)row.dataset.playback=playback;if(item.current){if(row.getAttribute('aria-current')!=='true')row.setAttribute('aria-current','true');}else if(row.getAttribute('aria-current')!==null)row.removeAttribute('aria-current');if(row.children[0].getAttribute?.('aria-label')!==(item.current?(item.playing===true?'Spiller nu':item.playing===false?'På pause':'Aktuelt nummer'):'Placering'))row.children[0].setAttribute('aria-label',item.current?(item.playing===true?'Spiller nu':item.playing===false?'På pause':'Aktuelt nummer'):'Placering');if(row.dataset.revision!==revision)row.dataset.revision=revision;if(row.disabled!==disabled)row.disabled=disabled;const actionLabel=item.current&&typeof item.playing==='boolean'?`${aria} · ${item.playing?'Sæt på pause':'Fortsæt'}`:aria;if(row.getAttribute?.('aria-label')!==actionLabel)row.setAttribute('aria-label',actionLabel);if(item.current){const slot=row.children[0];let icon=slot.querySelector('img');if(!icon){slot.textContent='';icon=this.doc.createElement('img');icon.alt='';icon.width=24;icon.height=24;slot.append(icon);}const source=`assets/icons/${item.playing===true?'soundwave':item.playing===false?'pause-fill':'music-note-beamed'}.svg`;if(icon.getAttribute('src')!==source)icon.src=source;}else if(row.children[0].textContent!==order)row.children[0].textContent=order;const actionIcon=`assets/icons/${item.current&&item.playing?'pause':'play'}-fill.svg`;if(row.children[3].getAttribute('src')!==actionIcon)row.children[3].src=actionIcon;this.artwork(row.children[1],item);if(row.children[2].children[0].textContent!==name)row.children[2].children[0].textContent=name;if(row.children[2].children[1].textContent!==artist)row.children[2].children[1].textContent=artist;if(this.queue.children[index]!==row)this.queue.insertBefore(row,this.queue.children[index]||null);});
  for(const[id,row]of this.rows)if(!wanted.has(id)){cancelArtwork(row.children[1]);row.remove();this.rows.delete(id);}// Loading keeps the list's height: four empty rows of the real row anatomy, hidden from assistive
  // technology and never queue items, instead of an empty list or spinner text (K2/K4).
  if(placeholders&&status==='loading'&&!items.some(item=>!item.current)){this.placeholders??=[0,1,2,3].map(n=>{const row=this.createRow(`placeholder:${n}`);row.dataset.placeholder='true';row.setAttribute('aria-hidden','true');row.tabIndex=-1;row.disabled=true;return row;});for(const row of this.placeholders)if(row.parentNode!==this.queue)this.queue.append(row);}else for(const row of this.placeholders||[])row.remove();
  if(status!=='loading'&&!items.some(item=>!item.current)&&empty){this.empty??=this.doc.createElement('p');if(this.empty.className!=='queue-empty')this.empty.className='queue-empty';if(this.empty.textContent!==empty)this.empty.textContent=empty;if(this.empty.parentNode!==this.queue)this.queue.append(this.empty);}else this.empty?.remove();

 }
 resume(){if(!this.suspended||this.host.isConnected===false)return;this.suspended=false;for(const id of ['volume','detail-volume']){const input=this.doc.getElementById(id);if(input)this.bindVolumeInput(input);}this.volumeMute?.addEventListener('click',this.volumeMuteClick);this.doc.getElementById('cover')?.addEventListener('load',this.coverToneLoad);this.doc.getElementById('cover')?.addEventListener('error',this.coverToneLoad);const root=this.doc.getElementById('player-progress');if(this.seekControl&&root&&this.seekControl.parentNode!==root)root.insertBefore(this.seekControl,this.doc.getElementById('player-progress-meter'));}
 cleanup(){for(const[input,listeners]of this.volumeInputListeners)for(const[type,listener]of Object.entries(listeners))input.removeEventListener(type,listener);this.volumeInputListeners.clear();this.volumeGestures.clear();clearTimeout(this.progressClockTimer);this.progressClockTimer=null;this.progressClockKey=null;this.progressDisplay=null;this.suspended=true;this.volumeMute?.removeEventListener('click',this.volumeMuteClick);this.volumeRestore=null;this.volumeMuteRequest=null;this.volumeMuteVM=null;if(this.coverToneRequest){this.coverToneRequest.image.onload=null;this.coverToneRequest.image.onerror=null;this.coverToneRequest.image.removeAttribute?.('src');this.coverToneRequest=null;}this.doc.getElementById('cover')?.removeEventListener('load',this.coverToneLoad);this.doc.getElementById('cover')?.removeEventListener('error',this.coverToneLoad);this.coverTones.clear();this.seekDraft=null;this.seekGesture=null;this.progressVM=null;this.sourceFocus=null;this.seekControl?.remove();for(const node of [this.doc.getElementById('cover'),this.doc.getElementById('detail-cover'),...[...this.rows.values(),...(this.queuePlaceholders||[])].map(row=>row.children[1])])if(node)cancelArtwork(node);}

}
