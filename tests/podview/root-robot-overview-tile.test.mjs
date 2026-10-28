import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceTile,updateResourceTile,updateResourceFacts,resourceOverviewAction,applyResourceFactBudget} from '../../podvoice/gatekeeper/static/podview/ui/resource-tile.js';
import {devicePresentation} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {previewScene} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
function fixture(){
 const nodes=new Map();let doc;const make=(tag='span')=>({tagName:tag.toUpperCase(),ownerDocument:doc,children:[],dataset:{},className:'',textContent:'',hidden:false,attributes:new Map(),style:{display:'',values:new Map(),getPropertyValue(k){return this.values.get(k)||'';},setProperty(k,v){this.values.set(k,v);}},getAttribute(k){return this.attributes.get(k)??null;},setAttribute(k,v){this.attributes.set(k,String(v));},removeAttribute(k){this.attributes.delete(k);},append(...children){for(const child of children){child.remove();child.parentNode=this;this.children.push(child);}},insertBefore(child,before){child.remove();const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,child);child.parentNode=this;},remove(){if(this.parentNode){const index=this.parentNode.children.indexOf(this);if(index>=0)this.parentNode.children.splice(index,1);this.parentNode=null;}}});
 doc={createElement:make};for(const selector of ['strong','small','.resource-value','.resource-visual img','svg'])nodes.set(selector,make());
 const node={...make('button'),querySelector:selector=>nodes.get(selector)};return {node,nodes};
}
const robot=change=>devicePresentation({id:'vacuum.stable',kind:'vacuum',status:'docked',revision:7,...change});
test('domain-projected robot activity shares the retained tile without granting an overview action',()=>{
 const {node,nodes}=fixture(),r={kind:'vacuum',target:'robot',title:'Robotstøvsuger',status:'docked',displayState:'Vasker moppe',detail:'Turen er pauset ved basen',value:'86 %'};
 updateResourceTile(node,r);assert.equal(nodes.get('.resource-value').textContent,'Vasker moppe');assert.equal(nodes.get('small').textContent,'Turen er pauset ved basen');assert.equal(resourceOverviewAction(r,{connected:true,canControl:true,actions:[{id:'resume'}],size:'m'}),null,'a displayed activity is no effect authority');
 updateResourceTile(node,{...r,displayState:'Sidst kendt · Vasker moppe',stale:true});assert.equal(nodes.get('.resource-value').textContent,'Sidst kendt · Vasker moppe');
});
test('robot overview separates canonical heading, observed primary state and bounded battery without rebuilding nodes',()=>{
 const {node,nodes}=fixture(),refs=[...nodes.values()];updateResourceTile(node,robot({battery:76}));assert.equal(nodes.get('strong').textContent,'Robotstøvsuger');assert.equal(nodes.get('.resource-value').textContent,'Ved basen');assert.equal(node.resourceFacts.rows.get('battery').value.textContent,'76 %');assert.equal(nodes.get('small').textContent,'Batteri 76 %');assert.equal(node.resourceFacts.list.hidden,false);assert.equal(node.dataset.target,'vacuum.stable');
 updateResourceTile(node,robot({status:'cleaning',battery:75}));assert.equal(nodes.get('.resource-value').textContent,'Rengør');assert.equal(node.resourceFacts.rows.get('battery').value.textContent,'75 %');assert.deepEqual([...nodes.values()],refs);
 for(const battery of [undefined,null,NaN,-1,101]){updateResourceTile(node,robot({battery}));assert.equal(nodes.get('small').textContent,'');assert.equal(nodes.get('small').hidden,true);}updateResourceTile(node,robot({battery:0}));assert.equal(node.resourceFacts.rows.get('battery').value.textContent,'0 %');
});
test('pending preserves last observation, waits honestly and replaces feedback only with observed outcome',()=>{
 const {node,nodes}=fixture();updateResourceTile(node,robot({status:'cleaning',battery:76,pending:{action:'pause'}}));assert.equal(nodes.get('.resource-value').textContent,'Rengør');assert.equal(nodes.get('small').textContent,'Afventer svar · Batteri 76 %');assert.equal(node.resourceFacts.rows.get('battery').value.textContent,'76 %');assert.equal(node.getAttribute('aria-busy'),'true');
 updateResourceTile(node,robot({status:'paused',battery:76}));assert.equal(nodes.get('.resource-value').textContent,'Rengøring på pause');assert.equal(node.resourceFacts.rows.get('battery').value.textContent,'76 %');assert.equal(nodes.get('small').textContent,'Batteri 76 %');assert.equal(node.getAttribute('aria-busy'),'false');
 updateResourceTile(node,robot({status:'fault'}));assert.equal(nodes.get('.resource-value').textContent,'Kræver hjælp');assert.equal(nodes.get('small').textContent,'Børste blokeret · se enheden');
 updateResourceTile(node,robot({status:'unknown'}));assert.equal(nodes.get('.resource-value').textContent,'Ukendt');assert.equal(nodes.get('small').textContent,'Status ukendt · hent status igen');
});
test('unavailable and stale live observations never invent successful actions or fresh battery',()=>{
 const {node,nodes}=fixture();updateResourceTile(node,robot({live:true,status:'unavailable'}));assert.equal(nodes.get('.resource-value').textContent,'Ikke forbundet');assert.equal(nodes.get('small').hidden,true);
 updateResourceTile(node,robot({live:true,status:'docked',battery:76,stale:true}));assert.equal(nodes.get('.resource-value').textContent,'Sidst kendt · Ved basen');assert.equal(nodes.get('small').textContent,'Batteri 76 %');assert.equal(node.resourceFacts.rows.get('battery').value.textContent,'76 % · sidst kendt');assert.equal(node.dataset.target,'vacuum.stable');
});

