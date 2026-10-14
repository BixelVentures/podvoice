import {visibleTimers,timerTime,timerStateLabel,adjustTimerDuration,readTimerDuration} from './timer-model.js';
export class TimerView {
 constructor(host,detail,overview){
  this.host=host;this.detail=detail;this.overview=overview;this.nodes=new Map();this.connected=true;
  detail.innerHTML=`<header class="response-heading"><div><h1 id="timers-title" tabindex="-1">Timere</h1><p>Hold styr på tiden</p></div></header>
   <form class="timer-create" aria-label="Ny timer"><h2>Ny timer</h2>
    <div class="timer-stepper"><button type="button" class="timer-adjust" data-adjust="-60" aria-label="1 minut mindre"><img src="assets/icons/dash.svg" alt=""></button><div class="timer-selected"><output aria-live="polite" aria-label="Valgt tid">5:00</output><span>min : sek</span></div><button type="button" class="timer-adjust" data-adjust="60" aria-label="1 minut mere"><img src="assets/icons/plus.svg" alt=""></button></div>
    <div class="timer-presets" aria-label="Faste tider">${[1,5,10,15,30].map(n=>`<button type="button" data-minutes="${n}" aria-pressed="${n===5}">${n} min.</button>`).join('')}</div>
    <div class="timer-create-footer"><button type="button" class="timer-customize" aria-expanded="false" aria-controls="timer-exact">Navn og præcis tid</button><button type="submit" class="timer-start"><img src="assets/icons/play-fill.svg" alt="">Start timer</button></div>
    <div id="timer-exact" hidden><label class="timer-name">Navn <span>(valgfrit)</span><input name="name" maxlength="120" placeholder="Fx pasta" autocomplete="off"></label><div class="timer-duration"><label>Timer<input name="hours" type="number" inputmode="numeric" min="0" max="24" value="0" required></label><label>Minutter<input name="minutes" type="number" inputmode="numeric" min="0" max="59" value="5" required></label><label>Sekunder<input name="seconds" type="number" inputmode="numeric" min="0" max="59" value="0" required></label></div><p class="timer-validation" role="status" hidden>Vælg mellem 1 sekund og 24 timer.</p></div>
   </form><section class="timer-running"><h2>I gang</h2><div class="timer-active-list"></div></section><section class="timer-recent" hidden><h2>Senest brugt</h2><div></div></section>`;
  this.form=detail.querySelector('form');this.inputs=this.form.elements;this.duration=300;
  this.form.addEventListener('input',()=>{this.duration=readTimerDuration(this.inputs.hours.value,this.inputs.minutes.value,this.inputs.seconds.value);this.updatePicker();});
  this.form.addEventListener('submit',e=>{e.preventDefault();if(!this.connected||this.duration===null)return;host.dispatch({type:'timer-start',seconds:this.duration,name:this.inputs.name.value,now:Date.now()});if(host.live)return;const node=this.nodes.get(`detail:${host.state.timer.id}`);node?.querySelector('.timer-finish').focus({preventScroll:true});node?.scrollIntoView({block:'nearest',behavior:'instant'});});
  for(const b of detail.querySelectorAll('[data-minutes]'))b.addEventListener('click',()=>this.fill({seconds:Number(b.dataset.minutes)*60}));
  for(const b of detail.querySelectorAll('[data-adjust]'))b.addEventListener('click',()=>this.fill({seconds:adjustTimerDuration(this.duration??300,Number(b.dataset.adjust))}));
  this.customize=this.form.querySelector('.timer-customize');this.customize.addEventListener('click',()=>{const fields=this.form.querySelector('#timer-exact');fields.hidden=!fields.hidden;this.customize.setAttribute('aria-expanded',String(!fields.hidden));if(!fields.hidden)this.inputs.name.focus({preventScroll:true});});
  this.updatePicker();
 }
 fill({name,seconds}){if(name!==undefined)this.inputs.name.value=name;this.duration=seconds;this.inputs.hours.value=Math.floor(seconds/3600);this.inputs.minutes.value=Math.floor(seconds%3600/60);this.inputs.seconds.value=seconds%60;this.updatePicker();}
 updatePicker(){
  const seconds=this.duration;this.form.querySelector('output').textContent=seconds===null?'—':timerTime(seconds);this.form.querySelector('.timer-selected>span').textContent=seconds>=3600?'timer : min : sek':'min : sek';
  for(const b of this.form.querySelectorAll('[data-minutes]'))b.setAttribute('aria-pressed',String(Number(b.dataset.minutes)*60===seconds));
  this.form.querySelector('[data-adjust="-60"]').disabled=!this.connected||seconds===1;this.form.querySelector('[data-adjust="60"]').disabled=!this.connected||seconds===86400;this.form.querySelector('.timer-start').disabled=!this.connected||seconds===null;
  this.form.querySelector('.timer-validation').hidden=seconds!==null;
 }
 card(t,container,key){
  let node=this.nodes.get(key);if(!node){
   node=document.createElement('article');node.className='timer-panel';const overview=key.startsWith('overview:');const tag=overview?'button':'div';
   node.innerHTML=`<${tag} class="timer-open"><span class="timer-instrument" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="timer-track" cx="60" cy="60" r="54"/><circle class="timer-progress" cx="60" cy="60" r="54" pathLength="100"/></svg><span class="timer-count"></span></span><span class="timer-copy"><strong></strong><span class="timer-state"></span></span></${tag}><button class="timer-finish"></button>`;
   container.append(node);this.nodes.set(key,node);
   if(overview)node.querySelector('.timer-open').addEventListener('click',()=>{this.host.dispatch({type:'show',id:'timers'});this.host.focusHeading();});
   node.querySelector('.timer-finish').addEventListener('click',()=>{this.host.dispatch({type:'timer',id:node.dataset.timerId,action:'cancel'});this.host.focusHeading();});
  }
  node.hidden=false;node.dataset.timerId=t.id;node.dataset.status=t.status;node.style.setProperty('--progress',t.duration>0?Math.max(0,t.remaining/t.duration*100):0);node.querySelector('.timer-count').textContent=timerTime(t.remaining);node.querySelector('.timer-instrument').dataset.long=String(t.remaining>=3600);
  node.querySelector('.timer-copy strong').textContent=t.name||'Timer ved bordet';const status=t.stale||t.status!=='running'||t.deadline===null?timerStateLabel(t):`Slutter ${new Date(t.deadline).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}).replace('.',':')}`;node.querySelector('.timer-state').textContent=status;
  node.querySelector('.timer-open').setAttribute('aria-label',`${t.name||'Timer'} · ${timerTime(t.remaining)} · ${status}${key.startsWith('overview:')?' · Åbn timerdetaljer':''}`);
  const finish=node.querySelector('.timer-finish');finish.textContent=t.status==='done'?'Færdig':'Annuller';finish.setAttribute('aria-label',`${t.status==='done'?'Afslut':'Annuller'} ${t.name||'timer'}`);return node;
 }
 render(s){
  const rows=visibleTimers(s);for(const node of this.nodes.values())node.hidden=true;this.overview.hidden=!rows.length;
  const list=this.detail.querySelector('.timer-active-list');rows.forEach((t,index)=>{for(const [container,key] of [[this.overview,`overview:${t.id}`],[list,`detail:${t.id}`]]){const node=this.card(t,container,key);if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);}});
  this.detail.querySelector('.timer-running').hidden=!rows.length;this.detail.hidden=s.focus!=='timers';this.connected=s.connected;
  for(const input of this.form.elements)input.disabled=!s.connected;this.updatePicker();
  const history=s.timerHistory||[],signature=JSON.stringify(history);if(signature!==this.history){this.history=signature;const section=this.detail.querySelector('.timer-recent'),recent=section.querySelector('div');recent.replaceChildren();section.hidden=!history.length;for(const item of history){const b=document.createElement('button');b.type='button';const title=document.createElement('strong'),duration=document.createElement('span');title.textContent=item.name;duration.textContent=timerTime(item.seconds);b.append(duration,title);b.setAttribute('aria-label',`Brug ${timerTime(item.seconds)} til ${item.name}`);b.addEventListener('click',()=>{this.fill(item);this.form.scrollIntoView({block:'nearest',behavior:'instant'});this.form.querySelector('.timer-start').focus({preventScroll:true});});recent.append(b);}}
 }
}
