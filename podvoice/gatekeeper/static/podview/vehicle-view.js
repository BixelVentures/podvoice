import {vehicleModel,vehicleChargeUpdate,vehicleUpdatedLabel,VEHICLE_ARTWORK} from './vehicle-model.js';
import {syncKitPowerToggle,syncKitButtonContent,applyKitTextRole,applyKitComponent,createKitComponent,applyKitTemplate,applyKitDialog,createKitDisclosure,createKitChoiceGroup} from './ui/kit.js';
const assign=(node,value)=>{const text=String(value??'');if(node.dataset?.kitContent==='icon-label'){syncKitButtonContent(node,{label:text});return;}if(node.textContent!==text)node.textContent=text;};

const historicalField=(model,field,connected)=>model.stale===true||connected===false||(model.historicalFields||[]).includes(field);

const climateDependents=new Set(['temperature','defrostOn','defrostOff','driverSeatHeat','passengerSeatHeat']);
const unlockTitle='Lås bilen op?';
const unlockConsequence='Bilen låses op. Den låses ikke automatisk igen herfra.';
const liveClimateActive=model=>!!model&&!model.stale&&!(model.historicalFields||[]).includes('climate.status')&&['heat','cool','auto','heat_cool','fan_only','dry'].includes(model.climate?.status);

const activeClimateModes=new Set(['heat','cool','auto','heat_cool','fan_only','dry']);
const vehicleActionFamily=action=>action==='rearTrunkToggle'?'trunk':
 action==='lock'||action==='unlock'?'lock':'climate';
// HA's clock (last_changed) and the screen's clock can differ by a few seconds.
// The field must still be newer than what was shown before the tap.
const CLOCK_SKEW_S=30;
const liveVehicleEffects={
 lock:['locked',()=>true,model=>model.locked,'Låser…','Bilen er låst.'],
 unlock:['locked',()=>false,model=>model.locked,'Låser op…','Bilen er låst op.'],
 rearTrunkToggle:['trunk',args=>args.direction==='open'?'open':'closed',model=>model.access.rearTrunk,
  args=>args.direction==='open'?'Åbner bagagerum…':'Lukker bagagerum…',
  args=>args.direction==='open'?'Bagagerummet er åbent.':'Bagagerummet er lukket.'],
 climateOn:['climate.status',()=>true,model=>activeClimateModes.has(model.climate.status)||undefined,'Tænder…','Klimaet er tændt.'],
 climateOff:['climate.status',()=>true,model=>model.climate.status==='off'||undefined,'Slukker…','Klimaet er slukket.'],
 temperature:['climate.targetTemperatureC',args=>args.temperature,model=>model.climate.targetTemperatureC,'Ændrer temperatur…',
  args=>`Måltemperaturen er ${args.temperature?.toLocaleString('da-DK')} °C.`],
 defrostOn:['climate.defrost',()=>true,model=>model.climate.defrost,'Afrimer…','Afrimningen er tændt.'],
 defrostOff:['climate.defrost',()=>false,model=>model.climate.defrost,'Stopper afrimning…','Afrimningen er slukket.'],
 driverSeatHeat:['climate.driverSeatHeat',args=>args.option,model=>model.climate.driverSeatHeat,'Ændrer sædevarme…','Førerens sædevarme er opdateret.'],
 passengerSeatHeat:['climate.passengerSeatHeat',args=>args.option,model=>model.climate.passengerSeatHeat,'Ændrer sædevarme…','Passagerens sædevarme er opdateret.'],
};

