import test from 'node:test';import assert from 'node:assert/strict';import {controlTask,controlArgs} from '../../podvoice/gatekeeper/static/podview/control-model.js';
const snapshot={roomId:'room',bootId:'boot'},now=Date.now();const task=()=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',taskId:'task',revision:1,expiresAt:now/1000+30,domain:'music',options:[{id:'volume-option',label:'Lydstyrke',action:'volume',argsSchema:{kind:'percent',min:0,max:50}}]});
test('control authority requires exact room/boot, short expiry and server offered option',()=>{const t=controlTask(task(),snapshot,'music',now);assert.deepEqual(controlArgs(t,'volume-option',{percent:35},now),{percent:35});assert.throws(()=>controlArgs(t,'volume-option',{percent:51},now));assert.throws(()=>controlArgs(t,'volume-option',{percent:35,entity_id:'another'},now));assert.throws(()=>controlArgs(t,'other',{},now));assert.throws(()=>controlArgs(t,'volume-option',{percent:35},now+31000));for(const mutate of [v=>v.roomId='other',v=>v.bootId='old',v=>v.options.push(v.options[0]),v=>v.options[0].action='transfer',v=>v.expiresAt+=300]){const v=task();mutate(v);assert.throws(()=>controlTask(v,snapshot,'music',now));}});
test('robot settings and areas accept only opaque server choices, never raw HA service args',()=>{const v={...task(),domain:'vacuum',options:[{id:'setting',label:'Indstilling',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'quiet-id',label:'Stille'}]}},{id:'clean',label:'Start rengøring',action:'start',argsSchema:{kind:'cleaning',areas:[{id:'area-option',label:'Køkken'}],repeat:{min:1,max:3}}}]};const t=controlTask(v,snapshot,'vacuum',now);assert.deepEqual(controlArgs(t,'setting',{choiceId:'quiet-id'},now),{choiceId:'quiet-id'});assert.deepEqual(controlArgs(t,'clean',{areaIds:['area-option'],repeat:2},now),{areaIds:['area-option'],repeat:2});assert.throws(()=>controlArgs(t,'clean',{areaIds:['vacuum.actual'],repeat:1},now));assert.throws(()=>controlArgs(t,'clean',{areaIds:['area-option','area-option'],repeat:1},now));assert.throws(()=>controlArgs(t,'setting',{choiceId:'silent'},now));});
test('vacuum action names and argument schemas exactly match the owner contract',()=>{for(const [action,kind] of [['resume','none'],['pause','none'],['stop','none'],['return','none'],['reuse','none']]){const raw={...task(),domain:'vacuum',options:[{id:'choice',label:'Handling',action,argsSchema:{kind}}]};assert.equal(controlTask(raw,snapshot,'vacuum',now).options[0].action,action);for(const change of [x=>x.action='vacuum.pause',x=>x.action='set_option',x=>x.action='start']){const bad=structuredClone(raw);change(bad.options[0]);assert.throws(()=>controlTask(bad,snapshot,'vacuum',now));}}});

test('setup must be explicitly successful',()=>{for(const ok of [false,undefined,null,1])assert.throws(()=>controlTask({...task(),ok},snapshot,'music',now));});

test('admitted128character robot names remain usable with exact IDs',()=>{
 const label='Æ'.repeat(128),raw={...task(),domain:'vacuum',setup:{mapName:label},options:[{id:'clean',label:'Start rengøring',action:'start',argsSchema:{kind:'cleaning',areas:[{id:'room-opaque',label}],repeat:{min:1,max:3}}},{id:'setting',label:'Moppetilstand',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'setting-opaque',label}]}}]};
 const admitted=controlTask(raw,snapshot,'vacuum',now);assert.equal(admitted.mapName,label);assert.equal(admitted.options[0].argsSchema.areas[0].label,label);assert.deepEqual(controlArgs(admitted,'clean',{areaIds:['room-opaque'],repeat:3},now),{areaIds:['room-opaque'],repeat:3});assert.deepEqual(controlArgs(admitted,'setting',{choiceId:'setting-opaque'},now),{choiceId:'setting-opaque'});
 for(const optionIndex of [0,1]){const invalid=structuredClone(raw),schema=invalid.options[optionIndex].argsSchema;(schema.areas||schema.choices)[0].label+='x';assert.throws(()=>controlTask(invalid,snapshot,'vacuum',now));}assert.throws(()=>controlArgs(admitted,'setting',{choiceId:label},now));
});


