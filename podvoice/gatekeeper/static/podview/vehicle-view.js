import {vehicleModel} from './vehicle-model.js';
const assign=(node,value)=>{const text=String(value??'');if(node.textContent!==text)node.textContent=text;};

// Existing detail anatomy: heading/context outside hero, current state,
// secondary disclosures and the shared activity-timeline. No remote controls.
export class VehicleView{
 constructor(root){
  this.root=root;const make=(tag,className,text)=>{const node=root.ownerDocument.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  this.heading=make('header','response-heading');const context=make('div');this.title=make('h1');this.context=make('p');context.append(this.title,this.context);this.heading.append(context);
  this.hero=make('section','vehicle-hero');this.hero.setAttribute('aria-label','Bilens status');
  this.status=make('p','vehicle-status');this.content=make('div','vehicle-content');
  this.metrics=make('dl','vehicle-metrics');this.batteryGroup=make('div','vehicle-metric');this.batteryLabel=make('dt',null,'Batteri');this.batteryValue=make('dd','vehicle-battery-value');this.batteryGroup.append(this.batteryLabel,this.batteryValue);
  this.rangeGroup=make('div','vehicle-metric');this.rangeLabel=make('dt',null,'Rækkevidde');this.rangeValue=make('dd','vehicle-range-value');this.rangeGroup.append(this.rangeLabel,this.rangeValue);this.metrics.append(this.batteryGroup,this.rangeGroup);
  this.rail=make('div','vehicle-battery-rail');this.meter=make('meter','vehicle-battery-meter');this.meter.min=0;this.meter.max=100;this.meter.setAttribute('aria-label','Batteriniveau');this.rail.append(this.meter);
  this.measurements=make('div','vehicle-measurements');this.measurements.append(this.metrics,this.rail);
  this.figure=make('figure','vehicle-artwork');this.image=make('img','vehicle-image');this.image.src='assets/icons/car-front.svg';this.image.alt='';this.image.width=64;this.image.height=64;this.image.decoding='async';this.image.draggable=false;
  this.onImageError=()=>{this.image.hidden=true;this.figure.dataset.imageState='missing';};this.onImageLoad=()=>{this.image.hidden=false;this.figure.dataset.imageState='ready';};this.image.addEventListener('error',this.onImageError);this.image.addEventListener('load',this.onImageLoad);this.figure.append(this.image);this.content.append(this.measurements,this.figure);this.hero.append(this.status,this.content);this.next=make('button','text-control','Til overblikket');this.next.type='button';this.onNext=()=>{const host=this.root.closest('pv-widget-host');host?.dispatch({type:'show',id:'now'});host?.focusHeading();};this.next.addEventListener('click',this.onNext);this.next.hidden=true;
  const disclosure=(title,rows)=>{const detail=make('details','device-history vehicle-disclosure'),summary=make('summary'),label=make('span',null,title),status=make('small');summary.append(label,status);const body=make('dl','vehicle-detail-values');const values=rows.map(([id,text])=>{const row=make('div'),label=make('dt',null,text),value=make('dd');row.append(label,value);body.append(row);return {id,value};});detail.append(summary,body);return {detail,status,values};};
  this.charging=disclosure('Opladning',[['connection','Ladekabel'],['power','Ladeeffekt'],['endsAt','Forventet færdig'],['limit','Ladegrænse og strømstyrke'],['control','Start og stop opladning'],['cable','Ladekabel og ladeport']]);this.climate=disclosure('Klima',[['state','Status'],['temperature','Temperatur'],['defrost','Afrimning'],['seats','Sædevarme']]);
  this.access=disclosure('Adgang',[['locks','Døre og låse'],['luggage','Bagagerum og frunk'],['windows','Vinduer']]);
  this.location=disclosure('Placering og rute',[['position','Bilens placering'],['route','Aktiv rute']]);
  this.health=disclosure('Bilens tilstand',[['tires','Dæktryk · afhænger af bilen'],['sentry','Sentry Mode'],['software','Softwareopdatering']]);
  this.more=disclosure('Flere muligheder',[['wake','Væk bilen'],['signal','Lysblink og horn'],['homelink','HomeLink · afhænger af bilen'],['keyless','Nøglefri kørsel'],['media','Bilens medieafspiller']]);
  this.capabilities=[this.access,this.location,this.health,this.more];this.secondary=make('section','vehicle-secondary');this.secondary.setAttribute('aria-label','Bilens muligheder efter tilslutning');this.secondary.append(this.charging.detail,this.climate.detail,...this.capabilities.map(group=>group.detail));
  this.history=make('section','device-history vehicle-history');this.historyTitle=make('h2',null,'Seneste hændelser');this.timeline=make('pv-activity-timeline');this.empty=make('p','robot-history-note','Ingen hændelser at vise endnu.');this.history.append(this.historyTitle,this.timeline,this.empty);
  root.classList.add('vehicle-view');root.append(this.heading,this.hero,this.secondary,this.history);this.render();
 }
 render(value){
  const model=vehicleModel(value);this.model=model;this.root.dataset.vehicleMode=model.mode;this.root.dataset.example=String(model.mode==='fixture');
  assign(this.title,model.title);assign(this.context,model.context);assign(this.status,model.mode==='unconnected'?`${model.status} · Forbindelsen mellem Home Assistant og PodView er ikke sat op.`:model.status);
  assign(this.batteryValue,model.batteryPercent===null?'—':`${model.batteryPercent} %`);assign(this.rangeValue,model.rangeKm===null?'—':`${model.rangeKm} km`);
  const known=model.batteryPercent!==null;this.rail.dataset.known=String(known);this.meter.hidden=!known;this.rail.setAttribute('aria-label',known?`Batteri ${model.batteryPercent} procent`:'Batteriniveau ukendt');
  if(known)this.meter.value=model.batteryPercent;else this.meter.removeAttribute('value');
  const disconnected=model.mode==='unconnected';this.measurements.hidden=disconnected;this.secondary.hidden=disconnected;this.history.hidden=disconnected;this.next.hidden=true;const charging=disconnected?'Kræver tilslutning':({charging:'Lader',complete:'Færdig',stopped:'Stoppet',disconnected:'Ikke tilsluttet',starting:'Starter'})[model.charging.status]||'',climate=disconnected?'Kræver tilslutning':model.climate.status==='off'?'Slukket':'Ukendt';assign(this.charging.status,charging);assign(this.climate.status,climate);
  // Read-only details show admitted observations, never a catalogue of promised controls.
  const power=Number.isFinite(model.charging.powerKw)?`${model.charging.powerKw.toLocaleString('da-DK')} kW`:null,endsAt=model.charging.status==='charging'&&Number.isFinite(model.charging.endsAt)?new Date(model.charging.endsAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}):null;
  const temperature=Number.isFinite(model.climate.temperatureC)?`${model.climate.temperatureC.toLocaleString('da-DK')} °C`:'Ikke oplyst';
  for(const {id,value}of this.charging.values){const known=({connection:charging,power,endsAt})[id];assign(value,known||'');value.parentNode.hidden=!known;}
  this.charging.detail.hidden=!charging&&!power&&!endsAt;
  for(const {id,value}of this.climate.values){assign(value,({state:climate,temperature})[id]||'Ikke oplyst');value.parentNode.hidden=!['state','temperature'].includes(id);}
  for(const group of this.capabilities){group.detail.hidden=true;assign(group.status,'Ikke oplyst');for(const {value}of group.values)assign(value,'Ikke oplyst');}
  // Until a real Tesla owner is introduced, even incoming history is ignored by
  // the model. The existing timeline remains the sole future history renderer.
  this.timeline.data={items:model.history,readOnly:true,connected:false,quietStatus:true,state:model.history.length?'ready':'empty'};this.timeline.hidden=!model.history.length;this.empty.hidden=!!model.history.length;
  return model;
 }
 cleanup(){this.next.removeEventListener('click',this.onNext);this.image.removeEventListener('error',this.onImageError);this.image.removeEventListener('load',this.onImageLoad);}
}
