import {applyKitComponent} from './kit.js';
// Retained, native button anatomy shared by the overview and supporting stack.
// Visuals reflect known local state only; there is no invented device telemetry.
import {timerProgress,timerStateLabel} from '../timer-model.js';
// The Card's factual information role is shared by native overview buttons and
// resource tiles. It never creates an action or fills missing source values.
export function updateResourceFacts(node,{facts=[],context=''}={}){
 const items=[],seen=new Set();
 for(const item of Array.isArray(facts)?facts:[]){
  if(!item||typeof item.id!=='string'||!item.id||seen.has(item.id)||typeof item.label!=='string'||!item.label.trim())continue;
  const value=typeof item.value==='string'?item.value.trim():Number.isFinite(item.value)?String(item.value):'';
  if(!value)continue;const stale=item.stale===true,meter=!stale&&Number.isFinite(item.meter?.value)&&Number.isFinite(item.meter?.max)&&item.meter.max>0&&item.meter.value>=0&&item.meter.value<=item.meter.max?{value:item.meter.value,max:item.meter.max}:null;
  seen.add(item.id);items.push({id:item.id,label:item.label.trim().slice(0,80),value:value.slice(0,180),stale,...(meter?{meter}:{})});if(items.length===6)break;
 }
 const note=typeof context==='string'?context.trim().slice(0,300):'',signature=JSON.stringify([items,note]);let retained=node.resourceFacts;
 if(!retained&&!items.length&&!note)return;
 if(retained?.signature===signature)return retained;
 if(!retained){
  const doc=node.ownerDocument||globalThis.document,list=doc.createElement('span'),contextNode=doc.createElement('span');list.className='resource-facts';list.setAttribute('role','list');contextNode.className='resource-context';node.append(list,contextNode);retained=node.resourceFacts={list,context:contextNode,rows:new Map()};
 }
 retained.signature=signature;retained.items=items;
 const hasFacts=String(!!(items.length||note)),count=String(items.length);if(node.dataset.hasFacts!==hasFacts)node.dataset.hasFacts=hasFacts;if(node.dataset.factCount!==count)node.dataset.factCount=count;
 for(const [id,row]of retained.rows)if(!seen.has(id)){row.node.remove();retained.rows.delete(id);}
 items.forEach((item,index)=>{
  let row=retained.rows.get(item.id);
  if(!row){const doc=node.ownerDocument||globalThis.document,element=doc.createElement('span'),label=doc.createElement('span'),value=doc.createElement('span');element.className='resource-fact';applyKitComponent(element,'listrow',{variant:'read-only'});element.dataset.factId=item.id;element.setAttribute('role','listitem');label.className='resource-fact-label';value.className='resource-fact-value';element.append(label,value);row={node:element,label,value};retained.rows.set(item.id,row);}
  const value=item.value+(item.stale?' · sidst kendt':'');if(row.label.textContent!==item.label)row.label.textContent=item.label;if(row.value.textContent!==value)row.value.textContent=value;if(retained.list.children[index]!==row.node)retained.list.insertBefore(row.node,retained.list.children[index]||null);
  // A determinate meter is source data, never parsed from the displayed copy.
  // Keep the native node for recovery; stale/invalid observations hide and clear it.
  if(item.meter&&!row.meter){row.meter=(node.ownerDocument||globalThis.document).createElement('progress');row.meter.className='resource-fact-meter';row.node.append(row.meter);}
  if(row.meter){const hidden=!item.meter;if(row.meter.hidden!==hidden)row.meter.hidden=hidden;if(item.meter){for(const [key,number]of Object.entries(item.meter)){const text=String(number);if(row.meter.getAttribute(key)!==text)row.meter.setAttribute(key,text);}if(row.meter.getAttribute('aria-label')!==item.label)row.meter.setAttribute('aria-label',item.label);}else for(const key of ['value','max'])if(row.meter.getAttribute(key)!==null)row.meter.removeAttribute(key);}
 });
 if(retained.list.hidden!==!items.length)retained.list.hidden=!items.length;if(retained.context.textContent!==note)retained.context.textContent=note;if(retained.context.hidden!==!note)retained.context.hidden=!note;return retained;
}
export function createResourceTile(open){
 const b=document.createElement('button');b.type='button';b.className='resource-preview';applyKitComponent(b,'tile');
 b.innerHTML='<span class="resource-visual" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="resource-dial-track" cx="40" cy="40" r="34"/><circle class="resource-dial-progress" cx="40" cy="40" r="34" pathLength="100"/></svg><img alt=""></span><span class="resource-label"><span class="resource-value"></span><strong><span class="resource-title-full"></span><span class="resource-title-short" aria-hidden="true"></span></strong><small></small></span><img class="resource-chevron" src="assets/icons/chevron-right.svg" alt="">';
 b.addEventListener('click',()=>{if(!b.disabled&&b.dataset.target)open(b.dataset.target);});return b;
}
export function updateResourceTile(b,r){
 const hidden=r.hidden===true;if(b.hidden!==hidden)b.hidden=hidden;
 // Opening retained/empty detail is navigation, not permission to control it.
 const navigationDisabled=r.navigationDisabled===true||r.target==null;if(b.disabled!==navigationDisabled)b.disabled=navigationDisabled;
 if(r.target==null){if(b.dataset.target!==undefined)delete b.dataset.target;}else if(b.dataset.target!==String(r.target))b.dataset.target=r.target;
 if(b.dataset.kind!==String(r.kind))b.dataset.kind=r.kind;const identity=r.kind==='vacuum'?'robot':r.kind==='light'?'light':r.kind==='vehicle'?'tesla':'neutral';if(b.dataset.kitIdentity!==identity)b.dataset.kitIdentity=identity;
 if(b.dataset.status!==(r.status||''))b.dataset.status=r.status||'';
 // Compact and expanded resources expose the same state role to the shared kit.
 if(b.dataset.resourceStatus!==(r.resourceStatus||r.status||''))b.dataset.resourceStatus=r.resourceStatus||r.status||'';
 const observedState=r.resourceStatus||r.status,kitState=r.status==='pending'?'pending':observedState==='unavailable'?'unavailable':r.stale===true?'stale':observedState==='unknown'?'unknown':['fault','error'].includes(observedState)?'error':'ready';if(b.dataset.kitState!==kitState)b.dataset.kitState=kitState;
 const facts=updateResourceFacts(b,r),factIds=new Set(facts?.items.map(item=>item.id)||[]);
 const pending=r.status==='pending',busy=String(pending);
 if(b.getAttribute('aria-busy')!==busy)b.setAttribute('aria-busy',busy);
 const timer=r.kind==='timer',done=timer&&r.status==='done',reading=done?'Tiden er gået':String(r.value??''),timerDetail=timer?(r.displayState||(r.stale||r.status!=='running'||!Number.isFinite(r.deadline)?timerStateLabel(r):`Slutter ${new Date(r.deadline).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'})}`)):r.detail,rawDetail=done&&timerDetail===reading?'':String(timerDetail??'');
 // Device telemetry belongs beside its status, never on top of the family icon.
 const deviceDetail=!timer&&r.kind!=='vacuum'&&reading&&!rawDetail.includes(reading)?[rawDetail,reading].filter(Boolean).join(' · '):rawDetail;
 const visibleDetail=pending&&!deviceDetail.startsWith('Afventer')?`Afventer svar · ${deviceDetail||'sidst kendte status'}`:deviceDetail;
 const title=b.querySelector('strong'),detail=b.querySelector('small');
 // Both title roles remain mounted: library size can change after this render.
 // CSS chooses the visible role; the full source title owns the accessible name.
 const fullTitle=title.querySelector?.('.resource-title-full')||title,shortTitle=title.querySelector?.('.resource-title-short'),fullText=String(r.title??''),shortText=({vacuum:'Robot',light:'Lys',timer:'Timer',vehicle:'Tesla'})[r.kind]||fullText;
 if(fullTitle.textContent!==fullText)fullTitle.textContent=fullText;if(shortTitle&&shortTitle.textContent!==shortText)shortTitle.textContent=shortText;
 const vacuum=r.kind==='vacuum',robotStatus=r.resourceStatus||r.status,robotLabel=({cleaning:'Gør rent',paused:'På pause',docking:'På vej til basen',returning:'På vej til basen',docked:'Ved basen',stopped:'Stoppet',complete:'Rengøring afsluttet',fault:'Kræver hjælp',error:'Kræver hjælp',unknown:'Ukendt',unavailable:'Ikke forbundet'})[robotStatus]||'Ukendt';
 const knownBattery=vacuum&&/^\d+(?:[.,]\d+)? %$/.test(reading)&&Number(reading.slice(0,-2).replace(',','.'))>=0&&Number(reading.slice(0,-2).replace(',','.'))<=100?`Batteri ${reading}`:'';
 const stale=vacuum&&(/^Sidst kendt/.test(rawDetail)||r.stale===true),fault=vacuum&&['fault','error'].includes(robotStatus),context=vacuum&&rawDetail.startsWith('Rengør · ')?rawDetail.slice('Rengør · '.length):'';
 const knownProgress=vacuum&&!stale&&robotStatus==='cleaning'&&Number.isFinite(r.progress)&&r.progress>=0&&r.progress<=100?`${r.progress.toLocaleString('da-DK',{maximumFractionDigits:1})} % færdig`:'';
 // Freshness belongs in the always-visible status, including S where optional
 // metadata is deliberately hidden. Recovery keeps its own existing text role.
 const unknownOutcome=vacuum&&robotStatus==='unknown'&&rawDetail.startsWith('Udfald ukendt'),robotFeedback=pending?'Afventer svar':fault&&rawDetail&&!['Robotten melder en fejl','Kræver hjælp'].includes(rawDetail)?rawDetail:unknownOutcome?'Udfald ukendt · hent status igen':'';
 const staleAttribute=String(stale);if(b.dataset.resourceStale!==staleAttribute)b.dataset.resourceStale=staleAttribute;const feedback=unknownOutcome?'unknown':'';if(b.dataset.resourceFeedback!==feedback)b.dataset.resourceFeedback=feedback;
 // Only a complete admitted lamp count can become the compact value. Partial
 // observations keep their explicit fact label instead of implying a total.
 const lightCount=r.kind==='light'?facts?.items.find(item=>item.id==='on-count'&&item.label==='Tændt'&&/^\d+ af \d+$/.test(item.value)):null;
 const size=b.overviewShell?.dataset.kitSize||b.dataset.kitSize,mediumRobot=vacuum&&size!=='s'&&size!=='l'&&b.parentNode?.id!=='resource-rail',compactLight=lightCount&&(!size||size==='s'),lightStatus=compactLight?[lightCount.stale?'Sidst kendt':'',Number(lightCount.value.split(' ')[0])?'tændt':'slukket'].filter(Boolean).join(' · '):visibleDetail;
 const batteryFact=facts?.items.find(item=>item.id==='battery'),roomFact=facts?.items.find(item=>item.id==='room'),mediumBattery=knownBattery||(batteryFact?`Batteri ${batteryFact.value}${batteryFact.stale&&!stale?' · sidst kendt':''}`:''),mediumContext=context||roomFact?.value||'';
 const secondaryDetail=vacuum?(mediumRobot?[robotFeedback,mediumBattery,mediumContext]:[robotFeedback,factIds.has('room')?'':context,factIds.has('progress')?'':knownProgress,factIds.has('battery')?'':knownBattery]).filter(Boolean).join(' · '):pending?visibleDetail:lightStatus;if(detail.textContent!==secondaryDetail)detail.textContent=secondaryDetail;const detailHidden=!secondaryDetail;if(detail.hidden!==detailHidden)detail.hidden=detailHidden;
 const value=b.querySelector('.resource-value'),dialValue=timer?reading:vacuum?[stale&&robotStatus!=='unavailable'?'Sidst kendt':'',robotLabel].filter(Boolean).join(' · '):lightCount?.value||'';if(value.textContent!==dialValue)value.textContent=dialValue;const valueHidden=!timer&&!vacuum&&!lightCount;if(value.hidden!==valueHidden)value.hidden=valueHidden;
 const hasValue=String(!!lightCount);if(r.kind==='light'&&b.dataset.hasOverviewValue!==hasValue)b.dataset.hasOverviewValue=hasValue;
 const icon=b.querySelector('.resource-visual img');if(icon.hidden)icon.hidden=false;
 const source=`assets/icons/${timer?'timer':r.kind==='vacuum'?'vacuum':r.kind==='vehicle'?'car-front':'lightbulb'}.svg`;
 if(icon.getAttribute('src')!==source)icon.src=source;
 const progress=timer?timerProgress(r):null,known=String(progress!==null);
 if(b.dataset.progressKnown!==known)b.dataset.progressKnown=known;
 const dial=b.querySelector('svg'),display=timer?'':'none',remaining=String(progress??0);
 if(dial.style.display!==display)dial.style.display=display;
 if(b.style.getPropertyValue('--remaining')!==remaining)b.style.setProperty('--remaining',remaining);
 // Use the rendered value, title and detail in their actual DOM order.
 if(b.getAttribute('aria-label')!==null)b.removeAttribute('aria-label');
}


// The kit decides whether a resource overview may expose an actual command.
// Whole-card navigation already opens detail; it never needs a duplicate CTA.
// The domain supplies admitted actions. This policy never invents live authority.
export function resourceOverviewAction(resource,{connected=false,live=false,actions=[],canControl=false,size}={}){
 // S cards keep one whole-tile navigation target. Only the existing M Robot
 // can expose its already admitted Pause/Continue command in the overview.
 if(!resource||resource.kind!=='vacuum'||size==='s'||!connected||live||resource.live||!canControl||resource.presentationOnly||resource.stale)return null;
 const id=({cleaning:'pause',paused:'resume'})[resource.status];
 const admitted=id&&actions.find(action=>action.id===id);if(!admitted)return null;
 const label=({pause:'Pause',resume:'Fortsæt',turn_on:'Tænd',turn_off:'Sluk'})[id];
 return {id,label,ariaLabel:admitted.label||label,disabled:!!resource.pending};
}
