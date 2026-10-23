// Shipped owner admission and image renderer; no media fetch or browser-pixel claim.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ownedAnswers,ownedSource} from '../../../podvoice/gatekeeper/static/podview/owner-answers.js';
class Element extends EventTarget {
 constructor(){super();this.children=[];this.dataset={};this.attributes=new Map();this.style={};this.classList={add(){}};this.isConnected=false;this.hidden=false;this.textContent='';}
 append(...nodes){for(const n of nodes){n.remove?.();n.parentNode=this;this.children.push(n);}}
 insertBefore(n,b){n.remove?.();n.parentNode=this;const i=this.children.indexOf(b);this.children.splice(i<0?this.children.length:i,0,n);}
 remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
 replaceWith(n){const p=this.parentNode;if(p){const i=p.children.indexOf(this);n.remove?.();p.children[i]=n;n.parentNode=p;this.parentNode=null;}}
 get src(){return this.getAttribute('src')??'';}set src(value){this.setAttribute('src',value);this.complete=false;this.naturalWidth=0;}
 setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return this.attributes.get(k)??null;}
}
const registry=new Map();globalThis.HTMLElement=Element;globalThis.customElements={define:(tag,type)=>registry.set(tag,type)};
globalThis.document={createElement(tag){const n=new (registry.get(tag)||Element)();n.localName=tag;n.tagName=tag.toUpperCase();return n;}};
await import('../../../podvoice/gatekeeper/static/podview/ui/library/visual-components.js');
export function renderAlbumCover(content,receiptId){
 const visual=document.createElement('pv-sourced-image');visual.data={state:'ready',content,ownerReceiptIds:[receiptId]};visual.isConnected=true;visual.connectedCallback();
 return visual;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let raw='';for await(const chunk of process.stdin)raw+=chunk;
 const payload=JSON.parse(raw),answer=ownedAnswers(payload.answers,payload.snapshot,0,payload.now).items[0];
 assert.equal(answer.kind,'sourced-image');assert.equal(answer.provenance.kind,'owner_sources');
 const visual=renderAlbumCover(answer.content,answer.receiptId);
 assert.equal(visual.body.hidden,false);assert.equal(visual.image.src,payload.expectedUrl);
 assert.equal(visual.image.alt,`Albumomslag til ${payload.expectedName}`);
 assert.equal(visual.captionText.textContent,payload.expectedName);assert.equal(visual.credit.textContent,'Omslag · Spotify');
 assert.equal(visual.sourceList.children.length,1);assert.equal(visual.sourceList.children[0].dataset.receiptId,answer.receiptId);
 const source=ownedSource(payload.source,answer.receiptId,payload.now,payload.snapshot);
 assert.equal(source.family,'sourced-image');assert.equal(source.sourceText,payload.source.sourceText);
 assert.ok(source.sourceText.includes(payload.expectedUri));assert.ok(source.sourceText.includes(payload.expectedUrl));
 // A current terminal decode, not a stale event from an incomplete image.
 visual.image.complete=true;visual.image.naturalWidth=0;visual.image.dispatchEvent(new Event('error'));
 assert.equal(visual.image.hidden,true);assert.equal(visual.imageError.hidden,false);
 assert.equal(visual.credit.textContent,'Omslag · Spotify');assert.equal(visual.sourceList.children.length,1);
 // A late load without decoded pixels cannot undo the failed image state.
 visual.image.dispatchEvent(new Event('load'));assert.equal(visual.image.hidden,true);assert.equal(visual.imageError.hidden,false);
 visual.image.complete=true;visual.image.naturalWidth=512;visual.image.dispatchEvent(new Event('load'));assert.equal(visual.image.hidden,false);assert.equal(visual.imageError.hidden,true);
 process.stdout.write(JSON.stringify({family:answer.kind,credit:visual.credit.textContent,source:source.sourceText,actions:answer.allowedActions}));
}
