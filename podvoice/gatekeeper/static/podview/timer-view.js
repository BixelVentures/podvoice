import {applyKitComponent,applyKitTemplate} from './ui/kit.js';
import {timersFor,timerTime,timerStateLabel,timerFinishLabel,timerProgress,adjustTimerDuration,readTimerDuration} from './timer-model.js';
import {TimerNotice} from './timer-notice.js';
export function timerPresentation(timers){
 const priority=t=>t.status==='done'?0:t.status==='running'?1:t.status==='paused'?2:3;
 const end=t=>Number.isFinite(t.deadline)?t.deadline:t.remaining;
 const all=timers.filter(t=>t.status!=='cancelled'),selected=[...all].sort((a,b)=>priority(a)-priority(b)||end(a)-end(b))[0]||null;
 // Normalize completed timer data to zero even if a snapshot includes an
 // old secondsLeft value. The renderer replaces the countdown with completion text. Keep the source records intact for owner actions.
 const current=selected?.status==='done'?{...selected,remaining:0}:selected;
 return {current,visible:current?[current]:[],all:timers,canStart:all.length===0};
}
export class TimerView {
 constructor(host,detail,overview){
  this.host=host;this.detail=detail;this.overview=overview;if(overview.dataset.kitTone!=='dark')overview.dataset.kitTone='dark';applyKitTemplate(detail,'detail');this.nodes=new Map();this.connected=true;
  this.overviewList=overview.querySelector('.timer-active-list');this.shortcut=overview.querySelector('#open-timers');
  detail.innerHTML=`<header class="response-heading"><div><h1 id="timers-title" tabindex="-1">Timere</h1></div></header><p id="timers-live-note" role="status" hidden></p>
   <section class="timer-running pv-detail-zone"><h2>Aktuel timer</h2><div class="timer-active-list"></div></section>
   <form class="timer-create pv-card" data-kit-tone="dark" aria-label="Ny timer"><h2 tabindex="-1">Ny timer</h2>
    <div class="timer-stepper"><button type="button" class="timer-adjust" data-adjust="-60" aria-label="1 minut mindre"><img src="assets/icons/dash.svg" alt=""></button><div class="timer-selected"><output aria-live="polite" aria-label="Valgt tid">5:00</output><span>min : sek</span></div><button type="button" class="timer-adjust" data-adjust="60" aria-label="1 minut mere"><img src="assets/icons/plus.svg" alt=""></button></div>
    <div class="timer-presets" role="group" aria-label="Faste tider">${[3,5,10,15].map(n=>`<button type="button" data-minutes="${n}" aria-pressed="false">${n} min</button>`).join('')}</div>
    <div class="timer-create-footer"><button type="submit" class="timer-start"><img src="assets/icons/play-fill.svg" alt="">Start timer</button></div>
    <div id="timer-exact" hidden><div class="timer-duration"><label>Timer<input name="hours" type="number" inputmode="numeric" min="0" max="24" value="0" required></label><label>Minutter<input name="minutes" type="number" inputmode="numeric" min="0" max="59" value="5" required></label><label>Sekunder<input name="seconds" type="number" inputmode="numeric" min="0" max="59" value="0" required></label></div><p class="timer-validation" role="status" hidden>Vælg mellem 1 sekund og 24 timer.</p></div>
   </form><section class="timer-recent" hidden><h2>Senest brugt</h2><div></div></section>`;
  applyKitComponent(detail.querySelector('.timer-create'),'card');for(const button of detail.querySelectorAll('.timer-presets button'))applyKitComponent(button,'chip');for(const button of detail.querySelectorAll('.timer-adjust,.timer-start'))applyKitComponent(button,'button',{variant:button.classList.contains('timer-start')?'primary':'secondary'});this.form=detail.querySelector('form');this.inputs=this.form.elements;this.duration=300;
  this.form.addEventListener('input',()=>{this.duration=readTimerDuration(this.inputs.hours.value,this.inputs.minutes.value,this.inputs.seconds.value);this.updatePicker();});
  this.form.addEventListener('submit',e=>{e.preventDefault();if(!this.connected||this.duration===null||!this.canStart)return;const before=host.state.timer,token={sessionId:host.state.sessionId,generation:host.state.generation,bootId:host.liveSnapshot?.bootId,roomId:host.liveSnapshot?.roomId,epoch:host.liveSnapshot?.timers?.epoch};this.startNavigation=host.state.focus==='timers'?token:null;host.dispatch({type:'timer-start',seconds:this.duration,name:'',now:Date.now()});if(host.live)return;const current=host.state.timer;if(current&&current!==before&&current.status==='running'&&!current.stale)this.completeStartNavigation(token);else this.startNavigation=null;});
  for(const b of detail.querySelectorAll('[data-minutes]'))b.addEventListener('click',()=>{this.fill({seconds:Number(b.dataset.minutes)*60});});
  for(const b of detail.querySelectorAll('[data-adjust]'))b.addEventListener('click',()=>this.fill({seconds:adjustTimerDuration(this.duration??300,Number(b.dataset.adjust))}));
  this.notice=new TimerNotice(host,document.getElementById('timer-alert'),{onElapsed:()=>{this.host.dispatch({type:'show',id:'now'});this.render(this.host.state);this.renderOverviewActivities(this.host.state);}});
  this.updatePicker();
 }
 completeStartNavigation(token,timerId){
  if(!token||this.startNavigation!==token)return;this.startNavigation=null;
  const host=this.host,s=host.state;if(host.isConnected===false||s.focus!=='timers'||s.sessionId!==token.sessionId||s.generation!==token.generation||host.live&&(host.liveSnapshot?.bootId!==token.bootId||host.liveSnapshot?.roomId!==token.roomId))return;
  if(host.live){const timers=host.liveSnapshot?.timers,current=timers?.items?.find(timer=>timer.id===timerId);if(timers?.status!=='observed'||timers.epoch!==token.epoch||!current||current.stale||!['running','paused'].includes(current.status))return;}
  host.dispatch({type:'show',id:'now'});host.focusHeading?.();
 }
 fill({seconds}){if(this.currentTimer||!Number.isInteger(seconds)||seconds<1||seconds>86400)return;this.duration=seconds;this.inputs.hours.value=Math.floor(seconds/3600);this.inputs.minutes.value=Math.floor(seconds%3600/60);this.inputs.seconds.value=seconds%60;this.updatePicker();}
 updatePicker(){
  const seconds=this.duration,output=this.form.querySelector('output'),time=seconds===null?'—':timerTime(seconds),unit=this.form.querySelector('.timer-selected>span'),label=seconds>=3600?'timer : min : sek':'min : sek';if(output.textContent!==time)output.textContent=time;if(unit.textContent!==label)unit.textContent=label;
  const selected=this.form.querySelector('.timer-selected'),long=String(seconds>=3600);if(selected&&selected.dataset.long!==long)selected.dataset.long=long;
  for(const b of this.form.querySelectorAll('[data-minutes]')){const selected='false';if(b.getAttribute('aria-pressed')!==selected)b.setAttribute('aria-pressed',selected);}
  for(const [selector,disabled]of [['[data-adjust="-60"]',!this.connected||this.canDraft===false||seconds===1],['[data-adjust="60"]',!this.connected||this.canDraft===false||seconds===86400],['.timer-start',!this.connected||!this.canStart||seconds===null]]){const button=this.form.querySelector(selector);if(button.disabled!==disabled)button.disabled=disabled;}
  const selectedRecent=null;if(this.recentChoiceModel&&this.recentChoiceModel.selected!==selectedRecent){this.recentChoiceModel={...this.recentChoiceModel,selected:selectedRecent};this.recentChoices.data=this.recentChoiceModel;}
  const validation=this.form.querySelector('.timer-validation');if(validation.hidden!==(seconds!==null))validation.hidden=seconds!==null;
 }
 // This is a display anchor, never a native deadline, completion or grant.
 // Repeated SSE copies of the same cached source count retain its original anchor.
 presentationTimer(t){
  const stop=()=>{clearTimeout(this.presentationTick);this.presentationTick=null;},host=this.host,s=host.liveSnapshot,transport=host.liveTransport;
  if(!host.live||!t?.ownerBootId||s?.bootId!==t.ownerBootId||typeof s.roomId!=='string'||s.timers?.epoch===undefined||s.timers.epoch===null||!Number.isFinite(t.remaining)||t.remaining<0){stop();this.presentationAnchor=null;return t;}
  const now=this.presentationNow?.()??globalThis.performance?.now?.()??Date.now(),key=JSON.stringify([s.bootId,s.roomId,s.timers.epoch,t.id]);let anchor=this.presentationAnchor;
  if(!anchor||anchor.key!==key||anchor.status!==t.status||anchor.sourceRemaining!==t.remaining){stop();anchor=this.presentationAnchor={key,status:t.status,sourceRemaining:t.remaining,at:now,displayed:t.remaining,advancing:false};}
  const item=s.timers.items?.find(row=>row.id===t.id),sourceCurrent=s.timers.status==='observed'&&item?.status===t.status&&item.secondsLeft===t.remaining,age=Date.now()-transport?.acceptedReadAt,ready=host.isConnected!==false&&host.browserOffline!==true&&host.liveStatus==='connected'&&transport?.connected===true&&transport.recoveryBlocked!==true&&Number.isFinite(transport.acceptedReadAt)&&age>=0&&age<6000&&this.connected!==false&&!t.stale&&sourceCurrent&&t.status==='running';
  if(!ready){stop();anchor.advancing=false;return anchor.displayed===t.remaining?t:{...t,remaining:anchor.displayed};}
  if(!anchor.advancing){anchor.at=now;anchor.displayed=t.remaining;anchor.advancing=true;}
  const elapsed=Math.max(0,now-anchor.at);anchor.displayed=Math.max(0,Math.ceil(anchor.sourceRemaining-elapsed/1000));
  if(anchor.displayed>0&&!this.presentationTick){
   const delay=Math.max(1,Math.ceil(1000-elapsed%1000));
   this.presentationTick=setTimeout(()=>{this.presentationTick=null;if(host.isConnected===false){this.presentationAnchor=null;return;}const current=timerPresentation(timersFor(host.state||{})).current;if(!current){this.presentationAnchor=null;return;}for(const slot of ['overview','detail']){const card=this.nodes.get(`${slot}:${current.id}`);if(card&&!card.hidden)this.card(current,card.parentNode,`${slot}:${current.id}`);}host.renderResourceRail?.();},delay);
  }else if(anchor.displayed===0)stop();
  return anchor.displayed===t.remaining?t:{...t,remaining:anchor.displayed};
 }
 card(t,container,key){
  t=this.presentationTimer(t);
  let node=this.nodes.get(key);if(!node){
   node=document.createElement('article');node.className='timer-panel pv-hero';node.dataset.kitTone='dark';applyKitComponent(node,'hero',{identity:'neutral'});const overview=key.startsWith('overview:');
   const instrument=`<span class="timer-instrument" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="timer-track" cx="60" cy="60" r="54"/><circle class="timer-progress" cx="60" cy="60" r="54" pathLength="100"/></svg>${overview?'<img class="timer-icon" src="assets/icons/timer.svg" alt="">':'<span class="timer-count"></span>'}</span>`,copy=`<span class="timer-copy">${overview?'<span class="timer-count"></span>':''}<strong></strong><span class="timer-state"></span></span>`;
   // Read-only content precedes the same two actions. Native tab order now
   // matches the right-hand controls: cancel, then the detail chevron.
   node.innerHTML=overview?`${instrument}${copy}<button type="button" class="timer-finish"></button><button type="button" class="timer-open"><img class="timer-chevron" src="assets/icons/chevron-right.svg" alt=""></button>`:`<div class="timer-open" role="group">${instrument}${copy}</div><div class="timer-actions" role="group" aria-label="Betjen timer"><button type="button" data-timer-action="toggle">Pause</button></div><button class="timer-finish"></button>`;
   if(overview)applyKitComponent(node.querySelector('.timer-open'),'button');
   for(const button of node.querySelectorAll('.timer-actions button,.timer-finish'))applyKitComponent(button,'button',{variant:button.dataset.timerAction==='toggle'?'primary':'secondary'});node.querySelector('svg')?.classList.add('pv-illu');container.append(node);this.nodes.set(key,node);
   if(overview)node.querySelector('.timer-open').addEventListener('click',()=>{this.host.dispatch({type:'show',id:'timers'});this.host.focusHeading();});
   for(const button of node.querySelectorAll('[data-timer-action]'))button.addEventListener('click',()=>{const timer=timersFor(this.host.state).find(t=>t.id===node.dataset.timerId);if(button.disabled||this.host.live||!this.connected||!timer||timer.ownerBootId||timer.stale||!['running','paused'].includes(timer.status))return;this.host.dispatch({type:'timer',id:timer.id,action:timer.status==='paused'?'resume':'pause',now:Date.now()});});
   node.querySelector('.timer-finish').addEventListener('click',()=>{if(!this.canCancel||this.accessModel?.cancelBlockedIds?.includes(node.dataset.timerId))return;this.host.dispatch({type:'timer',id:node.dataset.timerId,action:'cancel'});this.host.focusHeading();});
  }
  const progress=timerProgress(t);if(node.hidden)node.hidden=false;if(node.dataset.timerId!==t.id)node.dataset.timerId=t.id;if(node.dataset.status!==t.status)node.dataset.status=t.status;const stale=String(t.stale===true);if(node.dataset.stale!==stale)node.dataset.stale=stale;const known=String(progress!==null);if(node.dataset.progressKnown!==known)node.dataset.progressKnown=known;const progressValue=String(progress??0);if(node.style.getPropertyValue('--progress')!==progressValue)node.style.setProperty('--progress',progressValue);const count=node.querySelector('.timer-count'),time=t.status==='done'?'Tiden er gået':timerTime(t.remaining);if(count.textContent!==time)count.textContent=time;const instrument=node.querySelector('.timer-instrument'),long=String(t.remaining>=3600);if(instrument.dataset.long!==long)instrument.dataset.long=long;
  const title=node.querySelector('.timer-copy strong'),name=t.status==='done'?'':'Timer';if(title.textContent!==name)title.textContent=name;const titleHidden=t.status==='done';if(title.hidden!==titleHidden)title.hidden=titleHidden;const completion=this.notice?.completions?.get(String(t.id)),completedNote=t.status==='done'&&completion?.exhausted?`${completion.played?'Timeren ringede':'Timeren blev færdig'} kl. ${new Date(completion.at).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}).replace(':','.')}`:'';const rawStatus=completedNote||t.displayState||(t.stale||t.status!=='running'||!Number.isFinite(t.deadline)?timerStateLabel(t):`Slutter ${new Date(t.deadline).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}).replace(':','.')}`),status=rawStatus===time?'':rawStatus,state=node.querySelector('.timer-state');if(state.textContent!==status)state.textContent=status;if(state.hidden!==!status)state.hidden=!status;
  const open=node.querySelector('.timer-open'),openLabel=['Timer',time,status,key.startsWith('overview:')?'Åbn timerdetaljer':''].filter(Boolean).join(' · ');if(open.getAttribute('aria-label')!==openLabel)open.setAttribute('aria-label',openLabel);
  const actions=node.querySelector('.timer-actions'),local=this.host.live!==true&&!t.ownerBootId;if(actions){const hidden=!local||!['running','paused'].includes(t.status);if(actions.hidden!==hidden)actions.hidden=hidden;}for(const button of node.querySelectorAll('[data-timer-action]')){const label=t.status==='paused'?'Fortsæt':'Pause';if(button.dataset.timerAction==='toggle'&&button.textContent!==label)button.textContent=label;const disabled=!local||!this.connected||t.stale||!['running','paused'].includes(t.status)||button.dataset.timerAction!=='toggle';if(button.disabled!==!!disabled)button.disabled=!!disabled;}
  const finish=node.querySelector('.timer-finish'),finishLabel=timerFinishLabel(t),finishAria=`${finishLabel} timer`;if(finish.textContent!==finishLabel)finish.textContent=finishLabel;if(finish.getAttribute('aria-label')!==finishAria)finish.setAttribute('aria-label',finishAria);return node;
 }
 renderAccess({connected,canStart=connected,canCancel=connected,pending=false,waiting=pending,awaitingObservation=false,allowIndependentCancel=false,cancelBlockedIds=[],feedback=''}={}){
  this.accessModel={connected,canStart,canCancel,pending,waiting,awaitingObservation,allowIndependentCancel,cancelBlockedIds,feedback};const blocked=pending||awaitingObservation;this.connected=connected===true;this.canStart=this.connected&&canStart===true&&!this.currentTimer&&!blocked;this.canCancel=this.connected&&canCancel===true&&!pending&&(!awaitingObservation||allowIndependentCancel);if(this.host?.live&&!this.connected){clearTimeout(this.presentationTick);this.presentationTick=null;if(this.presentationAnchor)this.presentationAnchor.advancing=false;}
  // Visibility belongs to timer content, never to controller authority. A
  // disabled draft is still the same draft; it is not an observed timer.
  this.canDraft=this.connected&&!blocked&&!this.currentTimer;const formHidden=!!this.currentTimer,busy=String(waiting);if(this.form.hidden!==formHidden)this.form.hidden=formHidden;if(this.form.getAttribute?.('aria-busy')!==busy)this.form.setAttribute('aria-busy',busy);
  const startButton=this.form.querySelector?.('.timer-start');for(const input of this.form.elements)if(input!==startButton&&input.disabled!==!this.canDraft)input.disabled=!this.canDraft;this.updatePicker();
  for(const node of this.nodes.values()){if(node.getAttribute?.('aria-busy')!==busy)node.setAttribute?.('aria-busy',busy);const finish=node.querySelector('.timer-finish');if(finish.hidden)finish.hidden=false;const disabled=!this.canCancel||cancelBlockedIds.includes(node.dataset?.timerId);if(finish.disabled!==disabled)finish.disabled=disabled;}
  for(const node of this.nodes.values())for(const button of node.querySelectorAll('[data-timer-action]')){const t=timersFor(this.host.state||{}).find(t=>t.id===node.dataset.timerId),disabled=!this.connected||blocked||this.host.live===true||!t||!!t.ownerBootId||!!t.stale||!['running','paused'].includes(t.status)||button.dataset.timerAction!=='toggle';if(button.disabled!==disabled)button.disabled=disabled;}
  if(this.notice&&this.host.state)this.renderNotice();
  const note=this.detail.querySelector('#timers-live-note'),feedbackOwner=this.currentTimer?this.nodes.get(`detail:${this.currentTimer.id}`):this.form;
  if(note.dataset.kitSlot!=='feedback')note.dataset.kitSlot='feedback';if(feedbackOwner&&!feedbackOwner.hidden&&note.parentNode!==feedbackOwner)feedbackOwner.append(note);
  if(note.hidden!==!feedback)note.hidden=!feedback;if(note.textContent!==feedback)note.textContent=feedback;if(note.getAttribute?.('aria-busy')!==busy)note.setAttribute('aria-busy',busy);
 }
 render(s){
  if(s.focus!=='timers')this.startNavigation=null;
  const projection=timerPresentation(timersFor(s));for(const [key,node]of this.nodes){const hidden=key!==`overview:${projection.current?.id}`&&key!==`detail:${projection.current?.id}`;if(node.hidden!==hidden)node.hidden=hidden;}if(this.overviewList.hidden!==!projection.current)this.overviewList.hidden=!projection.current;if(this.shortcut.hidden!==!!projection.current)this.shortcut.hidden=!!projection.current;
  const current=projection.current;this.currentTimer=current;if(!current){clearTimeout(this.presentationTick);this.presentationTick=null;this.presentationAnchor=null;}if(current){const node=this.card(current,this.overviewList,`overview:${current.id}`);if(this.overviewList.children[0]!==node)this.overviewList.insertBefore(node,this.overviewList.children[0]||null);}
  const list=this.detail.querySelector('.timer-active-list');if(current){const node=this.card(current,list,`detail:${current.id}`);if(list.children[0]!==node)list.insertBefore(node,list.children[0]||null);}
  const running=this.detail.querySelector('.timer-running'),runningTitle=running.querySelector?.('h2'),runningLabel=current?.stale?'Senest kendte timer':current?.status==='done'?'Afsluttet timer':current?.status==='paused'?'Timer på pause':'Aktuel timer';if(runningTitle&&runningTitle.textContent!==runningLabel)runningTitle.textContent=runningLabel;if(running.hidden!==!current)running.hidden=!current;const detailHidden=s.focus!=='timers';if(this.detail.hidden!==detailHidden)this.detail.hidden=detailHidden;this.renderAccess(this.host.live?(this.accessModel||{connected:false,canStart:false,canCancel:false}):{connected:s.connected});
  const demoStart=document.getElementById('start-timer');if(demoStart&&demoStart.disabled!==!this.canStart)demoStart.disabled=!this.canStart;
  const history=(Array.isArray(s.timerHistory)?s.timerHistory:[]).filter(item=>item&&Number.isInteger(item.seconds)&&item.seconds>=1&&item.seconds<=86400),signature=JSON.stringify(history);if(signature!==this.history){
   this.history=signature;const section=this.detail.querySelector('.timer-recent'),recent=section.querySelector('div');
   if(!this.recentChoices){this.recentChoices=document.createElement('pv-choice-list');this.recentChoices.dataset.reuse='true';this.recentChoices.setAttribute('aria-label','Vælg tidligere timer');this.recentChoices.addEventListener('pv-action',event=>{event.stopPropagation();const item=this.recentRecipes.get(event.detail.option_id);if(event.detail.action_id!=='choose'||!item)return;this.fill(item);this.form.scrollIntoView({block:'nearest',behavior:'instant'});const target=this.form.querySelector('.timer-start');if(!target.disabled)target.focus({preventScroll:true});else this.form.querySelector('h2')?.focus({preventScroll:true});});recent.append(this.recentChoices);}
   this.recentRecipes=new Map();for(const item of history){const key=JSON.stringify(item.seconds);if(!this.recentRecipes.has(key))this.recentRecipes.set(key,item);if(this.recentRecipes.size===3)break;}
   this.recentChoiceModel={state:'ready',quietStatus:true,selected:null,items:[...this.recentRecipes].map(([id,item])=>({id,label:`Brug ${timerTime(item.seconds)} igen`,detail:'Justér før start'}))};this.recentChoices.data=this.recentChoiceModel;
  }
  const recent=this.detail.querySelector('.timer-recent'),recentHidden=!!current||!history.length;if(recent.hidden!==recentHidden)recent.hidden=recentHidden;
 }
 renderOverviewActivities(s){
  // The top overview slot belongs only to Timer. Other resources keep their fixed cards.
  const current=timerPresentation(timersFor(s).filter(timer=>!timer.hidden)).current;if(!current){clearTimeout(this.presentationTick);this.presentationTick=null;this.presentationAnchor=null;}
  const selected=current?{id:`timer:${current.id}`,kind:'timer',resource:current}:null;
  this.overviewActivities=selected?[selected]:[];this.overviewSelectedId=selected?.id||null;
  for(const [node,hidden] of [[this.overviewList,!selected],[this.shortcut,!!selected]])if(node.hidden!==hidden)node.hidden=hidden;
  for(const [key,node] of this.nodes)if(key.startsWith('overview:')){const hidden=key!==`overview:${current?.id||''}`;if(node.hidden!==hidden)node.hidden=hidden;}
  if(current){const node=this.card(current,this.overviewList,`overview:${current.id}`);const finish=node.querySelector('.timer-finish'),disabled=!this.canCancel||!!this.accessModel?.cancelBlockedIds?.includes(current.id);if(finish.disabled!==disabled)finish.disabled=disabled;}
  const activityKind=selected?'timer':'empty';if(this.overview.dataset.activityKind!==activityKind)this.overview.dataset.activityKind=activityKind;
  // SceneMotion owns the outer timer/grid transition. A second entrance on
  // these children would add displacement and could outlive hidden navigation.
  const shownId=selected?.id||'empty';if(this.overview.dataset.activityId!==shownId){this.overview.dataset.activityId=shownId;this.activityAnimation?.cancel();this.activityAnimation=null;}
 }

 renderNotice(focus=this.host.state.focus,live=this.host.live,feedbackVisible=document.getElementById('playback-status')?.hidden===false){
  const timer=timersFor(this.host.state||{}).find(t=>t.status==='done'&&!t.stale&&!t.noticeDismissed)||this.currentTimer;
  this.notice.render(timer,focus,live,feedbackVisible,null,{...this.accessModel,canCancel:this.canCancel});
 }
 cleanup(){clearTimeout(this.presentationTick);this.presentationTick=null;this.presentationAnchor=null;this.startNavigation=null;this.activityAnimation?.cancel();if(this.activityPointer)this.activityPointer.target.style.transform='';this.activityPointer=null;this.notice?.cleanup();}
}
