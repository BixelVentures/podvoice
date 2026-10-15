import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherFactDisplay} from '../../podvoice/gatekeeper/static/podview/weather-fact-display.js';
const answer=()=>({live:true,kind:'fact-card',receiptId:'actual-receipt',ownerReceiptIds:['actual-receipt'],provenance:{kind:'ha_weather',source:'Met.no',validUntil:123},content:{summary:'Vejret i Mårslet',sources:[{id:'source:actual',kind:'owner_receipt',receiptId:'actual-receipt'}],facts:[{id:'temp',sourceId:'source:actual',label:'Temperatur',value:'15.1 °C',detail:'Aktuel måling'},{id:'condition',sourceId:'source:actual',label:'Vejrforhold',value:'partlycloudy',detail:'Aktuel måling'}]}});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
test('typed owned weather receives shared Danish display while canonical values and provenance stay immutable',()=>{
 const raw=freeze(answer()),display=weatherFactDisplay(raw);
 assert.deepEqual(display.facts.map(f=>f.value),['15°C','Let skyet']);
 assert.deepEqual(raw.content.facts.map(f=>f.value),['15.1 °C','partlycloudy']);
 assert.equal(display.sources,raw.content.sources);assert.equal(display.facts[0].id,'temp');assert.equal(display.facts[0].sourceId,'source:actual');assert.equal(raw.provenance.source,'Met.no');
});
test('whole degrees use shared negative-half and zero behavior, never relabel another unit or parse prose',()=>{
 for(const [raw,expected] of [['-2.5 °C','-3°C'],['-0.4 °C','0°C'],['0.5 °C','1°C'],['100.1 °C','100.1 °C'],['72.3 °F','72.3 °F'],['15,1 °C','15,1 °C'],['15.1 °C senere','15.1 °C senere'],['1e2 °C','1e2 °C']]){const a=answer();a.content.facts[0].value=raw;assert.equal(weatherFactDisplay(a).facts[0].value,expected);}
});
test('generic facts, examples, unbound sources and non-current weather detail remain untouched',()=>{
 for(const mutate of [a=>a.live=false,a=>a.kind='comparison',a=>a.provenance.kind='completed_tool',a=>a.ownerReceiptIds=[],a=>a.content.sources[0].receiptId='other',a=>a.content.sources[0].kind='url']){const a=answer();mutate(a);assert.equal(weatherFactDisplay(a),a.content);}
 const a=answer();a.content.facts[0].detail='Et citat';a.content.facts[1].value='unknown_enum';assert.equal(weatherFactDisplay(a).facts[0],a.content.facts[0]);assert.equal(weatherFactDisplay(a).facts[1].value,'unknown_enum');
});
test('unknown condition prose and inherited object keys remain exact source strings',()=>{
 for(const raw of ['constructor','__proto__','toString','hasOwnProperty','valueOf','unknown_enum','partlycloudy later','Let skyet og koldt',' sunny ']){
  const a=freeze(answer());const content={...a.content,facts:a.content.facts.map(f=>f.label==='Vejrforhold'?{...f,value:raw}:f)};
  const changed={...a,content};const display=weatherFactDisplay(changed);
  assert.equal(display.facts[1].value,raw);assert.equal(typeof display.facts[1].value,'string');assert.equal(display.facts[1],content.facts[1]);
 }
});

test('existing actual fact-widget renderer receives display copy and retains canonical source answer',async()=>{
 const oldElement=globalThis.HTMLElement,oldRegistry=globalThis.customElements,registry=new Map();
 globalThis.HTMLElement=class{};globalThis.customElements={define:(name,type)=>registry.set(name,type),get:name=>registry.get(name)};
 try{
  await import('../../podvoice/gatekeeper/static/podview/answer-widget.js');
  const nodes=new Map(),q=key=>{if(!nodes.has(key))nodes.set(key,{hidden:false});return nodes.get(key);};
  const a=answer();a.status='ready';a.readConnected=true;
  const host={querySelector:q,dataset:{},visualNode:{localName:'pv-fact-card'}};
  registry.get('pv-answer').prototype.renderVisualAnswer.call(host,{connected:true},a);
  assert.deepEqual(host.visualNode.data.content.facts.map(f=>f.value),['15°C','Let skyet']);
  assert.equal(a.content.facts[0].value,'15.1 °C');assert.equal(a.content.facts[1].value,'partlycloudy');
  a.status='waiting';registry.get('pv-answer').prototype.renderVisualAnswer.call(host,{connected:true},a);assert.equal(host.visualNode.data.content,undefined);
 }finally{globalThis.HTMLElement=oldElement;globalThis.customElements=oldRegistry;}
});
