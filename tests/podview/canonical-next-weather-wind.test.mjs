import test from 'node:test';
import assert from 'node:assert/strict';
import {windStrength,windFrom,weatherObservation} from '../../podvoice/gatekeeper/static/podview/weather-observation.js';
const levels=[[0,'Stille'],[.3,'Næsten stille'],[1.6,'Svag vind'],[3.4,'Let vind'],[5.5,'Jævn vind'],[8,'Frisk vind'],[10.8,'Hård vind'],[13.9,'Stiv kuling'],[17.2,'Hård kuling'],[20.8,'Stormende kuling'],[24.5,'Storm'],[28.5,'Stærk storm']];
test('DMI names use unrounded SI thresholds on either side of every boundary',()=>{
 for(let i=0;i<levels.length;i++){const [minimum,label]=levels[i];assert.equal(windStrength(minimum,'m/s'),label);if(i)assert.equal(windStrength(minimum-.000001,'m/s'),levels[i-1][1]);assert.equal(windStrength(minimum+.000001,'m/s'),label);}
 assert.equal(windStrength(32.6,'m/s'),'Stærk storm');assert.equal(windStrength(32.600001,'m/s'),'Orkan');assert.equal(windStrength(32.7,'m/s'),'Orkan');assert.equal(windStrength(22,'km/h'),'Jævn vind');assert.equal(windStrength(19.79,'km/h'),'Let vind');assert.equal(windStrength(19.8,'km/h'),'Jævn vind');
});
test('all known source units agree without changing or rounding their source speed',()=>{
 for(const speed of [0,.4,2,4,6,9,11,15,18,22,26,30,35]){const expected=windStrength(speed,'m/s');for(const [unit,value]of [['m/s',speed],['km/h',speed*3.6],['mph',speed/.44704],['kn',speed/(1852/3600)]])assert.equal(windStrength(value,unit),expected);}
 for(const speed of [null,undefined,NaN,Infinity,-1,true,'22'])assert.equal(windStrength(speed,'km/h'),'');for(const unit of ['km/t','unknown','constructor','__proto__',null,{}])assert.equal(windStrength(22,unit),'');
});
test('north-up arrow points FROM the actual typed bearing with Danish accessible directions',()=>{
 for(const [degrees,label]of [[0,'nord'],[45,'nordøst'],[90,'øst'],[135,'sydøst'],[180,'syd'],[225,'sydvest'],[270,'vest'],[315,'nordvest']])assert.deepEqual(windFrom(degrees),{degrees,label:`Vind fra ${label}`});assert.deepEqual(windFrom(360),windFrom(0));assert.equal(windFrom(22.499).label,'Vind fra nord');assert.equal(windFrom(22.5).label,'Vind fra nordøst');
 for(const value of [undefined,null,'N','NØ','45',true,NaN,Infinity,-1,360.1,{}])assert.equal(windFrom(value),null);
});
test('only finite numeric source bearings survive projection; raw speed/units stay immutable',()=>{
 const base={source:'Met.no',location:'Mårslet',retrievedAt:'2026-10-16T12:00:00Z',observedAt:1792152000,units:{temperature:'°C',windSpeed:'km/h'},forecastType:'hourly',forecast:[{datetime:'2026-10-16T13:00:00Z',temperature:14,wind_speed:22.3,wind_bearing:45}],current:null};
 for(const bearing of [0,45,90,360,null,'45','N',-1,Infinity]){const raw=structuredClone(base);raw.forecast[0].wind_bearing=bearing;const before=structuredClone(raw),out=weatherObservation(raw);assert.equal(out.forecast[0].wind_speed,22.3);assert.equal(out.units.windSpeed,'km/h');assert.equal(out.forecast[0].wind_bearing,windFrom(bearing)?bearing:null);assert.deepEqual(raw,before);}
 const missing=structuredClone(base);delete missing.forecast[0].wind_bearing;assert.equal(weatherObservation(missing).forecast[0].wind_bearing,null);
});
