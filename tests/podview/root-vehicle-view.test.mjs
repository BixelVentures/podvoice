import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VehicleView} from '../../podvoice/gatekeeper/static/podview/vehicle-view.js';
import {vehicleFixture,unconnectedVehicleModel,vehicleModel,VEHICLE_ARTWORK} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';

class Node extends EventTarget{
 constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this._text='';this.attributes=new Map();this.dataset={};this.hidden=false;this.className='';this.classList={contains:name=>this.className.split(' ').includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');}};}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 set textContent(value){this.children=[];this._text=String(value);}
 setAttribute(key,value){this.attributes.set(key,String(value));if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
 getAttribute(key){if(key.startsWith('data-'))return this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]??null;return this.attributes.get(key)??null;}
 get src(){return this.getAttribute('src')||'';}set src(value){this.setAttribute('src',value);}
 removeAttribute(key){this.attributes.delete(key);if(key.startsWith('data-'))delete this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())];}
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

test('heading stays outside the hero while its model context precedes current state and empty battery slots',()=>{
 const {root}=fixture(),view=new VehicleView(root);assert.deepEqual(root.children.map(node=>node.className),['response-heading pv-topbar','vehicle-hero pv-hero pv-kit pv-kit-hero','vehicle-secondary pv-controls','device-history vehicle-history pv-history']);assert.equal(view.title.textContent,'Tesla');assert.equal(view.context.textContent,'Bil');assert.equal(view.context.parentNode,view.hero);assert.equal(view.hero.children[0],view.context);assert.equal(view.status.textContent,'Ikke forbundet');assert.equal(view.batteryValue.textContent,'—');assert.equal(view.rangeValue.textContent,'—');assert.equal(view.meter.hidden,true);assert.equal(view.rail.getAttribute('aria-label'),'Batteriniveau ukendt');assert.equal(descendants(view.hero).filter(node=>node.tagName==='H1').length,0);
});

test('local values use canonical hierarchy without duplicate battery percentage',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.batteryValue.textContent,'72 %');assert.equal(view.rangeValue.textContent,'312 km');assert.equal(view.meter.value,72);assert.equal(view.meter.hidden,false);assert.equal(view.status.textContent,'Parkeret · Låst');assert.equal(view.powerGroup.hidden,true);assert.equal(view.finishGroup.hidden,true);assert.equal(view.climate.status.textContent,'Slukket');assert.equal((view.hero.textContent.match(/72 %/g)||[]).length,1);assert.equal(root.dataset.example,'true');
});

test('refresh retains existing hero/disclosures/history and preserves open reading position',()=>{
 const {root}=fixture(),view=new VehicleView(root),original=[...root.children],hero=view.hero,image=view.image;view.climate.detail.open=true;view.render(vehicleFixture());view.render(unconnectedVehicleModel());assert.deepEqual(root.children,original);assert.equal(view.hero,hero);assert.equal(view.image,image);assert.equal(view.climate.detail.open,true);assert.equal(view.batteryValue.textContent,'—');assert.equal(view.rangeValue.textContent,'—');assert.equal(view.meter.hidden,true);assert.equal(view.meter.getAttribute('value'),null);assert.equal(view.status.textContent,'Ikke forbundet');assert.equal(view.climate.status.textContent,'Kræver tilslutning');assert.ok(!root.textContent.includes('Parkeret'));assert.ok(!root.textContent.includes('Låst'));
});

test('secondary disclosures are read-only and history reuses actual shared timeline',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.climate.detail.tagName,'SECTION');assert.equal(view.timeline.tagName,'PV-ACTIVITY-TIMELINE');assert.equal(view.timeline.hidden,true);assert.deepEqual(view.timeline.data.items,[]);assert.equal(view.timeline.data.readOnly,true);assert.equal(view.empty.hidden,false);assert.equal(view.history.hidden,true);assert.equal(descendants(root).filter(node=>['INPUT','SELECT'].includes(node.tagName)&&!node.disabled).length,0);assert.equal(root.textContent.includes('Lås op'),false);assert.equal(root.textContent.includes('Tesla Media Player'),false);
});

