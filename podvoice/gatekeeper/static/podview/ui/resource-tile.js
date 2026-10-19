// Retained, native button anatomy shared by the overview and supporting stack.
// Visuals reflect known local state only; there is no invented device telemetry.
import {timerProgress} from '../timer-model.js';
export function createResourceTile(open){
 const b=document.createElement('button');b.type='button';b.className='resource-preview';
 b.innerHTML='<span class="resource-visual" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="resource-dial-track" cx="40" cy="40" r="34"/><circle class="resource-dial-progress" cx="40" cy="40" r="34" pathLength="100"/></svg><img alt=""><span class="resource-value"></span></span><span class="resource-label"><strong></strong><small></small></span><img class="resource-chevron" src="assets/icons/chevron-right.svg" alt="">';
 b.addEventListener('click',()=>open(b.dataset.target));return b;
}
export function updateResourceTile(b,r){
 const hidden=r.hidden===true;if(b.hidden!==hidden)b.hidden=hidden;
 if(typeof r.disabled==='boolean'&&b.disabled!==r.disabled)b.disabled=r.disabled;
 if(r.target==null){if(b.dataset.target!==undefined)delete b.dataset.target;}else if(b.dataset.target!==String(r.target))b.dataset.target=r.target;
 if(b.dataset.kind!==String(r.kind))b.dataset.kind=r.kind;
 if(b.dataset.status!==(r.status||''))b.dataset.status=r.status||'';
 const title=b.querySelector('strong'),detail=b.querySelector('small');
 if(title.textContent!==String(r.title??''))title.textContent=r.title??'';
 if(detail.textContent!==String(r.detail??''))detail.textContent=r.detail??'';
 const value=b.querySelector('.resource-value');if(value.textContent!==String(r.value||''))value.textContent=r.value||'';
 const icon=b.querySelector('.resource-visual img'),timer=r.kind==='timer';if(icon.hidden!==timer)icon.hidden=timer;
 const source=`assets/icons/${r.kind==='vacuum'?'vacuum':'lightbulb'}.svg`;
 if(!timer&&icon.getAttribute('src')!==source)icon.src=source;
 const progress=timer?timerProgress(r):null,known=String(progress!==null);
 if(b.dataset.progressKnown!==known)b.dataset.progressKnown=known;
 const dial=b.querySelector('svg'),display=timer?'':'none',remaining=String(progress??0);
 if(dial.style.display!==display)dial.style.display=display;
 if(b.style.getPropertyValue('--remaining')!==remaining)b.style.setProperty('--remaining',remaining);
 const label=typeof r.ariaLabel==='string'?r.ariaLabel:`${r.title}${r.value?' · '+r.value:''} · ${r.detail}. Åbn detaljer`;
 if(b.getAttribute('aria-label')!==label)b.setAttribute('aria-label',label);
}
