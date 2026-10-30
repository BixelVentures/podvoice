import {homeConnectionPresentation} from './podvoice-view.js';
import {conditionLabel,conditionIcon,weatherTemperature,weatherAdviceCapability,weatherPassiveAdvice,weatherAiAdvice} from './weather-observation.js';
import {renderWeather,liveWeatherModel,weatherOverviewDetail,weatherHeaderVisible,renderOverviewForecast} from './weather-view.js';
import {robotFacts,robotExperience} from './robot-observation.js';
const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
// One lazy request per server-admitted source binding. Completion is read only
// through the existing home projection; navigation never replays a paid POST.
export class LiveWeatherAdvice {
 constructor(host,{now=()=>Date.now(),setTimer=globalThis.setTimeout.bind(globalThis),clearTimer=globalThis.clearTimeout.bind(globalThis),visible=()=>globalThis.document?.hidden!==true}={}){this.host=host;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.visible=visible;this.attempts=new Map();this.generation=0;}
 context(){
  const h=this.host,s=h.liveSnapshot,w=h.state.liveWeather;
  if(!h.live||!h.isConnected||h.state.focus!=='weather'||!this.visible()||!h.liveTransport?.connected||h.liveTransport.recoveryBlocked||!s?.capabilities?.homeRead?.includes('weather')||h.state.homeScope!==JSON.stringify([s.bootId,s.roomId]))return null;
  const cap=weatherAdviceCapability(h.state.weatherAdvice,w,s,this.now());
  if(!cap)return null;
  const {aiAdvice,passiveAdvice,displayLocation,advice,...source}=w||{},voice=weatherAiAdvice(aiAdvice,w,this.now()),voiceCurrent=!!voice&&['roomId','sessionId','turnId','taskId','inputRevision','providerGeneration'].every(key=>voice[key]===(key==='roomId'?s.roomId:s.answers?.[key]));
  return {cap,key:JSON.stringify([cap.bootId,cap.roomId,cap.weatherKey]),source:JSON.stringify(source),weather:w,transport:h.liveTransport,voiceCurrent};
 }
 current(context,generation){const latest=this.context();return generation===this.generation&&latest?.cap.availability==='available'&&latest.key===context.key&&latest.source===context.source&&latest.transport===context.transport;}
 sync(){
  const context=this.context();if(!context){this.invalidate();return null;}if(context.cap.availability!=='available'){this.invalidate();return {context:context.cap,status:'unavailable'};}
  if(this.active?.key!==context.key||this.active.source!==context.source||this.active.transport!==context.transport){this.invalidate();this.active=context;}
  for(const [key,entry]of this.attempts)if(entry.until<=this.now())this.attempts.delete(key);
  const cap=context.cap,projected=weatherPassiveAdvice(context.weather.passiveAdvice,context.weather,this.now(),cap);
  let entry=this.attempts.get(context.key);
  if(!entry&&!context.voiceCurrent&&cap.status==='idle'&&this.attempts.size<32){entry={until:cap.validUntil*1000,source:context.source,deadline:this.now()+10000,polls:0,status:'sending',advice:null};this.attempts.set(context.key,entry);this.start(context,entry);}
  if(entry&&entry.source!==context.source)return {context:cap,status:'unavailable'};
  if(projected&&entry?.advice?.requestId&&projected.requestId!==entry.advice.requestId)return {context:cap,status:'unavailable'};
  const advice=['error','unavailable'].includes(cap.status)?null:projected||entry?.advice,status=['error','unavailable'].includes(cap.status)?cap.status:cap.status==='ready'&&advice?.status!=='ready'?'unavailable':advice?.status||(cap.status==='pending'?cap.status:entry?.status==='sending'?'requesting':entry?.status||null);
  if(status!=='pending'){this.clearTimer(this.timer);this.timer=null;}
  if(entry?.refreshNeeded){entry.refreshNeeded=false;this.poll(context,entry);}
  if(status==='pending'){
   if(!entry){entry={until:cap.validUntil*1000,source:context.source,deadline:this.now()+10000,polls:0,status:'pending',advice:null};this.attempts.set(context.key,entry);}
   if(this.now()>=entry.deadline||entry.polls>=8)return {context:cap,status:'unavailable'};
   this.poll(context,entry);
  }
  return {context:cap,advice,status};
 }
 async start(context,entry){
  const generation=this.generation,controller=new AbortController();this.controller=controller;
  try{const value=await context.transport.weatherAdvice(context.cap,{signal:controller.signal});if(!this.current(context,generation))return;const advice=weatherPassiveAdvice(value,context.weather,this.now(),context.cap,{allowUnadmitted:true});entry.advice=advice;entry.status=advice?.status||'unavailable';}
  catch(error){if(!this.current(context,generation))return;entry.status='unavailable';if(['stale_weather_binding','read_access_denied'].includes(error?.code))this.host.loadLiveHome();}
  finally{if(this.controller===controller)this.controller=null;if(this.current(context,generation))this.host.render();}
 }
 poll(context,entry){
  if(this.timer)return;const generation=this.generation;
  this.timer=this.setTimer(async()=>{this.timer=null;if(!this.current(context,generation))return;entry.polls++;await this.host.loadLiveHome();if(this.current(context,generation))this.host.render();},1000);
 }
 invalidate(){if(!this.active&&!this.controller&&!this.timer)return;const entry=this.active&&this.attempts.get(this.active.key);if(entry&&entry.status==='sending'){entry.status='unavailable';entry.refreshNeeded=true;}this.generation++;this.controller?.abort();this.controller=null;this.clearTimer(this.timer);this.timer=null;this.active=null;}
 cleanup(){this.invalidate();}
}
export function renderLiveWeather(host){
 const passive=host.live?(host.liveWeatherAdvice||(host.liveWeatherAdvice=new LiveWeatherAdvice(host))).sync():null;
 const w=host.state.liveWeather,view=$('weather-view'),connected=host.live?host.liveTransport?.connected===true:host.state.connected!==false,reason=homeConnectionPresentation({status:host.liveStatus,blocked:host.liveTransport?.recoveryBlocked===true,browserOffline:host.browserOffline===true}).reason,model=liveWeatherModel(w,{connected,reason,readStatus:host.state.homeReadStatus?.scope===JSON.stringify([host.liveSnapshot?.bootId,host.liveSnapshot?.roomId])&&host.liveSnapshot?.capabilities?.homeRead?.includes('weather')?host.state.homeReadStatus.weather:null,passiveContext:passive?.context,passiveAdvice:passive?.advice,passiveStatus:passive?.status,aiContext:host.liveSnapshot?{...host.liveSnapshot.answers,roomId:host.liveSnapshot.roomId}:null});
 if(host.state.focus==='weather'||host.weatherNodes)host.weatherNodes=renderWeather(view,model);if(view.hidden!==(host.state.focus!=='weather'))view.hidden=host.state.focus!=='weather';
 const temp=w?.current?.temperature,condition=conditionLabel(w?.current?.condition),hasWeather=!!model.current||model.hours.length>0||model.days.length>0;
 for(const id of ['header-weather','photo-weather','home-weather']){
  const button=$(id),visible=id==='header-weather'?weatherHeaderVisible(host.state.focus,hasWeather):hasWeather?(id==='home-weather'?host.state.focus==='now':host.state.focus==='photo'?id==='photo-weather':id!=='photo-weather'):id==='home-weather'&&host.state.focus==='now'&&(!!model.connectionReason||host.liveSnapshot?.capabilities?.homeRead?.includes('weather')===true);
  if(button.hidden!==!visible)button.hidden=!visible;const disabled=id==='header-weather'?!hasWeather:!w&&!visible;if(button.disabled!==disabled)button.disabled=disabled;
  if(id==='header-weather'){const pending=String(!host.browserOffline&&host.liveStatus==='connecting'&&!hasWeather);if(button.getAttribute('aria-busy')!==pending)button.setAttribute('aria-busy',pending);}
  const icon=button.querySelector(':scope > img'),file=w?conditionIcon(w.current?.condition,w.current?.isDaytime):model.emptyIcon;if(icon){if(icon.hidden!==!file)icon.hidden=!file;const src=file?`assets/icons/${file}.svg`:null;if(src&&icon.getAttribute('src')!==src)icon.src=src;}
  const temperature=Number.isFinite(temp)?weatherTemperature(temp,w.unit):id==='home-weather'?'':hasWeather?'Vejr':'';
  if(id==='home-weather'){
   const value=button.querySelector('.home-temperature'),description=button.querySelector('.home-condition'),forecast=button.querySelector('.home-forecast'),range=model.current?.range||'';
   if(value&&value.textContent!==temperature)value.textContent=temperature;const overviewCondition=weatherOverviewDetail(model,{role:'condition'});if(description&&description.textContent!==overviewCondition)description.textContent=overviewCondition;
   renderOverviewForecast(button,model);
  }else{const strong=button.querySelector('strong'),label=id==='header-weather'?(Number.isFinite(temp)?temperature.replace(/°[CF]$/,'°'):'—'):temperature;if(strong&&strong.textContent!==label)strong.textContent=label;}
  const description=button.querySelector(id==='photo-weather'?':scope > span':'small'),detail=!hasWeather?(id==='header-weather'?'Vejr ukendt':model.emptyDetail||model.overviewStatus||'Ingen vejrdata'):id==='home-weather'?weatherOverviewDetail(model):model.sourceStale?'Sidst kendt':condition||'Se vejrudsigten';if(description&&description.textContent!==detail)description.textContent=detail;
 }
 const refreshAt=model.refreshAt||model.adviceUntil||null;if(refreshAt!==host.weatherAdviceAt||refreshAt&&!host.weatherAdviceTimer){globalThis.clearTimeout(host.weatherAdviceTimer);host.weatherAdviceTimer=null;host.weatherAdviceAt=refreshAt;if(refreshAt){let handle;handle=globalThis.setTimeout(()=>{if(host.weatherAdviceTimer!==handle)return;host.weatherAdviceTimer=null;if(host.isConnected)renderLiveWeather(host);},Math.min(2147483647,refreshAt-Date.now()+1));host.weatherAdviceTimer=handle;}}
}

