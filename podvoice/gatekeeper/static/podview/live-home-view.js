import {conditionLabel,conditionIcon,weatherTemperature} from './weather-observation.js';
import {renderWeather,liveWeatherModel,weatherOverviewDetail,weatherHeaderVisible,renderOverviewForecast} from './weather-view.js';
import {robotFacts} from './robot-observation.js';
const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export function renderLiveWeather(host){
 const w=host.state.liveWeather,view=$('weather-view'),connected=host.live?host.liveTransport?.connected===true:host.state.connected!==false,model=liveWeatherModel(w,{connected,aiContext:host.liveSnapshot?{...host.liveSnapshot.answers,roomId:host.liveSnapshot.roomId}:null});
 if(host.state.focus==='weather'||host.weatherNodes)host.weatherNodes=renderWeather(view,model);if(view.hidden!==(host.state.focus!=='weather'))view.hidden=host.state.focus!=='weather';
 const temp=w?.current?.temperature,condition=conditionLabel(w?.current?.condition),hasWeather=!!model.current||model.hours.length>0||model.days.length>0;
 for(const id of ['header-weather','photo-weather','home-weather']){
  const button=$(id),visible=id==='header-weather'?weatherHeaderVisible(host.state.focus,hasWeather):hasWeather?(id==='home-weather'?host.state.focus==='now':host.state.focus==='photo'?id==='photo-weather':id!=='photo-weather'):id==='home-weather'&&host.state.focus==='now'&&host.liveSnapshot?.capabilities?.homeRead?.includes('weather')===true;
  if(button.hidden!==!visible)button.hidden=!visible;if(button.disabled!==(!w&&!visible))button.disabled=!w&&!visible;
  const icon=button.querySelector(':scope > img'),file=w?conditionIcon(w.current?.condition,w.current?.isDaytime):null;if(icon){if(icon.hidden!==!file)icon.hidden=!file;const src=file?`assets/icons/${file}.svg`:null;if(src&&icon.getAttribute('src')!==src)icon.src=src;}
  const temperature=Number.isFinite(temp)?weatherTemperature(temp,w.unit):id==='home-weather'?'':hasWeather?'Vejr':'';
  if(id==='home-weather'){
   const value=button.querySelector('.home-temperature'),description=button.querySelector('.home-condition'),forecast=button.querySelector('.home-forecast'),range=model.current?.range||'';
   if(value&&value.textContent!==temperature)value.textContent=temperature;if(description&&description.textContent!==condition)description.textContent=condition;
   renderOverviewForecast(button,model);
  }else{const strong=button.querySelector('strong'),label=id==='header-weather'?temperature.replace(/°[CF]$/,'°'):temperature;if(strong&&strong.textContent!==label)strong.textContent=label;}
  const description=button.querySelector(id==='photo-weather'?':scope > span':'small'),detail=!hasWeather?'Ingen vejrdata':id==='home-weather'?weatherOverviewDetail(model):model.sourceStale?'Sidst kendt':condition||'Se vejrudsigten';if(description&&description.textContent!==detail)description.textContent=detail;
 }
 const refreshAt=model.refreshAt||model.adviceUntil||null;if(refreshAt!==host.weatherAdviceAt||refreshAt&&!host.weatherAdviceTimer){globalThis.clearTimeout(host.weatherAdviceTimer);host.weatherAdviceTimer=null;host.weatherAdviceAt=refreshAt;if(refreshAt){let handle;handle=globalThis.setTimeout(()=>{if(host.weatherAdviceTimer!==handle)return;host.weatherAdviceTimer=null;if(host.isConnected)renderLiveWeather(host);},Math.min(2147483647,refreshAt-Date.now()+1));host.weatherAdviceTimer=handle;}}
}

