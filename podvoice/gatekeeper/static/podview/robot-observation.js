// Optional closed read contract. Values cannot enable controls or imply physical proof.
const groups={duration:['cleaning_time','total_cleaning_time','main_brush_time_left','side_brush_time_left','filter_time_left','sensor_time_left','cleaning_brush_time_left','strainer_time_left','mop_drying_remaining_time'],area:['cleaning_area','total_cleaning_area'],percent:['battery','clean_percent','volume'],timestamp:['last_clean_start','last_clean_end'],text:['current_room','status','vacuum_error','dock_error','mop_intensity','mop_mode','cleaning_mode','selected_map','dust_collection_mode'],bool:['battery_charging','in_cleaning','water_shortage','mop_attached','water_box_attached','dirty_box_full','clean_box_empty','mop_drying_status','child_lock','dnd_switch','mop_drying','mop_washing','dust_emptying'],clock:['dnd_start_time','dnd_end_time'],count:['total_cleaning_count']};
const kinds=new Map(Object.entries(groups).flatMap(([kind,keys])=>keys.map(key=>[key,kind]))),entities=/^(sensor|binary_sensor|select|switch|number|time)\.[a-z0-9_]+$/;
const labels={main_brush_time_left:'Hovedbørste',side_brush_time_left:'Sidebørste',filter_time_left:'Filter',sensor_time_left:'Sensorer',cleaning_brush_time_left:'Dockbørste',strainer_time_left:'Dockfilter',mop_drying_remaining_time:'Tørring tilbage',total_cleaning_area:'Samlet areal',total_cleaning_time:'Samlet tid',total_cleaning_count:'Rengøringer i alt',clean_box_empty:'Rent vand mangler',dirty_box_full:'Snavset vandbeholder fuld',water_shortage:'Vandmangel',mop_drying_status:'Moppetørring',mop_drying:'Moppetørring',mop_washing:'Moppevask',dust_emptying:'Tømning af støvbeholder',battery:'Batteri',mop_attached:'Moppe monteret',water_box_attached:'Vandbeholder monteret',battery_charging:'Oplader',child_lock:'Børnelås',dnd_switch:'Forstyr ikke',dnd_start_time:'Forstyr ikke fra',dnd_end_time:'Forstyr ikke til',volume:'Robotens lydstyrke',mop_intensity:'Moppeintensitet',mop_mode:'Moppetilstand',cleaning_mode:'Rengøringstilstand',selected_map:'Valgt kort',dust_collection_mode:'Tømningstilstand',vacuum_error:'Robotfejl',dock_error:'Dockfejl'};
const careKeys=new Set(['main_brush_time_left','side_brush_time_left','filter_time_left','sensor_time_left','cleaning_brush_time_left','strainer_time_left']);
const detailGroups={maintenance:['main_brush_time_left','side_brush_time_left','filter_time_left','sensor_time_left','cleaning_brush_time_left','strainer_time_left','total_cleaning_area','total_cleaning_time','total_cleaning_count','vacuum_error'],dock:['mop_drying_remaining_time','clean_box_empty','dirty_box_full','water_shortage','mop_drying_status','mop_drying','mop_washing','dust_emptying','battery','mop_attached','water_box_attached','battery_charging','dock_error'],settings:['child_lock','dnd_switch','dnd_start_time','dnd_end_time','volume','mop_intensity','mop_mode','cleaning_mode','selected_map','dust_collection_mode']};
const detailGroup=new Map(Object.entries(detailGroups).flatMap(([group,keys])=>keys.map(key=>[key,group])));
const unavailable=()=>({status:'unavailable',items:[]});
export function robotRoom(device,now=Date.now()/1000){
 if(device.status!=='cleaning'||device.stale||device.telemetry?.status!=='observed')return null;
 const row=device.telemetry.items.find(value=>value.key==='current_room');
 return row&&!row.stale&&now-row.updatedAt<=300?row.value:null;
}
export function robotObservation(value,entityId){
 if(value?.schema!=='podview.robot.v1'||value.vacuumEntityId!==entityId||value.source!=='home_assistant_roborock'||value.status!=='observed'||!Array.isArray(value.items)||value.items.length>kinds.size)return unavailable();
 const keys=new Set(),seen=new Set(),items=[];for(const row of value.items){const kind=kinds.get(row?.key),v=row?.value,u=row?.unit;
  if(!kind||!entities.test(row.entityId)||keys.has(row.key)||seen.has(row.entityId)||!Number.isFinite(row.updatedAt)||!Number.isFinite(row.retrievedAt)||row.updatedAt<0||row.updatedAt>row.retrievedAt+1||row.retrievedAt<0||row.retrievedAt>Date.now()/1000+1||typeof row.stale!=='boolean')return unavailable();
  if(['duration','area','percent','timestamp','count'].includes(kind)&&(!Number.isFinite(v)||Math.abs(v)>1e12))return unavailable();
  if(kind==='duration'&&!['s','min','h'].includes(u)||kind==='area'&&(u!=='m²'||v<0)||kind==='percent'&&(u!=='%'||v<0||v>100)||kind==='count'&&(u!==null||v<0||!Number.isInteger(v))||kind==='timestamp'&&(u!==null||v<0||v>row.retrievedAt+1)||kind==='bool'&&(typeof v!=='boolean'||u!==null)||['text','clock'].includes(kind)&&(typeof v!=='string'||!v||v.length>120||u!==null)||kind==='clock'&&!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v))return unavailable();
  const domain=row.entityId.split('.')[0],expected=['child_lock','dnd_switch','mop_drying','mop_washing','dust_emptying'].includes(row.key)?'switch':kind==='bool'?'binary_sensor':row.key==='volume'?'number':kind==='clock'?'time':['mop_intensity','mop_mode','cleaning_mode','selected_map','dust_collection_mode'].includes(row.key)?'select':'sensor';if(expected!==domain)return unavailable();
  keys.add(row.key);seen.add(row.entityId);items.push({key:row.key,entityId:row.entityId,value:v,unit:u,updatedAt:row.updatedAt,retrievedAt:row.retrievedAt,stale:row.retrievedAt-row.updatedAt>300});
 }return {status:'observed',items};
}
export function robotFacts(device,now=Date.now()/1000){
 const items=device.telemetry?.status==='observed'?device.telemetry.items:[],fresh=row=>!device.stale&&!row.stale&&now-row.updatedAt<=300,byKey=new Map(items.map(row=>[row.key,row]));
 const active=device.status==='cleaning'&&!device.stale,summary=[];if(active){const room=byKey.get('current_room');if(room&&fresh(room))summary.push(room.value);for(const key of ['clean_percent','cleaning_area','cleaning_time']){const row=byKey.get(key);if(row&&fresh(row))summary.push(robotValue(row));}}
 const history=['last_clean_start','last_clean_end'].map(key=>byKey.get(key)).filter(Boolean).map(row=>({label:row.key==='last_clean_start'?'Senest startet':'Senest afsluttet',value:new Date(row.value*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),stale:!fresh(row)}));
 const attention=['clean_box_empty','dirty_box_full','water_shortage'].map(key=>byKey.get(key)).filter(row=>row?.value===true&&fresh(row)).map(row=>labels[row.key]);
 for(const key of ['vacuum_error','dock_error']){const row=byKey.get(key);if(row&&fresh(row)&&!['none','no_error','ok','0'].includes(row.value.toLowerCase()))attention.push(`${labels[key]}: ${robotValue(row)}`);}
 const details=items.filter(row=>labels[row.key]).map(row=>({label:labels[row.key],value:robotValue(row),stale:!fresh(row),group:detailGroup.get(row.key)}));return {summary,history,attention,details};
}
// Display-only vocabulary matches the existing admitted setting choices.
// Raw observations and action values remain owned by their source/transport.
const settingLabels={
 suction:{quiet:'Stille',balanced:'Balanceret',turbo:'Turbo',max:'Maks.',max_plus:'Maks.+',off:'Fra',custom:'Tilpasset'},
 cleaning_mode:{vacuum:'Støvsugning',vac_and_mop:'Støvsugning og gulvvask',mop:'Gulvvask',custom:'Tilpasset'},
 mop_intensity:{off:'Fra',low:'Lav',medium:'Mellem',high:'Høj',extreme:'Extreme',custom_water_flow:'Tilpasset vandmængde',custom:'Tilpasset'},
 mop_mode:{standard:'Standard',deep:'Grundig',deep_plus:'Ekstra grundig',fast:'Hurtig',custom:'Tilpasset'},
 dust_collection_mode:{smart:'Smart',light:'Let',balanced:'Balanceret',max:'Maksimal'},
 vacuum_error:{none:'Ingen'},dock_error:{ok:'Ingen',water_empty:'Mangler vand'}
};
export function robotValue(row){
 if(typeof row.value==='boolean')return row.value?'Ja':'Nej';if(typeof row.value==='string'){if(['dnd_start_time','dnd_end_time'].includes(row.key)&&row.value.length===8&&/^(?:[01]\d|2[0-3]):[0-5]\d:00$/.test(row.value))return row.value.slice(0,5);if(Object.hasOwn(settingLabels,row.key)){const vocabulary=settingLabels[row.key];return Object.hasOwn(vocabulary,row.value)?vocabulary[row.value]:row.value;}return row.value.replaceAll('_',' ');}const number=n=>n.toLocaleString('da-DK',{maximumFractionDigits:1});
 if(careKeys.has(row.key)&&['s','min','h'].includes(row.unit)){const magnitude=Math.abs(row.value),amount=row.unit==='s'?magnitude/60:magnitude,unit=row.unit==='h'?(amount===1?'time':'timer'):'min';return `${number(amount)} ${unit} ${row.value<0?'over interval':'tilbage'}`;}
 if(row.unit==='s')return `${number(row.value/60)} min`;if(row.unit==='min'||row.unit==='h')return `${number(row.value)} ${row.unit==='h'?'timer':'min'}`;if(row.unit==='m²')return `${number(row.value)} m²`;if(row.unit==='%')return `${number(row.value)} %`;return number(row.value);
}

