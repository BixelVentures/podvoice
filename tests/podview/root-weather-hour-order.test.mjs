import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherObservation} from '../../podvoice/gatekeeper/static/podview/weather-observation.js';
import {liveWeatherModel} from '../../podvoice/gatekeeper/static/podview/weather-view.js';
test('next twelve hours sort by instant before limiting across offsets and midnight, without mutating facts',()=>{
 const now=Date.parse('2026-10-18T20:30:00Z');
 const timestamps=['2026-10-18T23:00:00+02:00','2026-10-18T22:00:00Z','2026-10-19T01:00:00+02:00',...Array.from({length:10},(_,i)=>new Date(Date.parse('2026-10-19T00:00:00Z')+i*3600000).toISOString())];
 const rows=timestamps.map((datetime,i)=>({datetime,temperature:i+.25,condition:'cloudy',wind_bearing:i===0?0:360,wind_speed:i}));
 const raw={source:'Met.no',location:'hjemmet',retrievedAt:new Date(now).toISOString(),observedAt:now/1000,units:{temperature:'°C',windSpeed:'km/h'},current:null,forecastType:'hourly',forecast:[...rows].reverse()};
 const observed=weatherObservation(raw),before=structuredClone(observed),rawBefore=structuredClone(raw);
 const model=liveWeatherModel(observed,{now});
 assert.deepEqual(model.hours.map(h=>h.id),timestamps.slice(0,12));
 assert.equal(model.hours[0].temperature,'0°');
 assert.equal(model.hours[0].windBearing,0);
 assert.equal(model.source,'Kilde: Met.no');
 assert.deepEqual(observed,before);assert.deepEqual(raw,rawBefore);
});