test('car is a standalone contained asset and image failure retains honest page anatomy',()=>{
 const {root}=fixture(),view=new VehicleView(root),hero=view.hero;view.render(vehicleFixture());assert.equal(view.image.src,VEHICLE_ARTWORK);assert.equal(view.image.alt,'');view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,true);assert.equal(view.figure.dataset.imageState,'missing');view.render(vehicleFixture());assert.equal(view.hero,hero);assert.equal(view.batteryValue.textContent,'72 %');view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,false);view.cleanup();view.image.dispatchEvent(new Event('error'));assert.equal(view.image.hidden,false);
});

test('new renderer never fetches a third party or implements Tesla/Spotify commands',async()=>{
 const source=await readFile(new URL('../../podvoice/gatekeeper/static/podview/vehicle-view.js',import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|https?:|lock_command|unlock_command|control_playback|setTimeout|setInterval/);
 const webp=await readFile(new URL(`../../podvoice/gatekeeper/static/podview/${VEHICLE_ARTWORK}`,import.meta.url));assert.equal(webp.toString('ascii',0,4),'RIFF');assert.equal(webp.toString('ascii',8,12),'WEBP');assert.equal(webp.toString('ascii',12,16),'VP8X');assert.equal(webp.readUIntLE(24,3)+1,1280);assert.equal(webp.readUIntLE(27,3)+1,853);assert.equal(webp[20]&16,16); // bounded WebP retains alpha
});

test('disconnected Tesla hides unsupported capability groups without invented state or executable controls',()=>{const {root}=fixture(),view=new VehicleView(root);for(const group of view.capabilities){assert.equal(group.detail.tagName,group===view.access?'SECTION':'DETAILS');assert.equal(group.detail.hidden,true);assert.equal(group.status.textContent,'Ikke oplyst');}assert.match(view.location.detail.textContent,/Aktiv rute/);assert.doesNotMatch(view.location.detail.textContent,/Send destination/);assert.equal(descendants(root).filter(node=>['INPUT','SELECT'].includes(node.tagName)&&!node.disabled).length,0);assert.equal(view.model.actions.length,0);});

test('unconnected vehicle offers one calm status without duplicating the global back action',()=>{const {root}=fixture(),events=[];root.closest=()=>({dispatch:event=>events.push(event),focusHeading(){}});const view=new VehicleView(root);assert.equal(view.measurements.hidden,true);assert.equal(view.secondary.hidden,true);assert.equal(view.history.hidden,true);assert.equal(view.next.hidden,true);assert.equal(descendants(root).includes(view.next),false);view.next.dispatchEvent(new Event('click'));assert.deepEqual(events,[{type:'show',id:'now'}]);view.render(vehicleFixture());assert.equal(view.measurements.hidden,false);assert.equal(view.secondary.hidden,false);assert.equal(view.next.hidden,true);view.cleanup();view.next.dispatchEvent(new Event('click'));assert.equal(events.length,1);});

test('read-only vehicle details expose only known Hero facts and retain no charging controls or secondary charging panel',()=>{const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());assert.equal(view.climate.values.find(row=>row.id==='state').value.textContent,'Slukket');assert.equal(view.powerGroup.hidden,true);assert.equal(view.finishGroup.hidden,true);for(const group of view.capabilities)assert.equal(group.detail.hidden,true);assert.equal(view.charging,undefined);assert.equal(descendants(root).some(node=>node.tagName==='INPUT'),false);assert.doesNotMatch(root.textContent,/Ladegrænse|Start og stop opladning|Ladekabel og ladeport/);});

