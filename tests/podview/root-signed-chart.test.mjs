import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTypedAnswerContent as validate} from '../../podvoice/gatekeeper/static/podview/visual-content.js';
import {renderActualChart} from './helpers/render-owned-chart.mjs';
const receipt='a'.repeat(32),source={id:'source',kind:'owner_receipt',receiptId:receipt,label:'Måling',scope:'tool_result'};
function answer(values){return {kind:'chart',live:true,presentation:true,ownerReceiptIds:[receipt],provenance:{kind:'owner_sources'},status:'ready',readConnected:true,content:{summary:'Faktiske temperaturer',sources:[source],unit:'°C',unitSingular:'°C',items:values.map((value,i)=>({id:`value:${i}`,label:`Måling ${i}`,value,sourceId:source.id}))}};}
for(const [values,domain] of [[[-5.2],[-5.2,0]],[[-5.2,3.1],[-5.2,3.1]],[[-12,-5.2],[-12,0]],[[0],[0,1]],[[3,8],[0,8]],[[0.2],[0,1]]]){
 test(`signed chart preserves exact values ${JSON.stringify(values)} in shared domain ${JSON.stringify(domain)}`,()=>{
  const raw=answer(values),before=structuredClone(raw),parsed=validate('chart',raw.content,{ownerReceiptIds:[receipt]});
  assert.deepEqual(parsed.items.map(row=>row.value),values);
  const chart=renderActualChart(raw);
  assert.deepEqual([...chart.items.children].map(row=>[row.children[1].min,row.children[1].max]),values.map(()=>domain));
  assert.deepEqual([...chart.items.children].map(row=>row.children[1].value),values);
  assert.deepEqual([...chart.items.children].map(row=>row.children[2].textContent),values.map(value=>`${value} °C`));
  assert.deepEqual(raw,before);
 });
}
test('signed numeric admission remains finite, bounded, typed and source-bound',()=>{
 for(const value of [true,false,'-5.2',null,NaN,Infinity,-Infinity,-1e9-1,1e9+1])assert.throws(()=>validate('chart',answer([value]).content,{ownerReceiptIds:[receipt]}));
 for(const value of [-1e9,1e9])assert.equal(validate('chart',answer([value]).content,{ownerReceiptIds:[receipt]}).items[0].value,value);
 const forged=answer([-5.2]);forged.content.items[0].sourceId='unbound';assert.throws(()=>validate('chart',forged.content,{ownerReceiptIds:[receipt]}));
});
