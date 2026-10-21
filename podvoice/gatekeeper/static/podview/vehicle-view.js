import {vehicleModel,VEHICLE_ARTWORK} from './vehicle-model.js';
import {applyKitComponent,createKitComponent,applyKitTemplate} from './ui/kit.js';
const assign=(node,value)=>{const text=String(value??'');if(node.textContent!==text)node.textContent=text;};

// One retained detail composition: observed car, access, combined climate and
// charging facts in the Hero. Controls are explicit local previews; observations grant none.
export class VehicleView{
 constructor(root,{onAction=()=>{}}={}){
  this.root=root;applyKitTemplate(root,'detail');this.onAction=onAction;this.controlListeners=[];const make=(tag,className,text)=>{const node=root.ownerDocument.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;if(tag==='button')applyKitComponent(node,'button',{identity:'tesla',variant:className?.split(/\s+/).includes('pv-primary')?'primary':'secondary'});return node;};
  this.heading=make('header','response-heading pv-topbar');const context=make('div');this.title=make('h1');this.context=make('p');context.append(this.title);this.heading.append(context);
  this.hero=createKitComponent('hero',{document:root.ownerDocument,tag:'section',className:'vehicle-hero pv-hero',identity:'tesla'});this.hero.setAttribute('aria-label','Bilens status');this.hero.dataset.detailZone='hero';this.heroIcon=createKitComponent('icon',{document:root.ownerDocument,tag:'img',className:'--48'});this.heroIcon.src='assets/icons/car-front.svg';this.heroIcon.alt='';this.heroIcon.hidden=true;
  this.status=make('p','vehicle-status');this.connectionNote=make('p','vehicle-connection-note','Forbindelsen mellem Home Assistant og PodView er ikke sat op.');this.content=make('div','vehicle-content');
  this.metrics=make('dl','vehicle-metrics');this.batteryGroup=make('div','vehicle-metric');this.batteryLabel=make('dt',null,'Batteri');this.batteryValue=make('dd','vehicle-battery-value');this.batteryGroup.append(this.batteryLabel,this.batteryValue);
  this.rangeGroup=make('div','vehicle-metric');this.rangeLabel=make('dt',null,'Rækkevidde');this.rangeValue=make('dd','vehicle-range-value');this.rangeGroup.append(this.rangeLabel,this.rangeValue);this.powerGroup=make('div','vehicle-metric');this.powerLabel=make('dt',null,'Ladeeffekt');this.powerValue=make('dd','vehicle-charge-value');this.powerGroup.append(this.powerLabel,this.powerValue);this.finishGroup=make('div','vehicle-metric');this.finishLabel=make('dt',null,'Forventet færdig');this.finishValue=make('dd','vehicle-charge-value');this.finishGroup.append(this.finishLabel,this.finishValue);this.metrics.append(this.batteryGroup,this.rangeGroup,this.powerGroup,this.finishGroup);
  this.rail=make('div','vehicle-battery-rail');this.meter=make('meter','vehicle-battery-meter');this.meter.min=0;this.meter.max=100;this.meter.setAttribute('aria-label','Batteriniveau');this.rail.append(this.meter);
  this.measurements=make('div','vehicle-measurements');this.measurements.append(this.metrics,this.rail);
  this.figure=make('figure','vehicle-artwork');this.image=make('img','vehicle-image');this.image.alt='';this.image.width=1280;this.image.height=853;this.figure.dataset.artworkRole='illustration';this.image.decoding='async';this.image.draggable=false;
  this.onImageError=()=>{this.image.hidden=true;this.figure.dataset.imageState='missing';this.heroIcon.hidden=false;};this.onImageLoad=()=>{if(this.figure.hidden)return;this.image.hidden=false;this.heroIcon.hidden=true;this.figure.dataset.imageState='ready';};this.image.addEventListener('error',this.onImageError);this.image.addEventListener('load',this.onImageLoad);this.figure.append(this.image);this.content.append(this.figure,this.measurements);this.context.className='vehicle-context';this.hero.append(this.context,this.status,this.connectionNote,this.content,this.heroIcon);this.next=make('button','text-control pv-button','Til overblikket');this.next.type='button';this.onNext=()=>{const host=this.root.closest('pv-widget-host');host?.dispatch({type:'show',id:'now'});host?.focusHeading();};this.next.addEventListener('click',this.onNext);this.next.hidden=true;
  const disclosure=(title,rows,primary=false)=>{const detail=make(primary?'section':'details','device-history vehicle-disclosure pv-tile'),summary=make(primary?'h2':'summary',primary?'vehicle-section-heading pv-section-header':undefined),label=make('span',null,title),status=make('small');summary.append(label,status);const body=make('dl','vehicle-detail-values');const values=rows.map(([id,text])=>{const row=createKitComponent('listrow',{document:root.ownerDocument,tag:'div',className:'vehicle-fact-row'}),label=make('dt',null,text),value=make('dd');row.append(label,value);body.append(row);return {id,value};});detail.append(summary,body);return {detail,status,values,body};};
  this.climate=disclosure('Klima',[['state','Status'],['temperature','I kabinen'],['defrost','Afrimning'],['seats','Sædevarme']],true);
  this.access=disclosure('Adgang',[['locks','Døre og låse'],['luggage','Bagagerum og frunk'],['windows','Vinduer']],true);
  this.location=disclosure('Placering og rute',[['position','Bilens placering'],['route','Aktiv rute']]);
  this.health=disclosure('Bilens tilstand',[['tires','Dæktryk · afhænger af bilen'],['sentry','Sentry Mode'],['software','Softwareopdatering']]);
  this.more=disclosure('Flere muligheder',[['wake','Væk bilen'],['signal','Lysblink og horn'],['homelink','HomeLink · afhænger af bilen'],['keyless','Nøglefri kørsel'],['media','Bilens medieafspiller']]);
  const control=(parent,label,action)=>{const b=make('button','text-control pv-button',label);b.type='button';const fn=()=>{if(!this.controlsEnabled)return;this.onAction({action,revision:this.model.revision});};b.addEventListener('click',fn);this.controlListeners.push([b,'click',fn]);parent.append(b);return b;};
  this.climateToggle=control(this.climate.detail,'Tænd klima','climate');
  this.temperatureControls=make('section','vehicle-temperature-controls vehicle-control-tile pv-tile');this.temperatureControls.setAttribute('aria-label','Måltemperatur');this.temperatureControls.append(make('h3','pv-section-header','Måltemperatur'));
  this.temperatureValue=make('output');
  const adjust=delta=>{const b=make('button','text-control pv-button',delta<0?'−':'+');b.type='button';b.setAttribute('aria-label',delta<0?'Sænk temperatur':'Hæv temperatur');const fn=()=>{if(this.controlsEnabled)this.onAction({action:'temperature',value:this.model.climate.targetTemperatureC+delta,revision:this.model.revision});};b.addEventListener('click',fn);this.controlListeners.push([b,'click',fn]);return b;};
  this.temperatureDown=adjust(-1);this.temperatureUp=adjust(1);this.temperatureControls.append(this.temperatureDown,this.temperatureValue,this.temperatureUp);this.climate.detail.append(this.temperatureControls);
  this.lockControls=make('div','vehicle-lock-controls');this.access.detail.append(this.lockControls);
  this.lockButton=make('button','text-control pv-button');this.lockButton.type='button';this.lockConfirm=make('button','text-control pv-button');this.lockConfirm.type='button';this.lockCancel=make('button','text-control pv-button','Annuller');this.lockCancel.type='button';
  this.lockControls.append(this.lockButton,this.lockConfirm,this.lockCancel);
  for(const [node,fn]of [[this.lockButton,()=>{if(!this.controlsEnabled)return;this.confirmRevision=this.model.revision;this.renderControls();}],[this.lockCancel,()=>{this.confirmRevision=null;this.renderControls();}],[this.lockConfirm,()=>{if(!this.controlsEnabled||this.confirmRevision!==this.model.revision)return;const revision=this.confirmRevision;this.confirmRevision=null;this.onAction({action:'lock',confirmed:true,revision});this.renderControls();}]]){node.addEventListener('click',fn);this.controlListeners.push([node,'click',fn]);}
  this.capabilities=[this.access,this.location,this.health,this.more];this.secondary=make('section','vehicle-secondary pv-controls');this.secondary.setAttribute('aria-label','Adgang og klima');this.secondary.dataset.detailZone='controls';this.controlTiles=make('div','vehicle-control-tiles pv-tiles');for(const tile of [this.access.detail,this.climate.detail])applyKitComponent(tile,'tile',{identity:'tesla'});this.controlTiles.append(this.access.detail,this.climate.detail);this.secondary.append(this.controlTiles,...this.capabilities.filter(group=>group!==this.access).map(group=>group.detail));
  this.history=make('section','device-history vehicle-history pv-history');this.history.dataset.detailZone='history';this.historyTitle=make('h2','pv-section-header','Seneste hændelser');this.timeline=make('pv-activity-timeline');this.empty=make('p','robot-history-note','Ingen hændelser at vise endnu.');this.history.append(this.historyTitle,this.timeline,this.empty);
  root.classList.add('vehicle-view');root.append(this.heading,this.hero,this.secondary,this.history);this.render();
 }
 render(value,{connected=true}={}){
  this.connected=connected;
  const model=vehicleModel(value);this.model=model;this.root.dataset.vehicleMode=model.mode;this.root.dataset.example=String(model.mode==='fixture');this.hero.dataset.kitState=model.mode==='unconnected'?'unavailable':'ready';
  // The passive HA contract admits no vehicle model/year or artwork metadata.
  // The pinned illustration belongs only to the explicitly named local fixture.
  const showArtwork=model.mode==='fixture'&&model.modelName==='Model Y'&&model.modelYear===2023;this.figure.hidden=!showArtwork;this.heroIcon.hidden=showArtwork&&this.figure.dataset.imageState!=='missing';this.image.hidden=!showArtwork||this.figure.dataset.imageState==='missing';if(showArtwork){if(this.image.getAttribute('src')!==VEHICLE_ARTWORK)this.image.src=VEHICLE_ARTWORK;}else if(this.image.getAttribute('src')!==null){this.image.removeAttribute('src');this.figure.dataset.imageState='unavailable';}
  assign(this.title,model.title);assign(this.context,model.context);assign(this.status,model.status);this.connectionNote.hidden=model.mode!=='unconnected';this.content.hidden=model.mode==='unconnected';
  assign(this.batteryValue,model.batteryPercent===null?'—':`${model.batteryPercent} %`);this.batteryGroup.hidden=model.batteryPercent===null;assign(this.rangeValue,model.rangeKm===null?'—':`${model.rangeKm} km`);this.rangeGroup.hidden=model.rangeKm===null;
  const known=model.batteryPercent!==null;this.rail.dataset.known=String(known);this.rail.hidden=!known;this.meter.hidden=!known;this.rail.setAttribute('aria-label',known?`Batteri ${model.batteryPercent} procent`:'Batteriniveau ukendt');
  if(known)this.meter.value=model.batteryPercent;else this.meter.removeAttribute('value');
  const disconnected=model.mode==='unconnected';this.measurements.hidden=disconnected;this.secondary.hidden=disconnected;this.history.hidden=disconnected||!model.history.length;this.next.hidden=true;const climate=disconnected?'Kræver tilslutning':({off:'Slukket',heat:'Varmer',cool:'Køler',auto:'Automatisk',heat_cool:'Varme/køling',fan_only:'Ventilation',dry:'Affugtning'})[model.climate.status]||'Ukendt';assign(this.climate.status,climate);
  // Read-only details show admitted observations, never a catalogue of promised controls.
  const power=Number.isFinite(model.charging.powerKw)?`${model.charging.powerKw.toLocaleString('da-DK')} kW`:null,endsAt=model.charging.status==='charging'&&Number.isFinite(model.charging.endsAt)?new Date(model.charging.endsAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}):null;
  const temperature=Number.isFinite(model.climate.temperatureC)?`${model.climate.temperatureC.toLocaleString('da-DK')} °C`:null;
  assign(this.powerValue,power||'');this.powerGroup.hidden=power===null;assign(this.finishValue,endsAt||'');this.finishGroup.hidden=endsAt===null;this.measurements.hidden=disconnected||this.metrics.children.length>0&&[this.batteryGroup,this.rangeGroup,this.powerGroup,this.finishGroup].every(group=>group.hidden);this.content.hidden=disconnected||!showArtwork&&this.measurements.hidden;
  for(const {id,value}of this.climate.values){const known=({state:climate,temperature})[id];assign(value,known||'');value.parentNode.hidden=id!=='temperature'||!temperature;}
  this.climate.body.hidden=!temperature;this.climate.detail.hidden=!model.climate.status&&!temperature;
  for(const group of this.capabilities){group.detail.hidden=true;group.body.hidden=true;assign(group.status,'Ikke oplyst');for(const {value}of group.values){assign(value,'Ikke oplyst');value.parentNode.hidden=true;}}
  // An observed lock state is readable; it never grants a lock command.
  if(model.mode==='observed'&&typeof model.locked==='boolean'){
   this.access.detail.hidden=false;assign(this.access.status,model.locked?'Låst':'Ulåst');
   for(const {id,value}of this.access.values){value.parentNode.hidden=true;assign(value,id==='locks'?(model.locked?'Låst':'Ulåst'):'');}
  }
  // Until a real Tesla owner is introduced, even incoming history is ignored by
  // the model. The existing timeline remains the sole future history renderer.
  this.timeline.data={items:model.history,readOnly:true,connected:false,quietStatus:true,state:model.history.length?'ready':'empty'};this.timeline.hidden=!model.history.length;this.empty.hidden=!!model.history.length;
  this.renderControls();
  return model;
 }
 renderControls(){
  const m=this.model,enabled=m?.mode==='fixture'&&m.controlsPreview===true;this.controlsEnabled=enabled&&this.connected!==false;if(!this.controlsEnabled||this.confirmRevision!==m.revision)this.confirmRevision=null;
  for(const node of [this.climateToggle,this.temperatureControls,this.lockControls])node.hidden=!enabled;
  if(!enabled){this.confirmRevision=null;for(const node of [this.climateToggle,this.temperatureDown,this.temperatureUp,this.lockButton,this.lockConfirm])node.disabled=true;return;}
  this.climate.detail.hidden=false;this.access.detail.hidden=false;
  assign(this.access.status,m.locked?'Låst':'Ulåst');this.climateToggle.setAttribute('aria-pressed',String(m.climate.status!=='off'));assign(this.climateToggle,m.climate.status==='off'?'Tænd klima':'Sluk klima');assign(this.temperatureValue,`${m.climate.targetTemperatureC} °C`);
  this.temperatureDown.disabled=!this.controlsEnabled||m.climate.targetTemperatureC<=16;this.temperatureUp.disabled=!this.controlsEnabled||m.climate.targetTemperatureC>=30;this.climateToggle.disabled=!this.controlsEnabled;
  const confirm=this.controlsEnabled&&this.confirmRevision===m.revision;this.lockButton.hidden=confirm;this.lockConfirm.hidden=!confirm;this.lockCancel.hidden=!confirm;assign(this.lockButton,m.locked?'Lås op':'Lås bilen');assign(this.lockConfirm,m.locked?'Bekræft oplåsning':'Bekræft låsning');this.lockButton.disabled=!this.controlsEnabled;this.lockConfirm.disabled=!this.controlsEnabled;this.lockCancel.disabled=!this.controlsEnabled;
 }
 cleanup(){for(const [node,event,fn]of this.controlListeners)node.removeEventListener(event,fn);this.next.removeEventListener('click',this.onNext);this.image.removeEventListener('error',this.onImageError);this.image.removeEventListener('load',this.onImageLoad);}
}
