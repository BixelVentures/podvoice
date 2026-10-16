const conditions={clear:'Klart',sunny:'Solrigt',partlycloudy:'Let skyet',cloudy:'Skyet',rainy:'Regn',pouring:'Kraftig regn',snowy:'Sne',fog:'Tåge',windy:'Blæsende','clear-night':'Klar nat',lightning:'Torden','lightning-rainy':'Torden og regn','snowy-rainy':'Slud',exceptional:'Usædvanligt vejr'};
export const conditionLabel=v=>conditions[v]||String(v||'').slice(0,80);
export function conditionIcon(value){
 const icons={clear:'sun',sunny:'sun','clear-night':'moon',partlycloudy:'cloud-sun',cloudy:'cloud',rainy:'cloud-rain',pouring:'cloud-rain'};
 return icons[value]||null;
}
export function weatherTemperature(value,unit='°C'){
 return Number.isFinite(value)?`${new Intl.NumberFormat('da-DK',{maximumFractionDigits:0}).format(Math.abs(value)<0.5?0:value)}${unit}`:'—';
}
export const localDayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function completeHourlyDayRanges(periods){
 const groups=new Map();for(const row of periods){const date=new Date(row.datetime);if(!Number.isFinite(date.getTime())||!Number.isFinite(row.temperature)||date.getMinutes()!==0||date.getSeconds()!==0||date.getMilliseconds()!==0)continue;const key=localDayKey(date);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({date,temperature:row.temperature});}
 const result=[];for(const[key,rows]of groups){const [year,month,day]=key.split('-').map(Number),start=new Date(year,month-1,day),end=new Date(year,month-1,day+1),expected=[];for(let t=start.getTime();t<end.getTime();t+=3600000)expected.push(t);const times=new Set(rows.map(r=>r.date.getTime()));if(rows.length!==expected.length||times.size!==expected.length||expected.some(t=>!times.has(t)))continue;result.push({key,start,low:Math.min(...rows.map(r=>r.temperature)),high:Math.max(...rows.map(r=>r.temperature))});}return result.sort((a,b)=>a.start-b.start);
}
export function weatherObservation(v,includeHourly=true){
 if(!v||typeof v.source!=='string'||!v.source.length||typeof v.retrievedAt!=='string'||!Number.isFinite(Date.parse(v.retrievedAt))||!Number.isFinite(v.observedAt)||!v.units||!Array.isArray(v.forecast)||v.forecast.length>48)throw Error('invalid_weather');
 const unit=v.units.temperature;if(!['°C','°F','C','F'].includes(unit))throw Error('unknown_temperature_unit');
 const current=v.current===null?null:{temperature:Number.isFinite(v.current?.temperature)?v.current.temperature:null,condition:typeof v.current?.condition==='string'?v.current.condition.slice(0,80):''};
 const forecast=v.forecast.map(row=>{if(v.forecastType==='daily'&&(('highTemperature' in row&&(!Number.isFinite(row.highTemperature)||row.highTemperature!==row.temperature))||('lowTemperature' in row&&(!Number.isFinite(row.lowTemperature)||!Number.isFinite(row.highTemperature)||row.lowTemperature>row.highTemperature))))throw Error('invalid_daily_range');if(typeof row.datetime!=='string'||!Number.isFinite(Date.parse(row.datetime)))throw Error('invalid_weather_period');return {datetime:row.datetime,temperature:Number.isFinite(row.temperature)?row.temperature:null,condition:typeof row.condition==='string'?row.condition.slice(0,80):'',rain:Number.isFinite(row.precipitation_probability)&&row.precipitation_probability>=0&&row.precipitation_probability<=100?row.precipitation_probability:null,precipitation:Number.isFinite(row.precipitation)&&row.precipitation>=0?row.precipitation:null,wind_speed:Number.isFinite(row.wind_speed)&&row.wind_speed>=0?row.wind_speed:null,wind_bearing:Number.isFinite(row.wind_bearing)&&row.wind_bearing>=0&&row.wind_bearing<=360?row.wind_bearing:null,...(v.forecastType==='daily'&&Number.isFinite(row.highTemperature)?{highTemperature:row.highTemperature}:{}),...(v.forecastType==='daily'&&Number.isFinite(row.lowTemperature)?{lowTemperature:row.lowTemperature}:{})};});
 const label=v.displayLocation,displayLocation=label&&typeof label==='object'&&!Array.isArray(label)&&Object.keys(label).length===2&&label.source==='configured_label'&&typeof label.name==='string'&&label.name.length>0&&label.name.length<=80&&!/[\x00-\x1f\x7f]/.test(label.name)?{name:label.name,source:'configured_label'}:null;
 const projected={...(displayLocation?{displayLocation}:{}),source:v.source.slice(0,120),location:typeof v.location==='string'?v.location.slice(0,120):'',retrievedAt:v.retrievedAt,stateUpdatedAt:v.stateUpdatedAt,observedAt:v.observedAt,units:{temperature:unit,precipitation:v.units.precipitation,windSpeed:v.units.windSpeed},unit:unit.length===1?'°'+unit:unit,current,forecast,aiAdvice:weatherAiAdvice(v.aiAdvice,v),forecastType:typeof v.forecastType==='string'?v.forecastType:'',advice:weatherAdvice(v.advice,v),coverage:{truncated:v.coverage?.truncated===true,totalRows:v.coverage?.totalRows,returnedRows:forecast.length}};
 if(includeHourly&&v.forecastType==='daily'&&v.hourly){
  // The server binds the owner. The display independently checks the closed
  // auxiliary shape and provenance; failure cannot remove the daily forecast.
  const keys=['source','location','retrievedAt','stateUpdatedAt','observedAt','units','current','forecastType','forecast','advice','coverage','displayLocation','aiAdvice'],h=v.hourly;
  if(typeof h==='object'&&!Array.isArray(h)&&Object.keys(h).every(key=>keys.includes(key))&&h.forecastType==='hourly'&&h.source===v.source&&h.location===v.location&&['temperature','precipitation','windSpeed'].every(key=>h.units?.[key]===v.units[key]))try{projected.hourly=weatherObservation(h,false);}catch{}
 }
 return projected;
}