test('actual offline Robot projection visibly qualifies the retained status at every size without granting a command',()=>{
 const scene=previewScene('robot-detail-offline'),device=scene.devices.find(row=>row.kind==='vacuum'),before=structuredClone(device);
 assert.equal(scene.connected,false);assert.notEqual(device.stale,true,'fixture transport loss is supplied by the current read connection');
 for(const size of ['s','m','l']){
  const {node,nodes}=fixture();node.overviewShell={dataset:{kitSize:size}};const online=devicePresentation(device,{connected:true});updateResourceTile(node,online);
  const value=nodes.get('.resource-value'),battery=node.resourceFacts.rows.get('battery');
  const projected=devicePresentation(device,{connected:scene.connected});updateResourceTile(node,projected);
  assert.equal(value.textContent,'Sidst kendt · Rengør');assert.equal(node.dataset.resourceStale,'true');assert.equal(node.dataset.target,device.id);assert.equal(node.disabled,false);assert.equal(battery.value.textContent,'76 % · sidst kendt');assert.equal(node.resourceFacts.rows.get('battery'),battery);assert.equal(projected.facts.some(row=>['room','progress'].includes(row.id)),false,'old room/progress is not represented as current telemetry');
  assert.equal(resourceOverviewAction(device,{connected:false,size,canControl:true,actions:[{id:'pause',label:'Pause'}]}),null);
  const insert=node.resourceFacts.list.insertBefore;node.resourceFacts.list.insertBefore=()=>assert.fail('unchanged presentation cannot reorder retained facts');updateResourceTile(node,structuredClone(projected));node.resourceFacts.list.insertBefore=insert;assert.equal(nodes.get('.resource-value'),value);
  updateResourceTile(node,online);assert.equal(value.textContent,'Rengør');assert.equal(node.dataset.resourceStale,'false');assert.equal(node.resourceFacts.rows.get('battery'),battery);
 }
 assert.deepEqual(device,before);assert.equal(devicePresentation(device).stale,false);assert.equal(devicePresentation(device,{connected:undefined}).stale,false);
 const zero=devicePresentation({...device,battery:0,stale:true});assert.equal(zero.stale,true);assert.equal(zero.facts.find(row=>row.id==='battery').value,'0 %');
});

test('unknown Robot observation retains its recovery role across large-card updates',()=>{
 const {node,nodes}=fixture();node.overviewShell={dataset:{kitSize:'l'}};const input=robot({status:'unknown',battery:76});updateResourceTile(node,input);
 const value=nodes.get('.resource-value'),recovery=nodes.get('small');assert.equal(value.textContent,'Ukendt');assert.equal(recovery.textContent,'Status ukendt · hent status igen');assert.equal(recovery.hidden,false);assert.equal(node.dataset.resourceFeedback,'unknown');
 updateResourceTile(node,structuredClone(input));assert.equal(nodes.get('small'),recovery);assert.equal(nodes.get('.resource-value'),value);
 updateResourceTile(node,robot({status:'cleaning',battery:76}));assert.equal(node.dataset.resourceFeedback,'');assert.equal(value.textContent,'Rengør');
});

