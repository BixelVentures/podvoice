import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherAdvice} from '../../podvoice/gatekeeper/static/podview/weather-observation.js';
const now=Date.parse('2026-10-15T08:45:00Z');
const weather={source:'Home Assistant / Met.no',retrievedAt:'2026-10-15T08:44:00Z',forecastType:'hourly',units:{temperature:'°C',windSpeed:'km/h',precipitation:'mm'},forecast:[{datetime:'2026-10-15T09:00:00Z',temperature:12}]};
const advice={id:'advice:'+'a'.repeat(32),ruleVersion:'next-hour-clothing-v1',source:weather.source,retrievedAt:weather.retrievedAt,periodTime:weather.forecast[0].datetime,evidence:[{field:'temperature',value:12,unit:'°C',normalizedValue:12,normalizedUnit:'°C'}],kind:'practical_guidance',scope:'next_hourly_period',summary:'En jakke kan være rar at have med.',children:'Tag en jakke med.',validUntil:Date.parse('2026-10-15T08:59:00Z')/1000};
test('weather advice keeps the exact forecast source and expires without renewing age',()=>{
 assert.ok(weatherAdvice(advice,weather,now));
 assert.equal(weatherAdvice(advice,weather,advice.validUntil*1000),null);
 assert.equal(weatherAdvice({...advice,validUntil:Date.parse('2026-10-15T09:00:00Z')/1000},weather,now),null);
});
test('weather advice rejects source substitution, daily highs, absent evidence and changed forecast values',()=>{
 assert.equal(weatherAdvice({...advice,source:'another provider'},weather,now),null);
 assert.equal(weatherAdvice(advice,{...weather,forecastType:'daily'},now),null);
 assert.equal(weatherAdvice(advice,{...weather,forecast:[{datetime:advice.periodTime}]},now),null);
 assert.equal(weatherAdvice(advice,{...weather,forecast:[{datetime:advice.periodTime,temperature:20}]},now),null);
 assert.equal(weatherAdvice({...advice,evidence:[{...advice.evidence[0],unit:'°F'}]},weather,now),null);
});

test('weather advice rejects coerced expiry, future retrieval, loose fields and false normalization',()=>{
 for(const change of [{validUntil:String(advice.validUntil)},{privateUrl:'http://local.invalid/'},{evidence:[{...advice.evidence[0],normalizedValue:999}]},{evidence:[{...advice.evidence[0],html:'<img>'}]}])assert.equal(weatherAdvice({...advice,...change},weather,now),null);
 const future='2026-10-15T08:46:00Z';
 assert.equal(weatherAdvice({...advice,retrievedAt:future},{...weather,retrievedAt:future},now),null);
 assert.equal(weatherAdvice(advice,{...weather,forecast:[...weather.forecast,...weather.forecast]},now),null);
 assert.equal(weatherAdvice(advice,weather,NaN),null);
 assert.equal(weatherAdvice(advice,null,now),null);
});
test('weather advice checks source unit arithmetic and keeps quantity distinct from probability',()=>{
 for(const [field,unit,value,normalizedValue,normalizedUnit,unitKey] of [
 ['temperature','°F',42.8,6,'°C','temperature'],['wind_speed','km/h',36,10,'m/s','windSpeed'],['precipitation','in',1/25.4,1,'mm','precipitation'],['precipitation_probability','%',50,50,'%',null]
 ]){
  const raw={...weather,units:{...weather.units,...(unitKey?{[unitKey]:unit}:{})},forecast:[{datetime:advice.periodTime,[field]:value}]},item={...advice,evidence:[{field,unit,value,normalizedValue,normalizedUnit}]};
  assert.ok(weatherAdvice(item,raw,now));
  assert.equal(weatherAdvice({...item,evidence:[{...item.evidence[0],normalizedValue:normalizedValue+1}]},raw,now),null);
 }
});
test('real server microsecond timestamps share the browser millisecond boundary',()=>{
 const retrievedAt='2026-10-15T08:44:00.123456+00:00',periodTime='2026-10-15T09:00:00.123456+00:00';
 const raw={...weather,retrievedAt,forecast:[{...weather.forecast[0],datetime:periodTime}]},item={...advice,retrievedAt,periodTime,validUntil:Date.parse('2026-10-15T08:59:00Z')/1000+.123456};
 // Match exact Python timestamp arithmetic instead of re-dating source data.
 assert.ok(weatherAdvice(item,raw,now));
});
