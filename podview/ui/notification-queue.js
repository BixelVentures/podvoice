// One finite notification surface for connection, playback and journey events.
// Unchanged source updates are idempotent; outcomes wait instead of overlapping.
export class NotificationQueue {
 constructor(render,{setTimer=(callback,delay)=>globalThis.setTimeout(callback,delay),clearTimer=id=>globalThis.clearTimeout(id),duration=6000}={}){this.render=render;this.setTimer=setTimer;this.clearTimer=clearTimer;this.duration=duration;this.signatures=new Map();this.pending=[];this.current=null;}
 update(source,message,{pending=false,retry=false,priority=false}={}){
  message=String(message||'');const signature=JSON.stringify([message,pending,retry]);
  if(this.signatures.get(source)===signature)return;
  this.signatures.set(source,signature);this.pending=this.pending.filter(item=>item.source!==source);
  if(!message){if(this.current?.source===source){this.clearTimer(this.timer);this.current=null;this.next();}return;}
  const item={source,message,pending,retry};
  if(priority&&this.current?.source!==source){if(this.current)this.pending.unshift(this.current);this.clearTimer(this.timer);this.current=null;this.pending.unshift(item);}
  else if(this.current?.source===source){this.clearTimer(this.timer);this.current=null;this.pending.unshift(item);}else this.pending.push(item);
  if(!this.current)this.next();
 }
 dismiss(item=this.current){if(!item||this.current!==item)return false;this.clearTimer(this.timer);this.current=null;this.next();return true;}
 next(){const clock=this.clock=(this.clock||0)+1,item=this.pending.shift()||null;this.current=item;this.render(item);this.timer=item?this.setTimer(()=>{if(this.current===item&&this.clock===clock)this.dismiss(item);},this.duration):null;}
 cleanup(){this.clearTimer(this.timer);this.pending=[];this.current=null;this.signatures.clear();this.render(null);}
}