test('M Robot metadata admits only fresh source room/progress/battery and hides unsupported values',()=>{
 const {node,nodes}=fixture(),now=Date.now()/1000,observation={status:'observed',items:[{key:'current_room',value:'Køkkenet',unit:null,stale:false,updatedAt:now,retrievedAt:now},{key:'clean_percent',value:38,unit:'%',stale:false,updatedAt:now,retrievedAt:now}]},input={live:true,status:'cleaning',battery:76,telemetry:observation};
 updateResourceTile(node,robot(input));assert.equal(nodes.get('.resource-value').textContent,'Rengør');assert.deepEqual(node.resourceFacts.items.map(row=>[row.id,row.value]),[['room','Køkkenet'],['progress','38 %'],['battery','76 %']]);assert.equal(nodes.get('small').textContent,'Batteri 76 % · Køkkenet');
 for(const value of [0,100]){const telemetry={...observation,items:[{...observation.items[1],value}]};updateResourceTile(node,robot({...input,telemetry}));assert.equal(node.resourceFacts.rows.get('progress').value.textContent,`${value} %`);assert.equal(node.resourceFacts.rows.get('battery').value.textContent,'76 %');}
 for(const change of [{value:null},{value:undefined},{value:NaN},{value:-1},{value:101},{value:'38'},{unit:null},{stale:true},{updatedAt:now-301},{updatedAt:now+30}]){const telemetry={...observation,items:[{...observation.items[1],...change}]},projected=robot({...input,battery:undefined,telemetry});assert.equal(Object.hasOwn(projected,'progress'),false);updateResourceTile(node,projected);assert.equal(nodes.get('small').textContent,'');assert.equal(nodes.get('small').hidden,true);}
 for(const change of [{status:'docked'},{status:'paused'},{stale:true},{presentationOnly:true},{telemetry:{status:'unavailable',items:observation.items}}])assert.equal(Object.hasOwn(robot({...input,...change}),'progress'),false);
 updateResourceTile(node,robot({...input,battery:null,telemetry:{status:'observed',items:[]}}));assert.equal(nodes.get('small').hidden,true);
});

test('S Light remains a single whole-tile navigation target across known, unknown and offline states',()=>{
 const {node}=fixture(),prior=globalThis.document,opened=[],listeners=new Map();node.addEventListener=(type,callback)=>listeners.set(type,callback);globalThis.document={createElement:tag=>{assert.equal(tag,'button');return node;}};
 try{const tile=createResourceTile(id=>opened.push(id));for(const status of ['on','off','mixed','unknown','fault','unavailable']){updateResourceTile(tile,{id:'light-stable',target:'light-stable',kind:'light',title:'Lys',status,detail:status});assert.equal(tile.disabled,false);assert.equal(resourceOverviewAction({kind:'light',status},{connected:true,canControl:true,actions:[{id:'turn_on',label:'Tænd'},{id:'turn_off',label:'Sluk'}]}),null);listeners.get('click')();}assert.deepEqual(opened,Array(6).fill('light-stable'));assert.deepEqual([...listeners.keys()],['click']);}finally{globalThis.document=prior;}
});

