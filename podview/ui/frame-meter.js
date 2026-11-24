// On-device frame meter (docs/MOTION.md, "Måling på iPad'en"). Every touch opens a short motion session: from the
// finger down until the motion it started has settled (at most 1.5 s after release), requestAnimationFrame deltas
// are sampled. Each session becomes one small summary that is posted in batches to /view/api/frames, never while a
// session runs.
// Idle cost is zero: no rAF loop, no timer without a session or a queued summary. The meter never
// reads geometry or computed style and never writes the DOM; motion is seen generically through Web Animations
// (Element.prototype.animate), CSS transition/animation events and scroll events, and the kind is inferred from
// the host's view before and after. Motion code may label a session with begin(kind) / end() / moved().
const SCHEMA='podview.frames.v1',RELEASE_MAX_MS=1500,HOLD_MAX_MS=3000,QUIET_MS=200,SLOP_PX=10;
const FLUSH_MS=30000,QUEUE_MAX=50;
const VIEWS=new Set(['photo','now','music','player','timers','weather','radio','recipes','vehicle']);
let meter=null;

const round=value=>Math.round(value*10)/10;
function percentile(sorted,p){return sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)]:null;}
export function summarizeFrames(deltas){
 const sorted=[...deltas].sort((a,b)=>a-b),over=ms=>deltas.filter(d=>d>ms).length;
 return {frames:deltas.length,over17:over(17),over20:over(20),over34:over(34),over50:over(50),
  maxFrameMs:sorted.length?round(sorted.at(-1)):null,p95FrameMs:sorted.length?round(percentile(sorted,.95)):null};
}
export function shortUserAgent(ua=''){
 return String(ua).replace(/^Mozilla\/5\.0 /,'').replace(/ ?\(KHTML, like Gecko\)/,'')
  .replace(/[^\x20-\x7e]/g,'?').slice(0,160);
}
// The kind of motion a touch started, from the host's view before and after (no geometry).
export function inferKind(before,after,{scrolled,animations}){
 if(before.shell!==after.shell)return after.shell==='rest'?'ro-open':'ro-close';
 if(before.view!==after.view)return before.level==='detail'&&after.level==='home'?'pop':'push';
 if(scrolled)return 'scroll';
 return animations>0?'press':'tap';
}

