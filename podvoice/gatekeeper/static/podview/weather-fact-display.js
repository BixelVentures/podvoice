import {conditionLabel,weatherTemperature} from './weather-observation.js';

const knownConditions=new Set(['clear','sunny','partlycloudy','cloudy','rainy','pouring','snowy','fog','windy','clear-night','lightning','lightning-rainy','snowy-rainy','exceptional']);

// Display copies only. Owner/source values remain canonical for receipt inspection.
export function weatherFactDisplay(answer){
 const content=answer?.content,originalWeather=answer?.provenance?.kind==='ha_weather',boundWeather=answer?.presentation===true&&answer.provenance?.kind==='owner_sources'&&Array.isArray(answer.weatherDisplayFactIds);
 if(answer?.live!==true||answer.kind!=='fact-card'||(!originalWeather&&!boundWeather)||!answer.receiptId||!answer.ownerReceiptIds?.includes(answer.receiptId)||!Array.isArray(content?.facts)||!Array.isArray(content.sources)||!content.sources.length||content.sources.some(source=>source.kind!=='owner_receipt'||source.receiptId!==answer.receiptId))return content;
 return {...content,facts:content.facts.map(fact=>{
  if(fact.detail!=='Aktuel måling'||!originalWeather&&!answer.weatherDisplayFactIds.includes(fact.id))return fact;
  let value=fact.value;
  if(fact.label==='Temperatur'&&typeof value==='string'&&/^-?\d{1,3}(?:\.\d{1,8})? °C$/.test(value)){
   const number=Number(value.slice(0,-3));
   if(number>=-100&&number<=100)value=weatherTemperature(number,'°C');
  }else if(fact.label==='Vejrforhold'&&typeof value==='string'&&knownConditions.has(value)){
   const label=conditionLabel(value);if(typeof label==='string')value=label;
  }
  return value===fact.value?fact:{...fact,value};
 })};
}