test('shared factual Card rows retain stable source identity, ignore missing data and never add effect handlers',()=>{
 const {node}=fixture();let action=0;node.click=()=>action++;updateResourceFacts(node,{facts:[null,{id:'missing',label:'Ukendt',value:null}],context:null});assert.equal(node.children.length,0);assert.equal(node.resourceFacts,undefined);
 const model={facts:[{id:'battery',label:'Batteri',value:0},{id:'invalid',label:'',value:'123'},{id:'source',label:'Kilde',value:'Actual <img> text',stale:true},{id:'battery',label:'Duplicate',value:100},{id:'empty',label:'Tom',value:'  '}],context:'Senest afsluttet 21. okt. 12.30'};
 const first=updateResourceFacts(node,model),battery=first.rows.get('battery'),source=first.rows.get('source');assert.equal(first.rows.size,2);assert.equal(battery.value.textContent,'0');assert.equal(source.value.textContent,'Actual <img> text · sidst kendt');assert.equal(first.list.getAttribute('role'),'list');assert.equal(first.list.children[0].getAttribute('role'),'listitem');assert.equal(first.context.textContent,model.context);assert.equal(node.dataset.factCount,'2');assert.equal(node.children.length,2);
 const oldInsert=first.list.insertBefore;first.list.insertBefore=()=>assert.fail('unchanged facts may not reorder retained rows');assert.equal(updateResourceFacts(node,structuredClone(model)),first);first.list.insertBefore=oldInsert;
 updateResourceFacts(node,{facts:[{id:'source',label:'Kilde',value:'Updated'},model.facts[0]],context:''});assert.equal(first.rows.get('battery'),battery);assert.equal(first.rows.get('source'),source);assert.deepEqual(first.list.children,[source.node,battery.node]);assert.equal(first.context.hidden,true);node.click();assert.equal(action,1);
 updateResourceFacts(node,{});assert.equal(first.list.hidden,true);assert.equal(first.context.hidden,true);assert.equal(first.rows.size,0);assert.equal(node.dataset.hasFacts,'false');node.click();assert.equal(action,2);
});

test('compact Light presents room power without showing admitted counts or inventing partial readings',()=>{
 const {node,nodes}=fixture(),lights=[{entityId:'light.one',name:'Loft',state:'on'},{entityId:'light.two',name:'Bord',state:'off'}],input={id:'light.home',kind:'light',live:true,source:'home_assistant_state',status:'mixed',observedLights:lights};
 updateResourceTile(node,devicePresentation(input));assert.equal(nodes.get('.resource-value').textContent,'Tændt');assert.equal(nodes.get('.resource-value').hidden,false);assert.equal(nodes.get('small').textContent,'');assert.equal(node.dataset.hasOverviewValue,'true');
 updateResourceTile(node,devicePresentation({...input,stale:true}));assert.equal(nodes.get('.resource-value').textContent,'Sidst kendt · Tændt');assert.equal(nodes.get('small').textContent,'');
 updateResourceTile(node,devicePresentation({...input,observedLights:[lights[0],{...lights[1],state:'unknown'}]}));assert.equal(nodes.get('.resource-value').hidden,true);assert.equal(node.dataset.hasOverviewValue,'false');assert.equal(node.resourceFacts?.items.some(row=>row.id==='on-count')||false,false);assert.match(nodes.get('small').textContent,/ukendt/i);assert.doesNotMatch(nodes.get('small').textContent,/\d+ af \d+/);
 updateResourceTile(node,devicePresentation({kind:'light',live:true,status:'unavailable'}));assert.equal(nodes.get('.resource-value').hidden,true);assert.equal(nodes.get('.resource-value').textContent,'');assert.equal(node.disabled,true,'no missing navigation target is invented');
});


test('S M L Robot retain one status and identical inline battery while Large may add distinct facts',()=>{
 const {node,nodes}=fixture(),now=Date.now()/1000,fact=(key,value,unit)=>({key,value,unit,updatedAt:now,retrievedAt:now,stale:false}),model=robot({battery:76,telemetry:{status:'observed',items:[fact('cleaning_area',12.5,'m²'),fact('cleaning_time',10,'min'),fact('cleaning_mode','vac_and_mop',null)]}});node.overviewShell={dataset:{kitSize:'m'}};updateResourceTile(node,model);assert.equal(nodes.get('.resource-value').textContent,'Ved basen');assert.equal(nodes.get('small').textContent,'Batteri 76 %');assert.doesNotMatch(nodes.get('small').textContent,/Seneste|12,5|10 min|Støvsugning/);const rows=[...node.resourceFacts.rows.values()];assert.ok(node.resourceFacts.items.some(item=>item.id==='cleaning_mode'));node.overviewShell.dataset.kitSize='l';updateResourceTile(node,model);assert.equal(nodes.get('small').textContent,'Batteri 76 %');assert.deepEqual([...node.resourceFacts.rows.values()],rows);node.overviewShell.dataset.kitSize='s';updateResourceTile(node,model);assert.equal(nodes.get('small').textContent,'Batteri 76 %');delete node.overviewShell;node.parentNode={id:'resource-rail'};updateResourceTile(node,model);assert.equal(nodes.get('small').textContent,'');
});