export function renderRobotHistory(host){
 const timeline=$('device-timeline'),historySection=timeline.closest('.device-history');
 let section=$('robot-recent');if(!section){section=make('section','device-history robot-recent pv-component');section.id='robot-recent';$('device-view').append(section);}
 const d=host.state.devices.find(x=>x.id===host.state.focus&&x.kind==='vacuum'),local=!!(!host.live&&host.localRobot&&d&&!d.live),visible=!!(d?.live||local);if(section.hidden!==!visible)section.hidden=!visible;if(!visible){if(historySection.hidden)historySection.hidden=false;if(timeline.hidden)timeline.hidden=false;return;}
 const history=d.history||{status:'unavailable',items:[]},facts=robotFacts(d),controls=local?host.localRobot:host.liveControls,allowed=!!controls?.allowed('vacuum');
 const records=allowed&&history.status==='observed'?history.items.filter(record=>record.outcome==='accepted_by_ha'||local&&record.outcome==='accepted_local'):[],reusableIds=new Set(records.map(record=>record.id));
 const values=d.telemetry?.status==='observed'?d.telemetry.items:[],dates=['last_clean_start','last_clean_end'].map(key=>values.find(row=>row.key===key)).filter(Boolean);
 // Native start/end timestamps and control requests are separate facts in one history.
 const observed=facts.history.map((row,index)=>{const source=dates[index];return {id:`robot-fact:${source.key}`,time:row.value,label:`${row.label}${row.stale?' · sidst kendt':''}`,at:source.value};});
 const requested=history.status==='observed'?history.items.filter(record=>!reusableIds.has(record.id)).map(record=>({id:`robot-request:${record.id}`,time:new Date(record.recordedAt*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),label:`${local&&record.outcome==='accepted_local'?'Gemt valg · robotten er ikke startet':record.outcome==='accepted_by_ha'?'Start anmodet':'Udfald ukendt'} · ${record.recipe.mapName||'Rengøring'} · ${record.recipe.areaIds.length} ${record.recipe.areaIds.length===1?'område':'områder'} · ${record.recipe.repeat} ${record.recipe.repeat===1?'gang':'gange'}`,at:record.recordedAt})):[];
 const events=[...observed,...requested].sort((a,b)=>b.at-a.at).map(({at,...row})=>row);
 const historyHidden=!events.length&&records.length>0;if(historySection.hidden!==historyHidden)historySection.hidden=historyHidden;if(timeline.hidden)timeline.hidden=false;const presentation={items:events,state:events.length?'ready':'empty',stateText:events.length?'':history.status==='observed'?'Ingen hændelser at vise endnu.':'Hændelser er ikke tilgængelige lige nu.'};if(JSON.stringify(timeline.data)!==JSON.stringify(presentation))timeline.data={items:events,state:presentation.state,stateText:presentation.stateText};
 // Keep the actual controls mounted when telemetry or another history row changes.
 // The selected recipe is always resolved by its stable record ID when opened.
 const retained=section.robotHistoryNodes||(section.robotHistoryNodes={notes:new Map(),recipes:new Map()}),nodes=[];
 for(const [key,text] of [['summary',facts.summary.join(' · ')],['attention',facts.attention.join(' · ')]]){
  if(!text)continue;let note=retained.notes.get(key);if(!note){note=make('p','robot-history-note');if(key==='attention')note.setAttribute('role','status');retained.notes.set(key,note);}if(note.textContent!==text)note.textContent=text;nodes.push(note);
 }
 if(!retained.heading)retained.heading=make('h2',undefined,'Seneste valg');if(retained.heading.hidden!==!records.length)retained.heading.hidden=!records.length;nodes.push(retained.heading);
 if(!retained.choices){retained.choices=make('pv-choice-list');retained.choices.dataset.reuse='true';retained.choices.setAttribute('aria-label','Vælg tidligere rengøring');retained.choices.addEventListener('pv-action',event=>{event.stopPropagation();if(event.detail.action_id!=='choose'||!retained.recipes.has(event.detail.option_id))return;(local?host.localRobot:host.liveControls)?.openRobot(retained.choices.nodes?.get(String(event.detail.option_id))||retained.choices,event.detail.option_id);});}
 retained.recipes=new Map(records.map(record=>[record.id,record]));
 const choices={state:'ready',quietStatus:true,selected:null,items:records.map(record=>{const date=new Date(record.recordedAt*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),areas=record.recipe.areaIds.length,repeats=record.recipe.repeat,areaNames=local?record.recipe.areaIds.map(id=>host.localRobot.areaLabels?.get(id)):[],named=areaNames.length&&areaNames.every(Boolean);return {id:record.id,label:named?areaNames.join(', '):record.recipe.mapName||'Rengøring',detail:`${repeats} ${repeats===1?'gang':'gange'} · Vælg rengøring`};})};
 if(JSON.stringify(retained.choices.data)!==JSON.stringify(choices))retained.choices.data=choices;if(retained.choices.hidden!==!records.length)retained.choices.hidden=!records.length;nodes.push(retained.choices);
 for(const node of Array.from(section.children))if(!nodes.includes(node))node.remove();
 nodes.forEach((node,index)=>{if(section.children[index]!==node)section.insertBefore(node,section.children[index]||null);});
}
