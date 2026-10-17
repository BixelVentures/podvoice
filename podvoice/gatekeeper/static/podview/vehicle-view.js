import {VEHICLE_ARTWORK,vehicleModel} from './vehicle-model.js';
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
  this.figure=make('figure','vehicle-artwork');this.image=make('img','vehicle-image');this.image.src=VEHICLE_ARTWORK;this.image.alt='Illustration af en grå Tesla Model Y fra 2023';this.image.width=1536;this.image.height=1024;this.image.decoding='async';this.image.draggable=false;
  this.onImageError=()=>{this.image.hidden=true;this.figure.dataset.imageState='missing';};this.onImageLoad=()=>{this.image.hidden=false;this.figure.dataset.imageState='ready';};this.image.addEventListener('error',this.onImageError);this.image.addEventListener('load',this.onImageLoad);this.figure.append(this.image);this.content.append(this.measurements,this.figure);this.hero.append(this.status,this.content);
  const disclosure=(title,rows)=>{const detail=make('details','device-history vehicle-disclosure'),summary=make('summary'),label=make('span',null,title),status=make('small');summary.append(label,status);const body=make('dl','vehicle-detail-values');const values=rows.map(([id,text])=>{const row=make('div'),label=make('dt',null,text),value=make('dd');row.append(label,value);body.append(row);return {id,value};});detail.append(summary,body);return {detail,status,values};};
  this.charging=disclosure('Opladning',[['connection','Tilslutning'],['power','Ladeeffekt']]);this.climate=disclosure('Klima',[['state','Status'],['temperature','Temperatur']]);this.secondary=make('section','vehicle-secondary');this.secondary.setAttribute('aria-label','Opladning og klima');this.secondary.append(this.charging.detail,this.climate.detail);
  this.history=make('section','device-history vehicle-history');this.historyTitle=make('h2',null,'Seneste hændelser');this.timeline=make('pv-activity-timeline');this.empty=make('p','robot-history-note','Ingen hændelser at vise endnu.');this.history.append(this.historyTitle,this.timeline,this.empty);
  root.classList.add('vehicle-view');root.append(this.heading,this.hero,this.secondary,this.history);this.render();
 }
 render(value){
  const model=vehicleModel(value);this.model=model;this.root.dataset.vehicleMode=model.mode;this.root.dataset.example=String(model.mode==='fixture');
  assign(this.title,model.title);assign(this.context,model.context);assign(this.status,model.status);
  assign(this.batteryValue,model.batteryPercent===null?'—':`${model.batteryPercent} %`);assign(this.rangeValue,model.rangeKm===null?'—':`${model.rangeKm} km`);
  const known=model.batteryPercent!==null;this.rail.dataset.known=String(known);this.meter.hidden=!known;this.rail.setAttribute('aria-label',known?`Batteri ${model.batteryPercent} procent`:'Batteriniveau ukendt');
  if(known)this.meter.value=model.batteryPercent;else this.meter.removeAttribute('value');
  const charging=model.charging.status==='disconnected'?'Ikke tilsluttet':'Ukendt',climate=model.climate.status==='off'?'Slukket':'Ukendt';assign(this.charging.status,charging);assign(this.climate.status,climate);
  for(const {id,value}of this.charging.values)assign(value,id==='connection'?charging:'—');for(const {id,value}of this.climate.values)assign(value,id==='state'?climate:'—');
  // Until a real Tesla owner is introduced, even incoming history is ignored by
  // the model. The existing timeline remains the sole future history renderer.
  this.timeline.data={items:model.history,readOnly:true,connected:false,quietStatus:true,state:model.history.length?'ready':'empty'};this.timeline.hidden=!model.history.length;this.empty.hidden=!!model.history.length;
  return model;
 }
 cleanup(){this.image.removeEventListener('error',this.onImageError);this.image.removeEventListener('load',this.onImageLoad);}
}