test('unconnected placeholder names come from the actual domain and rendered status',()=>{
 for(const [kind,label]of [['vacuum','Robotstøvsuger'],['light','Lys']]){
  const {node,nodes}=fixture(),presentation=devicePresentation({id:`empty-${kind}`,kind,status:'unavailable',live:true,presentationOnly:true});
  updateResourceTile(node,{...presentation,target:`empty-${kind}`,detail:'Ikke forbundet'});
  assert.equal(nodes.get('strong').textContent,label);assert.equal(nodes.get(kind==='vacuum'?'.resource-value':'small').textContent,'Ikke forbundet');assert.equal(node.disabled,false);assert.equal(node.getAttribute('aria-label'),null);
 }
});

test('resource titles retain full accessible source and responsive short roles before size is applied',()=>{
 for(const [kind,full,short]of [['vacuum','Robotstøvsuger','Robot'],['light','Lys i den lange stue','Lys'],['timer','Pasta til aftensmad','Timer'],['vehicle','Familiebilen','Tesla']]){
  const {node,nodes}=fixture(),title=nodes.get('strong'),fullTitle=node.ownerDocument.createElement('span'),shortTitle=node.ownerDocument.createElement('span');
  fullTitle.className='resource-title-full';shortTitle.className='resource-title-short';shortTitle.setAttribute('aria-hidden','true');title.append(fullTitle,shortTitle);title.querySelector=selector=>selector==='.resource-title-full'?fullTitle:selector==='.resource-title-short'?shortTitle:null;
  const input={target:kind,kind,title:full,status:'unknown',detail:''};updateResourceTile(node,input);
  assert.equal(fullTitle.textContent,full);assert.equal(fullTitle.getAttribute('aria-hidden'),null);assert.equal(shortTitle.textContent,short);assert.equal(shortTitle.getAttribute('aria-hidden'),'true');
  for(const size of ['s','m','l']){node.dataset.kitSize=size;updateResourceTile(node,input);assert.deepEqual(title.children,[fullTitle,shortTitle]);assert.equal(fullTitle.textContent,full);assert.equal(shortTitle.textContent,short);}
  updateResourceTile(node,{...input,title:`${full} opdateret`});assert.equal(fullTitle.textContent,`${full} opdateret`);assert.equal(shortTitle.textContent,short);assert.equal(node.getAttribute('aria-label'),null);
 }
 const {node}=fixture(),prior=globalThis.document;node.addEventListener=()=>{};globalThis.document={createElement:()=>node};try{createResourceTile(()=>{});assert.match(node.innerHTML,/<span class="resource-title-full"><\/span><span class="resource-title-short" aria-hidden="true"><\/span>/);}finally{globalThis.document=prior;}
});



test('Light power replaces counts across sizes and retains honest freshness/pending/unknown states',()=>{
 const input={id:'light.actual',kind:'light',live:true,source:'home_assistant_state',status:'mixed',observedLights:[{entityId:'light.one',name:'Loft',state:'on',brightness:128},{entityId:'light.two',name:'Bord',state:'off',brightness:0}]};
 for(const size of ['s','m','l']){
  const {node,nodes}=fixture();node.overviewShell={dataset:{kitSize:size}};const value=nodes.get('.resource-value'),detail=nodes.get('small'),update=change=>updateResourceTile(node,devicePresentation({...input,...change}));
  update({});assert.equal(value.textContent,'Tændt');assert.equal(detail.textContent,'');assert.equal(node.dataset.resourceStale,'false');
  update({stale:true});assert.equal(value.textContent,'Sidst kendt · Tændt');assert.equal(detail.textContent,'');assert.equal(node.dataset.resourceStale,'true');assert.doesNotMatch(detail.textContent,/1 af 2/);
  update({pending:{action:'turn_off'}});assert.equal(value.textContent,'Afventer svar · Tændt');assert.equal(detail.textContent,'');assert.equal(node.getAttribute('aria-busy'),'true');
  update({status:'unknown'});assert.equal(value.hidden,true);assert.equal(value.textContent,'');assert.match(detail.textContent,/ukendt/i);assert.equal(node.dataset.hasOverviewValue,'false');assert.equal(node.getAttribute('aria-busy'),'false');
  update({});assert.equal(value.hidden,false);assert.equal(detail.textContent,'');assert.equal(nodes.get('.resource-value'),value);assert.equal(nodes.get('small'),detail);assert.equal(node.dataset.target,input.id);assert.equal(resourceOverviewAction(input,{size,live:true,connected:true,canControl:true}),null);
 }
});

