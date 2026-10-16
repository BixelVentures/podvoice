// Display-only conversation surface. PodVoice remains the sole speech owner.
const phases={LISTENING:['listening','Lytter…','Tal bare'],THINKING:['thinking','Tænker…','Et øjeblik'],AI_SPEAKING:['responding','Svarer…',''],LOUNGE_WINDOW:['ready','Klar til mere','Du kan spørge videre'],UNKNOWN:['waiting','Vent et øjeblik…','']};
export function voicePresentation(voice,connected=true,visualPending=null){
 if(!connected||voice?.active!==true||!phases[voice.phase])return null;
 const [phase,label,detail]=phases[voice.phase];const pending=visualPending?.sessionId===voice.sessionId&&typeof visualPending?.taskId==='string'&&Number.isInteger(visualPending?.revision);return {phase,label,detail,key:[voice.sessionId||'',voice.turnId||'',phase,...(pending&&!detail?[visualPending.taskId,visualPending.revision]:[])].join(':')};
}
const make=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n;};
export class VoiceSurface{
 constructor(host){this.host=host;this.serial=0;this.node=make('aside','voice-surface');this.node.hidden=true;this.node.setAttribute('role','status');this.node.setAttribute('aria-live','polite');this.node.setAttribute('aria-atomic','true');this.mark=make('span','voice-mark');this.mark.setAttribute('aria-hidden','true');const icon=make('img');icon.src='assets/icons/mic.svg';icon.alt='';this.mark.append(icon);const copy=make('div','voice-copy');this.label=make('strong');this.detail=make('span');copy.append(this.label,this.detail);this.node.append(this.mark,copy);(host.querySelector('.header-activity')||host).append(this.node);}
 attach(){if(this.attached)return;this.attached=true;this.media??=matchMedia('(prefers-reduced-motion: reduce)');this.onPreference??=()=>{if(this.reduced){this.cancelAnimations();if(!this.value)this.node.hidden=true;}};this.media.addEventListener?.('change',this.onPreference);}
 get reduced(){return this.host.dataset.motion==='reduced'||(this.media||matchMedia('(prefers-reduced-motion: reduce)')).matches;}
 cancelAnimations(){this.animation?.cancel();this.copyAnimation?.cancel();this.markAnimation?.cancel();this.animation=null;this.copyAnimation=null;this.markAnimation=null;}
 animate(node,frames,duration){if(this.reduced||!this.host.isConnected)return null;return node.animate(frames,{duration,easing:'cubic-bezier(.16,1,.3,1)'});}
 position(){if(this.host.dataset.view!=='rest')return;const photo=this.host.querySelector('#photo-view');if(!photo?.getClientRects().length)return;const box=photo.getBoundingClientRect(),height=this.node.offsetHeight||60;this.node.style.setProperty('--voice-rest-left',`${box.left+box.width/2}px`);this.node.style.setProperty('--voice-rest-top',`${box.top+Math.max(16,Math.min(box.height-height-16,(box.height-height)/2))}px`);}
 update(value){
  if(!this.host.isConnected){this.cleanup();return;}this.attach();this.position();if(this.reduced)this.cancelAnimations();if(value?.key===this.value?.key)return;const wasVisible=!this.node.hidden,serial=++this.serial;this.value=value;clearTimeout(this.slowTimer);this.cancelAnimations();
  if(!value){delete this.node.dataset.phase;if(!wasVisible)return;this.node.inert=true;this.node.setAttribute('aria-hidden','true');this.animation=this.animate(this.node,[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(-4px) scale(.98)'}],140);if(!this.animation){this.node.hidden=true;return;}this.animation.finished.catch(()=>{}).then(()=>{if(serial===this.serial&&!this.value)this.node.hidden=true;});return;}
  this.node.hidden=false;this.node.inert=false;this.node.removeAttribute('aria-hidden');this.node.dataset.phase=value.phase;this.label.textContent=value.label;this.detail.textContent=value.detail;this.detail.hidden=!value.detail;
  if(!wasVisible)this.animation=this.animate(this.node,[{opacity:0,transform:'translateY(-4px) scale(.98)'},{opacity:1,transform:'none'}],220);
  else this.copyAnimation=this.animate(this.node.querySelector('.voice-copy'),[{opacity:.45},{opacity:1}],160);
  // One finite acknowledgement per actual owner phase; never an audio meter.
  this.markAnimation=this.animate(this.mark,[{transform:'scale(.9)',opacity:.65},{transform:'scale(1)',opacity:1}],220);
  this.position();
  if(value.phase==='thinking')this.slowTimer=setTimeout(()=>{if(serial===this.serial&&this.host.isConnected)this.detail.textContent='Det tager lidt længere tid';},4000);
 }
 cleanup(){this.serial++;clearTimeout(this.slowTimer);this.cancelAnimations();this.media?.removeEventListener?.('change',this.onPreference);this.attached=false;delete this.node.dataset.phase;this.value=null;this.node.hidden=true;this.node.inert=true;}
}
