// A moving glyph means only that the current observation says cleaning. It
// carries no room path, coverage, estimated finish time or physical verification.
export function robotIsCleaning(device,{connected=true,live=false,now=Date.now()}={}){
 if(!connected||!device||device.status!=='cleaning'||device.stale||device.hidden)return false;
 if(live||device.live)return device.live===true&&device.source==='home_assistant_state'&&Number.isFinite(device.observedAt)&&now-device.observedAt*1000<=90000&&device.observedAt*1000-now<=5000;
 return true; // Explicit local demo observations use the same glyph behavior.
}
const frames=[
 {transform:'translate(0, 0) rotate(0deg)',offset:0},
 {transform:'translate(2px, -1px) rotate(5deg)',offset:.25},
 {transform:'translate(0, 1px) rotate(0deg)',offset:.5},
 {transform:'translate(-2px, 0) rotate(-5deg)',offset:.75},
 {transform:'translate(0, 0) rotate(0deg)',offset:1}
];
export class RobotMotion{
 constructor(host,{document=globalThis.document,media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),Observer=globalThis.MutationObserver,now=Date.now,setTimer=(...args)=>globalThis.setTimeout(...args),clearTimer=(...args)=>globalThis.clearTimeout(...args)}={}){
  this.host=host;this.document=document;this.media=media;this.Observer=Observer;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.expiryTimer=null;this.expiryAt=null;this.animations=new Map();this.onChange=()=>this.sync();
 }
 attach(){if(this.attached)return;this.attached=true;this.media?.addEventListener('change',this.onChange);this.document?.addEventListener('visibilitychange',this.onChange);if(this.Observer){this.observer=new this.Observer(this.onChange);this.observer.observe(this.host,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','data-motion']});}}
 candidates(){
  const result=[],devices=this.host.state?.devices||[];
  for(const tile of this.host.querySelectorAll('.resource-preview[data-kind="vacuum"]'))result.push({icon:tile.querySelector('.resource-visual img'),device:devices.find(d=>d.id===tile.dataset.target)});
  for(const widget of this.host.querySelectorAll('pv-vacuum-widget'))result.push({icon:widget.querySelector('.pv-instrument img'),device:devices.find(d=>d.id===widget.data?.context?.resourceId)});
  for(const panel of this.host.querySelectorAll('pv-robot-control-panel'))result.push({icon:panel.observation?.icon,device:panel.value?.device});
  return result;
 }
 sync(){
  if(!this.host.isConnected){this.cleanup();return;}this.attach();
  const reduced=this.media?.matches||this.host.dataset.motion==='reduced'||this.document?.documentElement?.dataset.motion==='reduced';
  const connected=this.host.live?!!this.host.liveTransport?.connected:this.host.state?.connected!==false,wanted=new Set(),now=this.now();let expiryAt=null;
  if(!reduced&&!this.document?.hidden)for(const {icon,device} of this.candidates()){
   if(!robotIsCleaning(device,{connected,live:this.host.live,now})||!icon?.animate||!icon.isConnected||!icon.getClientRects().length)continue;
   if(this.host.live||device.live){const expires=device.observedAt*1000+90001;expiryAt=expiryAt===null?expires:Math.min(expiryAt,expires);}
   wanted.add(icon);if(this.animations.has(icon))continue;
   const animation=icon.animate(frames,{duration:4200,iterations:Infinity,easing:'ease-in-out'});animation.id='pv-observed-robot-cleaning';this.animations.set(icon,animation);
  }
  for(const [icon,animation] of this.animations)if(!wanted.has(icon)){animation.cancel();this.animations.delete(icon);}
  if(this.expiryAt!==expiryAt){this.clearExpiry();if(expiryAt!==null){this.expiryAt=expiryAt;let handle;handle=this.setTimer(()=>{if(this.expiryTimer!==handle)return;this.expiryTimer=null;this.expiryAt=null;this.sync();},Math.max(1,expiryAt-now));this.expiryTimer=handle;this.expiryTimer?.unref?.();}}
 }
 clearExpiry(){if(this.expiryTimer!==null)this.clearTimer(this.expiryTimer);this.expiryTimer=null;this.expiryAt=null;}
 cleanup(){this.clearExpiry();for(const animation of this.animations.values())animation.cancel();this.animations.clear();this.observer?.disconnect();this.observer=null;this.media?.removeEventListener('change',this.onChange);this.document?.removeEventListener('visibilitychange',this.onChange);this.attached=false;}
}
