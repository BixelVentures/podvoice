import {conditionLabel,conditionIcon,weatherTemperature,forecastDayRows,localDayKey,hourlyWeather,weatherAiAdvice,weatherAppearance,windStrength,windFrom,weatherDisplayLocation} from './weather-observation.js';
export function weatherSourceLabel(source){
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
],days:[{day:'I dag',low:9,high:17},{day:'Fredag',low:10,high:16},{day:'Lørdag',low:8,high:14}]};
export function clothingTip({temperature,units={temperature:'°C'}}){
 if(!Number.isFinite(temperature)||!['°C','C','°F','F'].includes(units?.temperature))return '';
 const celsius=['°F','F'].includes(units.temperature)?(temperature-32)*5/9:temperature;
 if(celsius<1)return 'Tag en varm jakke, hue og handsker på.';if(celsius<7)return 'Tag en varm jakke på.';if(celsius<14)return 'Tag en jakke med.';if(celsius<20)return 'Tag en trøje med.';return 'Let tøj kan være passende.';
}
export function localWeatherModel(w=WEATHER){
 const unit=w.units?.temperature||'°C',time=period=>new Date(period.datetime).toLocaleTimeString('da-DK',{timeZone:'Europe/Copenhagen',hour:'2-digit',minute:'2-digit'});
 return {title:w.place,subtitle:'Vejret i dag',appearance:weatherAppearance({condition:w.conditionCode,isDaytime:w.isDaytime}),current:{temperature:weatherTemperature(w.temperature,unit),condition:w.condition,icon:conditionIcon(w.conditionCode,w.isDaytime),range:`Højst ${weatherTemperature(w.high,unit)} · Lavest ${weatherTemperature(w.low,unit)}`},summary:clothingTip(w),hoursLabel:'Vejret de næste 12 timer. Scroll vandret for flere timer',hours:w.hours.map((h,i)=>{const metrics=weatherMetrics(h,w.units);return {id:`fixture-hour-${i}`,time:time(h),temperature:weatherTemperature(h.temperature,unit),condition:conditionLabel(h.condition),icon:conditionIcon(h.condition),...metrics,wind:windStrength(h.wind_speed,w.units?.windSpeed),windSpeed:metrics.wind,windBearing:windFrom(h.wind_bearing)?.degrees??null};}),days:w.days.map((d,i)=>({id:`fixture-day-${i}`,day:d.day,low:weatherTemperature(d.low,unit),high:weatherTemperature(d.high,unit),condition:'Skyet',icon:'cloud',start:(d.low-8)*7,length:(d.high-d.low)*7})),source:weatherSourceLabel(w.source)};
}
// One source-provided clothing sentence occupies the advice slot. Prefer the
// existing clothing-specific text; do not concatenate overlapping rule outputs
// or present these bounded source rules as generated AI advice.
export function liveWeatherModel(w,{connected=true,now=Date.now(),aiContext=null}={}){
 const empty={title:'Vejr',subtitle:'Vejret i dag',appearance:weatherAppearance(null),current:null,summary:'',hours:[],days:[],source:''};if(!w)return empty;
 const displayLocation=weatherDisplayLocation(w.displayLocation,now),automaticLocation=displayLocation?.source==='ha_home_geonames';
 const format=value=>weatherTemperature(value,w.unit),days=forecastDayRows(w),ranges=days.filter(d=>Number.isFinite(d.low)&&Number.isFinite(d.high)),today=ranges.find(d=>d.key===localDayKey(new Date(now))),allLow=Math.min(...ranges.map(d=>d.low)),allHigh=Math.max(...ranges.map(d=>d.high)),span=Math.max(1,allHigh-allLow);
 const retrieved=Date.parse(w.retrievedAt),appearanceFresh=!w.stale&&connected&&Number.isFinite(now)&&retrieved<=now&&now<retrieved+900000,appearance=weatherAppearance(w.current,{fresh:appearanceFresh});
 const hourly=hourlyWeather(w,now),suggestion=hourly?.advice,period=Date.parse(suggestion?.periodTime),advice=!!suggestion&&!w.stale&&!hourly.stale&&connected&&suggestion.source===hourly.source&&suggestion.retrievedAt===hourly.retrievedAt&&suggestion.validUntil*1000>now&&period>now&&hourly.forecast.filter(p=>p.datetime===suggestion.periodTime).length===1;
 const ai=weatherAiAdvice(w.aiAdvice,w,now),aiCurrent=!!ai&&!w.stale&&!hourly?.stale&&connected&&!!aiContext&&['roomId','sessionId','turnId','taskId','inputRevision','providerGeneration'].every(key=>ai[key]===aiContext[key]);
 const adviceTime=advice?new Date(period).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
 const counts=new Map();for(const p of hourly?.forecast||[])counts.set(p.datetime,(counts.get(p.datetime)||0)+1);
 const periods=hourly?hourly.forecast.filter(p=>counts.get(p.datetime)===1&&Date.parse(p.datetime)>now).sort((a,b)=>Date.parse(a.datetime)-Date.parse(b.datetime)).slice(0,12):[],next=periods[0];
 const refreshTimes=[...(automaticLocation?[displayLocation.validUntil*1000]:[]),...(aiCurrent?[ai.validUntil*1000]:[]),...(advice?[suggestion.validUntil*1000]:[]),...(hourly?[Date.parse(hourly.retrievedAt)+900000]:[]),...(next?[Date.parse(next.datetime)]:[]),...(appearanceFresh?[retrieved+900000]:[])];
 return {title:displayLocation?.name||w.location||'Vejr',subtitle:w.stale||!connected?'Sidst kendte vejr':hourly?.stale?'Vejret i dag · Timeprognose sidst kendt':'Vejret i dag',appearance,current:w.current?{temperature:format(w.current.temperature),condition:conditionLabel(w.current.condition)||'Aktuel beskrivelse ikke oplyst',icon:conditionIcon(w.current.condition,w.current.isDaytime),range:today?`Højst ${format(today.high)} · Lavest ${format(today.low)}`:''}:null,
  summary:aiCurrent?ai.summary:advice?(suggestion.children||suggestion.summary):'',summaryLabel:aiCurrent?'AI-råd baseret på vejrudsigten':advice?`Praktisk råd for ${adviceTime}`:'',adviceUntil:aiCurrent?ai.validUntil*1000:advice?suggestion.validUntil*1000:null,refreshAt:refreshTimes.length?Math.min(...refreshTimes):null,
  hoursLabel:w.stale||hourly?.stale||!connected?'Sidst kendte timeprognose. Scroll vandret for flere timer':'Vejret de næste timer. Scroll vandret for flere timer',hours:periods.map(p=>{const metrics=weatherMetrics(p,hourly.units);return {id:p.datetime,time:new Date(p.datetime).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),temperature:format(p.temperature),condition:conditionLabel(p.condition),icon:conditionIcon(p.condition),...metrics,wind:windStrength(p.wind_speed,hourly.units?.windSpeed),windSpeed:metrics.wind,windBearing:windFrom(p.wind_bearing)?.degrees??null};}),
  days:days.map(d=>{const range=Number.isFinite(d.low)&&Number.isFinite(d.high);return {id:d.key,day:d.start.toLocaleDateString('da-DK',{weekday:'short',day:'numeric',month:'short'}),condition:conditionLabel(d.condition),icon:conditionIcon(d.condition),low:format(range?d.low:d.temperature),high:range?format(d.high):'',start:range?(d.low-allLow)/span*100:null,length:range?(d.high-d.low)/span*100:null};}),
  source:[weatherSourceLabel(w.source),automaticLocation?'Stednavn: GeoNames · CC BY 4.0':''].filter(Boolean).join('\n')};
}
const retained=new WeakMap(),text=(node,value)=>{const next=typeof value==='string'?value:'';if(node.textContent!==next)node.textContent=next;};
// The local header, overview, photo and detail share one fixture projection.
// Live surfaces continue to be populated solely by their observed-data adapter.
export function renderLocalWeather(doc,model=localWeatherModel()){
 for(const id of ['header-weather','photo-weather','home-weather']){
  const button=doc.getElementById(id);if(!button)continue;
  const assign=(selector,value)=>{const node=button.querySelector(selector);if(node)text(node,value);};
  if(id==='home-weather'){assign('.home-temperature',model.current?.temperature);assign('.home-condition',model.current?.condition);assign('small',`${model.title} · Se vejrudsigten`);}
  else{assign('strong',model.current?.temperature);assign(id==='photo-weather'?':scope > span':'small',model.current?.condition);}
  const icon=button.querySelector(':scope > img');if(icon)artwork(icon,model.current?.icon);
 }
 return renderWeather(doc.getElementById('weather-view'),model);
}
function build(node){
 const doc=node.ownerDocument||document,make=(tag,cls)=>{const n=doc.createElement(tag);if(cls)n.className=cls;return n;};
 const heading=make('header','response-heading'),intro=make('div'),title=make('h1'),subtitle=make('p'),card=make('div','weather-current'),copy=make('div'),value=make('strong'),description=make('p'),range=make('span'),icon=make('img'),summary=make('p','weather-summary'),summaryText=doc.createTextNode(''),hours=make('section','weather-hours'),days=make('section','weather-days'),daysTitle=make('h2'),source=make('footer','weather-source'),sourceCopy=make('p');
 title.id='weather-title';icon.alt='';intro.append(title,subtitle);heading.append(intro);copy.append(value,description,range);card.append(copy,icon);summary.append(summaryText);hours.tabIndex=0;days.setAttribute('aria-label','Vejrudsigt for de næste dage');text(daysTitle,'De næste dage');days.append(daysTitle);sourceCopy.id='weather-source-info';source.append(sourceCopy);node.replaceChildren(heading,card,summary,hours,days,source);
 const n={make,title,subtitle,card,value,description,range,icon,summary,summaryText,hours,days,daysTitle,source,sourceCopy,hourRows:new Map(),dayRows:new Map()};retained.set(node,n);return n;
}
function artwork(node,file,label=''){node.hidden=!file;if(file){const src=`assets/icons/${file}.svg`;if(node.getAttribute('src')!==src)node.src=src;}node.alt=label;}
function rows(parent,cache,items,make,update,offset=0){const wanted=new Set(items.map(item=>item.id));for(const[id,row]of cache)if(!wanted.has(id)){row.remove();cache.delete(id);}items.forEach((item,index)=>{let row=cache.get(item.id);if(!row){row=make();cache.set(item.id,row);}update(row,item);if(parent.children[index+offset]!==row)parent.insertBefore(row,parent.children[index+offset]||null);});}
// One retained DOM anatomy for local examples and validated source projections.
export function renderWeather(node,model=localWeatherModel()){
 const n=retained.get(node)||build(node),make=n.make;text(n.title,model.title);text(n.subtitle,model.subtitle);n.card.hidden=!model.current;
 // The same closed appearance reaches both scales, including live rendering.
 // CSS owns the decorative right-third image; no new DOM or image truth claim.
 const appearance=model.appearance||weatherAppearance(null);for(const surface of [n.card,node.ownerDocument?.getElementById('home-weather')].filter(Boolean)){surface.setAttribute('data-weather-tone',appearance.tone);surface.setAttribute('data-weather-phase',appearance.phase);surface.setAttribute('data-weather-photo',String(appearance.photo===true));}
 if(model.current){text(n.value,model.current.temperature);text(n.description,model.current.condition);text(n.range,model.current.range);n.range.hidden=!model.current.range;artwork(n.icon,model.current.icon);}
 n.summary.hidden=!model.summary;text(n.summaryText,model.summary);if(model.summaryLabel){n.summary.setAttribute('aria-description',model.summaryLabel);n.summary.setAttribute('aria-describedby','weather-source-info');}else{n.summary.removeAttribute('aria-description');n.summary.removeAttribute('aria-describedby');}
 n.hours.hidden=!model.hours.length;n.hours.setAttribute('aria-label',model.hoursLabel||'Timeprognose ikke tilgængelig');rows(n.hours,n.hourRows,model.hours,()=>{const row=make('div');row.append(make('span'),make('img'),make('strong'),make('small','weather-hour-rain'),make('small','weather-hour-wind'));row.children[4].append(make('span','weather-wind-label'),make('span','weather-wind-direction'));row.children[4].children[1].setAttribute('role','img');return row;},(row,item)=>{text(row.children[0],item.time);artwork(row.children[1],item.icon,item.condition);text(row.children[2],item.temperature);text(row.children[3],item.rain);row.children[3].hidden=!item.rain;const wind=row.children[4],direction=windFrom(item.windBearing);text(wind.children[0],item.wind||'');wind.hidden=!item.wind&&!direction;wind.title=item.windSpeed||'';const arrow=wind.children[1];arrow.hidden=!direction;if(direction){arrow.setAttribute('aria-label',direction.label);arrow.style.transform=`rotate(${direction.degrees}deg)`;}else{arrow.removeAttribute('aria-label');arrow.style.transform='';}row.setAttribute('aria-label',[item.time,item.condition,item.temperature,item.rain?`Regn ${item.rain}`:'',[item.wind,item.windSpeed,direction?.label].filter(Boolean).join(' · ')].filter(Boolean).join(', '));});
 n.days.hidden=!model.days.length;rows(n.days,n.dayRows,model.days,()=>{const row=make('div');row.append(make('strong'),make('img'),make('span'),make('span','temperature-range'),make('strong'));return row;},(row,item)=>{text(row.children[0],item.day);artwork(row.children[1],item.icon,item.condition);text(row.children[2],item.low);text(row.children[4],item.high);row.children[4].hidden=!item.high;const range=Number.isFinite(item.start)&&Number.isFinite(item.length);row.children[3].hidden=!range;if(range){row.children[3].style.setProperty('--start',`${item.start}%`);row.children[3].style.setProperty('--length',`${item.length}%`);}row.setAttribute('aria-label',[item.day,item.high?`lavest ${item.low}, højst ${item.high}`:`temperaturprognose ${item.low}`,item.condition].filter(Boolean).join(', '));},1);
 n.source.hidden=!model.source;text(n.sourceCopy,model.source);return n;
}
