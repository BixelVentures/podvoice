import {overviewActivities,selectOverviewActivity} from './overview-activity-model.js';
import {devicePresentation} from './scene-model.js';
import {createResourceTile,updateResourceTile} from './ui/resource-tile.js';
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
  this.host=host;this.detail=detail;this.overview=overview;this.nodes=new Map();this.connected=true;
  this.overviewList=overview.querySelector('.timer-active-list');this.shortcut=overview.querySelector('#open-timers');
  detail.innerHTML=`<header class="response-heading"><div><h1 id="timers-title" tabindex="-1">Timere</h1><p>Hold styr på tiden</p></div></header><p id="timers-live-note" role="status" hidden></p>
   <form class="timer-create" aria-label="Ny timer"><h2 tabindex="-1">Ny timer</h2>
    <div class="timer-stepper"><button type="button" class="timer-adjust" data-adjust="-60" aria-label="1 minut mindre"><img src="assets/icons/dash.svg" alt=""></button><div class="timer-selected"><output aria-live="polite" aria-label="Valgt tid">5:00</output><span>min : sek</span></div><button type="button" class="timer-adjust" data-adjust="60" aria-label="1 minut mere"><img src="assets/icons/plus.svg" alt=""></button></div>
    <div class="timer-presets" role="group" aria-label="Faste tider">${[3,5,10,15].map(n=>`<button type="button" data-minutes="${n}" aria-pressed="${n===5}">${n} min</button>`).join('')}<button type="button" class="timer-custom" aria-controls="timer-exact" aria-expanded="false">Anden tid</button></div>
    <div class="timer-create-footer"><button type="submit" class="timer-start"><img src="assets/icons/play-fill.svg" alt="">Start timer</button></div>
    <div id="timer-exact" hidden><div class="timer-duration"><label>Timer<input name="hours" type="number" inputmode="numeric" min="0" max="24" value="0" required></label><label>Minutter<input name="minutes" type="number" inputmode="numeric" min="0" max="59" value="5" required></label><label>Sekunder<input name="seconds" type="number" inputmode="numeric" min="0" max="59" value="0" required></label></div><p class="timer-validation" role="status" hidden>Vælg mellem 1 sekund og 24 timer.</p></div>
   </form><section class="timer-running"><h2>Aktuel timer</h2><div class="timer-active-list"></div></section><section class="timer-recent" hidden><h2>Senest brugt</h2><div></div></section>`;
  this.form=detail.querySelector('form');this.inputs=this.form.elements;this.duration=300;
  this.form.addEventListener('input',()=>{this.duration=readTimerDuration(this.inputs.hours.value,this.inputs.minutes.value,this.inputs.seconds.value);this.updatePicker();});
  this.form.addEventListener('submit',e=>{e.preventDefault();if(!this.connected||!this.canStart||this.duration===null)return;host.dispatch({type:'timer-start',seconds:this.duration,name:'',now:Date.now()});if(host.live)return;const node=this.nodes.get(`detail:${host.state.timer.id}`);node?.querySelector('.timer-finish').focus({preventScroll:true});node?.scrollIntoView({block:'nearest',behavior:'instant'});});
  for(const b of detail.querySelectorAll('[data-minutes]'))b.addEventListener('click',()=>this.fill({seconds:Number(b.dataset.minutes)*60}));
  for(const b of detail.querySelectorAll('[data-adjust]'))b.addEventListener('click',()=>this.fill({seconds:adjustTimerDuration(this.duration??300,Number(b.dataset.adjust))}));
  this.form.querySelector('.timer-custom').addEventListener('click',()=>{const exact=this.form.querySelector('#timer-exact'),button=this.form.querySelector('.timer-custom');exact.hidden=!exact.hidden;button.setAttribute('aria-expanded',String(!exact.hidden));if(!exact.hidden)this.inputs.minutes.focus({preventScroll:true});});
  this.notice=new TimerNotice(host,document.getElementById('timer-alert'),{onElapsed:()=>{this.host.dispatch({type:'show',id:'now'});this.render(this.host.state);this.renderOverviewActivities(this.host.state);}});
  this.updatePicker();
 }
 fill({seconds}){this.duration=seconds;this.inputs.hours.value=Math.floor(seconds/3600);this.inputs.minutes.value=Math.floor(seconds%3600/60);this.inputs.seconds.value=seconds%60;this.updatePicker();}
 updatePicker(){
  const seconds=this.duration,output=this.form.querySelector('output'),time=seconds===null?'—':timerTime(seconds),unit=this.form.querySelector('.timer-selected>span'),label=seconds>=3600?'timer : min : sek':'min : sek';if(output.textContent!==time)output.textContent=time;if(unit.textContent!==label)unit.textContent=label;
  const selected=this.form.querySelector('.timer-selected'),long=String(seconds>=3600);if(selected&&selected.dataset.long!==long)selected.dataset.long=long;
  for(const b of this.form.querySelectorAll('[data-minutes]')){const selected=String(Number(b.dataset.minutes)*60===seconds);if(b.getAttribute('aria-pressed')!==selected)b.setAttribute('aria-pressed',selected);}
  for(const [selector,disabled]of [['[data-adjust="-60"]',!this.connected||this.canDraft===false||seconds===1],['[data-adjust="60"]',!this.connected||this.canDraft===false||seconds===86400],['.timer-start',!this.connected||!this.canStart||seconds===null]]){const button=this.form.querySelector(selector);if(button.disabled!==disabled)button.disabled=disabled;}
  const validation=this.form.querySelector('.timer-validation');if(validation.hidden!==(seconds!==null))validation.hidden=seconds!==null;
 }
 card(t,container,key){
  let node=this.nodes.get(key);if(!node){
   node=document.createElement('article');node.className='timer-panel';const overview=key.startsWith('overview:');const tag=overview?'button':'div';
   node.innerHTML=`<${tag} class="timer-open"${overview?'':' role="group"'}><span class="timer-instrument" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="timer-track" cx="60" cy="60" r="54"/><circle class="timer-progress" cx="60" cy="60" r="54" pathLength="100"/></svg>${overview?'<img class="timer-icon" src="assets/icons/timer.svg" alt="">':'<span class="timer-count"></span>'}</span><span class="timer-copy">${overview?'<span class="timer-count" aria-hidden="true"></span>':''}<strong></strong><span class="timer-state"></span></span>${overview?'<img class="timer-chevron" src="assets/icons/chevron-right.svg" alt="">':''}</${tag}>${overview?'':'<div class="timer-actions" role="group" aria-label="Justér timer"><button type="button" data-timer-action="add" data-seconds="60">+1 min</button><button type="button" data-timer-action="add" data-seconds="300">+5 min</button><button type="button" data-timer-action="toggle">Pause</button></div>'}<button class="timer-finish"></button>`;
   container.append(node);this.nodes.set(key,node);
   if(overview)node.querySelector('.timer-open').addEventListener('click',()=>{this.host.dispatch({type:'show',id:'timers'});this.host.focusHeading();});
   for(const button of node.querySelectorAll('[data-timer-action]'))button.addEventListener('click',()=>{const timer=timersFor(this.host.state).find(t=>t.id===node.dataset.timerId);if(button.disabled||this.host.live||!this.connected||!timer||timer.ownerBootId||timer.stale||!['running','paused'].includes(timer.status))return;this.host.dispatch({type:'timer',id:timer.id,action:button.dataset.timerAction==='toggle'?(timer.status==='paused'?'resume':'pause'):'add',seconds:Number(button.dataset.seconds),now:Date.now()});});
   node.querySelector('.timer-finish').addEventListener('click',()=>{if(!this.canCancel||this.accessModel?.cancelBlockedIds?.includes(node.dataset.timerId))return;this.host.dispatch({type:'timer',id:node.dataset.timerId,action:'cancel'});this.host.focusHeading();});
  }
  const progress=timerProgress(t);if(node.hidden)node.hidden=false;if(node.dataset.timerId!==t.id)node.dataset.timerId=t.id;if(node.dataset.status!==t.status)node.dataset.status=t.status;const known=String(progress!==null);if(node.dataset.progressKnown!==known)node.dataset.progressKnown=known;const progressValue=String(progress??0);if(node.style.getPropertyValue('--progress')!==progressValue)node.style.setProperty('--progress',progressValue);const count=node.querySelector('.timer-count'),time=t.status==='done'?'Tiden er gået':timerTime(t.remaining);if(count.textContent!==time)count.textContent=time;const instrument=node.querySelector('.timer-instrument'),long=String(t.remaining>=3600);if(instrument.dataset.long!==long)instrument.dataset.long=long;
  const title=node.querySelector('.timer-copy strong'),name='Timer';if(title.textContent!==name)title.textContent=name;const completion=this.notice?.completions?.get(String(t.id)),completedNote=t.status==='done'&&completion?.exhausted?`${completion.played?'Timeren ringede':'Timeren blev færdig'} kl. ${new Date(completion.at).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}).replace(':','.')}`:'';const rawStatus=completedNote||t.displayState||(t.stale||t.status!=='running'||!Number.isFinite(t.deadline)?timerStateLabel(t):`Slutter ${new Date(t.deadline).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}).replace(':','.')}`),status=rawStatus===time?'':rawStatus,state=node.querySelector('.timer-state');if(state.textContent!==status)state.textContent=status;if(state.hidden!==!status)state.hidden=!status;
  const open=node.querySelector('.timer-open'),openLabel=['Timer',time,status,key.startsWith('overview:')?'Åbn timerdetaljer':''].filter(Boolean).join(' · ');if(open.getAttribute('aria-label')!==openLabel)open.setAttribute('aria-label',openLabel);
  const actions=node.querySelector('.timer-actions'),local=this.host.live!==true&&!t.ownerBootId;if(actions){const hidden=!local||!['running','paused'].includes(t.status);if(actions.hidden!==hidden)actions.hidden=hidden;}for(const button of node.querySelectorAll('[data-timer-action]')){const label=t.status==='paused'?'Fortsæt':'Pause';if(button.dataset.timerAction==='toggle'&&button.textContent!==label)button.textContent=label;const disabled=!local||!this.connected||t.stale||!['running','paused'].includes(t.status)||button.dataset.timerAction==='add'&&(!Number.isFinite(t.duration)||t.duration+Number(button.dataset.seconds)>86400);if(button.disabled!==!!disabled)button.disabled=!!disabled;}
  const finish=node.querySelector('.timer-finish'),finishLabel=timerFinishLabel(t),finishAria=`${finishLabel} timer`;if(finish.textContent!==finishLabel)finish.textContent=finishLabel;if(finish.getAttribute('aria-label')!==finishAria)finish.setAttribute('aria-label',finishAria);return node;
 }
 renderAccess({connected,canStart=connected,canCancel=connected,pending=false,waiting=pending,awaitingObservation=false,allowIndependentCancel=false,cancelBlockedIds=[],feedback=''}={}){
  this.accessModel={connected,canStart,canCancel,pending,waiting,awaitingObservation,allowIndependentCancel,cancelBlockedIds,feedback};const blocked=pending||awaitingObservation;this.connected=connected===true;this.canStart=this.connected&&canStart===true&&!this.currentTimer&&!blocked;this.canCancel=this.connected&&canCancel===true&&!pending&&(!awaitingObservation||allowIndependentCancel);
  // Visibility belongs to timer content, never to controller authority. A
  // disabled draft is still the same draft; it is not an observed timer.
  this.canDraft=this.connected&&!blocked;const formHidden=false,busy=String(waiting);if(this.form.hidden!==formHidden)this.form.hidden=formHidden;if(this.form.getAttribute?.('aria-busy')!==busy)this.form.setAttribute('aria-busy',busy);
  const startButton=this.form.querySelector?.('.timer-start');for(const input of this.form.elements)if(input!==startButton&&input.disabled!==!this.canDraft)input.disabled=!this.canDraft;this.updatePicker();
  for(const node of this.nodes.values()){if(node.getAttribute?.('aria-busy')!==busy)node.setAttribute?.('aria-busy',busy);const finish=node.querySelector('.timer-finish');if(finish.hidden)finish.hidden=false;const disabled=!this.canCancel||cancelBlockedIds.includes(node.dataset?.timerId);if(finish.disabled!==disabled)finish.disabled=disabled;}
  for(const node of this.nodes.values())for(const button of node.querySelectorAll('[data-timer-action]')){const t=timersFor(this.host.state||{}).find(t=>t.id===node.dataset.timerId),disabled=!this.connected||blocked||this.host.live===true||!t||!!t.ownerBootId||!!t.stale||!['running','paused'].includes(t.status)||button.dataset.timerAction==='add'&&(!Number.isFinite(t.duration)||t.duration+Number(button.dataset.seconds)>86400);if(button.disabled!==disabled)button.disabled=disabled;}
  if(this.notice&&this.host.state)this.renderNotice();
  const note=this.detail.querySelector('#timers-live-note');if(note.hidden!==!feedback)note.hidden=!feedback;if(note.textContent!==feedback)note.textContent=feedback;if(note.getAttribute?.('aria-busy')!==busy)note.setAttribute('aria-busy',busy);
 }
 render(s){
  const projection=timerPresentation(timersFor(s));for(const [key,node]of this.nodes){const hidden=key!==`overview:${projection.current?.id}`&&key!==`detail:${projection.current?.id}`;if(node.hidden!==hidden)node.hidden=hidden;}if(this.overviewList.hidden!==!projection.current)this.overviewList.hidden=!projection.current;if(this.shortcut.hidden!==!!projection.current)this.shortcut.hidden=!!projection.current;
  const current=projection.current;this.currentTimer=current;if(current){const node=this.card(current,this.overviewList,`overview:${current.id}`);if(this.overviewList.children[0]!==node)this.overviewList.insertBefore(node,this.overviewList.children[0]||null);}
  const list=this.detail.querySelector('.timer-active-list');if(current){const node=this.card(current,list,`detail:${current.id}`);if(list.children[0]!==node)list.insertBefore(node,list.children[0]||null);}
  const running=this.detail.querySelector('.timer-running'),runningTitle=running.querySelector?.('h2'),runningLabel=current?.stale?'Senest kendte timer':current?.status==='done'?'Afsluttet timer':current?.status==='paused'?'Timer på pause':'Aktuel timer';if(runningTitle&&runningTitle.textContent!==runningLabel)runningTitle.textContent=runningLabel;if(running.hidden!==!current)running.hidden=!current;const detailHidden=s.focus!=='timers';if(this.detail.hidden!==detailHidden)this.detail.hidden=detailHidden;this.renderAccess(this.host.live?(this.accessModel||{connected:false,canStart:false,canCancel:false}):{connected:s.connected});
  const demoStart=document.getElementById('start-timer');if(demoStart&&demoStart.disabled!==!this.canStart)demoStart.disabled=!this.canStart;
  const history=s.timerHistory||[],signature=JSON.stringify(history);if(signature!==this.history){
   this.history=signature;const section=this.detail.querySelector('.timer-recent'),recent=section.querySelector('div');
   if(!this.recentChoices){this.recentChoices=document.createElement('pv-choice-list');this.recentChoices.dataset.reuse='true';this.recentChoices.setAttribute('aria-label','Vælg tidligere timer');this.recentChoices.addEventListener('pv-action',event=>{event.stopPropagation();const item=this.recentRecipes.get(event.detail.option_id);if(event.detail.action_id!=='choose'||!item)return;this.fill(item);this.form.scrollIntoView({block:'nearest',behavior:'instant'});const target=this.form.querySelector('.timer-start');if(!target.disabled)target.focus({preventScroll:true});else this.form.querySelector('h2')?.focus({preventScroll:true});});recent.append(this.recentChoices);}
   this.recentRecipes=new Map();for(const item of history){const key=JSON.stringify(item.seconds);if(!this.recentRecipes.has(key))this.recentRecipes.set(key,item);}
   this.recentChoices.data={state:'ready',quietStatus:true,selected:null,items:[...this.recentRecipes].map(([id,item])=>({id,label:`Brug ${timerTime(item.seconds)} igen`,detail:'Justér før start'}))};
  }
  const recent=this.detail.querySelector('.timer-recent'),recentHidden=!history.length||!!current;if(recent.hidden!==recentHidden)recent.hidden=recentHidden;
 }
 renderOverviewActivities(s){
  const items=overviewActivities(timersFor(s),s.devices||[],s.vehicle,{allowExamples:!this.host.live});this.overviewActivities=items;
  const selected=selectOverviewActivity(items,this.overviewSelectedId);if(this.activityPointer&&(selected?.id!==this.overviewSelectedId||s.focus!=='now')){this.activityPointer.target.style.transform='';this.activityPointer=null;this.activityAnimation?.cancel();}this.overviewSelectedId=selected?.id||null;
  if(!this.activityChoices){
   this.activityChoices=document.createElement('pv-choice-list');this.activityChoices.className='overview-activity-selector';this.activityChoices.setAttribute('aria-label','Vælg aktivitet');
   this.activityChoices.addEventListener('pv-action',event=>{event.stopPropagation();if(event.detail.action_id!=='choose'||!this.overviewActivities.some(item=>item.id===event.detail.option_id))return;this.overviewSelectedId=event.detail.option_id;this.renderOverviewActivities(this.host.state);});
   this.activityResource=createResourceTile(id=>{this.host.dispatch({type:'show',id});this.host.focusHeading();});this.activityResource.classList.add('overview-activity-resource');this.overview.append(this.activityResource,this.activityChoices);
   this.overview.addEventListener('click',event=>{if(this.activitySwiped){this.activitySwiped=false;event.preventDefault();event.stopImmediatePropagation();}},true);
   this.bindActivityGesture();
  }
  if(this.activityChoices.hidden!==(items.length<2))this.activityChoices.hidden=items.length<2;const choices={state:'ready',quietStatus:true,selected:selected?.id||null,items:items.map(item=>({id:item.id,label:item.label}))},signature=JSON.stringify(choices);if(this.activityChoiceSignature!==signature){this.activityChoiceSignature=signature;this.activityChoices.data=choices;}
  for(const [node,hidden] of [[this.overviewList,selected?.kind!=='timer'],[this.shortcut,!!selected],[this.activityResource,!selected||selected.kind==='timer']])if(node.hidden!==hidden)node.hidden=hidden;
  for(const [key,node] of this.nodes)if(key.startsWith('overview:')){const hidden=key!==`overview:${selected?.kind==='timer'?selected.resource.id:''}`;if(node.hidden!==hidden)node.hidden=hidden;}
  if(selected?.kind==='timer'){const node=this.card(selected.resource,this.overviewList,`overview:${selected.resource.id}`);node.querySelector('.timer-finish').disabled=!this.canCancel||!!this.accessModel?.cancelBlockedIds?.includes(selected.resource.id);}
  const activityKind=selected?.kind||'empty';if(this.overview.dataset.activityKind!==activityKind)this.overview.dataset.activityKind=activityKind;
  if(selected?.kind==='vehicle')updateResourceTile(this.activityResource,{id:selected.id,kind:'vehicle',target:'vehicle',title:'Tesla',detail:Number.isFinite(selected.resource.charging?.endsAt)?`Oplader · færdig ${new Date(selected.resource.charging.endsAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'})}`:'Oplader',status:'charging',value:Number.isFinite(selected.resource.batteryPercent)?`${selected.resource.batteryPercent} %`:'',disabled:false});
  if(selected?.kind==='vacuum')updateResourceTile(this.activityResource,devicePresentation(selected.resource));
  const shownId=selected?.id||'empty';if(this.overview.dataset.activityId!==shownId){const hadActivity=this.overview.dataset.activityId!==undefined;this.overview.dataset.activityId=shownId;this.activityAnimation?.cancel();const target=selected?.kind==='timer'?this.overviewList:selected?this.activityResource:this.shortcut;if(hadActivity&&typeof matchMedia==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&target.animate)this.activityAnimation=target.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});}
 }
 bindActivityGesture(){
  this.overview.addEventListener('pointerdown',event=>{
   this.activitySwiped=false;if(event.isPrimary===false||event.button>0||this.overviewActivities.length<2||event.target.closest?.('.overview-activity-selector,.timer-finish,.timer-actions'))return;
   this.activityAnimation?.cancel();const target=this.overviewSelectedId?.startsWith('timer:')?this.overviewList:this.activityResource;
   this.activityPointer={x:event.clientX,y:event.clientY,id:event.pointerId,target,offset:0,lock:null};event.stopPropagation();
  });
  this.overview.addEventListener('pointermove',event=>{
   const p=this.activityPointer;if(!p||p.id!==event.pointerId)return;const dx=event.clientX-p.x,dy=event.clientY-p.y;
   if(!p.lock&&Math.hypot(dx,dy)>10)p.lock=Math.abs(dx)>Math.abs(dy)*1.6?'horizontal':'vertical';
   if(p.lock!=='horizontal')return;event.preventDefault();event.stopPropagation();this.activitySwiped=true;
   this.overview.setPointerCapture?.(event.pointerId);const index=this.overviewActivities.findIndex(item=>item.id===this.overviewSelectedId),edge=dx>0?index===0:index===this.overviewActivities.length-1;
   p.offset=edge?dx*.22:dx*.8;const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(!reduced)p.target.style.transform=`translateX(${p.offset}px)`;
  });
  this.overview.addEventListener('pointerup',event=>this.finishActivityGesture(event));
  this.overview.addEventListener('pointercancel',event=>this.finishActivityGesture(event,true));
  this.overview.addEventListener('lostpointercapture',event=>this.finishActivityGesture(event,true));
 }
 finishActivityGesture(event,cancelled=false){
  const p=this.activityPointer;if(!p||p.id!==event.pointerId)return;this.activityPointer=null;
  if(p.lock!=='horizontal')return;event.stopPropagation();const dx=event.clientX-p.x,index=this.overviewActivities.findIndex(item=>item.id===this.overviewSelectedId),next=cancelled||Math.abs(dx)<64?index:Math.max(0,Math.min(this.overviewActivities.length-1,index+(dx<0?1:-1)));
  p.target.style.transform='';this.overview.releasePointerCapture?.(event.pointerId);
  if(next!==index){this.overviewSelectedId=this.overviewActivities[next].id;this.renderOverviewActivities(this.host.state);}
  const target=next!==index?(this.overviewSelectedId.startsWith('timer:')?this.overviewList:this.activityResource):p.target,offset=next!==index?(dx<0?32:-32):p.offset;
  this.activityAnimation?.cancel();const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(target.animate)this.activityAnimation=target.animate(reduced?[{opacity:.7},{opacity:1}]:[{transform:`translateX(${offset}px)`,opacity:next!==index?.7:1},{transform:'translateX(0)',opacity:1}],{duration:reduced?120:240,easing:'cubic-bezier(.16,1,.3,1)'});
 }
 renderNotice(focus=this.host.state.focus,live=this.host.live,feedbackVisible=document.getElementById('playback-status')?.hidden===false){
  const timer=timersFor(this.host.state||{}).find(t=>t.status==='done'&&!t.stale&&!t.noticeDismissed)||this.currentTimer;
  this.notice.render(timer,focus,live,feedbackVisible,null,{...this.accessModel,canCancel:this.canCancel});
 }
 cleanup(){this.activityAnimation?.cancel();if(this.activityPointer)this.activityPointer.target.style.transform='';this.activityPointer=null;this.notice?.cleanup();}
}