export function installFrameMeter(win=globalThis.window,{fetch=win?.fetch?.bind(win),flushMs=FLUSH_MS}={}){
 if(meter||!win?.document||typeof win.requestAnimationFrame!=='function')return meter;
 const doc=win.document,perf=win.performance,now=()=>perf.now();
 const queue=[];let session=null,flushTimer=0,flushAfterSession=false,host=null;
 const view=()=>{host??=doc.querySelector('pv-widget-host');const state=host?.state;
  const history=doc.getElementById('history')?.open===true,focus=state?.focus;
  return {shell:host?.dataset.view,level:host?.dataset.level,
   view:history?'svar':typeof focus==='string'?(VIEWS.has(focus)?focus:'device'):null};};
 const activity=()=>{if(session)session.lastActivity=now();};
 const markMoved=()=>{if(!session)return;const t=now();activity();
  if(session.released&&session.movedAfter===null)session.movedAfter=t;};

 function start(kind=null,released=false){
  const t=now();
  session={kind,downAt:t,releaseAt:released?t:null,released,before:view(),
   frameTimes:[],deltas:[],lastTs:null,active:0,css:0,animations:0,scrolled:false,x:null,y:null,
   movedAfter:null,lastActivity:t};
  const s=session;
  const tick=ts=>{if(session!==s)return;const t=now();
   if(s.lastTs!==null)s.deltas.push(ts-s.lastTs);s.lastTs=ts;s.frameTimes.push(t);
   const quiet=s.active<=0&&s.css<=0&&t-s.lastActivity>=QUIET_MS;
   if(s.released?(t-s.releaseAt>=RELEASE_MAX_MS||(quiet&&t-s.releaseAt>=QUIET_MS)):t-s.downAt>=HOLD_MAX_MS)finish();
   else win.requestAnimationFrame(tick);};
  win.requestAnimationFrame(tick);
 }
 function release(){if(!session||session.released)return;session.released=true;session.releaseAt=now();}
 function finish(){
  const s=session;if(!s)return;session=null;
  const releaseAt=s.releaseAt??s.downAt,after=view(),anchor=s.movedAfter??releaseAt;
  const first=s.frameTimes.find(t=>t>=anchor),end=Math.max(s.lastActivity,releaseAt);
  queue.push({kind:s.kind||inferKind(s.before,after,s),from:s.before.view,to:after.view,...summarizeFrames(s.deltas),
   animations:Math.min(s.animations,10000),
   startLatencyMs:first===undefined?null:round(Math.max(0,first-releaseAt)),
   durationMs:round(Math.min(60000,end-releaseAt)),
   reduced:doc.documentElement.dataset.pvMotion==='reduced',
   ua:shortUserAgent(win.navigator?.userAgent),dpr:round(Math.min(8,Math.max(.1,win.devicePixelRatio||1))),
   at:Date.now()});
  if(queue.length>QUEUE_MAX)queue.splice(0,queue.length-QUEUE_MAX);
  if(flushAfterSession){flushAfterSession=false;flush();}
  else if(!flushTimer)flushTimer=win.setTimeout(()=>{flushTimer=0;flush();},flushMs);
 }
 function url(){
  const path=win.location?.pathname||'',at=path.lastIndexOf('/view/');if(at<0)return null;
  const target=new URL(path.slice(0,at+6)+'api/frames',win.location.origin);
  const room=new URLSearchParams(win.location.search).get('room');if(room)target.searchParams.set('room',room);
  return target;
 }
 function flush(){
  if(session){flushAfterSession=true;return false;}
  if(flushTimer){win.clearTimeout(flushTimer);flushTimer=0;}
  const target=url();if(!queue.length||!target||typeof fetch!=='function')return false;
  const body=JSON.stringify({schema:SCHEMA,sessions:queue.splice(0,QUEUE_MAX)});
  try{Promise.resolve(fetch(target,{method:'POST',keepalive:true,credentials:'same-origin',
   headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body})).catch(()=>{});}catch{}
  return true;
 }
 const hidden=()=>{if(session)finish();flushAfterSession=false;flush();};

 const opts={capture:true,passive:true};
 win.addEventListener('pointerdown',event=>{if(doc.hidden)return;if(session)finish();
  start();session.x=event.clientX;session.y=event.clientY;},opts);
 win.addEventListener('pointermove',event=>{const s=session;if(!s||s.released||s.scrolled||s.x===null)return;
  if(Math.abs(event.clientX-s.x)>SLOP_PX||Math.abs(event.clientY-s.y)>SLOP_PX)s.scrolled=true;},opts);
 win.addEventListener('pointerup',release,opts);
 win.addEventListener('pointercancel',()=>{if(session)session.scrolled=true;release();},opts);
 doc.addEventListener('scroll',()=>{if(session){session.scrolled=true;markMoved();}},opts);
 for(const type of ['transitionrun','animationstart'])
  doc.addEventListener(type,()=>{if(session){session.css++;markMoved();}},opts);
 for(const type of ['transitionend','transitioncancel','animationend','animationcancel'])
  doc.addEventListener(type,()=>{if(session){session.css--;activity();}},opts);
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)hidden();});
 win.addEventListener('pagehide',hidden);
 const proto=win.Element?.prototype,animate=proto?.animate;
 if(typeof animate==='function'){
  proto.animate=function(...args){
   const animation=animate.apply(this,args),s=session;
   if(s){try{if(animation.effect?.getTiming?.().iterations!==Infinity){s.active++;s.animations++;markMoved();
    const done=()=>{s.active--;if(session===s)activity();};animation.finished.then(done,done);}}catch{}}
   return animation;
  };
 }
 meter={begin(kind){if(!session)start(kind,true);else session.kind=kind;},end:()=>{if(session)finish();},
  moved:markMoved,flush,pending:()=>queue.length,active:()=>!!session,take:()=>queue.splice(0)};
 return meter;
}

// Label the current session (or open one for motion no touch started): 'push', 'pop', 'ro-open', 'ro-close',
// 'press', 'scroll'. end() closes it now; moved() marks the first moving frame when nothing animates generically.
export function begin(kind){meter?.begin(kind);}
export function end(){meter?.end();}
export function moved(){meter?.moved();}
export function flushFrames(){return meter?.flush()??false;}
// The sessions not yet sent, handed to a host that reports them itself (the HA panel has no /view/api/frames).
export function takeFrames(){return meter?.take()??[];}

if(typeof window!=='undefined'&&window.document)installFrameMeter(window);
