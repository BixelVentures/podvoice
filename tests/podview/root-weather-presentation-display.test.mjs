import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedAnswers,ownedSource} from '../../podvoice/gatekeeper/static/podview/owner-answers.js';
import {weatherFactDisplay} from '../../podvoice/gatekeeper/static/podview/weather-fact-display.js';
const now=Date.parse('2026-10-16T12:00:00Z'),id='a'.repeat(32),sourceId='b'.repeat(32);
const fact=(receiptId,label,value,i=0)=>({id:`fact:${i}`,label,value,detail:'Aktuel måling',sourceId:`source:${receiptId}`});
const sources=receiptId=>[{id:`source:${receiptId}`,kind:'owner_receipt',receiptId,label:'Kilde',scope:'tool_result'}];
function fixture(){
 const context={sessionId:'s',turnId:'t',taskId:'task',inputRevision:0,sessionEpoch:1,providerGeneration:1,answerRevision:1};
 const snapshot={roomId:'kitchen',voice:{sessionId:'s'},capabilities:{answerRead:true},answers:{...context,revision:1}};
 const row={...context,schema:'podview.presentation.v1',receiptId:id,roomId:'kitchen',observedAt:now/1000,validUntil:now/1000+120,family:'fact-card',title:'Vejret',displaySuggested:true,allowedActions:[],provenance:{kind:'owner_sources',receiptIds:[sourceId]},content:{summary:'Vejret',facts:[fact(id,'Temperatur','15.1 °C'),fact(id,'Vejrforhold','partlycloudy',1)],sources:sources(id)}};
 const source={receiptId:sourceId,sessionId:'s',turnId:'t',taskId:'task',inputRevision:0,observedAt:now/1000,family:'fact-card',displaySuggested:true,provenance:{kind:'ha_weather',source:'Met.no',retrievedAt:new Date(now).toISOString(),stateUpdatedAt:new Date(now).toISOString(),validUntil:now/1000+900},content:{summary:'Vejret',facts:[fact(sourceId,'Temperatur','15.1 °C'),fact(sourceId,'Vejrforhold','partlycloudy',1)],sources:sources(sourceId)}};
 return {snapshot,envelope:{schema:'podview.answers.v1',roomId:'kitchen',revision:1,items:[row,source]}};
}
const parse=f=>ownedAnswers(f.envelope,f.snapshot,0,now+1).items[0];
const values=a=>weatherFactDisplay(a).facts.map(f=>f.value);
const freeze=v=>{if(v&&typeof v==='object'){Object.freeze(v);Object.values(v).forEach(freeze);}return v;};
test('same-envelope admitted weather exact facts get display copies, raw wire and source GET stay canonical',()=>{
 const f=freeze(fixture()),before=JSON.stringify(f),answer=parse(f);
 assert.deepEqual(values(answer),['15°C','Let skyet']);
 assert.deepEqual(answer.content.facts.map(f=>f.value),['15.1 °C','partlycloudy']);
 const raw=ownedSource({...f.envelope.items[0],schema:'podview.presentation.source.v1'},id,now+1,f.snapshot);
 assert.deepEqual(raw.facts.map(f=>f.value),['15.1 °C','partlycloudy']);assert.equal(JSON.stringify(f),before);
});
test('shared whole-degree and condition rules apply only to exact bound facts',()=>{
 for(const [input,expected] of [['-2.5 °C','-3°C'],['-0.4 °C','0°C'],['15,1 °C','15,1 °C'],['102 °C','102 °C']]){const f=fixture();for(const row of f.envelope.items)row.content.facts[0].value=input;assert.equal(values(parse(f))[0],expected);}
 for(const input of ['constructor','__proto__','partlycloudy later']){const f=fixture();for(const row of f.envelope.items)row.content.facts[1].value=input;assert.equal(values(parse(f))[1],input);}
});
test('coincidental generic facts, missing or mismatched source bindings never receive weather formatting',()=>{
 for(const mutate of [f=>f.envelope.items.pop(),f=>f.envelope.items[0].provenance.receiptIds=['c'.repeat(32)],f=>f.envelope.items[1].provenance={kind:'tool_result'},f=>f.envelope.items[1].content.facts.forEach(f=>f.label+=' andet'),f=>f.envelope.items[1].content.facts.forEach(f=>f.value+=' andet'),f=>f.envelope.items[1].content.facts.forEach(f=>f.detail='Citat')]){const f=fixture();mutate(f);assert.deepEqual(values(parse(f)),['15.1 °C','partlycloudy']);}
});
test('one exact weather match never formats unmatched facts in the same card, or wire hints',()=>{
 const f=fixture();f.envelope.items[1].content.facts.pop();f.envelope.items[0].weatherDisplayFactIds=['fact:1'];assert.deepEqual(values(parse(f)),['15°C','partlycloudy']);
});
test('expired weather and wrong owner remain rejected instead of gaining display authority',()=>{
 const f=fixture();f.envelope.items[1].provenance.validUntil=now/1000;assert.throws(()=>parse(f),/expired_weather_source/);
 const wrong=fixture();wrong.envelope.items[1].sessionId='other';assert.throws(()=>parse(wrong),/invalid_owned_answer/);
});