// Display/recovery vocabulary only; raw observations and the closed wire keys above are unchanged.
// Error names: https://python-roborock.readthedocs.io/en/latest/error.html
// Q Revo care: https://support.roborock.com/hc/en-us/article_attachments/48579140713497
// Brush/charging: Roborock support articles 360035369172 and 360035369312.
const recovery={
 vacuum_error:{
  lidar_blocked:['Lasersensoren er blokeret','Fjern genstande, der blokerer lasersensoren.'],
  bumper_stuck:['Kofangeren sidder fast','Fjern genstande omkring kofangeren, og kontrollér at den kan bevæge sig.'],
  wheels_suspended:['Hjulene mangler gulvkontakt','Placér robotten på et plant gulv væk fra kanter.'],
  cliff_sensor_error:['Kontrollér faldsensorerne','Rengør faldsensorerne med en blød, tør klud, og flyt robotten væk fra kanter.'],
  main_brush_jammed:['Hovedbørsten sidder fast','Sluk robotten før du fjerner hår og genstande fra hovedbørsten, dens ender og holderne.'],
  side_brush_jammed:['Sidebørsten sidder fast','Sluk robotten, og fjern det, der blokerer sidebørsten.'],
  wheels_jammed:['Et hjul sidder fast','Sluk robotten, og fjern genstande omkring hjulene.'],
  robot_trapped:['Robotten sidder fast','Fjern forhindringer omkring robotten.'],
  no_dustbin:['Kontrollér støvbeholderen','Kontrollér, at støvbeholder og filter er monteret korrekt.'],
  low_battery:['Batteriet er lavt','Lad robotten oplade, før du starter rengøring.'],
  charging_error:['Kan ikke oplade','Kontrollér basens strøm og placering. Rengør robot og bases ladekontakter med en tør klud.'],
  battery_error:['Robotten melder batterifejl','Se den konkrete fejl i Roborock-appen. Kontakt support, hvis fejlen fortsætter.'],
  wall_sensor_dirty:['Vægsensoren skal rengøres','Tør vægsensoren af med en blød, tør klud.'],
  robot_tilted:['Robotten står skævt','Placér robotten på et plant gulv.'],
  return_to_dock_fail:['Kan ikke finde tilbage til basen','Kontrollér, at vejen til basen er fri, og at basen ikke er flyttet.'],
  filter_blocked:['Filteret er blokeret','Kontrollér og rengør filteret efter modellens vejledning. Et vasket filter skal være helt tørt før brug.']
 },
 dock_error:{
  duct_blockage:['Tømningskanalen er blokeret','Afbryd strømmen til basen før du kontrollerer støvpose, beholdere og tilgængelige luftkanaler.'],
  water_empty:['Rent vand mangler','Fyld beholderen med rent vand, og sæt den korrekt på plads.'],
  waste_water_tank_full:['Snavset vandbeholder er fuld','Tøm beholderen med snavset vand, og sæt den korrekt på plads.'],
  dirty_tank_latch_open:['Vandbeholderen er ikke lukket','Luk beholderens låg og lås, og kontrollér at beholderen sidder korrekt.'],
  no_dustbin:['Kontrollér basens støvbeholder','Kontrollér støvpose og dæksel på basen.'],
  cleaning_tank_full_or_blocked:['Vaskebakken skal kontrolleres','Kontrollér og rengør den aftagelige vaskebakke og dens filter efter modellens vejledning.']
 }
};
const errorNumbers={vacuum_error:{1:'lidar_blocked',2:'bumper_stuck',3:'wheels_suspended',4:'cliff_sensor_error',5:'main_brush_jammed',6:'side_brush_jammed',7:'wheels_jammed',8:'robot_trapped',9:'no_dustbin',12:'low_battery',13:'charging_error',14:'battery_error',15:'wall_sensor_dirty',16:'robot_tilted',23:'return_to_dock_fail',29:'filter_blocked'},dock_error:{34:'duct_blockage',38:'water_empty',39:'waste_water_tank_full',44:'dirty_tank_latch_open',46:'no_dustbin',53:'cleaning_tank_full_or_blocked'}};
const activityLabels={washing_the_mop:'Vasker moppe',washing_mop:'Vasker moppe',going_to_wash_the_mop:'På vej til moppevask',going_to_wash_mop:'På vej til moppevask',emptying_the_bin:'Tømmer støvbeholder',emptying_dustbin:'Tømmer støvbeholder',drying_the_mop:'Tørrer moppe',drying_mop:'Tørrer moppe'};
const waterRecovery={clean_box_empty:['Rent vand mangler','Fyld beholderen med rent vand, og sæt den korrekt på plads.'],dirty_box_full:['Snavset vandbeholder er fuld','Tøm beholderen med snavset vand, og sæt den korrekt på plads.'],water_shortage:['Robotten mangler vand','Kontrollér beholderen med rent vand og dens placering.']};
// One bounded projection for Hero, overview and Ro. Neither in_cleaning nor a dock
// state proves task identity, automatic resumption, completion, or command authority.
export function robotExperience(device,now=Date.now()/1000){
 const stale=!!device?.stale||['unavailable','unknown'].includes(device?.status),rows=device?.telemetry?.status==='observed'?device.telemetry.items||[]:[];
 const fresh=row=>!stale&&row&&!row.stale&&Number.isFinite(row.updatedAt)&&row.updatedAt<=now+1&&now-row.updatedAt<=300;
 const get=key=>{const row=rows.find(value=>value.key===key);return fresh(row)?row:null;},value=key=>get(key)?.value;
 const issues=[];
 for(const key of ['vacuum_error','dock_error']){const row=get(key);if(!row||typeof row.value!=='string'||['none','no_error','ok','0'].includes(row.value.toLowerCase()))continue;
  const raw=row.value,normal=raw.toLowerCase(),code=Object.hasOwn(errorNumbers[key],normal)?errorNumbers[key][normal]:normal,known=Object.hasOwn(recovery[key],code)?recovery[key][code]:null;
  issues.push({key,title:known?.[0]||(key==='dock_error'?'Basen melder en fejl':'Robotten melder en fejl'),help:known?.[1]||'Se den konkrete fejl i Roborock-appen eller modellens vejledning.',raw,severity:'attention'});
 }
 for(const [key,copy] of Object.entries(waterRecovery))if(value(key)===true&&!issues.some(issue=>issue.title===copy[0]))issues.push({key,title:copy[0],help:copy[1],raw:true,severity:'attention'});
 const maintenance=rows.filter(row=>careKeys.has(row.key)&&fresh(row)&&row.value<=0).map(row=>({key:row.key,title:`${labels[row.key]} skal vedligeholdes`,help:'Rengør eller udskift efter modellens vejledning. Nulstil først intervallet, når vedligeholdelsen er udført.',value:robotValue(row),severity:'reminder'}));
 const jobActive=typeof value('in_cleaning')==='boolean'?value('in_cleaning'):null,charging=typeof value('battery_charging')==='boolean'?value('battery_charging'):null,battery=typeof value('battery')==='number'?value('battery'):null;
 // dnd_switch is the enabled schedule, not proof that DND is active right now.
 const dnd={enabled:typeof value('dnd_switch')==='boolean'?value('dnd_switch'):null,start:value('dnd_start_time')??null,end:value('dnd_end_time')??null};
 let activity=null;
 if(!stale&&!['fault','error','unavailable','unknown'].includes(device?.status)&&device?.telemetry?.status==='observed'){
  const status=value('status'),operations=[['mop_washing','Vasker moppe'],['dust_emptying','Tømmer støvbeholder'],['mop_drying','Tørrer moppe']].filter(([key])=>value(key)===true);
  if(value('mop_drying_status')===true&&!operations.some(([key])=>key==='mop_drying'))operations.push(['mop_drying_status','Tørrer moppe']);
  // A specific fresh robot status can resolve disagreeing switch reports. Without
  // it there is no invented washing/emptying/drying priority or charging fallback.
  if(typeof status==='string'&&Object.hasOwn(activityLabels,status))activity=activityLabels[status];
  else if(operations.length>1)issues.push({key:'dock_activity_conflict',title:'Basens aktivitet er uklar',help:'Flere aktiviteter meldes aktive. Afvent en ny status, eller kontrollér Roborock-appen.',raw:operations.map(([key])=>key).join(', '),severity:'attention'});
  else if(operations.length===1)activity=operations[0][1];
  else if(['docked','stopped'].includes(device?.status)){
   if(charging===true||status==='charging'&&charging!==false)activity=jobActive===true?'Oplader · turen er ikke afsluttet':'Oplader';
   else if(status==='charging_complete'&&charging!==true)activity='Opladet';
  }
 }
 return {activity,jobActive,battery,charging,dnd,issues,maintenance,stale};
}
// Legacy label consumers explicitly prefix device.stale with “Sidst kendt”. Retain
// that last observed label while robotExperience exposes current facts strictly.
export function robotActivity(device,now=Date.now()/1000){return robotExperience(device?.stale?{...device,stale:false}:device,now).activity;}
