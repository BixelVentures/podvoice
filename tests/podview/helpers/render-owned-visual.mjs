// Tiny DOM adapter: execute the shipped admission + Web Component renderer with
// the actual Python owner's serialized payload. This is not browser/pixel QA.
import assert from 'node:assert/strict';
import {ownedAnswers} from '../../../podvoice/gatekeeper/static/podview/owner-answers.js';
class Element extends EventTarget {
 constructor(){super();this.children=[];this.dataset={};this.attributes=new Map();this.classList={add(){}};this.isConnected=false;this.hidden=false;this.textContent='';}
 append(...nodes){for(const n of nodes){n.remove?.();n.parentNode=this;this.children.push(n);}}
 insertBefore(n,b){n.remove?.();n.parentNode=this;const i=this.children.indexOf(b);this.children.splice(i<0?this.children.length:i,0,n);}
 remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
 replaceWith(n){const p=this.parentNode;if(p){const i=p.children.indexOf(this);n.remove?.();p.children[i]=n;n.parentNode=p;this.parentNode=null;}}
 setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return this.attributes.get(k)??null;}
}
const registry=new Map();globalThis.HTMLElement=Element;globalThis.customElements={define:(tag,type)=>registry.set(tag,type)};
globalThis.document={createElement(tag){const n=new (registry.get(tag)||Element)();n.localName=tag;n.tagName=tag.toUpperCase();return n;}};
await import('../../../podvoice/gatekeeper/static/podview/ui/library/visual-components.js');
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const payload=JSON.parse(raw),answer=ownedAnswers(payload.answers,payload.snapshot,0,payload.now).items[0];
assert.equal(answer.kind,'fact-card');
const visual=document.createElement('pv-fact-card');visual.data={state:'ready',content:answer.content,ownerReceiptIds:answer.ownerReceiptIds};visual.isConnected=true;visual.connectedCallback();
assert.equal(visual.body.hidden,false);assert.equal(visual.summary.textContent,payload.expectedQuery);assert.equal(visual.rows.size,1);
assert.equal([...visual.rows.values()][0].children[1].textContent,payload.expectedValue);
assert.equal(answer.content.sources[0].kind,'owner_receipt');assert.equal(answer.content.sources[0].url,undefined);
process.stdout.write(JSON.stringify({fact:payload.expectedValue,readOnly:true,actions:answer.allowedActions||[]}));