test('Light count suppression is presentation-only in S M L and power does not parse numeric count copy',()=>{
 for(const size of ['s','m','l']){
  const {node,nodes}=fixture();node.overviewShell={dataset:{kitSize:size}};
  for(const status of ['on','mixed','off']){
   const facts=[{id:'on-count',label:'Tændt',value:'0 af 99'},{id:'brightness:one',label:'Loft',value:'40 %'}],input={kind:'light',target:'lights',title:'Lys',status,facts},before=structuredClone(input);updateResourceTile(node,input);
   assert.equal(nodes.get('.resource-value').textContent,status==='off'?'Slukket':'Tændt','admitted state owns power; count is not reverse-parsed');assert.equal(node.resourceFacts.rows.has('on-count'),false);assert.deepEqual(node.resourceFacts.items.map(row=>row.id),['brightness:one']);assert.deepEqual(input,before,'rendering never removes factual counts from source');
  }
 }
});

test('Large limits distinct extra facts to four without dropping retained source rows or duplicating its core',()=>{
 const {node,nodes}=fixture();node.overviewShell={dataset:{kitSize:'l'}};
 const facts=[['battery','Batteri','76 %'],['area','Seneste areal','12,5 m²'],['duration','Seneste varighed','10 min'],['mode','Tilstand','Støvsugning og gulvvask'],['map','Kort','Stueetagen'],['finished','Senest afsluttet','22. okt.']].map(([id,label,value])=>({id,label,value}));
 const model={kind:'vacuum',title:'Robotstøvsuger',status:'docked',resourceStatus:'docked',value:'76 %',facts};
 updateResourceTile(node,model);assert.equal(nodes.get('small').textContent,'Batteri 76 %');assert.equal(node.resourceFacts.items.length,6);
 assert.deepEqual([...node.resourceFacts.rows].filter(([,row])=>!row.node.hidden).map(([id])=>id),['area','duration','mode','map']);
 const retained=node.resourceFacts.rows.get('finished').node;node.overviewShell.dataset.kitSize='m';updateResourceTile(node,model);assert.equal(retained.hidden,false);assert.equal(node.resourceFacts.rows.get('finished').node,retained);
});

test('Large fact budget counts native meter spans, aligns full rows and restores retained source rows for S and M',()=>{
 const {node}=fixture();node.overviewShell={dataset:{kitSize:'l'}};
 const input={kind:'vacuum',title:'Robotstøvsuger',status:'cleaning',target:'robot',facts:[{id:'battery',label:'Batteri',value:'76 %'},{id:'progress',label:'Fremskridt',value:'38 %',meter:{value:38,max:100}},{id:'area',label:'Areal',value:'12,5 m²'},{id:'duration',label:'Tid',value:'10 min'},{id:'mode',label:'Tilstand',value:'Støvsugning og gulvvask'},{id:'map',label:'Kort',value:'Stueplan'}]};
 const shown=()=>node.resourceFacts.list.children.filter(row=>!row.hidden).map(row=>row.dataset.factId);updateResourceTile(node,input);const rows=new Map(node.resourceFacts.rows),meter=rows.get('progress').meter;
 assert.deepEqual(shown(),['progress','area','duration'],'one full-row meter plus two cells consumes exactly two grid rows');
 node.overviewAction={hidden:false,disabled:false};applyResourceFactBudget(node);assert.deepEqual(shown(),['progress'],'the actual visible direct action reserves the second grid row');node.overviewAction.disabled=true;applyResourceFactBudget(node);assert.deepEqual(shown(),['progress'],'pending disabled action still reserves its row');
 let writes=0;for(const row of rows.values()){let hidden=row.node.hidden;Object.defineProperty(row.node,'hidden',{get:()=>hidden,set:value=>{writes++;hidden=value;}});}applyResourceFactBudget(node);updateResourceTile(node,input);assert.equal(writes,0,'an unchanged budget performs no visibility writes');
 node.overviewAction.hidden=true;applyResourceFactBudget(node);assert.deepEqual(shown(),['progress','area','duration']);
 for(const size of ['s','m']){node.overviewShell.dataset.kitSize=size;updateResourceTile(node,input);assert.equal(shown().length,6);for(const [id,row]of rows)assert.equal(node.resourceFacts.rows.get(id),row);assert.equal(node.resourceFacts.rows.get('progress').meter,meter);}
 node.overviewShell.dataset.kitSize='l';updateResourceTile(node,input);assert.deepEqual(shown(),['progress','area','duration']);
 const ordered={...input,facts:[input.facts[2],input.facts[1],input.facts[3],input.facts[4]]};updateResourceTile(node,ordered);assert.deepEqual(shown(),['area','progress'],'a meter after an odd single cell begins the next row rather than creating a third');node.overviewAction.hidden=false;applyResourceFactBudget(node);assert.deepEqual(shown(),['area','duration'],'an over-budget full-row meter is retained hidden while a later single cell can use the remaining first row');assert.equal(node.resourceFacts.rows.get('progress').meter,meter);
});

