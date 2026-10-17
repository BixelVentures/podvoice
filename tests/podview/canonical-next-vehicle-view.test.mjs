import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VehicleView} from '../../podvoice/gatekeeper/static/podview/vehicle-view.js';
import {vehicleFixture,unconnectedVehicleModel,vehicleModel,VEHICLE_ARTWORK} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';

class Node extends EventTarget{
 constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this._text='';this.attributes=new Map();this.dataset={};this.hidden=false;this.className='';this.classList={add:value=>{this.className+=` ${value}`;}};}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 set textContent(value){this.children=[];this._text=String(value);}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 getAttribute(key){return this.attributes.get(key)??null;}
 removeAttribute(key){this.attributes.delete(key);}
}
const fixture=()=>{const doc={createElement:tag=>new Node(doc,tag)};return {doc,root:doc.createElement('section')};};
const descendants=node=>[node,...node.children.flatMap(descendants)];

test('explicit local fixture has selected72/312 values and no remote authority',()=>{
 const data=vehicleFixture();assert.equal(data.batteryPercent,72);assert.equal(data.rangeKm,312);assert.equal(data.status,'Parkeret · Låst');assert.equal(data.mode,'fixture');assert.equal(data.context,'Model Y · 2023');assert.deepEqual(data.actions,[]);
 data.charging.status='charging';assert.equal(vehicleFixture().charging.status,'disconnected');
});

test('all unsupported live-shaped input fails closed without false car state',()=>{
 for(const input of [undefined,null,{}, {mode:'live',kind:'vehicle',status:'Parkeret · Låst',batteryPercent:100,locked:true,history:[{label:'Låst'}]}, {mode:'observed',batteryPercent:72}]){
  const model=vehicleModel(input);assert.equal(model.mode,'unconnected');assert.equal(model.batteryPercent,null);assert.equal(model.rangeKm,null);assert.equal(model.parked,null);assert.equal(model.locked,null);assert.equal(model.climate.status,null);assert.deepEqual(model.history,[]);assert.deepEqual(model.actions,[]);
 }
});

test('heading and context precede hero; model supplies real-empty battery slots',()=>{
 const {root}=fixture(),view=new VehicleView(root);assert.deepEqual(root.children.map(node=>node.className),['response-heading','vehicle-hero','vehicle-secondary','device-history vehicle-history']);assert.equal(view.title.textContent,'Tesla');assert.equal(view.context.textContent,'Model Y · 2023');assert.equal(view.status.textContent,'Ikke tilsluttet endnu');assert.equal(view.batteryValue.textContent,'—');assert.equal(view.rangeValue.textContent,'—');assert.equal(view.meter.hidden,true);assert.equal(view.rail.getAttribute('aria-label'),'Batteriniveau ukendt');assert.equal(descendants(view.hero).filter(node=>node.tagName==='H1').length,0);
});

test('local values use canonical hierarchy without duplicate battery percentage',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.batteryValue.textContent,'72 %');assert.equal(view.rangeValue.textContent,'312 km');assert.equal(view.meter.value,72);assert.equal(view.meter.hidden,false);assert.equal(view.status.textContent,'Parkeret · Låst');assert.equal(view.charging.status.textContent,'Ikke tilsluttet');assert.equal(view.climate.status.textContent,'Slukket');assert.equal((view.hero.textContent.match(/72 %/g)||[]).length,1);assert.equal(root.dataset.example,'true');
});

test('refresh retains existing hero/disclosures/history and preserves open reading position',()=>{
 const {root}=fixture(),view=new VehicleView(root),original=[...root.children],hero=view.hero,image=view.image;view.charging.detail.open=true;view.climate.detail.open=true;view.render(vehicleFixture());view.render(unconnectedVehicleModel());assert.deepEqual(root.children,original);assert.equal(view.hero,hero);assert.equal(view.image,image);assert.equal(view.charging.detail.open,true);assert.equal(view.climate.detail.open,true);assert.equal(view.batteryValue.textContent,'—');assert.equal(view.rangeValue.textContent,'—');assert.equal(view.meter.hidden,true);assert.equal(view.meter.getAttribute('value'),null);assert.equal(view.status.textContent,'Ikke tilsluttet endnu');assert.equal(view.climate.status.textContent,'Ukendt');assert.ok(!root.textContent.includes('Parkeret'));assert.ok(!root.textContent.includes('Låst'));
});

test('secondary disclosures are read-only and history reuses actual shared timeline',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.charging.detail.tagName,'DETAILS');assert.equal(view.climate.detail.tagName,'DETAILS');assert.equal(view.timeline.tagName,'PV-ACTIVITY-TIMELINE');assert.equal(view.timeline.hidden,true);assert.deepEqual(view.timeline.data.items,[]);assert.equal(view.timeline.data.readOnly,true);assert.equal(view.empty.hidden,false);assert.equal(descendants(root).filter(node=>['BUTTON','INPUT','SELECT'].includes(node.tagName)).length,0);assert.equal(root.textContent.includes('Lås op'),false);assert.equal(root.textContent.includes('Tesla Media Player'),false);
});

test('car is a standalone contained asset and image failure retains honest page anatomy',()=>{
 const {root}=fixture(),view=new VehicleView(root),hero=view.hero;assert.equal(view.image.src,VEHICLE_ARTWORK);assert.equal(view.image.alt,'Illustration af en grå Tesla Model Y fra 2023');view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,true);assert.equal(view.figure.dataset.imageState,'missing');view.render(vehicleFixture());assert.equal(view.hero,hero);assert.equal(view.batteryValue.textContent,'72 %');view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,false);view.cleanup();view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,false);
});

test('new renderer never fetches a third party or implements Tesla/Spotify commands',async()=>{
 const source=await readFile(new URL('../../podvoice/gatekeeper/static/podview/vehicle-view.js',import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|https?:|lock_command|unlock_command|control_playback|setTimeout|setInterval/);
 const png=await readFile(new URL(`../../podvoice/gatekeeper/static/podview/${VEHICLE_ARTWORK}`,import.meta.url));assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),1536);assert.equal(png.readUInt32BE(20),1024);assert.equal(png[25],6); // actual RGBA PNG
});
