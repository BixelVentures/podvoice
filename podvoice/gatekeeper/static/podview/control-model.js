const text=(v,n=160)=>typeof v==='string'&&v.length>0&&v.length<=n;
const fail=()=>{throw Error('invalid_control_task');};
const choices=raw=>{if(!Array.isArray(raw)||!raw.length||raw.length>64)fail();const seen=new Set();return raw.map(x=>{if(!text(x?.id)||seen.has(x.id)||!text(x.label,128))fail();seen.add(x.id);return {id:x.id,label:x.label};});};
// Compare decimal representations, matching the owner's Decimal(str(...)) grid.
const numberGrid=(value,min,step)=>{
 const parts=[value,min,step].map(value=>{const [digits,exponent='0']=String(value).split('e'),decimal=digits.split('.');return {coefficient:BigInt(decimal.join('')),power:Number(exponent)-(decimal[1]?.length||0)};});
 const scale=Math.min(...parts.map(row=>row.power)),[valueInt,minInt,stepInt]=parts.map(row=>row.coefficient*10n**BigInt(row.power-scale));
 return (valueInt-minInt)%stepInt===0n;
};
const clock=value=>typeof value==='string'&&(value.length===5||value.length===8)&&/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
export function controlTask(raw,snapshot,domain,now=Date.now()){
 if(raw?.ok!==true||raw?.schema!=='podview.control.v1'||raw.roomId!==snapshot.roomId||raw.bootId!==snapshot.bootId||raw.domain!==domain||!['music','vacuum'].includes(domain)||!text(raw.taskId)||raw.revision!==1||!Number.isFinite(raw.expiresAt)||raw.expiresAt*1000<=now||raw.expiresAt*1000>now+300000||!Array.isArray(raw.options)||!raw.options.length||raw.options.length>16)fail();
 const seen=new Set();const options=raw.options.map(row=>{if(!text(row?.id)||seen.has(row.id)||!text(row.label,120)||!text(row.action,80))fail();seen.add(row.id);const s=row.argsSchema;let argsSchema;
  if(s?.kind==='none')argsSchema={kind:'none'};
  else if(domain==='music'&&row.action==='volume'&&s?.kind==='percent'&&s.min===0&&Number.isInteger(s.max)&&s.max>=0&&s.max<=100)argsSchema={kind:'percent',min:0,max:s.max};
  else if(domain==='vacuum'&&row.action==='set_option'&&s?.kind==='choice')argsSchema={kind:'choice',choices:choices(s.choices)};
  else if(domain==='vacuum'&&row.action==='set_option'&&s?.kind==='number'&&Object.keys(s).sort().join(',')==='current,kind,max,min,step,unit'&&Number.isFinite(s.min)&&Number.isFinite(s.max)&&Number.isFinite(s.step)&&s.step>0&&Number.isFinite(s.current)&&s.min<=s.current&&s.current<=s.max&&text(s.unit,24)&&numberGrid(s.current,s.min,s.step))argsSchema={kind:'number',min:s.min,max:s.max,step:s.step,unit:s.unit,current:s.current};
  else if(domain==='vacuum'&&row.action==='set_option'&&s?.kind==='time'&&Object.keys(s).sort().join(',')==='current,kind'&&clock(s.current))argsSchema={kind:'time',current:s.current};
  else if(domain==='vacuum'&&row.action==='start'&&s?.kind==='cleaning'&&s.repeat?.min===1&&s.repeat?.max===3)argsSchema={kind:'cleaning',areas:choices(s.areas),repeat:{min:1,max:3}};
  else fail();if(domain==='music'&&((row.action==='volume')!==(argsSchema.kind==='percent')))fail();if(domain==='music'&&!['pause','resume','next','previous','volume','move_existing_session'].includes(row.action))fail();if(domain==='vacuum'&&(row.action==='set_option'?!['choice','number','time'].includes(argsSchema.kind):({start:'cleaning',reuse:'none',resume:'none',pause:'none',stop:'none',return:'none'}[row.action]!==argsSchema.kind)))fail();return {id:row.id,label:row.label,action:row.action,argsSchema};
 });return {roomId:raw.roomId,bootId:raw.bootId,taskId:raw.taskId,revision:raw.revision,expiresAt:raw.expiresAt,domain,options,mapName:text(raw.setup?.mapName,128)?raw.setup.mapName:null,volume:Number.isInteger(raw.setup?.volume)&&raw.setup.volume>=0&&raw.setup.volume<=100?raw.setup.volume:null};
}
export function controlArgs(task,optionId,input={},now=Date.now()){
 if(task.expiresAt*1000<=now)throw Error('expired_control_task');const option=task.options.find(x=>x.id===optionId);if(!option)throw Error('unknown_control_option');const s=option.argsSchema;
 if(s.kind==='none'){if(Object.keys(input).length)throw Error('unexpected_control_args');return {};}
 if(s.kind==='percent'){if(Object.keys(input).some(k=>k!=='percent')||!Number.isInteger(input.percent)||input.percent<s.min||input.percent>s.max)throw Error('invalid_volume');return {percent:input.percent};}
 if(s.kind==='choice'){if(Object.keys(input).some(k=>k!=='choiceId')||!s.choices.some(x=>x.id===input.choiceId))throw Error('invalid_setting_choice');return {choiceId:input.choiceId};}
 if(s.kind==='number'){if(Object.keys(input).length!==1||!Object.hasOwn(input,'value')||!Number.isFinite(input.value)||input.value<s.min||input.value>s.max||!numberGrid(input.value,s.min,s.step))throw Error('invalid_setting_number');return {value:input.value};}
 if(s.kind==='time'){if(Object.keys(input).length!==1||!Object.hasOwn(input,'time')||!clock(input.time))throw Error('invalid_setting_time');return {time:input.time};}
 if(Object.keys(input).some(k=>!['areaIds','repeat'].includes(k))||!Array.isArray(input.areaIds)||!input.areaIds.length||new Set(input.areaIds).size!==input.areaIds.length||input.areaIds.some(id=>!s.areas.some(x=>x.id===id))||!Number.isInteger(input.repeat)||input.repeat<1||input.repeat>3)throw Error('invalid_cleaning_choice');return {areaIds:[...input.areaIds],repeat:input.repeat};
}
