import {conditionLabel,conditionIcon,weatherTemperature} from './weather-observation.js';
import {renderWeather,liveWeatherModel} from './weather-view.js';
import {robotFacts} from './robot-observation.js';
const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export function renderLiveWeather(host){
 globalThis.clearTimeout(host.weatherAdviceTimer);host.weatherAdviceTimer=null;
 const w=host.state.liveWeather,view=$('weather-view'),connected=host.live?host.liveTransport?.connected===true:host.state.connected!==false,model=liveWeatherModel(w,{connected,aiContext:host.liveSnapshot?{...host.liveSnapshot.answers,roomId:host.liveSnapshot.roomId}:null});
 host.weatherNodes=renderWeather(view,model);view.hidden=!w||host.state.focus!=='weather';if(!w){for(const id of ['header-weather','photo-weather','home-weather']){$(id).hidden=true;$(id).disabled=true;}return;}
 const temp=w.current?.temperature,condition=conditionLabel(w.current?.condition),label=w.stale||!connected?'Sidst kendte vejr':'Vejret i dag';
 for(const id of ['header-weather','photo-weather','home-weather']){const button=$(id);button.hidden=host.state.focus==='photo'?id!=='photo-weather':id==='photo-weather';if(id==='home-weather')button.hidden=host.state.focus!=='now';button.disabled=false;const icon=button.querySelector(':scope > img');if(icon){const file=conditionIcon(w.current?.condition);icon.hidden=!file;if(file)icon.src=`assets/icons/${file}.svg`;}const strong=button.querySelector('strong');if(strong)strong.textContent=Number.isFinite(temp)?weatherTemperature(temp,w.unit):'Vejr';const description=button.querySelector(id==='photo-weather'?':scope > span':'small');if(description)description.textContent=id==='home-weather'?[w.displayLocation?.name||w.location,label].filter(Boolean).join(' · '):w.stale||!connected?'Sidst kendt':condition||'Se vejrudsigten';button.querySelector('.home-forecast')?.remove();}
 const current=$('home-weather').querySelector('strong');if(current)current.textContent=[Number.isFinite(temp)?weatherTemperature(temp,w.unit):'Vejr',condition].filter(Boolean).join(' ');
 const refreshAt=model.refreshAt||model.adviceUntil;if(refreshAt){const identity=w;let handle;handle=globalThis.setTimeout(()=>{if(host.weatherAdviceTimer!==handle)return;host.weatherAdviceTimer=null;if(host.isConnected&&host.state.liveWeather===identity)renderLiveWeather(host);},Math.min(2147483647,refreshAt-Date.now()+1));host.weatherAdviceTimer=handle;}
}
export function renderRobotHistory(host){
 const timeline=$('device-timeline'),historySection=timeline.closest('.device-history');
 let section=$('robot-recent');if(!section){section=make('section','device-history robot-recent');section.id='robot-recent';$('device-view').append(section);}
 const d=host.state.devices.find(x=>x.id===host.state.focus&&x.kind==='vacuum');section.hidden=!d?.live;historySection.hidden=false;if(!d?.live){timeline.hidden=false;const empty=$('robot-history-empty');if(empty)empty.hidden=true;return;}
 const history=d.history||{status:'unavailable',items:[]},facts=robotFacts(d),allowed=!!host.liveControls?.allowed('vacuum'),signature=JSON.stringify([history,facts,allowed]);
 const values=d.telemetry?.status==='observed'?d.telemetry.items:[],dates=['last_clean_start','last_clean_end'].map(key=>values.find(row=>row.key===key)).filter(Boolean);
 // These are independent source timestamps, not a reconstructed completed job.
 timeline.data={items:facts.history.map((row,index)=>{const source=dates[index];return {id:`robot-fact:${source.key}`,time:row.value,label:`${row.label}${row.stale?' · sidst kendt':''}`,at:source.value};}).sort((a,b)=>b.at-a.at).map(({at,...row})=>row)};
 let empty=$('robot-history-empty');if(!empty){empty=make('p','robot-history-note','Tidligere rengøringer er endnu ikke tilgængelige.');empty.id='robot-history-empty';historySection.append(empty);}empty.hidden=!!facts.history.length;timeline.hidden=!facts.history.length;
 if(section.dataset.signature===signature)return;section.dataset.signature=signature;const detailOpen=section.querySelector('details')?.open||false;section.replaceChildren();
 if(facts.summary.length)section.append(make('p','robot-history-note',facts.summary.join(' · ')));
 if(facts.attention.length){const warning=make('p','robot-history-note',facts.attention.join(' · '));warning.setAttribute('role','status');section.append(warning);}
 if(facts.details.length){const details=make('details','device-history');details.open=detailOpen;details.append(make('summary',null,'Pleje og indstillinger'));for(const row of facts.details)details.append(make('p',null,`${row.label}: ${row.value}${row.stale?' · sidst kendt':''}`));section.append(details);}
 if(history.status!=='observed'||!history.items.length)return;
 section.append(make('h2',null,'Senest anmodet'));const requests=make('pv-activity-timeline');requests.data={items:history.items.map(record=>({id:`robot-request:${record.id}`,time:new Date(record.recordedAt*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),label:`${record.outcome==='accepted_by_ha'?'Start anmodet':'Udfald ukendt'} · ${record.recipe.mapName||'Rengøring'} · ${record.recipe.areaIds.length} ${record.recipe.areaIds.length===1?'område':'områder'} · ${record.recipe.repeat} ${record.recipe.repeat===1?'gang':'gange'}`}))};section.append(requests);
 if(allowed)for(const record of history.items){if(record.outcome!=='accepted_by_ha')continue;const reuse=make('button','text-control',`Brug ${record.recipe.mapName||'rengøring'} igen`);reuse.type='button';reuse.setAttribute('aria-label',`Brug igen: ${record.recipe.mapName||'Rengøring'} · ${new Date(record.recordedAt*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`);reuse.addEventListener('click',()=>host.liveControls.openRobot(reuse,record.id));section.append(reuse);}
}
