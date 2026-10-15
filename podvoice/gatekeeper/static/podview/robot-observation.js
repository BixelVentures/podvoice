// Optional closed read contract. Values cannot enable controls or imply physical proof.
const groups={duration:['cleaning_time','total_cleaning_time','main_brush_time_left','side_brush_time_left','filter_time_left','sensor_time_left','cleaning_brush_time_left','strainer_time_left','mop_drying_remaining_time'],area:['cleaning_area','total_cleaning_area'],percent:['battery','clean_percent','volume'],timestamp:['last_clean_start','last_clean_end'],text:['current_room','status','vacuum_error','dock_error','mop_intensity','mop_mode','cleaning_mode','selected_map','dust_collection_mode'],bool:['battery_charging','in_cleaning','water_shortage','mop_attached','water_box_attached','dirty_box_full','clean_box_empty','mop_drying_status','child_lock','dnd_switch','mop_drying'],clock:['dnd_start_time','dnd_end_time'],count:['total_cleaning_count']};
const kinds=new Map(Object.entries(groups).flatMap(([kind,keys])=>keys.map(key=>[key,kind]))),entities=/^(sensor|binary_sensor|select|switch|number|time)\.[a-z0-9_]+$/;
const labels={main_brush_time_left:'Hovedbørste',side_brush_time_left:'Sidebørste',filter_time_left:'Filter',sensor_time_left:'Sensorer',cleaning_brush_time_left:'Dockbørste',strainer_time_left:'Dockfilter',mop_drying_remaining_time:'Tørring tilbage',total_cleaning_area:'Samlet areal',total_cleaning_time:'Samlet tid',total_cleaning_count:'Rengøringer i alt',clean_box_empty:'Rent vand mangler',dirty_box_full:'Snavset vandbeholder fuld',water_shortage:'Vandmangel',mop_drying_status:'Moppetørring',mop_drying:'Moppetørring',battery:'Batteri',mop_attached:'Moppe monteret',water_box_attached:'Vandbeholder monteret',battery_charging:'Oplader',child_lock:'Børnelås',dnd_switch:'Forstyr ikke',dnd_start_time:'Forstyr ikke fra',dnd_end_time:'Forstyr ikke til',volume:'Robotens lydstyrke',mop_intensity:'Moppeintensitet',mop_mode:'Moppetilstand',cleaning_mode:'Rengøringstilstand',selected_map:'Valgt kort',dust_collection_mode:'Tømningstilstand',vacuum_error:'Robotfejl',dock_error:'Dockfejl'};
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
  const domain=row.entityId.split('.')[0],expected=['child_lock','dnd_switch','mop_drying'].includes(row.key)?'switch':kind==='bool'?'binary_sensor':row.key==='volume'?'number':kind==='clock'?'time':['mop_intensity','mop_mode','cleaning_mode','selected_map','dust_collection_mode'].includes(row.key)?'select':'sensor';if(expected!==domain)return unavailable();
  keys.add(row.key);seen.add(row.entityId);items.push({key:row.key,entityId:row.entityId,value:v,unit:u,updatedAt:row.updatedAt,retrievedAt:row.retrievedAt,stale:row.retrievedAt-row.updatedAt>300});
 }return {status:'observed',items};
}
export function robotFacts(device,now=Date.now()/1000){
 const items=device.telemetry?.status==='observed'?device.telemetry.items:[],fresh=row=>!device.stale&&!row.stale&&now-row.updatedAt<=300,byKey=new Map(items.map(row=>[row.key,row]));
 const active=device.status==='cleaning'&&!device.stale,summary=[];if(active){const room=byKey.get('current_room');if(room&&fresh(room))summary.push(room.value);for(const key of ['clean_percent','cleaning_area','cleaning_time']){const row=byKey.get(key);if(row&&fresh(row))summary.push(robotValue(row));}}
 const history=['last_clean_start','last_clean_end'].map(key=>byKey.get(key)).filter(Boolean).map(row=>({label:row.key==='last_clean_start'?'Senest startet':'Senest afsluttet',value:new Date(row.value*1000).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),stale:!fresh(row)}));
 const attention=['clean_box_empty','dirty_box_full','water_shortage'].map(key=>byKey.get(key)).filter(row=>row?.value===true&&fresh(row)).map(row=>labels[row.key]);
 for(const key of ['vacuum_error','dock_error']){const row=byKey.get(key);if(row&&fresh(row)&&!['none','no_error','ok','0'].includes(row.value.toLowerCase()))attention.push(`${labels[key]}: ${row.value.replaceAll('_',' ')}`);}
 const details=items.filter(row=>labels[row.key]).map(row=>({label:labels[row.key],value:robotValue(row),stale:!fresh(row)}));return {summary,history,attention,details};
}
export function robotValue(row){
 if(typeof row.value==='boolean')return row.value?'Ja':'Nej';if(typeof row.value==='string')return row.value.replaceAll('_',' ');const number=n=>n.toLocaleString('da-DK',{maximumFractionDigits:1});
 if(row.unit==='s')return `${number(row.value/60)} min`;if(row.unit==='min'||row.unit==='h')return `${number(row.value)} ${row.unit==='h'?'timer':'min'}`;if(row.unit==='m²')return `${number(row.value)} m²`;if(row.unit==='%')return `${number(row.value)} %`;return number(row.value);
}
