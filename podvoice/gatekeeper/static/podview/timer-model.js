// Local demo only. Live timing/expiry must come from the HA native timer owner.
export const timersFor=s=>[s.timer,...(s.extraTimers||[])].filter(Boolean);
export const timerStateLabel=t=>t.stale?'Sidst kendte tid':t.status==='done'?'Tiden er gået':t.status==='paused'?'På pause':'Tæller ned';
// A native countdown is not its original duration. Only show progress when
// the owner supplied a consistent total; unknown totals stay visually neutral.
export function timerProgress(timer){
 const {duration,remaining}=timer||{};
 return Number.isFinite(duration)&&duration>0&&Number.isFinite(remaining)&&remaining>=0&&remaining<=duration?remaining/duration*100:null;
}
export const visibleTimers=s=>timersFor(s).filter(t=>t.status!=='cancelled'&&!t.hidden);
const mapTimers=(s,fn)=>{const timer=s.timer?fn(s.timer):null,extraTimers=(s.extraTimers||[]).map(fn);return timer===s.timer&&extraTimers.every((t,i)=>t===s.extraTimers[i])?s:{...s,timer,extraTimers};};
export function timerTransition(s,e){
 if(e.type==='timer-start'){
  const seconds=e.seconds??60;
  if(!s.connected||!Number.isInteger(seconds)||seconds<1||seconds>86400||!Number.isFinite(e.now))return s;
  if(visibleTimers(s).length>=32)return {...s,notice:'Der er allerede 32 timere. Afslut en, før du starter en ny.'};
  const name=(typeof e.name==='string'?e.name.trim().slice(0,120):'')||'Timer ved bordet',timerSerial=s.timerSerial+1;
  const recipe={name,seconds};
  return {...s,timerSerial,timer:{id:`local-timer-${timerSerial}`,name,duration:seconds,status:'running',remaining:seconds,deadline:e.now+seconds*1000,hidden:false},extraTimers:visibleTimers(s),timerHistory:[recipe,...(s.timerHistory||[]).filter(x=>x.name!==name||x.seconds!==seconds)].slice(0,6),notice:''};
 }
 if(e.type==='tick')return mapTimers(s,t=>{if(t.status!=='running')return t;const remaining=Math.max(0,Math.ceil((t.deadline-e.now)/1000));return remaining===t.remaining?t:{...t,remaining,status:remaining===0?'done':'running'};});
 if(e.type==='timer-notice-dismiss')return mapTimers(s,t=>t.id===e.id&&t.status==='done'&&!t.noticeDismissed?{...t,noticeDismissed:true}:t);
 if(e.type==='timer')return mapTimers(s,t=>{
  if(t.id!==e.id||t.status==='cancelled')return t;
  // Legacy workshop visibility/pause controls remain outside the product UI.
  if(e.action==='hide')return {...t,hidden:true};
  if(e.action==='show')return {...t,hidden:false};
  if(e.action==='cancel')return {...t,status:'cancelled',remaining:0};
  if(e.action==='pause'&&t.status==='running')return {...t,status:'paused',remaining:Math.max(0,Math.ceil((t.deadline-e.now)/1000))};
  if(e.action==='resume'&&t.status==='paused')return {...t,status:'running',deadline:e.now+t.remaining*1000};
  return t;
 });
 return s;
}
export const timerTime=seconds=>{const n=Math.max(0,Math.ceil(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;};

// Touch picker operates on a draft. It never changes an already running timer.
export const adjustTimerDuration=(seconds,delta)=>Math.min(86400,Math.max(1,seconds+delta));
export function readTimerDuration(hours,minutes,seconds){
 const fields=[hours,minutes,seconds];if(fields.some(x=>String(x).trim()===''||!Number.isInteger(Number(x))))return null;
 const [h,m,s]=fields.map(Number);if(h<0||h>24||m<0||m>59||s<0||s>59)return null;
 const total=h*3600+m*60+s;return total>=1&&total<=86400?total:null;
}