export function renderRobotHistory(host){
 const timeline=$('device-timeline'),historySection=timeline.closest('.device-history');
 const recent=$('robot-recent');if(recent){recent.hidden=true;if(recent.children.length)recent.replaceChildren();delete recent.robotHistoryNodes;}
 const canChoose=(device,record)=>{const local=!host.live&&!!host.localRobot&&device&&!device.live&&!device.presentationOnly,scope=host.liveSnapshot,read=!!(scope?.capabilities?.homeRead?.includes('vacuum')&&scope.bootId&&scope.roomId&&host.state.homeScope===JSON.stringify([scope.bootId,scope.roomId])&&!host.liveTransport?.recoveryBlocked&&device?.source==='home_assistant_state'),now=Date.now()/1000,experience=robotExperience(device),fresh=local||Number.isFinite(device?.observedAt)&&device.observedAt<=now&&now-device.observedAt<=300;return !!device&&host.state.focus===device.id&&(host.live?host.liveTransport?.connected===true:host.state.connected!==false)&&!device.stale&&!device.pending&&['docked','stopped','complete','idle'].includes(device.status)&&experience.jobActive!==true&&!experience.issues.length&&(experience.activity===null||['Oplader','Opladet'].includes(experience.activity))&&!device.localDockOperation&&fresh&&/^[a-f0-9]{32}$/.test(record?.id||'')&&Number.isFinite(record?.recordedAt)&&record.recordedAt>=0&&record.recordedAt<=now&&device.history?.status==='observed'&&device.history.items?.some(row=>row.id===record.id&&row.outcome===(local?'accepted_local':'accepted_by_ha'))&&record.recipe?.completeSetup===true&&(local?host.localRobot.allowed('vacuum'):device.live&&read&&host.isConnected===true&&host.liveControls?.allowed('vacuum'));};
 if(!timeline.robotHistoryListener){timeline.robotHistoryListener=true;timeline.addEventListener('pv-action',event=>{if(event.detail?.action_id!=='choose-history'||typeof event.detail.option_id!=='string'||!event.detail.option_id.startsWith('robot-request:'))return;const id=event.detail.option_id.slice('robot-request:'.length),device=host.state.devices.find(row=>row.id===host.state.focus&&row.kind==='vacuum'),record=device?.history?.items?.find(row=>row.id===id);if(!canChoose(device,record))return;(host.live?host.liveControls:host.localRobot)?.openRobot(event.target,id);});}
 const d=host.state.devices.find(x=>x.id===host.state.focus&&x.kind==='vacuum'),local=!!(!host.live&&host.localRobot&&d&&!d.live&&!d.presentationOnly),readAllowed=!!(host.liveSnapshot?.capabilities?.homeRead?.includes('vacuum')&&host.liveSnapshot.bootId&&host.liveSnapshot.roomId&&host.state.homeScope===JSON.stringify([host.liveSnapshot.bootId,host.liveSnapshot.roomId])&&!host.liveTransport?.recoveryBlocked&&d?.source==='home_assistant_state'),visible=!!(!d?.presentationOnly&&(local||d?.live&&readAllowed));if(!visible){if(d?.live||d?.presentationOnly){historySection.hidden=true;timeline.data={items:[],historyScope:null,state:'empty',stateText:'Hændelser er ikke tilgængelige lige nu.'};}else if(historySection.hidden)historySection.hidden=false;if(timeline.hidden)timeline.hidden=false;return;}
 const history=d.history||{status:'unavailable',items:[]},facts=robotFacts(d);
 const values=d.telemetry?.status==='observed'?d.telemetry.items:[],dates=['last_clean_start','last_clean_end'].map(key=>values.find(row=>row.key===key)).filter(Boolean);
 // Native start/end timestamps and control requests are separate facts in one history.
 const observed=facts.history.map((row,index)=>{const source=dates[index];return {id:`robot-fact:${source.key}`,time:row.value,label:`${row.label}${row.stale?' · sidst kendt':''}`,at:source.value};});
 const requested=history.status==='observed'?history.items.filter(record=>record.outcome==='accepted_by_ha'||record.outcome==='unknown'||local&&record.outcome==='accepted_local').map(record=>({id:`robot-request:${record.id}`,time:new Date(record.recordedAt*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),label:`${local&&record.outcome==='accepted_local'?'Lokal start · eksempel':record.outcome==='accepted_by_ha'?'Start anmodet':'Udfald ukendt'} · ${record.recipe.mapName||'Rengøring'} · ${record.recipe.areaIds.length} ${record.recipe.areaIds.length===1?'område':'områder'} · ${record.recipe.repeat} ${record.recipe.repeat===1?'gang':'gange'}`,at:record.recordedAt,...(record.outcome!=='unknown'&&record.recipe?.completeSetup===true&&/^[a-f0-9]{32}$/.test(record.id)&&canChoose(d,record)?{actionLabel:'Vælg igen',actionEnabled:true}:{})})):[];
 const events=[...observed,...requested].sort((a,b)=>b.at-a.at).map(({at,...row})=>row);
 const historyHidden=false,offline=(host.live?host.liveTransport?.connected!==true:host.state.connected===false)||d.stale===true;const historyTitle=$('device-history-title'),title=offline?'Sidst kendte hændelser':'Seneste hændelser';if(historyTitle&&historyTitle.textContent!==title)historyTitle.textContent=title;if(historySection.hidden!==historyHidden)historySection.hidden=historyHidden;if(timeline.hidden)timeline.hidden=false;const presentation={items:events,historyScope:JSON.stringify([local?'local':host.liveSnapshot.bootId,local?'local':host.liveSnapshot.roomId,d.id,d.source||'local']),state:events.length?(offline?'offline':'ready'):'empty',stateText:events.length?'':history.status==='observed'?'Ingen hændelser at vise endnu.':'Hændelser er ikke tilgængelige lige nu.'};if(JSON.stringify(timeline.data)!==JSON.stringify(presentation))timeline.data=presentation;
}