test('charging Hero presents only observed power and finish and retains its fact nodes across partial updates',async()=>{const {vehicleObservation}=await import('../../podvoice/gatekeeper/static/podview/ha-home-observation.js');const {root}=fixture(),view=new VehicleView(root),observed=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_charge'],data:{batteryPercent:72,charging:{status:'charging',powerKw:11,endsAt:1800000000},climate:{}}});view.render(observed);const nodes=[...view.metrics.children];assert.equal(view.status.textContent,'Lader');assert.equal(view.powerValue.textContent,'11 kW');assert.equal(view.powerGroup.hidden,false);assert.equal(view.finishGroup.hidden,false);assert.equal(view.charging,undefined);view.render({...observed,charging:{status:'charging',powerKw:null,endsAt:null}});assert.equal(view.powerGroup.hidden,true);assert.equal(view.finishGroup.hidden,true);assert.deepEqual(view.metrics.children,nodes);});

test('admitted climate and lock readings display known values without granting control',async()=>{const {vehicleObservation}=await import('../../podvoice/gatekeeper/static/podview/ha-home-observation.js');const {root}=fixture(),view=new VehicleView(root);const data=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['climate.car','lock.car'],data:{locked:true,climate:{status:'heat',temperatureC:21},charging:{}}});view.render(data);assert.equal(view.climate.status.textContent,'Varmer');assert.equal(view.access.detail.hidden,false);assert.equal(view.access.status.textContent,'Låst');assert.equal(view.access.values.find(row=>row.id==='locks').value.textContent,'Låst');assert.deepEqual(view.model.actions,[]);assert.equal(descendants(root).filter(node=>['INPUT','SELECT'].includes(node.tagName)&&!node.disabled).length,0);view.render({...data,locked:null,climate:{status:'cool',temperatureC:22}});assert.equal(view.climate.status.textContent,'Køler');assert.equal(view.access.detail.hidden,true);});

test('preview controls commit bounded values, require lock confirmation and clean up listeners',async()=>{const {vehiclePreviewAction}=await import('../../podvoice/gatekeeper/static/podview/vehicle-model.js');const {root}=fixture();let state=vehicleFixture({controls:true});const view=new VehicleView(root,{onAction:event=>{state=vehiclePreviewAction(state,event);view.render(state);}});view.render(state);assert.equal(view.climateToggle.getAttribute('aria-pressed'),'false');view.climateToggle.dispatchEvent(new Event('click'));assert.equal(state.climate.status,'heat');assert.equal(view.climateToggle.getAttribute('aria-pressed'),'true');view.temperatureUp.dispatchEvent(new Event('click'));assert.equal(state.climate.targetTemperatureC,22);view.lockButton.dispatchEvent(new Event('click'));assert.equal(state.locked,true);assert.equal(view.lockConfirm.hidden,false);view.lockConfirm.dispatchEvent(new Event('click'));assert.equal(state.locked,false);assert.equal(descendants(root).some(node=>node.tagName==='INPUT'),false);for(const event of [{action:'charge-limit',value:101},{action:'temperature',value:15},{action:'lock'},{action:'climate',revision:0}])assert.equal(vehiclePreviewAction(state,{revision:state.revision,...event}),state);view.render(state,{connected:false});assert.equal(view.climateToggle.disabled,true);const before=state;view.climateToggle.dispatchEvent(new Event('click'));assert.equal(state,before);view.cleanup();view.render(state);view.temperatureUp.dispatchEvent(new Event('click'));assert.equal(state,before);});


test('primary vehicle controls are exposed sections and unavailable copy owns a separate full-width lane',()=>{const {root}=fixture(),view=new VehicleView(root);assert.equal(view.status.textContent,'Ikke forbundet');assert.equal(view.connectionNote.hidden,false);assert.match(view.connectionNote.textContent,/Home Assistant/);assert.equal(view.content.hidden,true);view.render(vehicleFixture({controls:true}));assert.equal(view.connectionNote.hidden,true);assert.equal(view.content.hidden,false);for(const group of [view.climate,view.access]){assert.equal(group.detail.tagName,'SECTION');assert.equal(group.detail.children[0].tagName,'H2');assert.equal(group.detail.hidden,false);}assert.equal(view.climateToggle.hidden,false);assert.equal(descendants(root).some(node=>node.tagName==='INPUT'),false);assert.equal(view.lockControls.hidden,false);assert.equal(root.children.at(-1),view.history);});

