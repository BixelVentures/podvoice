import {conditionLabel,conditionIcon,weatherTemperature} from './weather-observation.js';
import {renderWeather,liveWeatherModel} from './weather-view.js';
import {robotFacts} from './robot-observation.js';
const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export function renderLiveWeather(host){
 const w=host.state.liveWeather,view=$('weather-view'),connected=host.live?host.liveTransport?.connected===true:host.state.connected!==false,model=liveWeatherModel(w,{connected,aiContext:host.liveSnapshot?{...host.liveSnapshot.answers,roomId:host.liveSnapshot.roomId}:null});
 host.weatherNodes=renderWeather(view,model);if(view.hidden!==(host.state.focus!=='weather'))view.hidden=host.state.focus!=='weather';
 const temp=w?.current?.temperature,condition=conditionLabel(w?.current?.condition),label=w?.stale||!connected?'Sidst kendte vejr':'Vejret i dag';
 for(const id of ['header-weather','photo-weather','home-weather']){
  const button=$(id),visible=w?(id==='home-weather'?host.state.focus==='now':host.state.focus==='photo'?id==='photo-weather':id!=='photo-weather'):id==='home-weather'&&host.state.focus==='now'&&host.liveSnapshot?.capabilities?.homeRead?.includes('weather')===true;
  if(button.hidden!==!visible)button.hidden=!visible;if(button.disabled!==(!w&&!visible))button.disabled=!w&&!visible;
  const icon=button.querySelector(':scope > img'),file=w?conditionIcon(w.current?.condition,w.current?.isDaytime):null;if(icon){if(icon.hidden!==!file)icon.hidden=!file;const src=file?`assets/icons/${file}.svg`:null;if(src&&icon.getAttribute('src')!==src)icon.src=src;}
  const strong=button.querySelector('strong'),title=!w?'Vejr':id==='home-weather'?[Number.isFinite(temp)?weatherTemperature(temp,w.unit):'Vejr',condition].filter(Boolean).join(' '):Number.isFinite(temp)?weatherTemperature(temp,w.unit):'Vejr';if(strong&&strong.textContent!==title)strong.textContent=title;
  const description=button.querySelector(id==='photo-weather'?':scope > span':'small'),detail=!w?'Ingen vejrdata':id==='home-weather'?[model.title,label].filter(Boolean).join(' · '):w.stale||!connected?'Sidst kendt':condition||'Se vejrudsigten';if(description&&description.textContent!==detail)description.textContent=detail;button.querySelector('.home-forecast')?.remove();
 }
 const refreshAt=model.refreshAt||model.adviceUntil||null;if(refreshAt!==host.weatherAdviceAt||refreshAt&&!host.weatherAdviceTimer){globalThis.clearTimeout(host.weatherAdviceTimer);host.weatherAdviceTimer=null;host.weatherAdviceAt=refreshAt;if(refreshAt){let handle;handle=globalThis.setTimeout(()=>{if(host.weatherAdviceTimer!==handle)return;host.weatherAdviceTimer=null;if(host.isConnected)renderLiveWeather(host);},Math.min(2147483647,refreshAt-Date.now()+1));host.weatherAdviceTimer=handle;}}
}

export function renderRobotHistory(host){
 const timeline=$('device-timeline'),historySection=timeline.closest('.device-history');
 let section=$('robot-recent');if(!section){section=make('section','device-history robot-recent pv-component');section.id='robot-recent';$('device-view').append(section);}
 const d=host.state.devices.find(x=>x.id===host.state.focus&&x.kind==='vacuum');if(section.hidden!==!d?.live)section.hidden=!d?.live;if(historySection.hidden)historySection.hidden=false;if(!d?.live){if(timeline.hidden)timeline.hidden=false;return;}
 const history=d.history||{status:'unavailable',items:[]},facts=robotFacts(d),allowed=!!host.liveControls?.allowed('vacuum'),signature=JSON.stringify([history,facts,allowed]);
 const values=d.telemetry?.status==='observed'?d.telemetry.items:[],dates=['last_clean_start','last_clean_end'].map(key=>values.find(row=>row.key===key)).filter(Boolean);
 // Native start/end timestamps and control requests are separate facts in one history.
 const observed=facts.history.map((row,index)=>{const source=dates[index];return {id:`robot-fact:${source.key}`,time:row.value,label:`${row.label}${row.stale?' · sidst kendt':''}`,at:source.value};});
 const requested=history.status==='observed'?history.items.map(record=>({id:`robot-request:${record.id}`,time:new Date(record.recordedAt*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),label:`${record.outcome==='accepted_by_ha'?'Start anmodet':'Udfald ukendt'} · ${record.recipe.mapName||'Rengøring'} · ${record.recipe.areaIds.length} ${record.recipe.areaIds.length===1?'område':'områder'} · ${record.recipe.repeat} ${record.recipe.repeat===1?'gang':'gange'}`,at:record.recordedAt})):[];
 const events=[...observed,...requested].sort((a,b)=>b.at-a.at).map(({at,...row})=>row);
 if(timeline.hidden)timeline.hidden=false;const presentation={items:events,state:events.length?'ready':'empty',stateText:events.length?'':history.status==='observed'?'Ingen hændelser at vise endnu.':'Hændelser er ikke tilgængelige lige nu.'};if(JSON.stringify(timeline.data)!==JSON.stringify(presentation))timeline.data={items:events,state:presentation.state,stateText:presentation.stateText};
 if(section.dataset.signature===signature)return;section.dataset.signature=signature;section.replaceChildren();
 if(facts.summary.length)section.append(make('p','robot-history-note',facts.summary.join(' · ')));
 if(facts.attention.length){const warning=make('p','robot-history-note',facts.attention.join(' · '));warning.setAttribute('role','status');section.append(warning);}
 if(history.status!=='observed'||!history.items.length)return;
 if(allowed)for(const record of history.items){if(record.outcome!=='accepted_by_ha')continue;const reuse=make('button','pv-button pv-ghost',`Brug ${record.recipe.mapName||'rengøring'} igen`);reuse.type='button';reuse.setAttribute('aria-label',`Brug igen: ${record.recipe.mapName||'Rengøring'} · ${new Date(record.recordedAt*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`);reuse.addEventListener('click',()=>host.liveControls.openRobot(reuse,record.id));section.append(reuse);}
}