test('move control only admits the music none-args option; raw destinations are never action args',()=>{const raw={...task(),options:[{id:'move:'+'a'.repeat(64),label:'Flyt til Svend',action:'move_existing_session',argsSchema:{kind:'none'}}]};const admitted=controlTask(raw,snapshot,'music',now);assert.deepEqual(controlArgs(admitted,raw.options[0].id,{},now),{});assert.throws(()=>controlArgs(admitted,raw.options[0].id,{speakerId:'a'.repeat(64)},now));assert.throws(()=>controlTask({...raw,domain:'vacuum'},snapshot,'vacuum',now));});

const settingsTask=(schema)=>({...task(),domain:'vacuum',options:[{id:'setting-owner',label:'Robotindstilling',action:'set_option',argsSchema:schema}]});
const volumeSchema=()=>({kind:'number',min:0,max:100,step:1,unit:'%',current:90});
test('robot numeric settings preserve current and admit only exact finite primitive grid values',()=>{
 const admitted=controlTask(settingsTask(volumeSchema()),snapshot,'vacuum',now);assert.deepEqual(admitted.options[0].argsSchema,volumeSchema());
 for(const value of [0,75,90,100])assert.deepEqual(controlArgs(admitted,'setting-owner',{value},now),{value});
 for(const value of [true,false,'75','',null,NaN,Infinity,-Infinity,-1,101,75.5,75.00000000000001])assert.throws(()=>controlArgs(admitted,'setting-owner',{value},now));
 for(const args of [{},{value:75,entity_id:'another'},{value:75,time:'22:00'}])assert.throws(()=>controlArgs(admitted,'setting-owner',args,now));
 for(const mutate of [s=>s.min=false,s=>s.max=Infinity,s=>s.min=101,s=>s.step=0,s=>s.step='1',s=>s.unit=null,s=>s.current=90.5,s=>s.current=101,s=>s.current='90',s=>s.extra=true]){const s=volumeSchema();mutate(s);assert.throws(()=>controlTask(settingsTask(s),snapshot,'vacuum',now));}
});
test('numeric setting grids match decimal source values without floating rounding permission',()=>{
 const schema={kind:'number',min:0.1,max:1,step:0.1,unit:'%',current:0.3};const admitted=controlTask(settingsTask(schema),snapshot,'vacuum',now);
 for(const value of [0.1,0.3,0.7,1])assert.deepEqual(controlArgs(admitted,'setting-owner',{value},now),{value});
 for(const value of [0.30000000000000004,0.25,0,1.1])assert.throws(()=>controlArgs(admitted,'setting-owner',{value},now));
});
test('DND time settings preserve exact HHMM or HHMMSS and never infer dates or timezone',()=>{
 const admitted=controlTask(settingsTask({kind:'time',current:'22:00:00'}),snapshot,'vacuum',now);
 for(const time of ['00:00','22:00','23:59:59','01:02:03'])assert.deepEqual(controlArgs(admitted,'setting-owner',{time},now),{time});
 for(const time of ['24:00','23:60','22:00:60','2:00','22:00Z','2026-10-16T22:00:00','22:00:00.5',' 22:00','22:00 ','22:00\n','22:00:00\r\n','22:00\u2028',22,true,null]){assert.throws(()=>controlArgs(admitted,'setting-owner',{time},now));assert.throws(()=>controlTask(settingsTask({kind:'time',current:time}),snapshot,'vacuum',now));}
 for(const args of [{},{time:'22:00',value:22},{time:'22:00',entity_id:'another'}])assert.throws(()=>controlArgs(admitted,'setting-owner',args,now));
 assert.throws(()=>controlTask(settingsTask({kind:'time',current:'22:00',timezone:'UTC'}),snapshot,'vacuum',now));
 for(const schema of [volumeSchema(),{kind:'time',current:'22:00'}, {kind:'unknown',current:'22:00'}])assert.throws(()=>controlTask({...settingsTask(schema),domain:'music'},snapshot,'music',now));
});
