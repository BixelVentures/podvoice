import test from 'node:test';
import assert from 'node:assert/strict';
import {stations,radioStation,localRadioPlayerModel} from '../../podvoice/gatekeeper/static/podview/radio-model.js';

test('five named channels have stable, unique identifiers and no invented stream or artwork',()=>{
 assert.deepEqual(stations.map(({id,label})=>[id,label]),[
  ['p3','P3'],['p1','P1'],['p4-ostjylland','P4 Østjylland'],['p6-beat','P6 Beat'],['p8-jazz','P8 Jazz'],
 ]);
 assert.ok(stations.every(station=>Object.isFrozen(station)));
 assert.ok(Object.isFrozen(stations));
 assert.ok(stations.every(station=>Object.keys(station).sort().join(',')==='id,label'));
 assert.equal(radioStation('p4-ostjylland'),stations[2]);
 assert.equal(radioStation('P3'),null);
 assert.equal(radioStation('__proto__'),null);
});

test('local selection changes only source content of the shared player model',()=>{
 const base={active:true,playing:true,fresh:true,title:'Old track',artist:'Old artist',target:'Stuen',fixtureArt:'assets/old.png',canOutput:true,canDiscover:true,volume:35};
 const first=localRadioPlayerModel('p3',base),second=localRadioPlayerModel('p8-jazz',base);
 assert.equal(first.title,'P3');
 assert.equal(second.title,'P8 Jazz');
 assert.equal(first.active,true);
 assert.equal(first.playing,false);
 assert.equal(first.fresh,false);
 assert.equal(first.artist,'Ikke tilsluttet endnu');
 assert.equal(first.fixtureArt,null);
 assert.equal(first.artwork,null);
 assert.equal(first.canOutput,false);
 assert.equal(first.canDiscover,false);
 assert.equal(first.volume,35);
 assert.equal(first.target,'Stuen');
 assert.equal(first.exampleOnly,true);
 assert.equal(first.sourceKind,'radio');
 assert.equal(first.previewLabel,'Radio');
 assert.equal(base.title,'Old track');
 assert.equal(localRadioPlayerModel('unknown',base),null);
 assert.equal('uri' in first,false);
 assert.equal('stream' in first,false);
 assert.equal('receipt' in first,false);
 assert.equal(localRadioPlayerModel('p1',{}).target,'');
 assert.equal(localRadioPlayerModel('p1',{}).volume,null);
});