// One retained detail composition: observed car, access, combined climate and
// charging facts in the Hero. Controls are explicit local previews; observations grant none.
export class VehicleView{
 constructor(root,{onAction=()=>{},onVehicleSetup=async()=>null,onVehicleSend=async()=>({status:'failed'}),onVehicleCancel=()=>{}}={}){
  this.onVehicleSetup=onVehicleSetup;this.onVehicleSend=onVehicleSend;this.onVehicleCancel=onVehicleCancel;this.root=root;this.liveVehicleCommands=new Map();this.liveVehicleFeedback=new Map();this.liveVehicleFeedbackNotes=new Set();applyKitTemplate(root,'detail');this.onAction=onAction;this.controlListeners=[];const make=(tag,className,text)=>{const node=root.ownerDocument.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;if(tag==='button')applyKitComponent(node,'button',{identity:'neutral',variant:className?.split(/\s+/).includes('pv-primary')?'primary':'secondary'});return node;};
  this.heading=make('header','response-heading pv-topbar');const context=make('div');this.title=make('h1');this.context=make('figcaption');context.append(this.title);this.heading.append(context);
  this.hero=createKitComponent('hero',{document:root.ownerDocument,tag:'section',className:'vehicle-hero pv-hero',identity:'tesla'});this.hero.setAttribute('aria-label','Bilens status');this.hero.dataset.detailZone='hero';this.heroIcon=createKitComponent('icon',{document:root.ownerDocument,tag:'img',className:'--48'});this.heroIcon.src='assets/icons/car-front.svg';this.heroIcon.alt='';this.heroIcon.dataset.kitSlot='icon';this.heroIcon.hidden=true;
  this.status=make('h2','vehicle-status');this.status.dataset.kitSlot='title';this.connectionNote=make('p','vehicle-connection-note','Forbind bilen i Home Assistant for at se status her.');this.connectionNote.dataset.kitSlot='body';this.content=make('div','vehicle-content');
  this.metrics=make('dl','vehicle-metrics');this.batteryGroup=make('div','vehicle-metric');this.batteryLabel=make('dt',null,'Batteri');this.batteryValue=make('dd','vehicle-battery-value');this.batteryGroup.append(this.batteryLabel,this.batteryValue);
  this.rangeGroup=make('div','vehicle-metric');this.rangeLabel=make('dt',null,'Rækkevidde');this.rangeValue=make('dd','vehicle-range-value');this.rangeGroup.append(this.rangeLabel,this.rangeValue);this.powerGroup=make('div','vehicle-metric');this.powerLabel=make('dt',null,'Ladeeffekt');this.powerValue=make('dd','vehicle-charge-value');this.powerGroup.append(this.powerLabel,this.powerValue);this.finishGroup=make('div','vehicle-metric');this.finishLabel=make('dt',null,'Forventet færdig');this.finishValue=make('dd','vehicle-charge-value');this.finishGroup.append(this.finishLabel,this.finishValue);this.metrics.append(this.batteryGroup,this.rangeGroup,this.powerGroup,this.finishGroup);
  this.rail=make('div','vehicle-battery-rail');this.meter=make('meter','vehicle-battery-meter');this.meter.min=0;this.meter.max=100;this.meter.setAttribute('aria-label','Batteriniveau');this.rail.append(this.meter);
  this.measurements=make('div','vehicle-measurements');this.measurements.append(this.metrics,this.rail);
  this.figure=make('figure','vehicle-artwork');this.image=make('img','vehicle-image');this.image.alt='';this.image.width=1280;this.image.height=853;this.figure.dataset.artworkRole='illustration';this.image.decoding='async';this.image.draggable=false;
  this.onImageError=()=>{this.image.hidden=true;this.figure.dataset.imageState='missing';this.heroIcon.hidden=false;};this.onImageLoad=()=>{if(this.figure.hidden)return;this.image.hidden=false;this.heroIcon.hidden=true;this.figure.dataset.imageState='ready';};this.image.addEventListener('error',this.onImageError);this.image.addEventListener('load',this.onImageLoad);this.figure.append(this.image,this.context);this.content.append(this.figure,this.measurements);this.context.className='vehicle-context';this.hero.append(this.status,this.connectionNote,this.content,this.heroIcon);this.next=make('button','text-control pv-button','Til overblikket');this.next.type='button';this.onNext=()=>{const host=this.root.closest('pv-widget-host');host?.dispatch({type:'show',id:'now'});host?.focusHeading();};this.next.addEventListener('click',this.onNext);this.next.hidden=true;
  const disclosure=(title,rows,primary=false)=>{const detail=make(primary?'section':'details','device-history vehicle-disclosure pv-tile'),summary=make(primary?'h2':'summary',primary?'vehicle-section-heading pv-section-header':undefined),label=make('span',null,title),status=make('small');summary.append(label,status);const body=make('dl','vehicle-detail-values');const values=rows.map(([id,text])=>{const row=createKitComponent('listrow',{document:root.ownerDocument,tag:'div',className:'vehicle-fact-row'}),label=make('dt',null,text),value=make('dd');row.append(label,value);body.append(row);return {id,value};});applyKitTextRole(label,'section-title');applyKitTextRole(status,'body');detail.append(summary,body);return {detail,status,values,body};};
  this.climate=disclosure('Klima',[['state','Status'],['temperature','I kabinen'],['defrost','Afrimning'],['seats','Sædevarme']],true);
  this.access=disclosure('Adgang',[['locks','Døre og låse'],['luggage','Bagagerum'],['windows','Vinduer']],true);
  this.access.detail.dataset.vehicleSection='access';
  this.health=disclosure('Bilens tilstand',[['tires','Dæktryk · afhænger af bilen'],['sentry','Sentry Mode'],['software','Softwareopdatering']]);
  this.more=disclosure('Flere muligheder',[['wake','Væk bilen'],['signal','Lysblink og horn'],['homelink','HomeLink · afhænger af bilen'],['keyless','Nøglefri kørsel'],['media','Bilens medieafspiller']]);
  const control=(parent,label,action)=>{const b=createKitComponent('toggle',{document:root.ownerDocument,variant:'power'});b.type='button';const fn=()=>{if(this.model?.mode==='observed'){const c=this.model.climate.status;if(this.connected!==false&&c!==null){const offered=c==='off'?'climateOn':'climateOff';if(this.vehicleActions?.includes(offered))this.beginVehicle(offered,b);}return;}if(!this.controlsEnabled)return;this.requestConfirmation({action,value:this.model.climate.status==='off'},b);};b.addEventListener('click',fn);this.controlListeners.push([b,'click',fn]);parent.append(b);return b;};
  this.climateToggle=control(this.climate.detail,'Tænd','climate');this.climate.detail.children[0].dataset.kitSlot='header';this.climateToggle.dataset.kitSlot='header-action';
  this.temperatureControls=make('section','vehicle-temperature-controls vehicle-control-tile pv-tile');this.temperatureControls.setAttribute('aria-label','Måltemperatur');
  this.temperatureValue=make('output');
  const adjust=delta=>{const b=make('button','text-control pv-button',delta<0?'−':'+');b.type='button';applyKitComponent(b,'button',{variant:'icon'});syncKitButtonContent(b,{label:delta<0?'−':'+'});b.setAttribute('aria-label',delta<0?'Sænk temperatur':'Hæv temperatur');const fn=()=>{if(b.disabled)return;if(this.model?.mode==='observed'&&this.vehicleActions?.includes('temperature')){const c=this.model.climate,v=c.targetTemperatureC+delta*0.5;if(c.temperatureStepC===0.5&&Number.isFinite(c.minTemperatureC)&&Number.isFinite(c.maxTemperatureC)&&Number.isFinite(c.targetTemperatureC)&&v>=c.minTemperatureC&&v<=c.maxTemperatureC)this.beginVehicle('temperature',b,{temperature:v});return;}if(this.settingsEnabled){this.draft.temperatureC=Math.max(16,Math.min(30,this.model.climate.targetTemperatureC+delta));this.sendAction({action:'climate-settings',temperatureC:this.draft.temperatureC,seats:{...this.model.climate.seats},confirmed:true,revision:this.model.revision},b);}};b.addEventListener('click',fn);this.controlListeners.push([b,'click',fn]);return b;};
  this.temperatureDown=adjust(-1);this.temperatureUp=adjust(1);this.temperatureControls.append(this.temperatureDown,this.temperatureValue,this.temperatureUp);this.climate.detail.append(this.temperatureControls);
  this.liveVehicleButtons={};for(const [action,label,parent]of [['lock','Lås bilen',this.access.detail],['unlock','Lås op',this.access.detail],['climateOn','Tænd klima',this.climate.detail],['climateOff','Sluk klima',this.climate.detail]]){const b=make('button','text-control pv-button');b.dataset.liveVehicleLabel=label;b.type='button';b.hidden=true;const fn=()=>this.beginVehicle(action,b);b.addEventListener('click',fn);this.controlListeners.push([b,'click',fn]);parent.append(b);this.liveVehicleButtons[action]=b;}
  this.lockControls=make('div','vehicle-lock-controls');this.access.detail.append(this.lockControls);for(const action of ['lock','unlock']){const button=this.liveVehicleButtons[action];applyKitComponent(button,'button',{variant:action==='unlock'?'primary':'secondary',tone:action==='unlock'?'danger':'neutral'});this.lockControls.append(button);}for(const action of ['climateOn','climateOff']){const button=this.liveVehicleButtons[action];applyKitComponent(button,'button',{variant:'secondary'});button.dataset.kitSlot='header-action';}
  this.lockButton=make('button','text-control pv-button');this.lockButton.type='button';
  this.rearTrunkButton=make('button','text-control pv-button');this.rearTrunkButton.type='button';this.lockControls.append(this.lockButton,this.rearTrunkButton);
  this.confirmation=make('dialog','vehicle-confirmation');this.confirmation.dataset.actionLayout='balanced';this.confirmation.setAttribute('aria-labelledby','vehicle-confirm-title');this.confirmation.setAttribute('aria-describedby','vehicle-confirm-description');
  const dialogHeader=make('header');this.confirmTitle=make('h2');this.confirmTitle.id='vehicle-confirm-title';dialogHeader.append(this.confirmTitle);
  this.confirmationNote=make('p');this.confirmationNote.id='vehicle-confirm-description';const dialogActions=make('div','pv-dialog-actions');this.lockConfirm=make('button','pv-primary');this.lockCancel=make('button',null,'Annuller');this.lockConfirm.type=this.lockCancel.type='button';dialogActions.append(this.lockCancel,this.lockConfirm);
  applyKitDialog(this.confirmation,{header:dialogHeader,description:this.confirmationNote,actions:dialogActions});this.confirmation.append(dialogHeader,this.confirmationNote,dialogActions);
  const confirmAction=(intent,trigger)=>{
   if(!this.controlsEnabled)return;this.confirmRevision=this.model.revision;this.confirmAction=intent;this.confirmTrigger=trigger;
   const trunk=intent.action==='rear-trunk',access=trunk||intent.action==='lock',settings=intent.action==='climate-settings',climate=intent.action==='climate',levels=['Fra','Lav','Mellem','Høj'];
   const label=trunk?(intent.value==='open'?'Åbn bagagerum':'Luk bagagerum'):access?'Lås op':settings?(intent.setting==='temperature'?`Indstil ${intent.temperatureC} °C`:'Indstil'):climate?(intent.value?'Tænd klima':'Sluk klima'):(intent.value?'Afrim ruder':'Stop afrimning');
   assign(this.confirmTitle,trunk?(intent.value==='open'?'Åbn bagagerummet?':'Luk bagagerummet?'):access?unlockTitle:settings?(intent.setting==='temperature'?`Indstil ${intent.temperatureC} °C?`:'Indstil sædevarme?'):label+'?');
   assign(this.confirmationNote,trunk?'Se til bilen, og hold området ved bagagerummet frit.':access?unlockConsequence:settings?`${intent.temperatureC} °C · Fører: ${levels[intent.seats.driver]} · Passager: ${levels[intent.seats.passenger]}.`+(this.model.climate.status==='off'&&Object.values(intent.seats).some(v=>v>0)?' Klima tændes samtidig.':''):climate?(intent.value?`Kabineklima tændes ved ${this.model.climate.targetTemperatureC} °C.`:'Kabineklima slukkes.'):intent.value?'Maksimal afrimning tændes. Det øger klimaanlæggets energiforbrug.':'Maksimal afrimning stoppes.');
   applyKitComponent(this.lockConfirm,'button',{tone:intent.action==='lock'?'danger':access?'warning':'neutral'});syncKitButtonContent(this.lockConfirm,{label,icon:`assets/icons/${trunk?'car-front':access?'lock-open':climate?'power':'wind'}.svg`});syncKitButtonContent(this.lockCancel,{label:'Annuller',icon:'assets/icons/x-lg.svg'});assign(this.lockCancel,'Annuller');this.lockConfirm.hidden=false;this.lockCancel.hidden=false;const scrollTop=this.root.scrollTop;this.confirmation.showModal();this.root.scrollTop=scrollTop;
  };
  this.requestConfirmation=confirmAction;
  for(const [node,event,fn]of [[this.lockButton,'click',()=>{if(!this.controlsEnabled)return;if(this.model.locked)confirmAction({action:'lock',value:false},this.lockButton);else this.sendAction({action:'lock',value:true,revision:this.model.revision},this.lockButton);}],[this.rearTrunkButton,'click',()=>{if(this.model?.mode==='observed'){const state=this.model.access.rearTrunk;if(!['open','closed'].includes(state))return;this.beginVehicle('rearTrunkToggle',this.rearTrunkButton,{direction:state==='closed'?'open':'close'});return;}confirmAction({action:'rear-trunk',value:this.model.access.rearTrunk==='open'?'closed':'open'},this.rearTrunkButton);}],[this.lockCancel,'click',()=>this.dismissConfirmation()],[this.confirmation,'cancel',()=>this.dismissConfirmation()],[this.confirmation,'close',()=>{if(!this.confirmation.open){if(this.vehicleProposal){this.onVehicleCancel(this.vehicleProposal.operation);this.vehicleProposal=null;}this.dismissConfirmation();}}],[this.lockConfirm,'click',()=>{if(this.vehicleProposal){const proposal=this.vehicleProposal,trigger=this.vehicleTrigger;this.vehicleProposal=null;this.confirmation.close();this.finishVehicle(proposal,trigger);return;}if(!this.controlsEnabled||this.confirmRevision!==this.model.revision||!this.confirmAction)return;const {setting,...intent}=this.confirmAction;const event={...intent,confirmed:true,revision:this.confirmRevision};const trigger=this.confirmTrigger;this.dismissConfirmation({restoreFocus:false,resetDraft:false});this.sendAction(event,trigger);}]]){node.addEventListener(event,fn);this.controlListeners.push([node,event,fn]);}
  this.defrostButton=make('button','text-control pv-button','Afrim ruder');this.defrostButton.type='button';const defrost=()=>{if(this.defrostButton.disabled)return;if(this.model?.mode==='observed'&&typeof this.model.climate.defrost==='boolean'){this.beginVehicle(this.model.climate.defrost?'defrostOff':'defrostOn',this.defrostButton);return;}if(this.settingsEnabled)confirmAction({action:'defrost',value:!this.model.climate.defrost},this.defrostButton);};this.defrostButton.addEventListener('click',defrost);this.controlListeners.push([this.defrostButton,'click',defrost]);
  this.climateActions=make('div','vehicle-climate-actions');this.climateActions.append(this.defrostButton);this.climate.detail.append(this.climateActions);
  this.seatControls=createKitDisclosure({document:root.ownerDocument,id:'vehicle-seat-heat',title:'Sædevarme',leadingIcon:'assets/icons/seat.svg',onToggle:expanded=>{this.renderControls();if(expanded){this.seatScrollTop=this.root.scrollTop;this.seatControls.panel.scrollIntoView?.({block:'nearest',behavior:'instant'});}else this.root.scrollTop=this.seatScrollTop??0;}});this.seatGroups={};
  for(const [seat,label]of [['driver','Fører'],['passenger','Passager']]){const group=createKitChoiceGroup({document:root.ownerDocument,id:'vehicle-seat-'+seat,label,variant:'level',choices:[{value:0,label:'Fra'},{value:1,label:'Lav'},{value:2,label:'Mellem'},{value:3,label:'Høj'}],value:0,onChange:value=>{if(this.model?.mode==='observed'&&!this.disposed){const action=seat==='driver'?'driverSeatHeat':'passengerSeatHeat',option=['off','low','medium','high'][Number(value)];group.setValue(['off','low','medium','high'].indexOf(this.model.climate[seat+'SeatHeat']));if(option)this.beginVehicle(action,group.inputs.find(input=>String(input.value)===String(value))??group.node,{option});return;}if(!this.settingsEnabled||this.disposed){group.setValue(this.model.climate.seats?.[seat]??0);return;}this.draft.seats[seat]=Number(value);this.sendAction({action:'climate-settings',temperatureC:this.model.climate.targetTemperatureC,seats:{...this.model.climate.seats,[seat]:Number(value)},confirmed:true,revision:this.model.revision},group.inputs.find(input=>input.value===value));}});this.seatGroups[seat]=group;this.seatControls.panel.append(group.node);}
  this.accessFeedback=createKitComponent('listrow',{document:root.ownerDocument,tag:'span',variant:'feedback'});this.climateFeedback=createKitComponent('listrow',{document:root.ownerDocument,tag:'span',variant:'feedback'});
  for(const node of [this.accessFeedback,this.climateFeedback]){node.setAttribute('role','status');node.setAttribute('aria-live','polite');}this.commandNote=this.accessFeedback;this.access.detail.children[0].append(this.accessFeedback);this.climate.detail.children[0].append(this.climateFeedback);this.climate.detail.append(this.seatControls.node);for(const node of [this.accessFeedback,this.climateFeedback])node.dataset.kitSlot='status';applyKitTextRole(this.temperatureValue,'control-value');
  for(const node of [this.lockButton,this.rearTrunkButton,this.defrostButton,this.temperatureDown,this.temperatureUp])applyKitComponent(node,'button',{feedback:'progress'});
  syncKitPowerToggle(this.climateToggle);
  this.capabilities=[this.access,this.health,this.more];this.secondary=make('section','vehicle-secondary pv-controls');this.secondary.setAttribute('aria-label','Adgang og klima');this.secondary.dataset.detailZone='controls';this.controlTiles=make('div','vehicle-control-tiles pv-tiles');for(const tile of [this.access.detail,this.climate.detail])applyKitComponent(tile,'tile',{identity:'tesla'});this.controlTiles.append(this.access.detail,this.climate.detail);this.secondary.append(this.controlTiles,...this.capabilities.filter(group=>group!==this.access).map(group=>group.detail));
  this.history=make('section','device-history vehicle-history pv-history');this.history.dataset.detailZone='history';this.historyTitle=make('h2','pv-section-header','Seneste hændelser');this.timeline=make('pv-activity-timeline');this.empty=make('p','robot-history-note','Ingen hændelser at vise endnu.');this.history.append(this.historyTitle,this.timeline,this.empty);
  root.classList.add('vehicle-view');root.append(this.heading,this.hero,this.secondary,this.history,this.confirmation);this.render();
 }
 feedbackScopeFor(snapshot){if(!snapshot)return this.feedbackScope??null;let prior=[];try{prior=JSON.parse(this.feedbackScope||'[]');}catch{}const same=prior[0]===snapshot.bootId&&prior[1]===snapshot.roomId;return JSON.stringify([snapshot.bootId,snapshot.roomId,snapshot.sessionId==null?(same?prior[2]??null:null):snapshot.sessionId,snapshot.providerGeneration==null?(same?prior[3]??null:null):snapshot.providerGeneration]);}
 render(value,{connected=true,connectionDetail=null,chargeContext,vehicleActions=[],feedbackScope=null}={}){
  if(this.feedbackScope!==feedbackScope){this.feedbackScope=feedbackScope;for(const node of [this.accessFeedback,this.climateFeedback]){assign(node,'');node.hidden=true;}}
  this.vehicleActions=Array.isArray(vehicleActions)?vehicleActions:[];
  this.connected=connected;
  const model=vehicleModel(value),configuredUnavailable=model.mode==='unconnected'&&chargeContext?.readGranted===true&&typeof chargeContext.scope==='string'&&chargeContext.scope!==''&&chargeContext.scope!=='local'&&chargeContext.scope===chargeContext.sourceScope;if(!this.draft||this.draftRevision!==model.revision){this.draft={temperatureC:model.climate.targetTemperatureC,seats:{...model.climate.seats}};this.draftRevision=model.revision;if(this.unknownRevision!==model.revision)this.unknownRevision=null;}this.model=model;this.reconcileLiveVehicleCommands();this.hero.dataset.charging=String(model.charging.status==='charging');this.root.dataset.vehicleMode=model.mode;this.root.dataset.example=String(model.mode==='fixture');this.hero.dataset.kitState=model.mode==='unconnected'?'unavailable':'ready';const message=model.mode==='unconnected'&&!configuredUnavailable;if(message){if(this.hero.getAttribute('data-kit-variant')!=='message')this.hero.setAttribute('data-kit-variant','message');}else if(this.hero.getAttribute('data-kit-variant')!==null)this.hero.removeAttribute('data-kit-variant');
  // Live artwork is a generic illustration only for a verified model.
  const showArtwork=model.modelName==='Model Y'&&(model.mode==='observed'||model.mode==='fixture'&&model.modelYear===2023);this.figure.hidden=!showArtwork;if(this.context.hidden!==!showArtwork)this.context.hidden=!showArtwork;this.heroIcon.hidden=showArtwork&&this.figure.dataset.imageState!=='missing';this.image.hidden=!showArtwork||this.figure.dataset.imageState==='missing';if(showArtwork){if(this.image.getAttribute('src')!==VEHICLE_ARTWORK)this.image.src=VEHICLE_ARTWORK;}else if(this.image.getAttribute('src')!==null){this.image.removeAttribute('src');this.figure.dataset.imageState='unavailable';}
  assign(this.title,model.title);assign(this.context,model.context);const status=model.status==='Lader'?'Bilen lader':model.status;const qualified=status;const trunk=model.mode==='observed'&&model.access?.rearTrunk==='open'?'Bagagerum åbent':null;assign(this.status,configuredUnavailable?'Status ukendt':trunk?`${qualified} · ${trunk}`:qualified);const updated=vehicleUpdatedLabel(model)||null;assign(this.connectionNote,updated||(connectionDetail||'Tilføj i Home Assistant'));this.connectionNote.hidden=!updated&&(model.mode!=='unconnected'||configuredUnavailable);this.content.hidden=model.mode==='unconnected';
  assign(this.batteryValue,model.batteryPercent===null?'—':`${model.batteryPercent} %`);this.batteryGroup.hidden=model.batteryPercent===null;assign(this.rangeValue,model.rangeKm===null?'—':`${model.rangeKm.toLocaleString('da-DK',{maximumFractionDigits:0})} km`);this.rangeGroup.hidden=model.rangeKm===null;
  const known=model.batteryPercent!==null;this.rail.dataset.known=String(known);this.rail.hidden=!known;this.meter.hidden=!known;
  if(known){if(this.meter.value!==model.batteryPercent)this.meter.value=model.batteryPercent;}else this.meter.removeAttribute('value');
  const charge=vehicleChargeUpdate(this.chargePresentation,model,chargeContext),motion=this.root.closest?.('pv-widget-host')?.motion;this.chargePresentation=charge;
  if(charge.cancel||charge.cue){this.chargeAnimation?.cancel();this.chargeAnimation=null;}if(charge.cue)this.chargeAnimation=motion?.animate(this.meter,[{opacity:.65},{opacity:1}],120)||null;
  const disconnected=model.mode==='unconnected'&&!configuredUnavailable;this.measurements.hidden=disconnected;this.secondary.hidden=disconnected;this.history.hidden=disconnected||!model.history.length;this.next.hidden=true;const climate=disconnected?'Kræver tilslutning':({off:'Slukket',heat:'Varmer',cool:'Køler',auto:'Automatisk',heat_cool:'Varme/køling',fan_only:'Ventilation',dry:'Affugtning'})[model.climate.status]||'Ukendt';assign(this.climate.status,climate);
  // Read-only details show admitted observations, never a catalogue of promised controls.
  const power=model.charging.status==='charging'&&Number.isFinite(model.charging.powerKw)?`${model.charging.powerKw.toLocaleString('da-DK')} kW`:null,endsAt=model.charging.status==='charging'&&Number.isFinite(model.charging.endsAt)?new Date(model.charging.endsAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}):null;
  const temperature=Number.isFinite(model.climate.temperatureC)?`${model.climate.temperatureC.toLocaleString('da-DK')} °C`:null;
  assign(this.powerValue,power||'');this.powerGroup.hidden=power===null;assign(this.finishValue,endsAt||'');this.finishGroup.hidden=endsAt===null;this.measurements.hidden=disconnected||this.metrics.children.length>0&&[this.batteryGroup,this.rangeGroup,this.powerGroup,this.finishGroup].every(group=>group.hidden);this.content.hidden=disconnected||!showArtwork&&this.measurements.hidden;
  for(const {id,value}of this.climate.values){const known=({state:climate,temperature})[id];assign(value,known||'');value.parentNode.hidden=id!=='temperature'||!temperature;}
  this.climate.body.hidden=!temperature;this.climate.detail.hidden=disconnected;
  for(const group of this.capabilities){group.detail.hidden=true;group.body.hidden=true;assign(group.status,'Ikke oplyst');for(const {value}of group.values){assign(value,'Ikke oplyst');value.parentNode.hidden=true;}}
  if(!disconnected){this.access.detail.hidden=false;assign(this.access.status,'Ukendt');}
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
 async beginVehicle(action,trigger,args={}){
  if(this.vehicleActionBlocked(action)||this.vehicleProposal)return;
  if(climateDependents.has(action)&&!liveClimateActive(this.model))return;
  const historical=this.model?.historicalFields||[],fields={lock:['locked'],unlock:['locked'],rearTrunkToggle:['trunk'],climateOn:['climate.status'],climateOff:['climate.status'],temperature:['climate.status','climate.targetTemperatureC','climate.minTemperatureC','climate.maxTemperatureC','climate.temperatureStepC'],defrostOn:['climate.defrost'],defrostOff:['climate.defrost'],driverSeatHeat:['climate.driverSeatHeat'],passengerSeatHeat:['climate.passengerSeatHeat']};if((fields[action]||[]).some(field=>historical.includes(field))||!this.vehicleActions?.includes(action)||this.model?.mode!=='observed'||this.connected===false)return;
  this.vehiclePending=true;trigger.setAttribute('aria-busy','true');let proposal;try{proposal=await this.onVehicleSetup(action,args);}catch{}trigger.removeAttribute('aria-busy');this.vehiclePending=false;
  if(!proposal||this.disposed){this.onVehicleCancel(proposal?.operation);if(!this.disposed){const note=['climateOn','climateOff','temperature','defrostOn','defrostOff','driverSeatHeat','passengerSeatHeat'].includes(action)?this.climateFeedback:this.accessFeedback;if(note.dataset.state!=='unknown'||!note.textContent){note.hidden=false;note.dataset.state='error';assign(note,'Betjeningen kunne ikke hentes.');}}return;}
  const c=proposal.confirmation;if(!c.requiresConfirmation&&!c.nativeWakePossible&&!c.requiresOverride){await this.finishVehicle(proposal,trigger);return;}
  this.vehicleProposal=proposal;
  this.vehicleTrigger=trigger;
  const unlocking=c.action==='unlock';
  const requested=c.action==='temperature'?`${c.label}: ${String(c.args.temperature).replace('.',',')} °C`:['driverSeatHeat','passengerSeatHeat'].includes(c.action)?`${c.label}: ${{off:'Fra',low:'Lav',medium:'Mellem',high:'Høj'}[c.args.option]}`:c.label;
  assign(this.confirmTitle,unlocking?unlockTitle:requested+'?');
  const extraPrior=Object.entries(c.priorUnresolved).filter(([key,values])=>!['access','climate'].includes(key)&&values.length).map(([key])=>({temperature:'ændre temperaturen',defrost:'betjene afrimningen',driverSeat:'ændre førersædevarmen',passengerSeat:'ændre passagersædevarmen',trunk:'betjene bagagerummet'})[key]).filter(Boolean);const prior=[...extraPrior,...c.priorUnresolved.access.map(v=>v==='locked'?'låse bilen':'låse bilen op'),...c.priorUnresolved.climate.map(v=>v==='on'?'tænde klimaet':'slukke klimaet')],priorText=prior.length>1?`${prior.slice(0,-1).join(', ')} og ${prior.at(-1)}`:prior[0];
  assign(this.confirmationNote,[unlocking?unlockConsequence:'',c.nativeWakePossible?'Handlingen kan vække bilen.':'',c.effects?.some(([family,value])=>family==='climate'&&value==='on')&&['driverSeatHeat','passengerSeatHeat','defrostOn'].includes(c.action)?'Handlingen kan tænde klimaet.':'',c.effects?.some(([family,value])=>family==='climate'&&value==='off')&&c.action==='defrostOff'?'Handlingen kan slukke klimaet.':'',prior.length?`Tidligere anmodninger om at ${priorText} kan stadig blive udført senere.`:'',c.requiresOverride?'Bekræft, at du vil fortsætte.':''].filter(Boolean).join(' '));
  applyKitComponent(this.lockConfirm,'button',{tone:unlocking?'danger':'neutral'});
  syncKitButtonContent(this.lockConfirm,{label:c.label});
  syncKitButtonContent(this.lockCancel,{label:'Annuller'});
  this.lockConfirm.hidden=false;
  this.lockCancel.hidden=false;
  this.confirmation.showModal();
 }
 vehicleActionBlocked(action){
  const phase=this.liveVehicleCommands.get(vehicleActionFamily(action))?.phase;
  return !!this.vehiclePending||phase==='sending'||phase==='observing';
 }
 async finishVehicle(proposal,trigger){
  const {action,args={}}=proposal.confirmation;
  if(this.vehicleActionBlocked(action)||this.disposed)return;
  const family=vehicleActionFamily(action);
  const [field,wanted,read,label,confirmation]=liveVehicleEffects[action]||[];
  const command={family,operation:proposal.operation,trigger,action,field,expected:wanted?.(args),read,
   label:typeof label==='function'?label(args):label,
   confirmation:typeof confirmation==='function'?confirmation(args):confirmation,
   previousAt:this.model.fieldObservedAt?.[field]??this.model.observedAt??0,
   sentAt:Date.now()/1000,phase:'sending',note:['lock','unlock','rearTrunkToggle'].includes(action)?this.accessFeedback:this.climateFeedback};
  this.liveVehicleCommands.set(family,command);
  this.liveVehicleFeedback.delete(family);
  assign(command.note,'');
  this.vehiclePending=true;
  this.renderControls();
  let result;
  try{result=await this.onVehicleSend(proposal.operation);}catch{result={status:'unknown'};}
  this.vehiclePending=false;
  if(this.disposed)return;
  if(this.liveVehicleCommands.get(family)!==command){this.renderControls();return;}
  if(result?.late){
   if(command.operation?.presentationCurrent?.())this.finishVehicleFeedback(command,'unknown','Udfald ukendt · kontrollér bilen.');
   else this.clearLiveVehicleCommand(command);
  }else if(result?.status==='accepted'){
   command.phase='observing';
   this.reconcileLiveVehicleCommand(command);
   if(this.liveVehicleCommands.get(family)===command)command.cancelObservation=command.operation?.waitForObservation?.(()=>{
    if(this.liveVehicleCommands.get(family)!==command||command.phase!=='observing')return;
    this.finishVehicleFeedback(command,'unknown','Udfald ukendt · kontrollér bilen.');
    this.renderControls();
   });
  }else if(result?.status==='unknown'){
   this.finishVehicleFeedback(command,'unknown','Udfald ukendt · kontrollér bilen.');
   this.reconcileLiveVehicleCommand(command);
  }else if(result?.status==='example'){
   this.finishVehicleFeedback(command,'ready','Lokalt eksempel · ingen bil betjenes.');
  }else{
   this.finishVehicleFeedback(command,'error','Handlingen blev afvist.');
  }
  this.renderControls();
 }
 clearLiveVehicleCommand(command){
  command.cancelObservation?.();
  command.cancelObservation=null;
  command.trigger?.removeAttribute('aria-busy');
  this.liveVehicleCommands.delete(command.family);
 }
 finishVehicleFeedback(command,state,text){
  this.clearLiveVehicleCommand(command);
  if(state==='unknown'){
   command.phase='unknown';
   this.liveVehicleCommands.set(command.family,command);
  }
  if(command.operation?.presentationCurrent){
   this.liveVehicleFeedback.delete(command.family);
   this.liveVehicleFeedback.set(command.family,{command,state,text});
  }
  command.note.dataset.state=state;
  assign(command.note,text);
 }
 renderLiveVehicleFeedback(){
  for(const [family,{command,state}]of this.liveVehicleFeedback){
   if(!command.operation.presentationCurrent()||
    state==='ready'&&!this.liveVehicleObservationMatches(command)){this.liveVehicleFeedback.delete(family);continue;}
   // A newer observation of the field is the car's answer: "Udfald ukendt" has served its purpose.
   if(state==='unknown'&&this.liveVehicleObservedSince(command)){
    this.liveVehicleFeedback.delete(family);
    if(this.liveVehicleCommands.get(family)===command)this.clearLiveVehicleCommand(command);
   }
  }
  for(const note of [this.accessFeedback,this.climateFeedback]){
   const entries=[...this.liveVehicleFeedback.values()].filter(row=>row.command.note===note);
   if(!entries.length){
    if(this.liveVehicleFeedbackNotes.delete(note))assign(note,'');
    continue;
   }
   this.liveVehicleFeedbackNotes.add(note);
   const issues=entries.filter(row=>row.state==='unknown'||row.state==='error');
   const active=issues.length?issues:[entries.at(-1)];
   note.dataset.state=active.some(row=>row.state==='unknown')?'unknown':active[0].state;
   const labels={lock:'Lås',trunk:'Bagagerum',climate:'Klima'};
   assign(note,active.length===1?active[0].text:
    active.map(row=>labels[row.command.family]+': '+row.text).join(' '));
  }
 }
 reconcileLiveVehicleCommands(){
  for(const command of [...this.liveVehicleCommands.values()])this.reconcileLiveVehicleCommand(command);
 }
 reconcileLiveVehicleCommand(command){
  if(command.operation?.presentationCurrent&&!command.operation.presentationCurrent()){
   assign(command.note,'');
   this.clearLiveVehicleCommand(command);
   return;
  }
  if(command.phase!=='sending'&&this.liveVehicleObservationMatches(command)){
   this.finishVehicleFeedback(command,'ready',command.confirmation);
  }
 }
 liveVehicleObservedSince(command){
  if(!command.field||this.model.mode!=='observed')return false;
  const observedAt=this.model.fieldObservedAt?.[command.field];
  return !historicalField(this.model,command.field,this.connected)&&Number.isFinite(observedAt)&&
   observedAt>command.previousAt&&observedAt>=command.sentAt-CLOCK_SKEW_S;
 }
 liveVehicleObservationMatches(command){
  if(!command.read||this.model.mode!=='observed'||
   command.operation?.observationCurrent&&!command.operation.observationCurrent())return false;
  const observedAt=this.model.fieldObservedAt?.[command.field];
  return !historicalField(this.model,command.field,this.connected)&&Number.isFinite(observedAt)&&
   observedAt>command.previousAt&&observedAt>=command.sentAt-CLOCK_SKEW_S&&
   command.read(this.model)===command.expected;
 }
 renderLiveVehicleCommands(){
  for(const command of this.liveVehicleCommands.values())if(command.phase!=='unknown')this.renderLiveVehicleCommand(command);
 }
 renderLiveVehicleCommand(command){
  const {trigger,action,note,label}=command;
  const button=trigger?.tagName==='BUTTON';
  const named=button&&trigger.dataset.kitVariant!=='icon';
  if(!named){note.dataset.state='pending';assign(note,label);}
  if(!button||!this.vehicleActions.includes(action))return;
  if(trigger===this.liveVehicleButtons[action]&&(action==='lock'||action==='unlock')){
   trigger.hidden=false;
   this.liveVehicleButtons[action==='unlock'?'lock':'unlock'].hidden=true;
   applyKitComponent(trigger,'button',{variant:'secondary',tone:'neutral'});
  }
  applyKitComponent(trigger,trigger.dataset.kit==='toggle'?'toggle':'button',{feedback:'progress',loading:true});
  trigger.disabled=true;
  if(named)syncKitButtonContent(trigger,{label});
 }
 dismissConfirmation({restoreFocus=true,resetDraft=true}={}){if(resetDraft&&!this.pending&&this.model)this.draft={temperatureC:this.model.climate.targetTemperatureC,seats:{...this.model.climate.seats}};const trigger=this.confirmTrigger;this.confirmTrigger=null;this.confirmAction=null;this.confirmRevision=null;this.lockConfirm.hidden=true;this.lockCancel.hidden=true;if(this.confirmation.open)this.confirmation.close();if(resetDraft&&!this.pending&&this.model){assign(this.temperatureValue,Number.isFinite(this.model.climate.targetTemperatureC)?`${this.model.climate.targetTemperatureC.toLocaleString('da-DK')} °C`:'—');for(const [seat,group]of Object.entries(this.seatGroups??{}))group.setValue(this.model.climate.seats?.[seat]??0);}if(restoreFocus&&!this.disposed)trigger?.focus?.({preventScroll:true});}
 hasDraft(){const m=this.model;return this.draft.temperatureC!==m.climate.targetTemperatureC||['driver','passenger'].some(seat=>this.draft.seats[seat]!==m.climate.seats?.[seat]);}
 sendAction(event,trigger){
  if(!this.controlsEnabled||this.pending)return;const seat=Object.entries(this.seatGroups).find(([,group])=>group.inputs.includes(trigger))?.[0],levels=['Fra','Lav','Mellem','Høj'],label=seat?`${seat==='driver'?'Fører':'Passager'}: ${levels[event.seats?.[seat]]}`:Number.isInteger(event.temperatureC)?`${event.temperatureC} °C`:'';const operation={trigger,label,intentValue:event.value,revision:event.revision,controller:new AbortController()};this.pending=operation;this.commandNote=[this.lockButton,this.rearTrunkButton].includes(trigger)?this.accessFeedback:this.climateFeedback;this.commandResult=null;this.renderControls();
  const progress=({phase}={})=>{if(this.pending!==operation||this.disposed)return;operation.phase=phase==='waking'?'waking':'awaiting';this.renderControls();};
  let result;try{result=this.onAction(event,{signal:operation.controller.signal,onProgress:progress});}catch{result={status:'unknown'};}
  const finish=result=>{if(this.pending!==operation||this.disposed)return;this.pending=null;const same=this.model.mode==='fixture'&&this.model.revision===operation.revision,confirmed=result?.status==='confirmed'&&result.revision===this.model.revision&&this.model.revision===operation.revision+1;if(!same&&!confirmed){this.commandResult=null;this.dismissConfirmation();this.renderControls();return;}this.commandTarget=trigger;this.commandResult=confirmed?'confirmed':result?.status==='failed'?'failed':'unknown';if(this.commandResult==='unknown')this.unknownRevision=operation.revision;this.dismissConfirmation();this.renderControls();};
  // A synchronous legacy preview callback is not proof of a vehicle outcome.
  if(result?.then)result.then(finish,()=>finish({status:'unknown'}));else if(result)finish(result);else{this.pending=null;this.dismissConfirmation();this.renderControls();}
 }
 renderControls(){
  const m=this.model,liveEnabled=m?.mode==='observed'&&this.connected!==false&&!this.disposed,freshClimate=liveEnabled&&m.climate.status!==null,climateIntent=freshClimate?(m.climate.status==='off'?'climateOn':'climateOff'):null,useClimateToggle=!!climateIntent&&this.vehicleActions?.includes(climateIntent);for(const [action,button]of Object.entries(this.liveVehicleButtons)){const irrelevant=((action==='lock'&&m.locked===true)||(action==='unlock'&&m.locked===false)||(action==='climateOn'&&m.climate.status!==null&&m.climate.status!=='off')||(action==='climateOff'&&m.climate.status==='off'));button.hidden=!liveEnabled||!this.vehicleActions?.includes(action)||irrelevant||(useClimateToggle&&(action==='climateOn'||action==='climateOff')); if(action==='lock'||action==='unlock')applyKitComponent(button,'button',{
   variant:action==='unlock'?'primary':'secondary',tone:action==='unlock'?'danger':'neutral',loading:false});
  if(!button.hidden)syncKitButtonContent(button,{label:button.dataset.liveVehicleLabel,icon:`assets/icons/${action==='unlock'?'lock-open':action==='lock'?'lock':'power'}.svg`});button.disabled=this.vehicleActionBlocked(action)||(m.historicalFields||[]).includes(action==='lock'||action==='unlock'?'locked':'climate.status');}if(liveEnabled&&this.vehicleActions?.some(x=>x==='lock'||x==='unlock'))this.access.detail.hidden=false;if(liveEnabled&&this.vehicleActions?.some(x=>x==='climateOn'||x==='climateOff'))this.climate.detail.hidden=false;const enabled=m?.mode==='fixture'&&m.controlsPreview===true,pending=!!this.pending,unknown=this.unknownRevision===m.revision;this.climate.detail.dataset.kitLayout=(enabled||liveEnabled&&['climateOn','climateOff'].some(action=>this.vehicleActions?.includes(action)))?'header-action':'default';this.controlsEnabled=enabled&&this.connected!==false&&!this.disposed&&!pending&&!unknown;this.settingsEnabled=this.controlsEnabled&&m.climate.status!=='off';
  if(!this.vehicleProposal&&(!enabled||this.connected===false||this.confirmRevision!==m.revision)&&!pending)this.dismissConfirmation();
  for(const node of [this.climateToggle,this.climateActions,this.temperatureControls,this.lockControls,this.seatControls.node])node.hidden=!enabled;
  for(const node of [this.climateToggle,this.defrostButton,this.temperatureDown,this.temperatureUp,this.lockButton,this.rearTrunkButton]){node.disabled=!this.controlsEnabled;node.removeAttribute('aria-busy');node.removeAttribute('data-state');}
  this.defrostButton.hidden=false;
  this.seatControls.setDisabled(enabled?m.climate.status==='off':!liveClimateActive(m));
  for(const [seat,group]of Object.entries(this.seatGroups)){group.setDisabled(!this.settingsEnabled);for(const input of group.inputs)input.disabled=!this.settingsEnabled;group.setValue(m.climate.seats?.[seat]??0);}
  if(liveEnabled){this.climateToggle.hidden=!useClimateToggle;this.climateToggle.disabled=this.vehicleActionBlocked('climateOn')||(m.historicalFields||[]).includes('climate.status');if(useClimateToggle)syncKitPowerToggle(this.climateToggle,{checked:m.climate.status!=='off'});const offered=action=>this.vehicleActions?.includes(action),c=m.climate,t=c.targetTemperatureC,validTemp=!m.stale&&!['climate.status','climate.targetTemperatureC','climate.minTemperatureC','climate.maxTemperatureC','climate.temperatureStepC'].some(field=>(m.historicalFields||[]).includes(field))&&['heat','cool','auto','heat_cool','fan_only','dry'].includes(c.status)&&offered('temperature')&&c.temperatureStepC===0.5&&Number.isFinite(t)&&t*2===Math.round(t*2)&&Number.isFinite(c.minTemperatureC)&&Number.isFinite(c.maxTemperatureC)&&c.minTemperatureC<=t&&t<=c.maxTemperatureC;this.temperatureControls.hidden=!offered('temperature');if(offered('temperature')){assign(this.temperatureValue,Number.isFinite(t)?`${t.toLocaleString('da-DK')} °C`:'—');this.temperatureDown.disabled=!validTemp||this.vehicleActionBlocked('climateOn')||t-0.5<c.minTemperatureC;this.temperatureUp.disabled=!validTemp||this.vehicleActionBlocked('climateOn')||t+0.5>c.maxTemperatureC;this.climate.detail.hidden=false;}const defrostAction=c.defrost===true?'defrostOff':c.defrost===false?'defrostOn':null;this.climateActions.hidden=!['defrostOn','defrostOff'].some(offered);this.defrostButton.hidden=this.climateActions.hidden;this.defrostButton.disabled=!liveClimateActive(m)||!defrostAction||m.stale||(m.historicalFields||[]).includes('climate.defrost')||!offered(defrostAction)||this.vehicleActionBlocked('climateOn');if(!this.climateActions.hidden){syncKitButtonContent(this.defrostButton,{label:c.defrost===true?'Stop afrimning':c.defrost===false?'Afrim ruder':'Afrimning ukendt',icon:'assets/icons/wind.svg'});this.climate.detail.hidden=false;}this.lockControls.hidden=!['rearTrunkToggle','lock','unlock'].some(offered);this.lockButton.hidden=true;this.rearTrunkButton.hidden=!offered('rearTrunkToggle');this.rearTrunkButton.disabled=this.rearTrunkButton.hidden||this.vehicleActionBlocked('rearTrunkToggle')||(m.historicalFields||[]).includes('trunk')||!['open','closed'].includes(m.access?.rearTrunk);if(!this.rearTrunkButton.hidden){syncKitButtonContent(this.rearTrunkButton,{label:m.access?.rearTrunk==='closed'?'Åbn bagagerum':m.access?.rearTrunk==='open'?'Luk bagagerum':'Bagagerum ukendt',icon:'assets/icons/car-front.svg'});this.access.detail.hidden=false;}let seatsVisible=false;for(const [seat,group]of Object.entries(this.seatGroups)){const action=seat==='driver'?'driverSeatHeat':'passengerSeatHeat',current=['off','low','medium','high'].indexOf(c[seat+'SeatHeat']);group.node.hidden=!offered(action)||current<0;group.setDisabled(!liveClimateActive(m)||group.node.hidden||this.vehicleActionBlocked('climateOn')||(m.historicalFields||[]).includes(`climate.${seat}SeatHeat`));for(const input of group.inputs)input.disabled=!liveClimateActive(m)||group.node.hidden||this.vehicleActionBlocked('climateOn')||(m.historicalFields||[]).includes(`climate.${seat}SeatHeat`);if(!group.node.hidden){group.setValue(current);seatsVisible=true;}}this.seatControls.node.hidden=!seatsVisible;if(seatsVisible){this.climate.detail.hidden=false;const levels={off:'Fra',low:'Lav',medium:'Mellem',high:'Høj'},description=!m.stale?['driver','passenger'].flatMap(seat=>levels[c[seat+'SeatHeat']]?[`${seat==='driver'?'Fører':'Passager'}: ${levels[c[seat+'SeatHeat']]}`]:[]).join(' · '):'';this.seatControls.setDescription(this.seatControls.trigger.getAttribute('aria-expanded')==='true'?'':description);}}
  this.renderLiveVehicleFeedback();
  if(liveEnabled)this.renderLiveVehicleCommands();
  if(!enabled){this.access.status.hidden=false;this.climate.status.hidden=false;this.commandResult=null;for(const [group,node] of [[this.access,this.accessFeedback],[this.climate,this.climateFeedback]]){node.hidden=!node.textContent;if(!node.hidden){group.detail.hidden=false;this.secondary.hidden=false;}}return;}
  this.climate.detail.hidden=false;this.access.detail.hidden=false;
  assign(this.access.status,`${m.access?.rearTrunk==='open'?'Bagagerum åbent · ':''}${m.locked?'Låst':'Ulåst'}`);this.climateToggle.removeAttribute('data-selected');syncKitPowerToggle(this.climateToggle,{checked:m.climate.status!=='off'});applyKitComponent(this.lockButton,'button',{variant:m.locked?'primary':'secondary',tone:m.locked?'danger':'neutral'});assign(this.temperatureValue,`${m.climate.targetTemperatureC} °C`);
  this.defrostButton.setAttribute('data-selected',String(m.climate.defrost));assign(this.defrostButton,m.climate.defrost?'Stop afrimning':'Afrim ruder');
  this.temperatureDown.disabled=!this.settingsEnabled||m.climate.targetTemperatureC<=16;this.temperatureUp.disabled=!this.settingsEnabled||m.climate.targetTemperatureC>=30;this.defrostButton.disabled=!this.settingsEnabled;assign(this.temperatureDown,'−');assign(this.temperatureUp,'+');
  syncKitButtonContent(this.lockButton,{label:m.locked?'Lås op':'Lås bilen',icon:`assets/icons/${m.locked?'lock-open':'lock'}.svg`});syncKitButtonContent(this.rearTrunkButton,{label:m.access?.rearTrunk==='open'?'Luk bagagerum':'Åbn bagagerum',icon:'assets/icons/car-front.svg'});syncKitButtonContent(this.defrostButton,{label:m.climate.defrost?'Stop afrimning':'Afrim ruder',icon:'assets/icons/wind.svg'});
  const levels=['Fra','Lav','Mellem','Høj'];this.seatControls.setDescription(this.seatControls.trigger.getAttribute('aria-expanded')==='true'?'':`Fører: ${levels[m.climate.seats.driver]||'Fra'} · Passager: ${levels[m.climate.seats.passenger]||'Fra'}`);
  for(const node of [this.accessFeedback,this.climateFeedback]){node.hidden=!enabled;if(node!==this.commandNote)assign(node,'');}this.commandNote.dataset.state=pending?'pending':this.commandResult==='failed'?'error':unknown?'unknown':'ready';
  const inlinePending=pending&&this.pending.trigger?.tagName==='INPUT';
  assign(this.commandNote,inlinePending?`${this.pending.label} · ${this.pending.phase==='waking'?'vækker bilen…':'afventer svar…'}`:unknown?'Svar mangler · Kontrollér bilen før en ny kommando.':this.commandResult==='failed'?'Afvist · Prøv igen.':'');
  for(const [group,node]of [[this.access,this.accessFeedback],[this.climate,this.climateFeedback]]){node.hidden=!enabled||!node.textContent;group.status.hidden=!node.hidden;}
  this.lockConfirm.disabled=pending||!this.controlsEnabled;this.lockConfirm.removeAttribute('aria-busy');
  if(this.commandResult==='failed')this.commandTarget?.setAttribute('data-state','error');
  if(pending){const node=this.pending.trigger;if(node?.tagName==='BUTTON'){node.setAttribute('aria-busy','true');node.disabled=true;}assign(this.lockCancel,'Luk');}
 }
 cleanup(){for(const node of [this.accessFeedback,this.climateFeedback]){assign(node,'');node.hidden=true;}this.disposed=true;for(const command of this.liveVehicleCommands.values())this.clearLiveVehicleCommand(command);this.pending?.controller.abort();this.pending=null;this.dismissConfirmation();this.chargeAnimation?.cancel();this.chargeAnimation=null;this.chargePresentation=null;for(const [node,event,fn]of this.controlListeners)node.removeEventListener(event,fn);this.next.removeEventListener('click',this.onNext);this.image.removeEventListener('error',this.onImageError);this.image.removeEventListener('load',this.onImageLoad);}
}
