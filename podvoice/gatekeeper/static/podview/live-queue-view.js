import {roomObservationCurrent,playbackBinding} from './media-observation.js';
import {spotifyArtwork} from './spotify-artwork.js';
const text=(v,n=160)=>typeof v==='string'&&v.length>0&&v.length<=n;
const int=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isInteger(v)&&v>=min&&v<=max;
export function queueOffer(body,snapshot,account,target,requestedAt=Date.now(),expectedBindingId=null){
 if(!body||Object.keys(body).sort().join(',')!=='accountId,bootId,expectedBindingId,expiresInMs,items,ok,ownerEpoch,pollSequence,revision,roomId,schema,targetId,taskId,truncated'||body.ok!==true||body.schema!=='podview.queue-offer.v1'||body.bootId!==snapshot?.bootId||body.roomId!==snapshot?.roomId||body.accountId!==account||body.targetId!==target||typeof expectedBindingId!=='string'||!/^[a-f0-9]{64}$/.test(expectedBindingId)||body.expectedBindingId!==expectedBindingId||!/^queue:[a-f0-9]{32}$/.test(body.taskId)||body.revision!==1||!int(body.expiresInMs,1,10000)||!text(body.ownerEpoch,128)||!int(body.pollSequence,1)||typeof body.truncated!=='boolean'||!Array.isArray(body.items)||body.items.length>20||!Number.isFinite(requestedAt)||requestedAt>Date.now()||requestedAt+body.expiresInMs<=Date.now())return null;
 const seen=new Set();for(const [index,row] of body.items.entries()){if(!row||typeof row!=='object'||Array.isArray(row)||!["artist,artwork,id,order,title,uri","artist,artwork,id,metadataKnown,order,title,uri"].includes(Object.keys(row).sort().join(','))||Object.hasOwn(row,'metadataKnown')&&typeof row.metadataKnown!=='boolean'||!text(row.id,24)||!/^[a-f0-9]{24}$/.test(row.id)||seen.has(row.id)||row.order!==index+1||typeof row.title!=='string'||row.title.length>256||(row.metadataKnown!==false&&!row.title.trim())||(typeof row.artist!=='string'||row.artist.length>512)||!/^spotify:track:[A-Za-z0-9]{22}$/.test(row.uri))return null;seen.add(row.id);}
 return {...body,items:body.items.map(row=>({...row,artwork:spotifyArtwork(row.artwork,row.uri)})),expiresAt:requestedAt+body.expiresInMs};
}
// The playback owner is independent of the conversation and answer shown alongside it.
const ownerScope = (host, account, playback) => [
 host.liveSnapshot?.bootId,
 host.liveSnapshot?.roomId,
 account,
 playback?.roomBinding?.bindingId,
 playback?.owner_epoch,
 playback?.target?.id,
];
const scope = (host, account, playback) => JSON.stringify([
 ...ownerScope(host, account, playback),
 playback?.item?.uri ?? null,
]);
const displayScope = (host, account, playback) => JSON.stringify(ownerScope(host, account, playback));
const sameOccurrence=(a,b)=>a?.id===b?.id&&a?.uri===b?.uri;
export class LiveQueueView{
 constructor(host){this.host=host;this.generation=0;this.pending=false;this.pendingOccurrenceId=null;this.consumed=false;this.offer=null;this.retained=null;this.status='unavailable';this.errorKind=null;this.readRetryable=false;this.waitingChoices=[];this.reconcilingChoice=null;this.unknownChoice=null;}
 redraw(){this.host.liveMedia?.renderQueue();}
 allowed(account,playback){return !!(this.host.isConnected&&this.host.liveTransport?.connected&&this.host.liveSnapshot?.capabilities?.queueSelection===true&&this.host.liveSnapshot?.capabilities?.musicRead?.includes('queue')&&text(account)&&roomObservationCurrent(playback,this.host.liveSnapshot)&&playbackBinding(playback,this.host.liveSnapshot,account)&&playback.target?.id);}
 invalidate(revoke=false,preserveChoices=false){
  this.readRetryable=false;
  this.generation++;
  this.pending=false;
  this.effectPending=false;
  this.pendingOccurrenceId=null;
  this.offer=null;
  this.status='stale';
  this.errorKind=null;
  clearTimeout(this.expiryTimer);
  if(revoke){
   this.retained=null;
   this.unknownChoice=null;
  }
  if(revoke||!preserveChoices){
   this.waitingChoices=[];
   this.reconcilingChoice=null;
  }
 }
 async load(account,playback,{notify=false,preserveChoices=false}={}){
  if(this.pending||this.host.liveControls?.musicIntentPending)return false;
  this.invalidate(false,preserveChoices);
  if(!this.allowed(account,playback))return false;
  this.unknownChoice=null;
  if(notify)this.host.showFeedback?.('',false,{source:'queue'});const generation=this.generation,key=scope(this.host,account,playback),requestedAt=Date.now();const transport=this.host.liveTransport,transportGeneration=transport.generation;let diagnosticCode='failure';const readDiagnostic=transport.createReadDiagnostic?.(),record=value=>{if(typeof transport.recordReadDiagnostic==='function')transport.recordReadDiagnostic('queue_read',value,readDiagnostic);else transport.recordDiagnostic?.('queue_read',value);};record({code:'start'});this.pending=true;this.status='loading';this.redraw();try{const body=await this.host.liveTransport.queueOffer(account,playback.target.id,playbackBinding(playback,this.host.liveSnapshot,account)?.bindingId,...(readDiagnostic?[{readDiagnostic}]:[]));if(generation!==this.generation||this.host.liveTransport!==transport||transport.generation!==transportGeneration||key!==scope(this.host,this.host.liveMedia?.account,this.host.liveMedia?.playback)||!this.allowed(account,playback)){record({code:'superseded',current:false,durationMs:Date.now()-requestedAt});return false;}diagnosticCode='invalid_dto';const value=queueOffer(body,this.host.liveSnapshot,account,playback.target.id,requestedAt,playbackBinding(playback,this.host.liveSnapshot,account)?.bindingId);if(value&&(value.ownerEpoch!==playback.owner_epoch||value.pollSequence<playback.poll_sequence))diagnosticCode='stale_binding';if(!value||value.ownerEpoch!==playback.owner_epoch||value.pollSequence<playback.poll_sequence)throw Error('foreign_queue');record({code:value.items.length?'ok':'empty',count:value.items.length,durationMs:Date.now()-requestedAt});
   const displayKey = displayScope(this.host, account, playback);
   const previous = this.retained?.displayKey === displayKey ? this.retained.items : [];
   const items = [], unknown = [];
   for (const row of value.items) {
    if (row.metadataKnown !== false) {
     items.push(row);
     continue;
    }
    const candidates = [...previous, ...value.items].filter(
     prior => prior.uri === row.uri && prior.metadataKnown !== false,
    );
    const known = candidates[0];
    const signature = known && JSON.stringify([known.title, known.artist, known.artwork]);
    if (known && candidates.every(prior => JSON.stringify([prior.title, prior.artist, prior.artwork]) === signature)) {
     items.push({...row, title: known.title, artist: known.artist, artwork: known.artwork, metadataKnown: true});
    } else {
     unknown.push(row);
    }
   }
   // Incomplete metadata keeps the known list for display. Donors never supply occurrence IDs or order.
   const retainDisplay = unknown.length > 0 && previous.length > 0;
   const hasCurrentRows=!retainDisplay||previous.some(row=>value.items.some(item=>sameOccurrence(item,row)));
   this.offer = value;
   this.retained = {
    key: hasCurrentRows ? key : null,
    displayKey,
    items: retainDisplay ? previous : items,
    metadataPending: unknown.length > 0,
    shownOffer: value,
    transport,
    transportGeneration,
   };
   this.consumed = false;
   this.status = unknown.length ? 'stale' : 'ready';
   this.expiryTimer=setTimeout(()=>{if(this.offer===value){this.offer=null;if(!this.pending)this.status='stale';this.redraw();}},Math.max(0,value.expiresAt-Date.now()));return true;}catch(error){if(generation===this.generation&&this.host.liveTransport===transport&&transport.generation===transportGeneration)this.readRetryable=!!(error?.code==='read_transient'&&diagnosticCode==='failure'&&generation===this.generation&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&key===scope(this.host,this.host.liveMedia?.account,this.host.liveMedia?.playback)&&this.allowed(account,playback));record({code:error?.name==='TimeoutError'?'timeout':error?.name==='AbortError'?'cancelled':error?.name==='TypeError'?'network':error?.code==='read_transient'?'http_transient':diagnosticCode,current:generation===this.generation&&this.host.liveTransport===transport&&transport.generation===transportGeneration,durationMs:Date.now()-requestedAt});if(generation===this.generation&&this.host.liveTransport===transport&&transport.generation===transportGeneration){this.offer=null;this.status='error';this.errorKind='read';if(notify&&key===scope(this.host,this.host.liveMedia?.account,this.host.liveMedia?.playback)&&this.allowed(account,playback))this.host.showFeedback?.('Køen kunne ikke hentes. Den kendte sang bevares.',false,{source:'queue'});}return false;}finally{if(generation===this.generation){this.pending=false;this.redraw();}}}
 choiceScope(account,playback){
  const transport=this.host.liveTransport,capabilities=this.host.liveSnapshot?.capabilities;
  if(!this.allowed(account,playback))return null;
  return {
   key:JSON.stringify([displayScope(this.host,account,playback),capabilities.musicRead]),
   transport,generation:transport.generation,
  };
 }
 sameChoiceScope(a,b){
  return !!(a&&b&&a.key===b.key&&a.transport===b.transport&&a.generation===b.generation);
 }
 unknownRecoveryReady(account,playback){
  const unknown=this.unknownChoice;
  return !!(unknown&&playback?.poll_sequence>unknown.pollSequence
   &&this.sameChoiceScope(unknown.scope,this.choiceScope(account,playback)));
 }
 model(account,playback){
  const choiceScope=this.choiceScope(account,playback);
  const snapshot=this.host.liveSnapshot,transport=this.host.liveTransport;
  if(this.unknownChoice&&(
   choiceScope&&!this.sameChoiceScope(this.unknownChoice.scope,choiceScope)
   ||!transport?.connected||transport!==this.unknownChoice.scope.transport
   ||transport.generation!==this.unknownChoice.scope.generation
   ||snapshot?.capabilities?.queueSelection!==true||!snapshot.capabilities.musicRead?.includes('queue')
  ))this.unknownChoice=null;
  if(this.reconcilingChoice&&!this.sameChoiceScope(this.reconcilingChoice.scope,choiceScope)){
   this.reconcilingChoice=null;
   this.waitingChoices=[];
  }
  if(this.waitingChoices.length&&!this.sameChoiceScope(this.waitingChoices[0].scope,choiceScope)){
   this.waitingChoices=[];
  }
  if(!this.retained)return null;
  if(this.retained.displayKey!==displayScope(this.host,account,playback)){
   this.retained=null;
   this.offer=null;
   return null;
  }
  const sameAuthority=this.retained.key===scope(this.host,account,playback);
  if(!sameAuthority){
   this.retained.key=null;
   this.offer=null;
  }
  const shownOffer=this.retained.shownOffer;
  const renewUnknown=this.sameChoiceScope(this.unknownChoice?.scope,choiceScope);
  const currentOffer=!this.retained.metadataPending||this.offer===shownOffer&&shownOffer?.expiresAt>Date.now();
  const selectable=!!(choiceScope&&shownOffer&&this.retained.transport===choiceScope.transport
   &&this.retained.transportGeneration===choiceScope.generation
   &&(renewUnknown||this.reconcilingChoice||sameAuthority&&(this.effectPending||!this.consumed&&currentOffer)));
  const latest=this.waitingChoices.at(-1);
  const visibleChoice=latest&&this.retained.items.some(row=>sameOccurrence(row,latest));
  const pendingId=visibleChoice?latest.id:this.effectPending?this.pendingOccurrenceId:null;
  return {
   errorKind:this.errorKind,
   metadataPending:this.retained.metadataPending===true,
   items:this.retained.items.map(row=>({
    ...row,
    selectable:selectable&&row.id!==this.reconcilingChoice?.occurrenceId
     &&shownOffer.items.some(item=>sameOccurrence(item,row)),
    ...(renewUnknown?{renewUnknown:true}:{}),
    ...(choiceScope&&row.id===pendingId?{pending:true}:{}),
   })),
   status:this.pending?this.status:!sameAuthority||this.status==='ready'&&!this.offer?'stale':this.status,
  };
 }
 async drainChoices(previousTaskId,offer){
  if(!this.waitingChoices.length)return;
  const media=this.host.liveMedia,choiceScope=this.choiceScope(media?.account,media?.playback);
  const fresh=offer&&offer.taskId!==previousTaskId&&offer===this.retained?.shownOffer
   &&offer.expiresAt>Date.now();
  while(this.waitingChoices.length){
   const input=this.waitingChoices.shift();
   if(!this.sameChoiceScope(input.scope,choiceScope))continue;
   // Newly exposed rows can lack labels. Retained display stays read-only, but
   // a recorded tap may use this exact occurrence in the newly admitted offer.
   const row=fresh&&offer.items.find(item=>sameOccurrence(item,input));
   if(row){
    await this.sendChoice(row,offer,choiceScope);
    return;
   }
   const absent=fresh&&!offer.truncated&&!offer.items.some(item=>item.uri===input.uri);
   const message=absent?'Dit næste valg er ikke længere i køen.':'Dit næste køvalg kunne ikke bekræftes.';
   this.host.showFeedback?.(message,false,{source:'queue'});
  }
  this.redraw();
 }
 async choose(item){
  const media=this.host.liveMedia;
  const model=this.model(media?.account,media?.playback),shownOffer=this.retained?.shownOffer;
  const selected=model?.items.find(row=>row.selectable&&sameOccurrence(row,item));
  if(!selected||!shownOffer?.items.some(row=>sameOccurrence(row,selected)))return;
  const choiceScope=this.choiceScope(media.account,media.playback);
  const input={scope:choiceScope,id:selected.id,uri:selected.uri};
  if(this.effectPending||this.reconcilingChoice){
   // This is local intent only. The spent shown task never authorizes a second action.
   this.waitingChoices.push(input);
   this.redraw();
   return;
  }
  if(selected.renewUnknown){
   // A newly presented touch may request fresh authority. An earlier row cannot.
   if(item.renewUnknown!==true||this.host.liveControls?.musicIntentPending)return;
   const reconciliation={scope:choiceScope,occurrenceId:null};
   this.reconcilingChoice=reconciliation;
   this.waitingChoices.push(input);
   this.redraw();
   return this.renewChoices(media,shownOffer.taskId,reconciliation);
  }
  return this.sendChoice(selected,shownOffer,choiceScope);
 }
 async renewChoices(media,previousTaskId,reconciling){
  const waiting=this.waitingChoices;
  const loaded=await this.load(media.account,media.playback,{preserveChoices:true});
  if(reconciling?this.reconcilingChoice===reconciling:this.waitingChoices===waiting){
   const freshOffer=loaded?this.retained?.shownOffer:null;
   this.reconcilingChoice=null;
   this.redraw();
   await this.drainChoices(previousTaskId,freshOffer);
  }
 }
 async sendChoice(selected,shownOffer,choiceScope){
  const media=this.host.liveMedia,controls=this.host.liveControls;
  if(controls?.musicIntentPending){
   this.host.showFeedback?.('Afvent den igangværende handling.',false,{source:'queue'});
   return;
  }
  const waiting=this.waitingChoices;
  const token=controls?.beginMusicIntent?.();
  if(controls&&!token)return;
  if(!controls)this.invalidate();
  this.waitingChoices=waiting;
  const generation=this.generation,key=scope(this.host,media.account,media.playback);
  const transport=this.host.liveTransport,transportGeneration=transport.generation;
  const pollSequence=media.playback.poll_sequence;
  let sent=false,outcome;
  // Only the accepted read continuation may cross a current-track change.
  // Display custody never revives the consumed task or a different owner/context.
  const readKey=scope(this.host,media.account,{...media.playback,item:null});
  const readCurrent=()=>generation===this.generation&&this.host.liveMedia===media&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&readKey===scope(this.host,media.account,{...media.playback,item:null})&&this.allowed(media.account,media.playback);
  const current=()=>generation===this.generation&&this.host.liveMedia===media&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&key===scope(this.host,media.account,media.playback)&&this.allowed(media.account,media.playback);
  this.host.showFeedback?.('',false,{source:'queue'});this.effectPending=true;this.pendingOccurrenceId=selected.id;this.pending=true;this.consumed=true;this.status='pending';this.errorKind=null;this.redraw();
  try{
   // The shown task binds the exact opaque occurrence/revision at the broker.
   // Expired display custody is not a native lease: fresh resolution/admission
   // belongs to the server, never a client URI/index remap or renewed deadline.
   if(!current())return;this.offer=null;sent=true;
   const result=await transport.queueAction(shownOffer,selected.id);outcome=result.outcome;transport.recordDiagnostic?.('queue_action',{code:['accepted','unknown','rejected'].includes(result.outcome)?result.outcome:'other',requestId:result.requestId,current:current()});if(!current()&&!(result.outcome==='accepted'&&readCurrent()))return;
   this.status=result.outcome==='accepted'?'accepted':result.outcome==='unknown'?'unknown':'error';
   this.errorKind=this.status==='error'?'choice':null;
   if(result.outcome==='accepted')this.reconcilingChoice={scope:choiceScope,occurrenceId:selected.id};
   this.consumed=true;
   this.effectPending=false;
   this.pendingOccurrenceId=null;
   this.pending=false;
   controls?.endMusicIntent?.(token,result.outcome);
   this.redraw();
   if(result.outcome!=='accepted')this.host.showFeedback?.(result.outcome==='unknown'?'Køvalg kunne ikke bekræftes · handlingen gentages ikke.':'Køvalget blev afvist. Den kendte sang bevares.',false,{source:'queue'});
   if(result.outcome==='accepted'){media.lastRead=0;await media.refresh();if(!current())return;}
  }catch{outcome=sent?'unknown':'rejected';transport.recordDiagnostic?.('queue_action',{code:sent?'unknown':'rejected',current:current()});if(current()){this.offer=null;this.status=sent?'unknown':'error';this.errorKind=sent?null:'choice';if(sent)this.consumed=true;this.host.showFeedback?.(sent?'Køvalg kunne ikke bekræftes · handlingen gentages ikke.':'Køvalget kunne ikke klargøres. Den kendte sang bevares.',false,{source:'queue'});}}
  finally{
   if(generation===this.generation){
    this.effectPending=false;
    this.pendingOccurrenceId=null;
    this.pending=false;
    this.redraw();
   }
   controls?.endMusicIntent?.(token,outcome);
   if(generation===this.generation){
    const reconciling=this.reconcilingChoice,waiting=this.waitingChoices;
    if(readCurrent()&&(this.status==='accepted'||outcome==='rejected'&&waiting.length)){
     await this.renewChoices(media,shownOffer.taskId,reconciling);
    }else{
     this.reconcilingChoice=null;
     this.waitingChoices=[];
     if(outcome==='unknown'&&readCurrent()
      &&this.sameChoiceScope(choiceScope,this.choiceScope(media.account,media.playback))){
      this.unknownChoice={scope:choiceScope,pollSequence};
     }
     if(waiting.length&&outcome==='unknown'){
      this.host.showFeedback?.(
       'Køvalget kunne ikke bekræftes · dit næste valg blev ikke sendt.',false,{source:'queue'},
      );
     }
     if(reconciling||waiting.length||this.unknownChoice)this.redraw();
    }
   }
  }
 }
}
