const conditions={clear:'Klart',sunny:'Solrigt',partlycloudy:'Let skyet',cloudy:'Skyet',rainy:'Regn',pouring:'Kraftig regn',snowy:'Sne',fog:'Tåge',windy:'Blæsende','clear-night':'Klar nat',lightning:'Torden','lightning-rainy':'Torden og regn','snowy-rainy':'Slud',exceptional:'Usædvanligt vejr'};
export const conditionLabel=v=>conditions[v]||String(v||'').slice(0,80);
export function conditionIcon(value){
 const icons={clear:'sun',sunny:'sun','clear-night':'moon',partlycloudy:'cloud-sun',cloudy:'cloud',rainy:'cloud-rain',pouring:'cloud-rain'};
 return icons[value]||null;
}
export function weatherTemperature(value,unit='°C'){
 return Number.isFinite(value)?`${new Intl.NumberFormat('da-DK',{maximumFractionDigits:1}).format(value)}${unit}`:'—';
}
export const localDayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function completeHourlyDayRanges(periods){
 const groups=new Map();for(const row of periods){const date=new Date(row.datetime);if(!Number.isFinite(date.getTime())||!Number.isFinite(row.temperature)||date.getMinutes()!==0||date.getSeconds()!==0||date.getMilliseconds()!==0)continue;const key=localDayKey(date);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({date,temperature:row.temperature});}
 const result=[];for(const[key,rows]of groups){const [year,month,day]=key.split('-').map(Number),start=new Date(year,month-1,day),end=new Date(year,month-1,day+1),expected=[];for(let t=start.getTime();t<end.getTime();t+=3600000)expected.push(t);const times=new Set(rows.map(r=>r.date.getTime()));if(rows.length!==expected.length||times.size!==expected.length||expected.some(t=>!times.has(t)))continue;result.push({key,start,low:Math.min(...rows.map(r=>r.temperature)),high:Math.max(...rows.map(r=>r.temperature))});}return result.sort((a,b)=>a.start-b.start);
}
export function weatherObservation(v){
 if(!v||typeof v.source!=='string'||!v.source.length||typeof v.retrievedAt!=='string'||!Number.isFinite(Date.parse(v.retrievedAt))||!Number.isFinite(v.observedAt)||!v.units||!Array.isArray(v.forecast)||v.forecast.length>48)throw Error('invalid_weather');
 const unit=v.units.temperature;if(!['°C','°F','C','F'].includes(unit))throw Error('unknown_temperature_unit');
 const current=v.current===null?null:{temperature:Number.isFinite(v.current?.temperature)?v.current.temperature:null,condition:typeof v.current?.condition==='string'?v.current.condition.slice(0,80):''};
 const forecast=v.forecast.map(row=>{if(typeof row.datetime!=='string'||!Number.isFinite(Date.parse(row.datetime)))throw Error('invalid_weather_period');return {datetime:row.datetime,temperature:Number.isFinite(row.temperature)?row.temperature:null,condition:typeof row.condition==='string'?row.condition.slice(0,80):'',rain:Number.isFinite(row.precipitation_probability)?row.precipitation_probability:null};});
 return {source:v.source.slice(0,120),location:typeof v.location==='string'?v.location.slice(0,120):'',retrievedAt:v.retrievedAt,observedAt:v.observedAt,unit:unit.length===1?'°'+unit:unit,current,forecast,forecastType:typeof v.forecastType==='string'?v.forecastType:'',coverage:{truncated:v.coverage?.truncated===true,totalRows:v.coverage?.totalRows,returnedRows:forecast.length}};
}
