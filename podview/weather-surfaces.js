// The pre-React weather surfaces: header, photo and overview buttons. The model they paint is
// TypeScript (src/screens/weather/view-model.ts); the detail page is React (WeatherScreen.tsx).
import {weatherAppearance} from './src/screens/weather/observation.ts';
import {localWeatherModel,weatherOverviewDetail} from './src/screens/weather/view-model.ts';
const text=(node,value)=>{const next=typeof value==='string'?value:'';if(node.textContent!==next)node.textContent=next;};
export function renderOverviewForecast(button,model){
 const stale=model.sourceStale===true&&(!!model.current||!!model.hours?.length||!!model.days?.length),staleAttribute=String(stale);if(button.getAttribute('data-weather-stale')!==staleAttribute)button.setAttribute('data-weather-stale',staleAttribute);
 const appearance=model.appearance||weatherAppearance(null);for(const [key,value]of [['tone',appearance.tone],['phase',appearance.phase],['photo',String(appearance.photo===true)]])if(button.getAttribute(`data-weather-${key}`)!==value)button.setAttribute(`data-weather-${key}`,value);
 const forecast=button.querySelector('.home-forecast');if(!forecast)return;
 if(!forecast.hourRows){forecast.replaceChildren();forecast.hourRows=new Map();}
 const hours=(model.hours||[]).slice(0,5),doc=button.ownerDocument;
 rows(forecast,forecast.hourRows,hours,()=>{const row=doc.createElement('span');row.className='home-forecast-hour';row.append(doc.createElement('span'),doc.createElement('img'),doc.createElement('strong'));return row;},(row,hour)=>{text(row.children[0],hour.time);artwork(row.children[1],hour.icon,'');text(row.children[2],hour.temperature);const label=[hour.time,hour.condition,hour.temperature].filter(Boolean).join(', ');if(row.getAttribute('aria-label')!==label)row.setAttribute('aria-label',label);});
 if(forecast.hidden!==!hours.length)forecast.hidden=!hours.length;
}
// Header, photo and overview weather buttons (pre-React). The detail page reads the same model from the
// query cache (WeatherScreen.tsx).
export function renderLocalWeatherSurfaces(doc,model=localWeatherModel()){
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
}
function artwork(node,file,label=''){if(node.hidden!==!file)node.hidden=!file;if(file){const src=`assets/icons/${file}.svg`;if(node.getAttribute('src')!==src)node.src=src;}if(node.getAttribute('alt')!==label)node.setAttribute('alt',label);}
function rows(parent,cache,items,make,update,offset=0){const wanted=new Set(items.map(item=>item.id));for(const[id,row]of cache)if(!wanted.has(id)){row.remove();cache.delete(id);}items.forEach((item,index)=>{let row=cache.get(item.id);if(!row){row=make();cache.set(item.id,row);}update(row,item,index);if(parent.children[index+offset]!==row)parent.insertBefore(row,parent.children[index+offset]||null);});}

// Stable host lifecycle hook: the detail has no independently scheduled effects.
export function cleanupWeather(){}
