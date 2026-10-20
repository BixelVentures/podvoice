// A display-only return to Ro. This never dismisses an answer or
// stops a resource. Speech completion must come from an explicit owner signal.
export function autoReturnCandidate(host){
 const s=host.state,answer=s?.answers?.find(item=>item.id===s.focus&&!item.hidden);
 if(!answer)return null;
 const identity=JSON.stringify([host.live?'live':'local',host.liveSnapshot?.bootId,answer.id,answer.sessionId,answer.turnId,answer.inputRevision]);
 const blocked=[s.timer,...s.extraTimers||[]].some(t=>t?.status==='done')||!!host.screenLifecycle?.pointers?.size||!!host.ownerDocument.activeElement?.matches?.('input,textarea,select,[contenteditable=true]')||answer.historical===true||['steps','checklist'].includes(answer.kind)||!!s.pendingAnswer||!!s.conflict||!!host.historyBrowse||!!host.ownerDocument?.querySelector('dialog[open], details[open]');
 let complete=false,connected=false,speaking=false;
 if(host.live){
  const snapshot=host.liveSnapshot,owner=snapshot?.answers,voice=snapshot?.voice;
  connected=host.liveStatus==='connected'&&host.liveTransport?.connected===true;
  speaking=voice?.active===true;
  complete=owner?.readOnlyCompleted===true&&voice?.active===false&&voice.sessionId===null&&snapshot.capabilities?.answerRead===true&&answer.live===true&&answer.readConnected===true&&['sessionId','turnId','taskId','inputRevision','revision'].every(key=>answer[key]===owner[key])&&!snapshot.visualPending;
 }else{
  connected=s.connected===true;
  speaking=['LISTENING','THINKING','AI_SPEAKING'].includes(s.voicePreviewPhase);
  complete=host.previewStage==='conversation-complete'&&s.voicePreviewPhase==='IDLE'&&answer.exampleOnly===true;
 }
 return {identity,eligible:connected&&complete&&!blocked&&(answer.readStatus||answer.status)==='ready',speaking};
}
export class AnswerAutoReturn{
 constructor(host,clock=globalThis){this.host=host;this.clock=clock;this.cancelled=new Set();this.timer=null;this.identity=null;this.attached=false;this.interact=()=>{this.cancel();this.sync();};this.visibility=()=>{if(this.host.ownerDocument?.visibilityState==='hidden')this.cancel(true);};}
 attach(){if(this.attached)return;this.attached=true;const doc=this.host.ownerDocument;for(const type of ['pointerdown','click','touchstart','wheel','keydown','scroll'])doc.addEventListener(type,this.interact,{capture:true,passive:true});doc.addEventListener('visibilitychange',this.visibility);}
 cancel(remember=false){if(remember){const key=autoReturnCandidate(this.host)?.identity||this.identity;if(key)this.cancelled.add(key);if(this.identity)this.cancelled.add(this.identity);}if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;this.identity=null;}
 sync(){
  this.attach();const candidate=autoReturnCandidate(this.host),hidden=this.host.ownerDocument?.visibilityState==='hidden';
  if(!this.host.isConnected||hidden){this.cancel(true);return;}
  if(!candidate?.eligible){if(this.timer!==null)this.cancel(true);return;}
  if(this.cancelled.has(candidate.identity))return;
  if(this.timer!==null&&this.identity===candidate.identity)return;
  this.cancel();this.identity=candidate.identity;
  this.timer=this.clock.setTimeout(()=>{
   const expected=this.identity,current=autoReturnCandidate(this.host);this.timer=null;this.identity=null;
   if(!expected)return;
   this.cancelled.add(expected);
   if(!this.host.isConnected||this.host.ownerDocument?.visibilityState==='hidden'||!current?.eligible||current.identity!==expected)return;
   this.host.sceneNavigation=true;this.host.dispatch({type:'show',id:'photo'});
  },90000);
 }
 cleanup(){this.cancel(true);if(!this.attached)return;const doc=this.host.ownerDocument;for(const type of ['pointerdown','click','touchstart','wheel','keydown','scroll'])doc.removeEventListener(type,this.interact,true);doc.removeEventListener('visibilitychange',this.visibility);this.attached=false;}
}
