// Execute the existing admission, answer routing and canonical chart renderer.
// This small DOM adapter inspects shipped properties, not browser pixel appearance.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ownedAnswers} from '../../../podvoice/gatekeeper/static/podview/owner-answers.js';
class Element extends EventTarget {
 constructor(){super();this.children=[];this.dataset={};this.attributes=new Map();this.classList={add(){}};this.isConnected=false;this.hidden=false;this.textContent='';}
 get childNodes(){return this.children;}
 append(...nodes){for(const n of nodes){n.remove?.();n.parentNode=this;this.children.push(n);}}
 prepend(...nodes){for(const n of [...nodes].reverse())this.insertBefore(n,this.children[0]);}
 insertBefore(n,b){n.remove?.();n.parentNode=this;const i=this.children.indexOf(b);this.children.splice(i<0?this.children.length:i,0,n);}
 remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
 setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return this.attributes.get(k)??null;}
 querySelectorAll(){return [];}
 contains(){return false;}
}
const registry=new Map();globalThis.HTMLElement=Element;globalThis.customElements={define:(tag,type)=>registry.set(tag,type)};
globalThis.document={createElement(tag){const n=new (registry.get(tag)||Element)();n.localName=tag;n.tagName=tag.toUpperCase();return n;},activeElement:null};
await import('../../../podvoice/gatekeeper/static/podview/answer-widget.js');
export function renderActualChart(answer){
 const chart=document.createElement('pv-data-chart');chart.isConnected=true;chart.connectedCallback();
 const nodes=new Map([['.chart',chart]]),q=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
 const host=new (registry.get('pv-answer'))();host.querySelector=q;
 host.renderTypedAnswer({},answer);
 assert.equal(chart.hidden,false);assert.equal(q('.answer-status').hidden,true);
 assert.equal(chart.data.readOnly,true);assert.equal(chart.data.connected,false);
 return chart;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let raw='';for await(const chunk of process.stdin)raw+=chunk;
 const payload=JSON.parse(raw),answer=ownedAnswers(payload.answers,payload.snapshot,0,payload.now).items[0];
 assert.equal(answer.kind,'chart');const chart=renderActualChart({...answer,readConnected:true});
 const values=payload.expectedValues,rows=[...chart.items.children];assert.equal(rows.length,values.length);
 assert.deepEqual(rows.map(row=>row.children[1].value),values);
 assert.deepEqual(rows.map(row=>row.children[2].textContent),values.map(value=>`${value} ${answer.content.unit}`));
 const lower=Math.min(0,...values),upper=Math.max(lower<0?0:1,...values);
 for(const [index,row] of rows.entries()){
  const meter=row.children[1];assert.equal(meter.min,lower);assert.equal(meter.max,upper);
  assert.equal(meter.getAttribute('aria-label'),`${answer.content.items[index].label}: ${values[index]} ${answer.content.unit}`);
 }
 assert.equal(answer.content.sources[0].kind,'owner_receipt');assert.deepEqual(answer.allowedActions,[]);
 process.stdout.write(JSON.stringify({values:rows.map(row=>row.children[1].value),domain:[lower,upper],actions:[]}));
}
