// Retained, native button anatomy shared by the overview and supporting stack.
// Visuals reflect known local state only; there is no invented device telemetry.
import {timerProgress,timerStateLabel} from '../timer-model.js';
export function createResourceTile(open){
 const b=document.createElement('button');b.type='button';b.className='resource-preview';
 b.innerHTML='<span class="resource-visual" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="resource-dial-track" cx="40" cy="40" r="34"/><circle class="resource-dial-progress" cx="40" cy="40" r="34" pathLength="100"/></svg><img alt=""></span><span class="resource-label"><span class="resource-value"></span><strong></strong><small></small></span><img class="resource-chevron" src="assets/icons/chevron-right.svg" alt="">';
 b.addEventListener('click',()=>{if(!b.disabled&&b.dataset.target)open(b.dataset.target);});return b;
}
export function updateResourceTile(b,r){
 const hidden=r.hidden===true;if(b.hidden!==hidden)b.hidden=hidden;
 if(typeof r.disabled==='boolean'&&b.disabled!==r.disabled)b.disabled=r.disabled;
 if(r.target==null){if(b.dataset.target!==undefined)delete b.dataset.target;}else if(b.dataset.target!==String(r.target))b.dataset.target=r.target;
 if(b.dataset.kind!==String(r.kind))b.dataset.kind=r.kind;
 if(b.dataset.status!==(r.status||''))b.dataset.status=r.status||'';
 // Compact and expanded resources expose the same state role to the shared kit.
 if(b.dataset.resourceStatus!==(r.resourceStatus||r.status||''))b.dataset.resourceStatus=r.resourceStatus||r.status||'';
 const pending=r.status==='pending',busy=String(pending);
 if(b.getAttribute('aria-busy')!==busy)b.setAttribute('aria-busy',busy);
 const timer=r.kind==='timer',done=timer&&r.status==='done',reading=done?'Tiden er gået':String(r.value??''),timerDetail=timer?(r.displayState||(r.stale||r.status!=='running'||!Number.isFinite(r.deadline)?timerStateLabel(r):`Slutter ${new Date(r.deadline).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'})}`)):r.detail,rawDetail=done&&timerDetail===reading?'':String(timerDetail??'');
 // Device telemetry belongs beside its status, never on top of the family icon.
 const deviceDetail=!timer&&r.kind!=='vacuum'&&reading&&!rawDetail.includes(reading)?[rawDetail,reading].filter(Boolean).join(' · '):rawDetail;
 const visibleDetail=pending&&!deviceDetail.startsWith('Afventer')?`Afventer svar · ${deviceDetail||'sidst kendte status'}`:deviceDetail;
 const title=b.querySelector('strong'),detail=b.querySelector('small');
 if(title.textContent!==String(r.title??''))title.textContent=r.title??'';
 const secondaryDetail=r.kind==='vacuum'?'':visibleDetail;if(detail.textContent!==secondaryDetail)detail.textContent=secondaryDetail;const detailHidden=!secondaryDetail;if(detail.hidden!==detailHidden)detail.hidden=detailHidden;
 const value=b.querySelector('.resource-value'),dialValue=timer?reading:r.kind==='vacuum'?[visibleDetail,reading].filter(Boolean).join(' · ')||'Status ukendt':'';if(value.textContent!==dialValue)value.textContent=dialValue;const valueHidden=!timer&&r.kind!=='vacuum';if(value.hidden!==valueHidden)value.hidden=valueHidden;
 const icon=b.querySelector('.resource-visual img');if(icon.hidden)icon.hidden=false;
 const source=`assets/icons/${timer?'timer':r.kind==='vacuum'?'vacuum':r.kind==='vehicle'?'car-front':'lightbulb'}.svg`;
 if(icon.getAttribute('src')!==source)icon.src=source;
 const progress=timer?timerProgress(r):null,known=String(progress!==null);
 if(b.dataset.progressKnown!==known)b.dataset.progressKnown=known;
 const dial=b.querySelector('svg'),display=timer?'':'none',remaining=String(progress??0);
 if(dial.style.display!==display)dial.style.display=display;
 if(b.style.getPropertyValue('--remaining')!==remaining)b.style.setProperty('--remaining',remaining);
 const label=typeof r.ariaLabel==='string'?r.ariaLabel:`${[r.title,timer?reading:r.kind==='vacuum'?dialValue:'',r.kind==='vacuum'?'':visibleDetail].filter(Boolean).join(' · ')}. Åbn detaljer`;
 if(b.getAttribute('aria-label')!==label)b.setAttribute('aria-label',label);
}
