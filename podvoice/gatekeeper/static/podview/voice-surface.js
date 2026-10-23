// Display-only conversation surface. PodVoice remains the sole speech owner.
const phases={LISTENING:['listening','Lytter…','Tal bare'],THINKING:['thinking','Tænker…','Et øjeblik'],AI_SPEAKING:['responding','Svarer…',''],LOUNGE_WINDOW:['ready','Spørg videre',''],CLOSING:['closing','Afslutter…',''],UNKNOWN:['waiting','Venter…','']};
export function voicePresentation(voice,connected=true,visualPending=null){
 if(!connected||voice?.active!==true||!phases[voice.phase])return null;
 // Visual enrichment has its own lifecycle. It cannot replay a speech-phase
 // acknowledgement when the speaker, turn and visible status are unchanged.
 const [phase,label,detail]=phases[voice.phase];return {phase,label,detail,key:JSON.stringify([voice.sessionId||'',voice.turnId||'',phase])};
}
const make=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n;};
export class VoiceSurface{
 constructor(host){this.host=host;this.document=host.ownerDocument||globalThis.document;this.serial=0;this.node=make('div','voice-surface');this.node.hidden=true;this.node.setAttribute('role','status');this.node.setAttribute('aria-live','polite');this.node.setAttribute('aria-atomic','true');this.mark=make('span','voice-mark');this.mark.setAttribute('aria-hidden','true');const icon=make('img');this.icon=icon;icon.src='assets/icons/mic.svg';icon.alt='';this.mark.append(icon);const copy=make('div','voice-copy');this.label=make('strong');this.detail=make('span');copy.append(this.label,this.detail);this.node.append(this.mark,copy);const slot=host.querySelector('.header-activity')||host,history=host.querySelector('#open-history');if(history&&history.parentNode!==slot)slot.append(history);host.append(this.node);}
 attach(){if(this.attached)return;this.attached=true;this.media??=matchMedia('(prefers-reduced-motion: reduce)');this.onPreference??=()=>{if(this.reduced){this.cancelAnimations();if(!this.value)this.node.hidden=true;}};this.media.addEventListener?.('change',this.onPreference);this.onVisibility??=()=>{if(this.document?.hidden)this.cancelAnimations();else{this.position();this.startActivity();}};this.document?.addEventListener?.('visibilitychange',this.onVisibility);this.window=this.document?.defaultView||globalThis.window;this.onResize??=()=>this.position();this.window?.addEventListener?.('resize',this.onResize);this.window?.visualViewport?.addEventListener?.('resize',this.onResize);}
 get reduced(){return this.host.dataset.motion==='reduced'||(this.media||matchMedia('(prefers-reduced-motion: reduce)')).matches;}
 cancelAnimations(position=true){this.animation?.cancel();this.copyAnimation?.cancel();this.markAnimation?.cancel();this.animation=null;this.copyAnimation=null;this.markAnimation=null;if(position){this.positionAnimation?.cancel();this.positionAnimation=null;}}
 animate(node,frames,duration,iterations=1){if(this.reduced||!this.host.isConnected||this.document?.hidden||typeof node?.animate!=='function')return null;return node.animate(frames,{duration,iterations,easing:'cubic-bezier(.2,0,0,1)'});}
 startActivity(){
  if(this.markAnimation||!this.value||this.node.hidden||this.reduced||this.document?.hidden)return;
  const phase=this.value.phase,active=['listening','thinking','responding','waiting'].includes(phase);
  const frames=phase==='listening'?[{opacity:.65,transform:'scale(.94)'},{opacity:1,transform:'scale(1.06)'},{opacity:.65,transform:'scale(.94)'}]:phase==='responding'?[{opacity:.65,transform:'scaleY(.72)'},{opacity:1,transform:'scaleY(1)'},{opacity:.65,transform:'scaleY(.72)'}]:active?[{opacity:.82,transform:'scale(.88)'},{opacity:1,transform:'scale(1.08)'},{opacity:.82,transform:'scale(.88)'}]:[{opacity:.45,transform:'scale(.88)'},{opacity:1,transform:'none'}];
  const animation=this.animate(this.mark,frames,active?(phase==='responding'?720:phase==='listening'?1200:1400):180,active?Infinity:1);this.markAnimation=animation;
  if(animation)animation.finished.catch(()=>{}).finally(()=>{if(this.markAnimation===animation)this.markAnimation=null;});
 }
 position(value=this.value){
  const history=this.host.querySelector('#open-history'),slot=this.host.querySelector('.header-activity')||this.host,active=!!value&&this.host.dataset.view==='active';
  // The original history action stays in the topbar. The same status node
  // moves independently of its semantic phase and ongoing mark activity.
  if(history&&history.parentNode!==slot)slot.append(history);
  if(this.node.parentNode!==this.host)this.host.append(this.node);
  if(active&&history){
   if(!this.historyButton){this.historyButton=history;this.historyLabel=history.getAttribute('aria-label');}
   if(history.dataset.voicePhase!==value.phase)history.dataset.voicePhase=value.phase;
   if(this.host.dataset.voicePhase!==value.phase)this.host.dataset.voicePhase=value.phase;
   const label=`${value.label} · Se tidligere svar`;if(history.getAttribute('aria-label')!==label)history.setAttribute('aria-label',label);
  }else{
   if(this.host.dataset.voicePhase!==undefined)delete this.host.dataset.voicePhase;
   if(this.historyButton){delete this.historyButton.dataset.voicePhase;if(this.historyLabel===null)this.historyButton.removeAttribute('aria-label');else if(this.historyButton.getAttribute('aria-label')!==this.historyLabel)this.historyButton.setAttribute('aria-label',this.historyLabel);this.historyButton=null;}
  }
  if(!value||!this.host.isConnected)return;
  const style=globalThis.getComputedStyle?.(this.node),topbar=Number.parseFloat(style?.getPropertyValue('--pv-s2'))||16,inset=Number.parseFloat(style?.getPropertyValue('--pv-s3'))||24;
  const photo=this.host.dataset.view==='rest'?this.host.querySelector('#photo-view'):null,box=photo&&!photo.hidden?photo.getBoundingClientRect?.():null;
  const top=box&&Number.isFinite(box.top)&&box.height>=48?box.top+Math.min(inset,Math.max(0,(box.height-48)/2)):topbar;
  if(this.positionTop===top)return;
  // Read the in-flight visible position before cancelling a superseded move.
  const from=this.positionTop===undefined||this.node.hidden?top:this.node.getBoundingClientRect?.().top??this.positionTop;
  this.positionAnimation?.cancel();this.positionAnimation=null;this.positionTop=top;this.node.style.setProperty('--pv-voice-top',`${top}px`);
  if(Math.abs(from-top)<.5)return;
  const animation=this.animate(this.node,[{transform:`translateY(${from-top}px)`},{transform:'none'}],240);this.positionAnimation=animation;
  if(animation)animation.finished.catch(()=>{}).finally(()=>{if(this.positionAnimation===animation)this.positionAnimation=null;});
 }
 update(value){
  if(!this.host.isConnected){this.cleanup();return;}this.attach();this.position(value);if(this.reduced){this.cancelAnimations();if(!this.value)this.node.hidden=true;}if(value?.key===this.value?.key)return;const wasVisible=!this.node.hidden,serial=++this.serial;this.value=value;this.cancelAnimations(!value);
  if(!value){delete this.node.dataset.phase;if(!wasVisible)return;this.node.inert=true;this.node.setAttribute('aria-hidden','true');this.animation=this.animate(this.node,[{opacity:1},{opacity:0}],120);if(!this.animation){this.node.hidden=true;return;}const animation=this.animation;animation.finished.catch(()=>{}).then(()=>{if(serial===this.serial&&!this.value)this.node.hidden=true;if(this.animation===animation)this.animation=null;});return;}
  this.node.hidden=false;this.node.inert=false;this.node.removeAttribute('aria-hidden');this.node.dataset.phase=value.phase;const icon={listening:'mic',thinking:'chat-circle',responding:'soundwave',ready:'chat-circle',closing:'chat-circle',waiting:'chat-circle'}[value.phase]||'chat-circle';const source=`assets/icons/${icon}.svg`;if(this.icon.getAttribute('src')!==source)this.icon.src=source;this.label.textContent=value.label;this.detail.textContent=value.detail;this.detail.hidden=!value.detail;
  if(!wasVisible)this.animation=this.animate(this.node,[{opacity:0},{opacity:1}],120);
  else this.copyAnimation=this.animate(this.node.querySelector('.voice-copy'),[{opacity:.45},{opacity:1}],120);
  // Only the semantic mark carries ongoing activity. Screen positioning has
  // its own finite owner; an unchanged phase never restarts either cue.
  this.startActivity();this.position();
 }
 cleanup(){this.serial++;this.cancelAnimations();this.media?.removeEventListener?.('change',this.onPreference);this.document?.removeEventListener?.('visibilitychange',this.onVisibility);this.window?.removeEventListener?.('resize',this.onResize);this.window?.visualViewport?.removeEventListener?.('resize',this.onResize);this.attached=false;delete this.node.dataset.phase;this.value=null;this.position(null);this.node.style.removeProperty('--pv-voice-top');this.positionTop=undefined;this.node.hidden=true;this.node.inert=true;}
}
