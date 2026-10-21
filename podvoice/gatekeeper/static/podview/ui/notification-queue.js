// One finite notification surface for connection, playback and journey events.
// Unchanged source updates are idempotent; outcomes wait instead of overlapping.
export class NotificationQueue {
 constructor(render,{setTimer=(callback,delay)=>globalThis.setTimeout(callback,delay),clearTimer=id=>globalThis.clearTimeout(id),duration=4000}={}){this.render=render;this.setTimer=setTimer;this.clearTimer=clearTimer;this.duration=duration;this.signatures=new Map();this.pending=[];this.current=null;}
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
 next(){this.current=this.pending.shift()||null;this.render(this.current);if(this.current)this.timer=this.setTimer(()=>{this.current=null;this.next();},this.duration);}
 cleanup(){this.clearTimer(this.timer);this.pending=[];this.current=null;this.signatures.clear();this.render(null);}
}