export function hourlyWeather(weather,now=Date.now()){
 const h=weather.forecastType==='hourly'?weather:weather.hourly;if(!h||weather.stale||h.forecastType!=='hourly'||h.source!==weather.source||h.location!==weather.location||['temperature','precipitation','windSpeed'].some(key=>h.units?.[key]!==weather.units?.[key]))return null;
 const retrieved=Date.parse(h.retrievedAt);return Number.isFinite(now)&&retrieved<=now&&now<retrieved+900000?h:null;
}

export function forecastDayRows(weather){
 if(weather.forecastType==='hourly')return completeHourlyDayRanges(weather.forecast).map(day=>({...day,condition:weather.forecast.find(x=>localDayKey(new Date(x.datetime))===day.key&&x.condition)?.condition||''}));
 if(weather.forecastType!=='daily')return [];
 const rows=weather.forecast.map(period=>({key:localDayKey(new Date(period.datetime)),start:new Date(period.datetime),temperature:period.temperature,condition:period.condition||'',...(Number.isFinite(period.highTemperature)&&Number.isFinite(period.lowTemperature)?{high:period.highTemperature,low:period.lowTemperature}:{})}));
 const counts=new Map();for(const row of rows)counts.set(row.key,(counts.get(row.key)||0)+1);
 return rows.filter(row=>counts.get(row.key)===1).sort((a,b)=>a.start-b.start);
}