test('access and combined climate remain separate while charging facts belong to the main Hero',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture({controls:true}));
 assert.deepEqual(view.controlTiles.children,[view.access.detail,view.climate.detail]);
 assert.equal(view.temperatureControls.parentNode,view.climate.detail);assert.equal(view.secondary.children[0],view.controlTiles);assert.equal(view.secondary.children[1],view.location.detail);assert.deepEqual(view.metrics.children,[view.batteryGroup,view.rangeGroup,view.powerGroup,view.finishGroup]);
 assert.equal(view.temperatureControls.getAttribute('aria-label'),'Måltemperatur');assert.equal(view.temperatureControls.children[0].textContent,'Måltemperatur');
 assert.ok(view.controlTiles.children.every(tile=>tile.dataset.kit==='tile'&&tile.dataset.kitIdentity==='tesla'));
 assert.equal(descendants(root).some(node=>node.tagName==='INPUT'),false);assert.equal(view.temperatureDown.getAttribute('aria-label'),'Sænk temperatur');assert.equal(view.temperatureUp.getAttribute('aria-label'),'Hæv temperatur');
 assert.equal(view.powerGroup.parentNode,view.metrics);assert.equal(view.finishGroup.parentNode,view.metrics);assert.equal(root.dataset.kitTemplate,'detail');
});

test('specific Model Y artwork appears only for the explicit identified fixture and is cleared again for unconfigured state',()=>{
 const {root}=fixture(),view=new VehicleView(root),image=view.image,figure=view.figure;assert.equal(image.getAttribute('src'),null);assert.equal(figure.hidden,true);assert.equal(image.hidden,true);assert.equal(view.heroIcon.hidden,false);assert.equal(view.heroIcon.src,'assets/icons/car-front.svg');assert.equal(view.content.hidden,true);assert.equal(view.model.modelName,null);assert.equal(view.model.modelYear,null);assert.doesNotMatch(root.textContent,/Model Y|2023/);
 view.render(vehicleFixture({controls:true}));assert.equal(view.image,image);assert.equal(view.figure,figure);assert.equal(figure.hidden,false);assert.equal(image.src,VEHICLE_ARTWORK);assert.equal(image.width,1280);assert.equal(image.height,853);assert.equal(figure.dataset.artworkRole,'illustration');assert.equal(view.measurements.hidden,false);assert.equal(view.context.textContent,'Model Y · 2023');
 view.render(unconnectedVehicleModel());assert.equal(view.image,image);assert.equal(image.getAttribute('src'),null);assert.equal(figure.hidden,true);assert.equal(image.hidden,true);assert.equal(view.heroIcon.hidden,false);assert.equal(view.content.hidden,true);assert.equal(view.measurements.hidden,true);assert.equal(view.secondary.hidden,true);assert.doesNotMatch(root.textContent,/Model Y|2023/);image.dispatchEvent(new Event('load'));assert.equal(figure.hidden,true);assert.equal(image.hidden,true);assert.equal(view.heroIcon.hidden,false);assert.deepEqual(view.model.actions,[]);view.cleanup();
});


test('actual Tesla command and confirmation controls share Button recipe while observation retains their nodes',()=>{
 const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture({controls:true}));const buttons=descendants(root).filter(node=>node.tagName==='BUTTON');assert.ok(buttons.length>0);assert.ok(buttons.every(button=>button.getAttribute('data-kit')==='button'));const confirm=view.lockConfirm,climate=view.climateToggle;view.render(vehicleFixture({controls:true}));assert.equal(view.lockConfirm,confirm);assert.equal(view.climateToggle,climate);view.cleanup();
});


