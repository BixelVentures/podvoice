import {timersFor,timerTime,timerStateLabel,timerFinishLabel,timerProgress,adjustTimerDuration,readTimerDuration} from './timer-model.js';
import {TimerNotice} from './timer-notice.js';
export function timerPresentation(timers){
 const priority=t=>t.status==='done'?0:t.status==='running'?1:t.status==='paused'?2:3;
 const end=t=>Number.isFinite(t.deadline)?t.deadline:t.remaining;
 const all=timers.filter(t=>t.status!=='cancelled'),selected=[...all].sort((a,b)=>priority(a)-priority(b)||end(a)-end(b))[0]||null;
 // Project authoritative completion as 0:00 even if a snapshot includes an
 // old secondsLeft value. Keep the source records intact for owner actions.
 const current=selected?.status==='done'?{...selected,remaining:0}:selected;
 return {current,visible:current?[current]:[],all:timers,canStart:all.length===0};
}
export class TimerView {
 constructor(host,detail,overview){
  this.host=host;this.detail=detail;this.overview=overview;this.nodes=new Map();this.connected=true;
  this.overviewList=overview.querySelector('.timer-active-list');this.shortcut=overview.querySelector('#open-timers');
  detail.innerHTML=`<header class="response-heading"><div><h1 id="timers-title" tabindex="-1">Timere</h1><p>Hold styr på tiden</p></div></header><p id="timers-live-note" role="status" hidden></p>
   <form class="timer-create" aria-label="Ny timer"><h2>Ny timer</h2>
    <div class="timer-stepper"><button type="button" class="timer-adjust" data-adjust="-60" aria-label="1 minut mindre"><img src="assets/icons/dash.svg" alt=""></button><div class="timer-selected"><output aria-live="polite" aria-label="Valgt tid">5:00</output><span>min : sek</span></div><button type="button" class="timer-adjust" data-adjust="60" aria-label="1 minut mere"><img src="assets/icons/plus.svg" alt=""></button></div>
    <div class="timer-presets" aria-label="Faste tider">${[1,5,10,15,30].map(n=>`<button type="button" data-minutes="${n}" aria-pressed="${n===5}">${n} min.</button>`).join('')}</div>
    <div class="timer-create-footer"><button type="submit" class="timer-start"><img src="assets/icons/play-fill.svg" alt="">Start timer</button></div>
    <div id="timer-exact" hidden><label class="timer-name">Navn <span>(valgfrit)</span><input name="name" maxlength="120" placeholder="Fx pasta" autocomplete="off"></label><div class="timer-duration"><label>Timer<input name="hours" type="number" inputmode="numeric" min="0" max="24" value="0" required></label><label>Minutter<input name="minutes" type="number" inputmode="numeric" min="0" max="59" value="5" required></label><label>Sekunder<input name="seconds" type="number" inputmode="numeric" min="0" max="59" value="0" required></label></div><p class="timer-validation" role="status" hidden>Vælg mellem 1 sekund og 24 timer.</p></div>
   </form><section class="timer-running"><h2>Aktuel timer</h2><div class="timer-active-list"></div></section><section class="timer-recent" hidden><h2>Senest brugt</h2><div></div></section>`;
  this.form=detail.querySelector('form');this.inputs=this.form.elements;this.duration=300;
  this.form.addEventListener('input',()=>{this.duration=readTimerDuration(this.inputs.hours.value,this.inputs.minutes.value,this.inputs.seconds.value);this.updatePicker();});
  this.form.addEventListener('submit',e=>{e.preventDefault();if(!this.connected||!this.canStart||this.duration===null)return;host.dispatch({type:'timer-start',seconds:this.duration,name:this.inputs.name.value,now:Date.now()});if(host.live)return;const node=this.nodes.get(`detail:${host.state.timer.id}`);node?.querySelector('.timer-finish').focus({preventScroll:true});node?.scrollIntoView({block:'nearest',behavior:'instant'});});
  for(const b of detail.querySelectorAll('[data-minutes]'))b.addEventListener('click',()=>this.fill({seconds:Number(b.dataset.minutes)*60}));
  for(const b of detail.querySelectorAll('[data-adjust]'))b.addEventListener('click',()=>this.fill({seconds:adjustTimerDuration(this.duration??300,Number(b.dataset.adjust))}));
  this.notice=new TimerNotice(host,document.getElementById('timer-alert'));
  this.updatePicker();
 }
 fill({name,seconds}){if(name!==undefined)this.inputs.name.value=name;this.duration=seconds;this.inputs.hours.value=Math.floor(seconds/3600);this.inputs.minutes.value=Math.floor(seconds%3600/60);this.inputs.seconds.value=seconds%60;this.updatePicker();}
 updatePicker(){
  const seconds=this.duration,output=this.form.querySelector('output'),time=seconds===null?'—':timerTime(seconds),unit=this.form.querySelector('.timer-selected>span'),label=seconds>=3600?'timer : min : sek':'min : sek';if(output.textContent!==time)output.textContent=time;if(unit.textContent!==label)unit.textContent=label;
  for(const b of this.form.querySelectorAll('[data-minutes]')){const selected=String(Number(b.dataset.minutes)*60===seconds);if(b.getAttribute('aria-pressed')!==selected)b.setAttribute('aria-pressed',selected);}
  for(const [selector,disabled]of [['[data-adjust="-60"]',!this.connected||!this.canStart||seconds===1],['[data-adjust="60"]',!this.connected||!this.canStart||seconds===86400],['.timer-start',!this.connected||!this.canStart||seconds===null]]){const button=this.form.querySelector(selector);if(button.disabled!==disabled)button.disabled=disabled;}
  const validation=this.form.querySelector('.timer-validation');if(validation.hidden!==(seconds!==null))validation.hidden=seconds!==null;
 }
 card(t,container,key){
  let node=this.nodes.get(key);if(!node){
   node=document.createElement('article');node.className='timer-panel';const overview=key.startsWith('overview:');const tag=overview?'button':'div';
   node.innerHTML=`<${tag} class="timer-open"><span class="timer-instrument" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="timer-track" cx="60" cy="60" r="54"/><circle class="timer-progress" cx="60" cy="60" r="54" pathLength="100"/></svg><span class="timer-count"></span></span><span class="timer-copy"><strong></strong><span class="timer-state"></span></span></${tag}><button class="timer-finish"></button>`;
   container.append(node);this.nodes.set(key,node);
   if(overview)node.querySelector('.timer-open').addEventListener('click',()=>{this.host.dispatch({type:'show',id:'timers'});this.host.focusHeading();});
   node.querySelector('.timer-finish').addEventListener('click',()=>{if(!this.canCancel||this.accessModel?.cancelBlockedIds?.includes(node.dataset.timerId))return;this.host.dispatch({type:'timer',id:node.dataset.timerId,action:'cancel'});this.host.focusHeading();});
  }
  const progress=timerProgress(t);if(node.hidden)node.hidden=false;if(node.dataset.timerId!==t.id)node.dataset.timerId=t.id;if(node.dataset.status!==t.status)node.dataset.status=t.status;const known=String(progress!==null);if(node.dataset.progressKnown!==known)node.dataset.progressKnown=known;const progressValue=String(progress??0);if(node.style.getPropertyValue('--progress')!==progressValue)node.style.setProperty('--progress',progressValue);const count=node.querySelector('.timer-count'),time=timerTime(t.remaining);if(count.textContent!==time)count.textContent=time;const instrument=node.querySelector('.timer-instrument'),long=String(t.remaining>=3600);if(instrument.dataset.long!==long)instrument.dataset.long=long;
  const title=node.querySelector('.timer-copy strong'),name=t.name||'Timer ved bordet';if(title.textContent!==name)title.textContent=name;const status=t.displayState||(t.stale||t.status!=='running'||t.deadline===null?timerStateLabel(t):`Slutter ${new Date(t.deadline).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}).replace('.',':')}`),state=node.querySelector('.timer-state');if(state.textContent!==status)state.textContent=status;
  const open=node.querySelector('.timer-open'),openLabel=`${t.name||'Timer'} · ${time} · ${status}${key.startsWith('overview:')?' · Åbn timerdetaljer':''}`;if(open.getAttribute('aria-label')!==openLabel)open.setAttribute('aria-label',openLabel);
  const finish=node.querySelector('.timer-finish'),finishLabel=timerFinishLabel(t),finishAria=`${finishLabel} ${t.name||'timer'}`;if(finish.textContent!==finishLabel)finish.textContent=finishLabel;if(finish.getAttribute('aria-label')!==finishAria)finish.setAttribute('aria-label',finishAria);return node;
 }
 renderAccess({connected,canStart=connected,canCancel=connected,pending=false,waiting=pending,awaitingObservation=false,allowIndependentCancel=false,cancelBlockedIds=[],feedback=''}={}){
  this.accessModel={connected,canStart,canCancel,pending,waiting,awaitingObservation,allowIndependentCancel,cancelBlockedIds,feedback};const blocked=pending||awaitingObservation;this.connected=connected===true;this.canStart=this.connected&&canStart===true&&!this.currentTimer&&!blocked;this.canCancel=this.connected&&canCancel===true&&!pending&&(!awaitingObservation||allowIndependentCancel);
  // Visibility belongs to timer content, never to controller authority. A
  // disabled draft is still the same draft; it is not an observed timer.
  const formHidden=!!this.currentTimer,busy=String(waiting);if(this.form.hidden!==formHidden)this.form.hidden=formHidden;if(this.form.getAttribute?.('aria-busy')!==busy)this.form.setAttribute('aria-busy',busy);
  for(const input of this.form.elements)if(input.disabled!==!this.canStart)input.disabled=!this.canStart;this.updatePicker();
  for(const node of this.nodes.values()){const finish=node.querySelector('.timer-finish');if(finish.hidden)finish.hidden=false;const disabled=!this.canCancel||cancelBlockedIds.includes(node.dataset?.timerId);if(finish.disabled!==disabled)finish.disabled=disabled;}
  const note=this.detail.querySelector('#timers-live-note');if(note.hidden!==!feedback)note.hidden=!feedback;if(note.textContent!==feedback)note.textContent=feedback;if(note.getAttribute?.('aria-busy')!==busy)note.setAttribute('aria-busy',busy);
 }
 render(s){
  const projection=timerPresentation(timersFor(s));for(const [key,node]of this.nodes){const hidden=key!==`overview:${projection.current?.id}`&&key!==`detail:${projection.current?.id}`;if(node.hidden!==hidden)node.hidden=hidden;}if(this.overviewList.hidden!==!projection.current)this.overviewList.hidden=!projection.current;if(this.shortcut.hidden!==!!projection.current)this.shortcut.hidden=!!projection.current;
  const current=projection.current;this.currentTimer=current;if(current){const node=this.card(current,this.overviewList,`overview:${current.id}`);if(this.overviewList.children[0]!==node)this.overviewList.insertBefore(node,this.overviewList.children[0]||null);}
  const list=this.detail.querySelector('.timer-active-list');if(current){const node=this.card(current,list,`detail:${current.id}`);if(list.children[0]!==node)list.insertBefore(node,list.children[0]||null);}
  const running=this.detail.querySelector('.timer-running');if(running.hidden!==!current)running.hidden=!current;const detailHidden=s.focus!=='timers';if(this.detail.hidden!==detailHidden)this.detail.hidden=detailHidden;this.renderAccess(this.host.live?(this.accessModel||{connected:false,canStart:false,canCancel:false}):{connected:s.connected});
  const demoStart=document.getElementById('start-timer');if(demoStart&&demoStart.disabled!==!this.canStart)demoStart.disabled=!this.canStart;
  const history=s.timerHistory||[],signature=JSON.stringify(history);if(signature!==this.history){this.history=signature;const section=this.detail.querySelector('.timer-recent'),recent=section.querySelector('div');recent.replaceChildren();section.hidden=!history.length;for(const item of history){const b=document.createElement('button');b.type='button';const title=document.createElement('strong'),duration=document.createElement('span');title.textContent=item.name;duration.textContent=timerTime(item.seconds);b.append(duration,title);b.setAttribute('aria-label',`Brug ${timerTime(item.seconds)} til ${item.name}`);b.addEventListener('click',()=>{this.fill(item);this.form.scrollIntoView({block:'nearest',behavior:'instant'});this.form.querySelector('.timer-start').focus({preventScroll:true});});recent.append(b);}}const recent=this.detail.querySelector('.timer-recent'),recentHidden=!history.length||!this.canStart;if(recent.hidden!==recentHidden)recent.hidden=recentHidden;
 }
 renderNotice(focus=this.host.state.focus,live=this.host.live,feedbackVisible=document.getElementById('playback-status')?.hidden===false){
  const timer=this.currentTimer,id=timer?String(timer.id):null,resourceRail=document.getElementById('resource-rail');
  const inRail=focus==='photo'&&!resourceRail.hidden&&[...resourceRail.children].some(node=>!node.hidden&&node.dataset.timerId===id);
  const matches=node=>!node.hidden&&node.dataset.timerId===id;
  const inOverview=focus==='now'&&!document.getElementById('now-view').hidden&&[...this.overviewList.querySelectorAll('.timer-panel')].some(matches);
  const inDetail=focus==='timers'&&!this.detail.hidden&&[...this.detail.querySelectorAll('.timer-active-list .timer-panel')].some(matches);
  this.notice.render(timer,focus,live,feedbackVisible,inRail||inOverview||inDetail?id:null);
 }
 cleanup(){this.notice?.cleanup();}
}