// Advice is a bounded source-owned suggestion for one actual forecast hour.
export function weatherAdvice(advice,weather,now=Date.now()){
 const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 if(!exact(advice,['id','ruleVersion','source','retrievedAt','periodTime','evidence','kind','scope','summary','children','validUntil'])||!weather||!Array.isArray(weather.forecast)||!Number.isFinite(now)||!Number.isFinite(advice.validUntil)||advice.ruleVersion!=='next-hour-clothing-v1'||advice.kind!=='practical_guidance'||advice.scope!=='next_hourly_period'||weather.forecastType!=='hourly'||!/^advice:[a-f0-9]{32}$/.test(advice.id||'')||advice.source!==weather.source||advice.retrievedAt!==weather.retrievedAt)return null;
 if(![advice.periodTime,advice.retrievedAt].every(value=>typeof value==='string'&&value.length<=64&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)))return null;
 // Date.parse keeps milliseconds; floor the numeric server expiry to the same
 // precision so valid Python microsecond timestamps do not fail their own bound.
 const period=Date.parse(advice.periodTime),retrieved=Date.parse(advice.retrievedAt),expiry=Math.floor(advice.validUntil*1000);
 if(!Number.isFinite(period)||!Number.isFinite(retrieved)||retrieved>now||!Number.isFinite(expiry)||expiry<=now||period<=now||period>now+3600000||expiry>period||expiry>retrieved+900000||weather.forecast.filter(row=>row.datetime===advice.periodTime).length!==1)return null;
 if(!['summary','children'].every(key=>typeof advice[key]==='string'&&advice[key].length>0&&advice[key].length<=240)||!Array.isArray(advice.evidence)||advice.evidence.length!==1)return null;
 const row=weather.forecast.find(row=>row.datetime===advice.periodTime),fact=advice.evidence[0],fields={temperature:['temperature',['°C','C','°F','F'],'°C'],wind_speed:['windSpeed',['m/s','km/h','mph','kn'],'m/s'],precipitation:['precipitation',['mm','cm','in'],'mm'],precipitation_probability:[null,['%'],'%']},spec=fields[fact?.field];
 if(!exact(fact,['field','value','unit','normalizedValue','normalizedUnit'])||!spec||!Number.isFinite(fact.value)||!Number.isFinite(fact.normalizedValue)||row[fact.field]!==fact.value||!spec[1].includes(fact.unit)||fact.normalizedUnit!==spec[2]||(spec[0]&&weather.units?.[spec[0]]!==fact.unit))return null;
 const conversions={'°C':[1,0],C:[1,0],'°F':[5/9,-32],F:[5/9,-32],'m/s':[1,0],'km/h':[1/3.6,0],mph:[.44704,0],kn:[.5144444444444445,0],mm:[1,0],cm:[10,0],in:[25.4,0],'%':[1,0]},[factor,offset]=conversions[fact.unit],normalized=(fact.value+offset)*factor;
 if(!Number.isFinite(normalized)||Math.abs(normalized-fact.normalizedValue)>1e-12*Math.max(1,Math.abs(normalized))||(fact.field==='precipitation_probability'&&(fact.value<0||fact.value>100))||(['wind_speed','precipitation'].includes(fact.field)&&fact.value<0))return null;
 return {...advice,evidence:[{...fact}]};
}

// Only a typed server-projected advice receipt, never arbitrary assistant text.
export function weatherAiAdvice(value,weather,now=Date.now()){
 const keys=['schema','receiptId','weatherReceiptId','roomId','sessionId','turnId','taskId','inputRevision','providerGeneration','summary','summaryKind','evidenceFactIds','validUntil','source','sourceRetrievedAt'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||value.schema!=='podview.weather-advice.v1'||value.summaryKind!=='ai_advice'||value.source!==weather?.source||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>240||!Number.isFinite(value.validUntil)||value.validUntil*1000<=now||!['receiptId','weatherReceiptId','roomId','sessionId','turnId','taskId'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=160)||!['inputRevision','providerGeneration'].every(key=>Number.isInteger(value[key])&&value[key]>=0)||!Array.isArray(value.evidenceFactIds)||value.evidenceFactIds.length<1||value.evidenceFactIds.length>12||value.evidenceFactIds.some(id=>typeof id!=='string'||!id.length||id.length>160)||new Set(value.evidenceFactIds).size!==value.evidenceFactIds.length)return null;
 const retrieved=Date.parse(value.sourceRetrievedAt);if(!Number.isFinite(retrieved)||retrieved>now||value.validUntil*1000>retrieved+900000)return null;
 return {...value,evidenceFactIds:[...value.evidenceFactIds]};
}

// DMI Beaufort lower bounds in m/s. Classify raw SI, never a rounded display speed.
const windLevels=[[0,'Stille'],[.3,'Næsten stille'],[1.6,'Svag vind'],[3.4,'Let vind'],[5.5,'Jævn vind'],[8,'Frisk vind'],[10.8,'Hård vind'],[13.9,'Stiv kuling'],[17.2,'Hård kuling'],[20.8,'Stormende kuling'],[24.5,'Storm'],[28.5,'Stærk storm']];
export function windStrength(speed,unit){
 const factors={'m/s':1,'km/h':1/3.6,mph:.44704,kn:1852/3600};
 if(!Number.isFinite(speed)||speed<0||typeof unit!=='string'||!Object.hasOwn(factors,unit))return '';
 const si=speed*factors[unit];if(!Number.isFinite(si))return '';if(si>32.6)return 'Orkan';
 let label=windLevels[0][1];for(const [minimum,name]of windLevels){if(si<minimum)break;label=name;}return label;
}
export function windFrom(bearing){
 if(!Number.isFinite(bearing)||bearing<0||bearing>360)return null;
 const degrees=bearing===360?0:bearing,names=['nord','nordøst','øst','sydøst','syd','sydvest','vest','nordvest'];
 return {degrees,label:`Vind fra ${names[Math.floor((degrees+22.5)/45)%8]}`};
}