test('charging partial data hides unknown Hero facts without fabricating cable or finish values',async()=>{
 const {vehicleObservation}=await import('../../podvoice/gatekeeper/static/podview/ha-home-observation.js');const {root}=fixture(),view=new VehicleView(root),nodes=[...view.metrics.children];
 for(const [charging,powerKnown,finishKnown] of [[{status:'charging',powerKw:11,endsAt:1800000000},true,true],[{status:'charging'},false,false],[{status:'stopped'},false,false],[{status:'disconnected'},false,false],[{},false,false]]){
  view.render(vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_charge'],data:{charging,climate:{}}}));assert.equal(view.powerGroup.hidden,!powerKnown);assert.equal(view.finishGroup.hidden,!finishKnown);assert.equal(view.batteryGroup.hidden,true);assert.equal(view.rangeGroup.hidden,true);assert.deepEqual(view.metrics.children,nodes);assert.equal(view.charging,undefined);assert.equal(descendants(root).some(node=>node.tagName==='INPUT'),false);
 }
});

test('unknown climate and unsupported access facts never create empty control cards',async()=>{
 const {vehicleObservation}=await import('../../podvoice/gatekeeper/static/podview/ha-home-observation.js');const {root}=fixture(),view=new VehicleView(root);
 const observed=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_charge'],data:{charging:{},climate:{}}});view.render(observed);assert.equal(view.climate.detail.hidden,true);assert.equal(view.access.detail.hidden,true);
 view.render({...observed,climate:{status:'cool',temperatureC:22},locked:true});assert.equal(view.climate.detail.hidden,false);assert.equal(view.climate.body.hidden,false);assert.deepEqual(view.climate.values.filter(row=>!row.value.parentNode.hidden).map(row=>row.id),['temperature']);assert.equal(view.climate.values.find(row=>row.id==='temperature').value.textContent,'22 °C');assert.equal(view.access.status.textContent,'Låst');assert.equal(view.access.body.hidden,true);assert.equal(view.climateToggle.hidden,true);assert.equal(view.temperatureControls.hidden,true);
 view.render(vehicleFixture({controls:true}));for(const group of [view.access,view.location,view.health,view.more])for(const {value}of group.values)assert.equal(value.parentNode.hidden,true);assert.equal(view.access.body.hidden,true);
});

test('lock confirmation is revoked by a revision change or lost connection',()=>{
 const {root}=fixture(),events=[],view=new VehicleView(root,{onAction:event=>events.push(event)}),model=vehicleFixture({controls:true});view.render(model);
 view.lockButton.dispatchEvent(new Event('click'));assert.equal(view.lockConfirm.hidden,false);view.render({...model,revision:2});view.lockConfirm.dispatchEvent(new Event('click'));assert.deepEqual(events,[]);assert.equal(view.lockConfirm.hidden,true);
 view.lockButton.dispatchEvent(new Event('click'));view.render({...model,revision:2},{connected:false});view.render({...model,revision:2});assert.equal(view.lockConfirm.hidden,true);view.lockConfirm.dispatchEvent(new Event('click'));assert.deepEqual(events,[]);
 view.lockButton.dispatchEvent(new Event('click'));view.lockCancel.dispatchEvent(new Event('click'));assert.equal(view.lockConfirm.hidden,true);assert.deepEqual(events,[]);
});

test('admitted passive readings never infer a car model, year or specific artwork from unadmitted metadata',async()=>{
 const {vehicleObservation}=await import('../../podvoice/gatekeeper/static/podview/ha-home-observation.js');const {root}=fixture(),view=new VehicleView(root);view.render(vehicleFixture());const observed=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_battery'],data:{batteryPercent:61,modelName:'Model 3',modelYear:2025,artwork:VEHICLE_ARTWORK,charging:{},climate:{}}});assert.equal(observed.modelName,undefined);assert.equal(observed.modelYear,undefined);assert.equal(observed.artwork,undefined);view.render(observed);assert.equal(view.model.mode,'observed');assert.equal(view.context.textContent,'Home Assistant');assert.equal(view.batteryValue.textContent,'61 %');assert.equal(view.content.hidden,false);assert.equal(view.figure.hidden,true);assert.equal(view.image.hidden,true);assert.equal(view.image.getAttribute('src'),null);assert.equal(view.heroIcon.hidden,false);assert.doesNotMatch(root.textContent,/Model Y|Model 3|2023|2025/);view.image.dispatchEvent(new Event('load'));assert.equal(view.image.hidden,true);assert.deepEqual(view.model.actions,[]);
});