test('observed dock activity is identical in shared detail label and overview without action authority',()=>{
 const now=Date.now()/1000,d={id:'robot',kind:'vacuum',status:'docked',live:true,telemetry:{status:'observed',items:[{key:'status',value:'washing_the_mop',updatedAt:now,stale:false}]}};
 const projected=devicePresentation(d);assert.equal(projected.displayState,'Vasker moppe');assert.equal(projected.detail,'Vasker moppe');
 const {node,nodes}=fixture();updateResourceTile(node,projected);assert.equal(nodes.get('.resource-value').textContent,'Vasker moppe');assert.equal(resourceOverviewAction(projected,{connected:true,canControl:true,actions:[{id:'resume'}]}),null);
 const stale=devicePresentation(d,{connected:false});assert.equal(stale.displayState,'Sidst kendt: Vasker moppe');
});

test('source-bound error guidance and active dock work share overview priority and concrete state',async()=>{const {deviceLabel,overviewPriorities}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js'),now=Date.now()/1000,device={id:'robot',kind:'vacuum',live:true,status:'fault',telemetry:{status:'observed',items:[{key:'vacuum_error',value:'main_brush_jammed',unit:null,updatedAt:now,retrievedAt:now,stale:false}]}};assert.equal(deviceLabel(device),'Hovedbørsten sidder fast');assert.equal(devicePresentation(device).displayState,deviceLabel(device));const wash={...device,status:'docked',telemetry:{status:'observed',items:[{key:'mop_washing',value:true,updatedAt:now,stale:false}]}};assert.equal(overviewPriorities({devices:[wash]}).find(row=>row.id==='robot').priority,'active');assert.equal(overviewPriorities({devices:[{...wash,stale:true}]}).find(row=>row.id==='robot').priority,'useful');});

test('custom robot primary status is not repeated in secondary copy and retains actual battery or pending feedback',()=>{
 const {node,nodes}=fixture(),robot={kind:'vacuum',target:'r',title:'Robot',status:'docked',displayState:'Vasker moppe',detail:'Vasker moppe',value:'86 %'};updateResourceTile(node,robot);assert.equal(nodes.get('.resource-value').textContent,'Vasker moppe');assert.equal(nodes.get('small').textContent,'Batteri 86 %');updateResourceTile(node,{...robot,displayState:'Sidst kendt: Vasker moppe',detail:'Sidst kendt · Vasker moppe',stale:true});assert.equal(nodes.get('small').textContent,'Batteri 86 %');updateResourceTile(node,{...robot,pending:true});assert.equal(nodes.get('small').textContent,'Afventer svar · Batteri 86 %');updateResourceTile(node,{...robot,status:'fault',displayState:'Hovedbørsten sidder fast',detail:'Hovedbørsten sidder fast'});assert.equal(nodes.get('small').textContent,'Batteri 86 %');
});
