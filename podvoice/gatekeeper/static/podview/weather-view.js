import {applyKitComponent,applyKitTemplate} from './ui/kit.js';
import {conditionLabel,conditionIcon,weatherTemperature,forecastDayRows,localDayKey,hourlyWeather,weatherAiAdvice,weatherPassiveAdvice,weatherAppearance,windStrength,windFrom,weatherDisplayLocation} from './weather-observation.js';
export function weatherSourceLabel(source){
 if(source==='Forhåndsvisning')return 'Eksempeldata';
 const provider=typeof source==='string'?source.replace(/^Home Assistant(?:\s*\/\s*|\s*$)/i,'').trim():'';
 const names=[...new Set(provider.split(',').map(name=>name.trim()).filter(Boolean))];
 return names.length?`${names.length>1?'Kilder':'Kilde'}: ${names.join(', ')}`:'';
}
// Forecast quantities keep their source units in the observation. Only these
// known conversions may produce the compact Danish presentation.
export function weatherMetrics(period,units){
 const quantity=(value,unit,factors,suffix,digits=1)=>{const factor=typeof unit==='string'&&Object.hasOwn(factors,unit)?factors[unit]:null,converted=Number.isFinite(value)&&value>=0&&factor!==null?value*factor:null;if(!Number.isFinite(converted))return '';return `${converted>0&&converted<.1?'<0,1':new Intl.NumberFormat('da-DK',{maximumFractionDigits:digits}).format(converted)} ${suffix}`;};
 return {rain:quantity(period?.precipitation,units?.precipitation,{mm:1,cm:10,in:25.4},'mm'),wind:quantity(period?.wind_speed,units?.windSpeed,{'m/s':3.6,'km/h':1,mph:1.609344,kn:1.852},'km/t',0)};
}
// LOCAL visual fixture, fixed at the supplied screenshot's 15 October 13:46
// preview clock. These exact twelve hourly rows/units came from
// integration/observed-weather-20261015/ha-hourly-visible-response.json.
// Current weather/daylight, three daily ranges and Mårslet are curated household examples;
// they are NOT HA observations or city proof. No retrieval/freshness timestamps
// are fabricated, and this local model never enters the live validator.
export const WEATHER={place:'Mårslet',previewAt:'2026-10-15T13:46:00+02:00',source:'Met.no',units:{temperature:'°C',precipitation:'mm',windSpeed:'km/h'},temperature:15,condition:'Let skyet',conditionCode:'partlycloudy',isDaytime:true,high:17,low:9,hours:[
 {"condition":"cloudy","datetime":"2026-10-15T12:00:00+00:00","temperature":14.9,"wind_speed":22.3,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T13:00:00+00:00","temperature":15.1,"wind_speed":21.6,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T14:00:00+00:00","temperature":15.1,"wind_speed":22.7,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T15:00:00+00:00","temperature":14.9,"wind_speed":18.7,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T16:00:00+00:00","temperature":14.8,"wind_speed":19.8,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T17:00:00+00:00","temperature":14.7,"wind_speed":24.1,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T18:00:00+00:00","temperature":14.5,"wind_speed":20.9,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T19:00:00+00:00","temperature":14.3,"wind_speed":19.8,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T20:00:00+00:00","temperature":13.9,"wind_speed":16.6,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T21:00:00+00:00","temperature":13.7,"wind_speed":17.3,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T22:00:00+00:00","temperature":13.8,"wind_speed":17.6,"precipitation":0},
 {"condition":"cloudy","datetime":"2026-10-15T23:00:00+00:00","temperature":14,"wind_speed":19.1,"precipitation":0}
],days:[{day:'I dag',low:9,high:17},{day:'I morgen',low:10,high:16},{day:'I overmorgen',low:8,high:14}]};
// Explicit local review scenario: not an observation and never passed to liveWeatherModel.
export const WEATHER_CHANGE_EXAMPLE={...WEATHER,source:'Forhåndsvisning',hours:WEATHER.hours.map((hour,index)=>({...hour,condition:['partlycloudy','partlycloudy','rainy','rainy','cloudy','partlycloudy','partlycloudy','cloudy','cloudy','cloudy','cloudy','cloudy'][index],temperature:[16,17,15,14,14,13,12,12,11,11,10,10][index],precipitation:[0,0,1.2,.8,0,0,0,0,0,0,0,0][index]})),days:[{day:'I dag',low:9,high:17,condition:'rainy'},{day:'I morgen',low:10,high:16,condition:'partlycloudy'},{day:'I overmorgen',low:8,high:14,condition:'cloudy'}]};
export function clothingTip({temperature,units={temperature:'°C'}}){
 if(!Number.isFinite(temperature)||!['°C','C','°F','F'].includes(units?.temperature))return '';
 const celsius=['°F','F'].includes(units.temperature)?(temperature-32)*5/9:temperature;
 if(celsius<1)return 'Tag en varm jakke, hue og handsker på.';if(celsius<7)return 'Tag en varm jakke på.';if(celsius<14)return 'Tag en jakke med.';if(celsius<20)return 'Tag en trøje med.';return 'Let tøj kan være passende.';
}
export function forecastQuantities(period,units={}){
 const temp=period?.temperature,tempKnown=Number.isFinite(temp)&&['°C','C','°F','F'].includes(units.temperature),rain=period?.precipitation,factor={mm:1,cm:10,in:25.4}[units.precipitation];
 return {temperatureNumber:tempKnown?(['°F','F'].includes(units.temperature)?(temp-32)*5/9:temp):null,rainNumber:Number.isFinite(rain)&&rain>=0&&factor?rain*factor:null};
}
export function localWeatherModel(w=WEATHER){
 const preview=['idle','pending','ready','error'].includes(w.advicePreview)?w.advicePreview:null,nextRain=w.hours.find(hour=>Number.isFinite(hour.precipitation)&&hour.precipitation>0),unit=w.units?.temperature||'°C',time=period=>new Date(period.datetime).toLocaleTimeString('da-DK',{timeZone:'Europe/Copenhagen',hour:'2-digit',minute:'2-digit'});
 return {title:w.place,subtitle:'',appearance:weatherAppearance({condition:w.conditionCode,isDaytime:w.isDaytime}),current:{temperature:weatherTemperature(w.temperature,unit),condition:w.condition,icon:conditionIcon(w.conditionCode,w.isDaytime),range:`Højst ${weatherTemperature(w.high,unit)} · Lavest ${weatherTemperature(w.low,unit)}`},metadata:[...(Number.isFinite(w.hours[0]?.precipitation_probability)?[{id:'rain',label:'Regn næste time',value:`${w.hours[0].precipitation_probability} %`}]:[])],summary:nextRain?`Regn fra kl. ${time(nextRain)}. ${clothingTip(w)}`:clothingTip(w),hoursLabel:'Timeprognose. Scroll vandret for flere timer',hours:w.hours.map((h,i)=>{const metrics=weatherMetrics(h,w.units);return {id:`fixture-hour-${i}`,time:time(h),temperature:weatherTemperature(h.temperature,unit),...forecastQuantities(h,w.units),condition:conditionLabel(h.condition),icon:conditionIcon(h.condition),...metrics,wind:windStrength(h.wind_speed,w.units?.windSpeed),windSpeed:metrics.wind,windBearing:windFrom(h.wind_bearing)?.degrees??null};}),days:w.days.map((d,i)=>({id:`fixture-day-${i}`,day:d.day,low:weatherTemperature(d.low,unit),high:weatherTemperature(d.high,unit),condition:conditionLabel(d.condition||'cloudy'),icon:conditionIcon(d.condition||'cloudy'),start:(d.low-8)*7,length:(d.high-d.low)*7})),source:'Eksempeldata',...(preview?{summaryState:preview,summary:preview==='ready'?'Tag en trøje med – skyerne bliver hængende.':preview==='error'?'Vejrrådet er ikke tilgængeligt lige nu.':'',summaryLabel:preview==='ready'?'Forfattet eksempel – ikke genereret af AI':preview==='pending'?'Visuelt eksempel på et afventende vejrråd':preview==='error'?'Visuelt eksempel på et utilgængeligt vejrråd':''}:{})};
}
// One source-provided clothing sentence occupies the advice slot. Prefer the
// existing clothing-specific text; do not concatenate overlapping rule outputs
// or present these bounded source rules as generated AI advice.
export function liveWeatherModel(w,{connected=true,reason=null,now=Date.now(),aiContext=null,passiveContext=null,passiveAdvice=null,passiveStatus=null}={}){
 // Only the connection owner can name a cause. Missing observations or a lost
 // transport alone cannot establish missing setup, permission or provider error.
 const reasons={setup:'Tilføj i Home Assistant',unavailable:'Home Assistant svarer ikke lige nu',denied:'PodView har ikke adgang – log ind i Home Assistant'},connectionReason=typeof reason==='string'&&Object.hasOwn(reasons,reason)?reason:null,status=connectionReason?'Ikke forbundet':'Ingen vejrdata';
 const empty={title:'Vejr',subtitle:status,appearance:weatherAppearance(null),current:null,emptyTitle:status,emptyDetail:connectionReason?reasons[connectionReason]:'Der er endnu ingen vejroplysninger at vise.',emptyIcon:connectionReason?'cloud-sun':null,overviewStatus:status,connectionReason,summary:'',hours:[],days:[],source:''};if(!w)return empty;
 const displayLocation=weatherDisplayLocation(w.displayLocation,now),automaticLocation=displayLocation?.source==='ha_home_geonames';
 const format=value=>weatherTemperature(value,w.unit),days=forecastDayRows(w),ranges=days.filter(d=>Number.isFinite(d.low)&&Number.isFinite(d.high)),today=ranges.find(d=>d.key===localDayKey(new Date(now))),allLow=Math.min(...ranges.map(d=>d.low)),allHigh=Math.max(...ranges.map(d=>d.high)),span=Math.max(1,allHigh-allLow);
 const retrieved=Date.parse(w.retrievedAt),appearanceFresh=!w.stale&&connected&&Number.isFinite(now)&&retrieved<=now&&now<retrieved+900000,appearance=weatherAppearance(w.current,{fresh:appearanceFresh});
 const hourly=hourlyWeather(w,now),suggestion=hourly?.advice,period=Date.parse(suggestion?.periodTime),advice=!!suggestion&&appearanceFresh&&!hourly.stale&&suggestion.source===hourly.source&&suggestion.retrievedAt===hourly.retrievedAt&&suggestion.validUntil*1000>now&&period>now&&hourly.forecast.filter(p=>p.datetime===suggestion.periodTime).length===1;
 const ai=weatherAiAdvice(w.aiAdvice,w,now),aiCurrent=!!ai&&appearanceFresh&&!hourly?.stale&&!!aiContext&&['roomId','sessionId','turnId','taskId','inputRevision','providerGeneration'].every(key=>ai[key]===aiContext[key]);
 const passive=passiveContext&&!['error','unavailable'].includes(passiveStatus)&&passiveContext.availability!=='unavailable'&&appearanceFresh&&!hourly?.stale?weatherPassiveAdvice(passiveAdvice||w.passiveAdvice,w,now,passiveContext):null,passiveReady=passive?.status==='ready',pending=!['error','unavailable'].includes(passiveStatus)&&!aiCurrent&&!passiveReady&&appearanceFresh&&!!passiveContext&&(passive?.status==='pending'||passiveStatus==='pending'),summaryState=aiCurrent||passiveReady?'ready':pending?'pending':passiveContext&&['error','unavailable'].includes(passiveStatus||passive?.status)?passiveStatus||passive?.status:passiveContext?.availability==='available'&&passiveContext.status==='idle'&&[null,'idle'].includes(passiveStatus)?'idle':null;
 const adviceTime=advice?new Date(period).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
 const counts=new Map();for(const p of hourly?.forecast||[])counts.set(p.datetime,(counts.get(p.datetime)||0)+1);
 const periods=hourly?hourly.forecast.filter(p=>counts.get(p.datetime)===1&&Date.parse(p.datetime)>now).sort((a,b)=>Date.parse(a.datetime)-Date.parse(b.datetime)).slice(0,12):[],next=periods[0];
 const refreshTimes=[...(automaticLocation?[displayLocation.validUntil*1000]:[]),...(aiCurrent?[ai.validUntil*1000]:[]),...(passive?[passive.validUntil*1000]:[]),...(advice?[suggestion.validUntil*1000]:[]),...(hourly?[Date.parse(hourly.retrievedAt)+900000]:[]),...(next?[Date.parse(next.datetime)]:[]),...(appearanceFresh?[retrieved+900000]:[])];
 const model={title:displayLocation?.name||w.location||'Vejr',emptyTitle:'Aktuelt vejr ikke tilgængeligt',emptyDetail:periods.length||days.length?'Se den tilgængelige prognose nedenfor.':'Der er endnu ingen vejroplysninger at vise.',sourceStale:!appearanceFresh,subtitle:!appearanceFresh?'Sidst kendte vejr':hourly?.stale?'Vejret i dag · Timeprognose sidst kendt':'Vejret i dag',appearance,current:w.current?{temperature:format(w.current.temperature),condition:conditionLabel(w.current.condition)||'Aktuel beskrivelse ikke oplyst',icon:conditionIcon(w.current.condition,w.current.isDaytime),range:today?`Højst ${format(today.high)} · Lavest ${format(today.low)}`:''}:null,
  metadata:[...(Number.isFinite(next?.rain)?[{id:'rain',label:'Regn næste time',value:`${next.rain} %`}]:[])],
  summary:aiCurrent?ai.summary:passiveReady?passive.summary:pending?'':passiveContext?(['error','unavailable'].includes(summaryState)?'Vejrrådet er ikke tilgængeligt lige nu.':''):advice?(suggestion.children||suggestion.summary):'',summaryState,summaryLabel:aiCurrent||passiveReady?'AI-råd baseret på vejrudsigten':pending?'Et vejrråd er på vej':!passiveContext&&advice?`Praktisk råd for ${adviceTime}`:'',adviceUntil:aiCurrent?ai.validUntil*1000:passive?passive.validUntil*1000:advice?suggestion.validUntil*1000:null,refreshAt:refreshTimes.length?Math.min(...refreshTimes):null,
  hoursLabel:!appearanceFresh||hourly?.stale?'Sidst kendte timeprognose. Scroll vandret for flere timer':'Vejret de næste timer. Scroll vandret for flere timer',hours:periods.map(p=>{const metrics=weatherMetrics(p,hourly.units);return {id:p.datetime,time:new Date(p.datetime).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),temperature:format(p.temperature),...forecastQuantities(p,{...hourly.units,temperature:w.unit}),condition:conditionLabel(p.condition),icon:conditionIcon(p.condition),...metrics,wind:windStrength(p.wind_speed,hourly.units?.windSpeed),windSpeed:metrics.wind,windBearing:windFrom(p.wind_bearing)?.degrees??null};}),
  days:days.map(d=>{const range=Number.isFinite(d.low)&&Number.isFinite(d.high);return {id:d.key,day:d.start.toLocaleDateString('da-DK',{weekday:'short',day:'numeric',month:'short'}),condition:conditionLabel(d.condition),icon:conditionIcon(d.condition),low:format(range?d.low:d.temperature),high:range?format(d.high):'',start:range?(d.low-allLow)/span*100:null,length:range?(d.high-d.low)/span*100:null};}),
  source:[weatherSourceLabel(w.source),automaticLocation?'Stednavn: GeoNames · CC BY 4.0':''].filter(Boolean).join('\n')};
 return !model.current&&!model.hours.length&&!model.days.length?{...model,...empty,title:model.title,source:model.source}:model;
}
const retained=new WeakMap(),text=(node,value)=>{const next=typeof value==='string'?value:'';if(node.textContent!==next)node.textContent=next;};
// The local header, overview, photo and detail share one fixture projection.
// Live surfaces continue to be populated solely by their observed-data adapter.
export function weatherOverviewDetail(model,{role='detail'}={}){
 if(role==='condition'){
  const condition=model.current?.condition||model.overviewStatus||'',hasFacts=!!model.current||!!model.hours?.length||!!model.days?.length;
  return model.sourceStale&&hasFacts?['Sidst kendt',condition].filter(Boolean).join(' · '):condition;
 }
 if(!model.current&&!model.hours?.length&&!model.days?.length)return model.emptyDetail||'';
 const range=model.current?.range||'';
 return range||(!model.sourceStale?'Se vejrudsigten':'');
}
export function renderOverviewForecast(button,model){
 const stale=model.sourceStale===true&&(!!model.current||!!model.hours?.length||!!model.days?.length),staleAttribute=String(stale);if(button.getAttribute('data-weather-stale')!==staleAttribute)button.setAttribute('data-weather-stale',staleAttribute);
 const appearance=model.appearance||weatherAppearance(null);for(const [key,value]of [['tone',appearance.tone],['phase',appearance.phase],['photo',String(appearance.photo===true)]])if(button.getAttribute(`data-weather-${key}`)!==value)button.setAttribute(`data-weather-${key}`,value);
 const forecast=button.querySelector('.home-forecast');if(!forecast)return;
 if(!forecast.hourRows){forecast.replaceChildren();forecast.hourRows=new Map();}
 const hours=(model.hours||[]).slice(0,5),doc=button.ownerDocument;
 rows(forecast,forecast.hourRows,hours,()=>{const row=doc.createElement('span');row.className='home-forecast-hour';row.append(doc.createElement('span'),doc.createElement('img'),doc.createElement('strong'));return row;},(row,hour)=>{text(row.children[0],hour.time);artwork(row.children[1],hour.icon,'');text(row.children[2],hour.temperature);const label=[hour.time,hour.condition,hour.temperature].filter(Boolean).join(', ');if(row.getAttribute('aria-label')!==label)row.setAttribute('aria-label',label);});
 if(forecast.hidden!==!hours.length)forecast.hidden=!hours.length;
}
export function renderLocalWeather(doc,model=localWeatherModel(),{detail=true}={}){
 for(const id of ['header-weather','photo-weather','home-weather']){
  const button=doc.getElementById(id);if(!button)continue;
  const assign=(selector,value)=>{const node=button.querySelector(selector);if(node)text(node,value);};
  if(id==='home-weather'){
   assign('.home-temperature',model.current?.temperature||'');assign('.home-condition',weatherOverviewDetail(model,{role:'condition'}));
   assign('small',weatherOverviewDetail(model));
   renderOverviewForecast(button,model);
  }
  else if(id==='header-weather'){const available=!!model.current||!!model.hours?.length||!!model.days?.length;if(button.disabled!==!available)button.disabled=!available;assign('strong',model.current?.temperature?.replace(/°[CF]$/,'°')||'—');assign('small',available?model.current?.condition||'Se vejrudsigten':'Vejr ukendt');}
  else{assign('strong',model.current?.temperature);assign(':scope > span',model.current?.condition);}
  const icon=button.querySelector(':scope > img');if(icon)artwork(icon,model.current?.icon||model.emptyIcon);
 }
 return detail?renderWeather(doc.getElementById('weather-view'),model):null;
}
function build(node){
 const doc=node.ownerDocument||document,make=(tag,cls)=>{const n=doc.createElement(tag);if(cls)n.className=cls;return n;};
 const heading=make('header','response-heading'),intro=make('div'),title=make('h1'),subtitle=make('p'),card=make('div','weather-current'),copy=make('div'),value=make('strong'),description=make('p'),range=make('span'),metadata=make('dl','weather-metadata'),icon=make('img'),summary=make('p','weather-summary'),summaryText=doc.createTextNode(''),hours=make('section','weather-hours'),days=make('section','weather-days'),daysTitle=make('h2'),source=make('footer','weather-source'),sourceCopy=make('p');
 title.id='weather-title';icon.alt='';intro.append(title,subtitle);heading.append(intro);copy.append(value,description,range,metadata,summary);card.append(copy,icon);summary.append(summaryText);summary.setAttribute('data-kit-slot','body');hours.tabIndex=0;hours.setAttribute('role','region');days.setAttribute('aria-label','Vejrudsigt for de næste dage');text(daysTitle,'De næste dage');days.append(daysTitle);sourceCopy.id='weather-source-info';source.append(sourceCopy);applyKitTemplate(node,'detail');applyKitComponent(card,'hero',{identity:'weather'});card.setAttribute('data-detail-zone','hero');copy.setAttribute('data-kit-slot','copy');icon.setAttribute('data-kit-slot','icon');description.setAttribute('data-kit-slot','title');range.setAttribute('data-kit-slot','body');hours.setAttribute('data-detail-zone','controls');days.setAttribute('data-detail-zone','history');node.replaceChildren(heading,card,hours,days,source);
 const n={make,title,subtitle,card,value,description,range,metadata,metadataRows:new Map(),icon,summary,summaryText,hours,days,daysTitle,source,sourceCopy,hourRows:new Map(),dayRows:new Map()};retained.set(node,n);return n;
}
function artwork(node,file,label=''){if(node.hidden!==!file)node.hidden=!file;if(file){const src=`assets/icons/${file}.svg`;if(node.getAttribute('src')!==src)node.src=src;}if(node.getAttribute('alt')!==label)node.setAttribute('alt',label);}
function rows(parent,cache,items,make,update,offset=0){const wanted=new Set(items.map(item=>item.id));for(const[id,row]of cache)if(!wanted.has(id)){row.remove();cache.delete(id);}items.forEach((item,index)=>{let row=cache.get(item.id);if(!row){row=make();cache.set(item.id,row);}update(row,item,index);if(parent.children[index+offset]!==row)parent.insertBefore(row,parent.children[index+offset]||null);});}
// One retained DOM anatomy for local examples and validated source projections.
export function renderWeather(node,model=localWeatherModel()){
 const n=retained.get(node)||build(node),make=n.make;text(n.title,model.title);text(n.subtitle,model.subtitle);if(n.card.hidden)n.card.hidden=false;
 // The same closed appearance reaches both scales, including live rendering.
 // CSS owns the decorative right-third image; no new DOM or image truth claim.
 const hasFacts=!!model.current||!!model.hours?.length||!!model.days?.length,metadata=[...(model.sourceStale&&hasFacts?[{id:'freshness',label:'Status',value:'Sidst kendte vejr'}]:[]),...(model.metadata||[])];if(n.metadata.hidden!==!metadata.length)n.metadata.hidden=!metadata.length;rows(n.metadata,n.metadataRows,metadata,()=>{const row=make('div');row.append(make('dt'),make('dd'));return row;},(row,item)=>{text(row.children[0],item.label);text(row.children[1],item.value);});
 const appearance=model.appearance||weatherAppearance(null);for(const surface of [n.card,node.ownerDocument?.getElementById('home-weather')].filter(Boolean)){if(surface.getAttribute('data-weather-tone')!==appearance.tone)surface.setAttribute('data-weather-tone',appearance.tone);if(surface.getAttribute('data-weather-phase')!==appearance.phase)surface.setAttribute('data-weather-phase',appearance.phase);if(surface.getAttribute('data-weather-photo')!==String(appearance.photo===true))surface.setAttribute('data-weather-photo',String(appearance.photo===true));}
 const message=!!model.connectionReason&&!hasFacts;if(message){if(n.card.getAttribute('data-kit-variant')!=='message')n.card.setAttribute('data-kit-variant','message');}else if(n.card.getAttribute('data-kit-variant')!==null)n.card.removeAttribute('data-kit-variant');if(n.value.hidden!==message)n.value.hidden=message;
 const currentState=model.current?(model.sourceStale?'stale':'current'):'empty';const kitState=model.current?'ready':'empty';if(n.card.getAttribute('data-kit-state')!==kitState)n.card.setAttribute('data-kit-state',kitState);if(n.card.getAttribute('data-weather-state')!==currentState)n.card.setAttribute('data-weather-state',currentState);
 if(model.current){text(n.value,model.current.temperature);text(n.description,model.current.condition);text(n.range,model.current.range);if(n.range.hidden!==(!model.current.range))n.range.hidden=!model.current.range;artwork(n.icon,model.current.icon);}else{text(n.value,'');text(n.description,model.emptyTitle||'Aktuelt vejr ikke tilgængeligt');text(n.range,model.emptyDetail||'');if(n.range.hidden!==!model.emptyDetail)n.range.hidden=!model.emptyDetail;artwork(n.icon,model.emptyIcon);}
 const summaryVisible=!!model.summary||['idle','pending'].includes(model.summaryState);if(n.summary.hidden!==!summaryVisible)n.summary.hidden=!summaryVisible;const adviceState=model.summaryState||'none';if(n.summary.getAttribute('data-advice-state')!==adviceState)n.summary.setAttribute('data-advice-state',adviceState);const busy=String(model.summaryState==='pending');if(n.summary.getAttribute('aria-busy')!==busy)n.summary.setAttribute('aria-busy',busy);text(n.summaryText,model.summary);if(model.summaryLabel){if(n.summary.getAttribute('aria-description')!==model.summaryLabel)n.summary.setAttribute('aria-description',model.summaryLabel);if(n.summary.getAttribute('aria-describedby')!=='weather-source-info')n.summary.setAttribute('aria-describedby','weather-source-info');}else{if(n.summary.getAttribute('aria-description')!==null)n.summary.removeAttribute('aria-description');if(n.summary.getAttribute('aria-describedby')!==null)n.summary.removeAttribute('aria-describedby');}
 if(n.hours.hidden!==(!model.hours.length))n.hours.hidden=!model.hours.length;if(n.hours.getAttribute('aria-label')!==(model.hoursLabel||'Timeprognose ikke tilgængelig'))n.hours.setAttribute('aria-label',model.hoursLabel||'Timeprognose ikke tilgængelig');rows(n.hours,n.hourRows,model.hours,()=>{const row=make('div');row.setAttribute('role','group');row.append(make('span'),make('img'),make('strong'),make('small','weather-hour-rain'),make('small','weather-hour-wind'));row.children[4].append(make('span','weather-wind-label'),make('span','weather-wind-direction'));row.children[4].children[1].setAttribute('role','img');return row;},(row,item,index)=>{const previous=model.hours[index-1],change=!previous?'first':previous.condition!==item.condition||previous.rain!==item.rain?'change':'steady';if(row.getAttribute('data-weather-change')!==change)row.setAttribute('data-weather-change',change);text(row.children[0],item.time);artwork(row.children[1],item.icon,item.condition);text(row.children[2],item.temperature);text(row.children[3],item.rain);if(row.children[3].hidden!==(!item.rain))row.children[3].hidden=!item.rain;const wind=row.children[4],direction=windFrom(item.windBearing),windLabel=item.windSpeed||item.wind||'',windDescription=[item.wind,item.windSpeed,direction?.label].filter(Boolean).join(' · ');text(wind.children[0],windLabel);if(wind.hidden!==(!windLabel&&!direction))wind.hidden=!windLabel&&!direction;if(wind.title!==windDescription)wind.title=windDescription;const arrow=wind.children[1];if(arrow.hidden!==(!direction))arrow.hidden=!direction;if(direction){if(arrow.getAttribute('aria-label')!==direction.label)arrow.setAttribute('aria-label',direction.label);if(arrow.style.transform!==`rotate(${direction.degrees}deg)`)arrow.style.transform=`rotate(${direction.degrees}deg)`;}else{if(arrow.getAttribute('aria-label')!==null)arrow.removeAttribute('aria-label');if(arrow.style.transform!=='')arrow.style.transform='';}const label=[item.time,item.condition,item.temperature,item.rain?`Regn ${item.rain}`:'',[item.wind,item.windSpeed,direction?.label].filter(Boolean).join(' · ')].filter(Boolean).join(', ');if(row.getAttribute('aria-label')!==label)row.setAttribute('aria-label',label);});
 if(n.days.hidden!==(!model.days.length))n.days.hidden=!model.days.length;rows(n.days,n.dayRows,model.days,()=>{const row=make('div');row.setAttribute('role','group');row.append(make('strong'),make('img'),make('span'),make('span','temperature-range'),make('strong'));return row;},(row,item)=>{text(row.children[0],item.day);artwork(row.children[1],item.icon,item.condition);text(row.children[2],item.low);text(row.children[4],item.high);if(row.children[4].hidden!==(!item.high))row.children[4].hidden=!item.high;const range=Number.isFinite(item.start)&&Number.isFinite(item.length);if(row.children[3].hidden!==(!range))row.children[3].hidden=!range;if(range){if(row.children[3].style.getPropertyValue?.('--start')!==`${item.start}%`)row.children[3].style.setProperty('--start',`${item.start}%`);if(row.children[3].style.getPropertyValue?.('--length')!==`${item.length}%`)row.children[3].style.setProperty('--length',`${item.length}%`);}const label=[item.day,item.high?`lavest ${item.low}, højst ${item.high}`:`temperaturprognose ${item.low}`,item.condition].filter(Boolean).join(', ');if(row.getAttribute('aria-label')!==label)row.setAttribute('aria-label',label);},1);
 if(n.source.hidden!==(!model.source))n.source.hidden=!model.source;text(n.sourceCopy,model.source);return n;
}

// Keep the header slot stable even when current data is unavailable.
// Photo has its own weather chip; disabled empty copy makes no forecast claim.
export const weatherHeaderVisible=focus=>focus!=='photo';

// Stable host lifecycle hook: the detail has no independently scheduled effects.
export function cleanupWeather(){}
