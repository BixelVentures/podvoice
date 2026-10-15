// PodVoice owns resources and authorizes controls. Unconfigured lights remain a visible placeholder.
export const unconfiguredLight=()=>({id:"podvoice-light-unconfigured",kind:"light",revision:1,status:"unavailable",pending:null,hidden:false,timeline:[]});
export function liveScene(base, snapshot) {
 const observed=snapshot.timers.status==='observed',timerHistory=liveTimerHistory(snapshot.timerHistory);const durationFor=t=>{const entry=timerHistory.find(row=>row.id===t.id);return entry&&entry.seconds>=t.secondsLeft?entry.seconds:null;};
 const items=snapshot.timers.status==='observed'?snapshot.timers.items:[];
 const previousTimer=t=>{const previous=base.timer?.id===t.id?base.timer:base.extraTimers.find(x=>x.id===t.id);return previous?.ownerBootId===snapshot.bootId?previous:null;};
 const timers=items.filter(t=>t&&typeof t.id==='string'&&typeof t.name==='string'&&Number.isFinite(t.secondsLeft)&&['running','paused','finished'].includes(t.status)).slice(0,32).map(t=>({id:t.id,name:t.name.slice(0,120),remaining:t.status==='finished'?0:Math.max(0,t.secondsLeft),duration:durationFor(t),status:t.status==='finished'?'done':t.status,deadline:null,hidden:false,ownerBootId:snapshot.bootId,noticeDismissed:previousTimer(t)?.noticeDismissed}));
 const homeAllowed=snapshot.capabilities?.homeRead?.includes('vacuum'),devices=[unconfiguredLight(),...(homeAllowed?base.devices.filter(d=>d.source==='home_assistant_state'):[])];
 const revokedWeather=base.focus==='weather'&&!snapshot.capabilities?.homeRead?.includes('weather');
 const revokedAnswer=base.answers.some(a=>a.live&&a.id===base.focus)&&(snapshot.capabilities?.answerRead!==true||!base.answers.some(a=>a.id===base.focus&&a.sessionId===snapshot.answers?.sessionId&&a.turnId===snapshot.answers?.turnId&&a.taskId===snapshot.answers?.taskId&&a.inputRevision===snapshot.answers?.inputRevision&&a.revision===snapshot.answers?.revision));
 const revokedFocus=revokedWeather||revokedAnswer||base.devices.some(d=>d.id===base.focus&&d.source==='home_assistant_state')&&!devices.some(d=>d.id===base.focus);
 return {...base,live:true,liveWeather:snapshot.capabilities?.homeRead?.includes('weather')?base.liveWeather:null,focus:revokedFocus?'now':base.focus,sessionId:snapshot.voice.sessionId||'podvoice-idle',connected:false,timerHistory,timer:observed?timers[0]||null:base.timer?{...base.timer,stale:true}:null,extraTimers:observed?timers.slice(1):base.extraTimers.map(t=>({...t,stale:true})),answers:snapshot.capabilities?.answerRead===true?base.answers.filter(a=>a.live&&a.sessionId===snapshot.answers?.sessionId&&a.turnId===snapshot.answers?.turnId&&a.taskId===snapshot.answers?.taskId&&a.inputRevision===snapshot.answers?.inputRevision&&a.revision===snapshot.answers?.revision):[],devices,pendingAnswer:null,notice:'',music:{...base.music,pending:null,message:'',playback:{...base.music.playback,active:false,playing:false}}};
}
export const liveLocalEvent=(e,scene)=>['show','back','device-back','timer-notice-dismiss','hide'].includes(e.type)&&!(e.type==='show'&&!['photo','now','timers','music','podvoice-light-unconfigured'].includes(e.id)&&!scene?.devices.some(d=>d.id===e.id)&&!scene?.answers.some(a=>a.id===e.id&&!a.hidden)&&!(e.id==='weather'&&scene?.liveWeather));
export const voiceStatus=phase=>({LISTENING:'Lytter…',THINKING:'Tænker…',RESPONDING:'Svarer…',SPEAKING:'Svarer…',AI_SPEAKING:'Svarer…',LOUNGE_WINDOW:'Lytter…',CLOSING:'Afslutter…',IDLE:'Ingen aktiv samtale'}[phase]||'Forbundet');
export function liveTimerRequest(snapshot,connected,event){
 if(!connected||!snapshot||snapshot.timers?.status!=='observed'||!Array.isArray(snapshot.capabilities?.timerActions))return null;
 if(event.type==='timer-start'&&snapshot.timers.items.length===0&&snapshot.capabilities.timerActions.includes('timer.start')&&Number.isInteger(event.seconds)&&event.seconds>=1&&event.seconds<=86400&&typeof event.name==='string'&&event.name.length<=120)return {action:'timer.start',args:{seconds:event.seconds,name:event.name}};
 if(event.type==='timer'&&event.action==='cancel'&&snapshot.capabilities.timerActions.includes('timer.cancel')&&snapshot.timers.items.some(t=>t.id===event.id))return {action:'timer.cancel',args:{timer_id:event.id}};
 return null;
}

export function liveTimerHistory(value,now=Date.now()){
 if(value?.status!=='observed'||value.scope!=='core_lifetime'||!Array.isArray(value.items)||value.items.length>12)return [];const seen=new Set(),rows=[];for(const r of value.items){if(typeof r?.id!=='string'||!r.id||r.id.length>200||seen.has(r.id)||typeof r.name!=='string'||r.name.length>120||!Number.isInteger(r.seconds)||r.seconds<1||r.seconds>86400||!Number.isFinite(r.acceptedAt)||r.acceptedAt<=0||r.acceptedAt*1000>now+5000)return [];seen.add(r.id);rows.push({id:r.id,name:r.name||'Timer',seconds:r.seconds,acceptedAt:r.acceptedAt});}return rows.sort((a,b)=>b.acceptedAt-a.acceptedAt);
}
