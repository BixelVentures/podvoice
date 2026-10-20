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
 const {root}=fixture(),view=new VehicleView(root);assert.deepEqual(root.children.map(node=>node.className),['response-heading','vehicle-hero','vehicle-secondary','device-history vehicle-history']);assert.equal(view.title.textContent,'Tesla');assert.equal(view.context.textContent,'Model Y · 2023');assert.equal(view.status.textContent,'Ikke forbundet · Forbindelsen mellem Home Assistant og PodView er ikke sat op.');assert.equal(view.batteryValue.textContent,'—');assert.equal(view.rangeValue.textContent,'—');assert.equal(view.meter.hidden,true);assert.equal(view.rail.getAttribute('aria-label'),'Batteriniveau ukendt');assert.equal(descendants(view.hero).filter(node=>node.tagName==='H1').length,0);
});

test('local values use canonical hierarchy without duplicate battery percentage',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.batteryValue.textContent,'72 %');assert.equal(view.rangeValue.textContent,'312 km');assert.equal(view.meter.value,72);assert.equal(view.meter.hidden,false);assert.equal(view.status.textContent,'Parkeret · Låst');assert.equal(view.charging.status.textContent,'Ikke tilsluttet');assert.equal(view.climate.status.textContent,'Slukket');assert.equal((view.hero.textContent.match(/72 %/g)||[]).length,1);assert.equal(root.dataset.example,'true');
});

test('refresh retains existing hero/disclosures/history and preserves open reading position',()=>{
 const {root}=fixture(),view=new VehicleView(root),original=[...root.children],hero=view.hero,image=view.image;view.charging.detail.open=true;view.climate.detail.open=true;view.render(vehicleFixture());view.render(unconnectedVehicleModel());assert.deepEqual(root.children,original);assert.equal(view.hero,hero);assert.equal(view.image,image);assert.equal(view.charging.detail.open,true);assert.equal(view.climate.detail.open,true);assert.equal(view.batteryValue.textContent,'—');assert.equal(view.rangeValue.textContent,'—');assert.equal(view.meter.hidden,true);assert.equal(view.meter.getAttribute('value'),null);assert.equal(view.status.textContent,'Ikke forbundet · Forbindelsen mellem Home Assistant og PodView er ikke sat op.');assert.equal(view.climate.status.textContent,'Kræver tilslutning');assert.ok(!root.textContent.includes('Parkeret'));assert.ok(!root.textContent.includes('Låst'));
});

test('secondary disclosures are read-only and history reuses actual shared timeline',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.charging.detail.tagName,'DETAILS');assert.equal(view.climate.detail.tagName,'DETAILS');assert.equal(view.timeline.tagName,'PV-ACTIVITY-TIMELINE');assert.equal(view.timeline.hidden,true);assert.deepEqual(view.timeline.data.items,[]);assert.equal(view.timeline.data.readOnly,true);assert.equal(view.empty.hidden,false);assert.equal(descendants(root).filter(node=>['INPUT','SELECT'].includes(node.tagName)).length,0);assert.equal(root.textContent.includes('Lås op'),false);assert.equal(root.textContent.includes('Tesla Media Player'),false);
});

test('car is a standalone contained asset and image failure retains honest page anatomy',()=>{
 const {root}=fixture(),view=new VehicleView(root),hero=view.hero;assert.equal(view.image.src,'assets/icons/car-front.svg');assert.equal(view.image.alt,'');view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,true);assert.equal(view.figure.dataset.imageState,'missing');view.render(vehicleFixture());assert.equal(view.hero,hero);assert.equal(view.batteryValue.textContent,'72 %');view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,false);view.cleanup();view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,false);
});

test('new renderer never fetches a third party or implements Tesla/Spotify commands',async()=>{
 const source=await readFile(new URL('../../podvoice/gatekeeper/static/podview/vehicle-view.js',import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|https?:|lock_command|unlock_command|control_playback|setTimeout|setInterval/);
 const webp=await readFile(new URL(`../../podvoice/gatekeeper/static/podview/${VEHICLE_ARTWORK}`,import.meta.url));assert.equal(webp.toString('ascii',0,4),'RIFF');assert.equal(webp.toString('ascii',8,12),'WEBP');assert.equal(webp.toString('ascii',12,16),'VP8X');assert.equal(webp.readUIntLE(24,3)+1,1280);assert.equal(webp.readUIntLE(27,3)+1,853);assert.equal(webp[20]&16,16); // bounded WebP retains alpha
});

test('disconnected Tesla hides unsupported capability groups without invented state or executable controls',()=>{const {root}=fixture(),view=new VehicleView(root);for(const group of view.capabilities){assert.equal(group.detail.tagName,'DETAILS');assert.equal(group.detail.hidden,true);assert.equal(group.status.textContent,'Ikke oplyst');}assert.match(view.location.detail.textContent,/Aktiv rute/);assert.doesNotMatch(view.location.detail.textContent,/Send destination/);assert.equal(descendants(root).filter(node=>['INPUT','SELECT'].includes(node.tagName)).length,0);assert.equal(view.model.actions.length,0);});

test('unconnected vehicle offers one calm status without duplicating the global back action',()=>{const {root}=fixture(),events=[];root.closest=()=>({dispatch:event=>events.push(event),focusHeading(){}});const view=new VehicleView(root);assert.equal(view.measurements.hidden,true);assert.equal(view.secondary.hidden,true);assert.equal(view.history.hidden,true);assert.equal(view.next.hidden,true);assert.equal(descendants(root).includes(view.next),false);view.next.dispatchEvent(new Event('click'));assert.deepEqual(events,[{type:'show',id:'now'}]);view.render(vehicleFixture());assert.equal(view.measurements.hidden,false);assert.equal(view.secondary.hidden,false);assert.equal(view.next.hidden,true);view.cleanup();view.next.dispatchEvent(new Event('click'));assert.equal(events.length,1);});

 test('read-only vehicle details present observations and hide unimplemented controls',()=>{const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.charging.values.find(row=>row.id==='connection').value.textContent,'Ikke tilsluttet');assert.equal(view.climate.values.find(row=>row.id==='state').value.textContent,'Slukket');assert.equal(view.charging.values.find(row=>row.id==='power').value.textContent,'');for(const group of view.capabilities)assert.equal(group.detail.hidden,true);for(const id of ['limit','control','cable'])assert.equal(view.charging.values.find(row=>row.id===id).value.parentNode.hidden,true);assert.doesNotMatch(root.textContent,/Vælg hvor meget|Afrim bilen|Se og ændr|Kontakt bilen/);});

test('charging detail presents known charging state, power and finish without contradictory unknown rows',async()=>{const {vehicleObservation}=await import('../../podvoice/gatekeeper/static/podview/ha-home-observation.js');const {root}=fixture(),view=new VehicleView(root),observed=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_charge'],data:{batteryPercent:72,charging:{status:'charging',powerKw:11,endsAt:1800000000},climate:{}}});view.render(observed);assert.equal(view.charging.status.textContent,'Lader');assert.equal(view.charging.values.find(row=>row.id==='power').value.textContent,'11 kW');assert.equal(view.charging.values.find(row=>row.id==='endsAt').value.parentNode.hidden,false);assert.doesNotMatch(view.charging.detail.textContent,/Ukendt|Ikke oplyst/);view.render({...observed,charging:{status:'charging',powerKw:null,endsAt:null}});assert.equal(view.charging.values.find(row=>row.id==='power').value.parentNode.hidden,true);assert.equal(view.charging.values.find(row=>row.id==='endsAt').value.parentNode.hidden,true);});
