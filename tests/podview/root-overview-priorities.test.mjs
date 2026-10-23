import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewPriorities,sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
test('overview fixes timer/weather/robot/light/vehicle/music/radio order regardless of state',()=>{
 const rows=overviewPriorities({timers:[{status:'running'}],mediaActive:true,devices:[{id:'robot',kind:'vacuum',status:'cleaning'},{id:'light',kind:'light',status:'unavailable'}]});
 assert.deepEqual(rows.map(row=>row.id),['timer-card','home-weather','robot','light','home-vehicle','home-music','home-radio']);
 assert.equal(rows.find(row=>row.id==='home-music').priority,'secondary');assert.equal(rows.find(row=>row.id==='light').priority,'unavailable');assert.equal(rows.find(row=>row.id==='home-weather').priority,'useful');
});
test('calm overview retains useful access, no hidden device resurrected and no fabricated availability',()=>{
 const data={devices:[{id:'robot',kind:'vacuum',status:'docked'},{id:'light',kind:'light',status:'off'},{id:'hidden',kind:'vacuum',status:'cleaning',hidden:true}],timers:[{status:'done',hidden:true}]};
 const rows=overviewPriorities(data);assert.deepEqual(rows.map(row=>row.id),['timer-card','home-weather','robot','light','home-vehicle','home-music','home-radio']);assert.deepEqual(overviewPriorities(data),rows);assert.equal(rows.find(row=>row.id==='home-vehicle').priority,'unavailable');
});
test('actual host slots stay fixed while state appearance updates and preserve scroll/player state',async()=>{
 const {readFileSync}=await import('node:fs'),{timersFor}=await import('../../podvoice/gatekeeper/static/podview/timer-model.js');
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),method=source.slice(source.indexOf(' alignOverview(){'),source.indexOf('\n renderOverviewMediaCards(')).trim();
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},style:{},scrollTop:53});return nodes.get(id);};
 const align=new Function('$','overviewPriorities','timersFor','getComputedStyle',`return function ${method}`)(node,overviewPriorities,timersFor,()=>({getPropertyValue:()=>0}));
 const style={getPropertyValue:()=>'',setProperty(){}},host={state:{focus:'now',devices:[{id:'robot',kind:'vacuum',status:'docked'}],timer:null,extraTimers:[]},dataset:{playback:'active'},style,deviceRows:new Map([['robot',node('robot')]])};
 align.call(host);const initial=node('robot').style.order;host.state.devices[0].status='cleaning';align.call(host);assert.equal(node('robot').style.order,initial);assert.equal(node('robot').dataset.overviewPriority,'active');
 host.state.focus='robot';align.call(host);host.state.focus='now';align.call(host);assert.equal(node('robot').style.order,'3');assert.equal(node('robot').dataset.overviewPriority,'active');assert.equal(node('robot').scrollTop,53);assert.equal(host.dataset.playback,'active');
});

test('ranked overview uses actual retained DOM order, keeps focus/scroll, and does not move cards on ticks',async()=>{
 const {readFileSync}=await import('node:fs'),{timersFor}=await import('../../podvoice/gatekeeper/static/podview/timer-model.js');
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),method=source.slice(source.indexOf(' alignOverview(){'),source.indexOf('\n renderOverviewMediaCards(')).trim();
 const doc={activeElement:null},feed={scrollTop:53};let moves=0;
 class Node{
  constructor(id){this.id=id;this.dataset={};this.style={};this.children=[];this.parentNode=null;this.isConnected=true;}
  get firstChild(){return this.children[0]||null;}get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  querySelector(){return this.children.find(n=>n.id==='heading')||null;}
  insertBefore(node,before){if(node.parentNode)node.parentNode.children.splice(node.parentNode.children.indexOf(node),1);this.children.splice(before?this.children.indexOf(before):this.children.length,0,node);node.parentNode=this;moves++;feed.scrollTop=0;if(doc.activeElement===node)doc.activeElement=null;}
  focus(options){assert.deepEqual(options,{preventScroll:true});doc.activeElement=this;}
  remove(){if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;this.isConnected=false;}
 }
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},overview=get('now-view'),wrapper=get('wrapper');overview.insertBefore(get('heading'),null);overview.insertBefore(wrapper,null);
 for(const id of ['home-weather','home-music','robot','light','timer-card','home-radio','home-vehicle'])wrapper.insertBefore(get(id),null);
 feed.scrollTop=53;doc.activeElement=get('home-music');moves=0;
 const align=new Function('$','overviewPriorities','timersFor','getComputedStyle',`return function ${method}`)(id=>nodes.get(id)||null,overviewPriorities,timersFor,()=>({getPropertyValue:()=>0}));
 const host={state:{focus:'now',devices:[{id:'robot',kind:'vacuum',status:'cleaning'},{id:'light',kind:'light',status:'unavailable'}],timer:{id:'t',status:'running'},extraTimers:[]},dataset:{playback:'active'},style:{getPropertyValue:()=>'',setProperty(){}},deviceRows:new Map([['robot',get('robot')],['light',get('light')]]),ownerDocument:doc,querySelector:()=>feed};
 align.call(host);
 const ranked=()=>overview.children.filter(n=>n.dataset.overviewRank).map(n=>n.id);
 assert.deepEqual(ranked(),['timer-card','home-weather','robot','light','home-vehicle','home-music','home-radio']);
 assert.equal(wrapper.children.length,0);assert.equal(doc.activeElement,get('home-music'));assert.equal(feed.scrollTop,53);
 const firstMoves=moves;for(let i=0;i<10;i++)align.call(host);assert.equal(moves,firstMoves);
 // Real timer transitions must change content, never spatial or keyboard order.
 const fixed=ranked();host.state={...host.state,connected:true,timer:null,timerSerial:0,timerHistory:[]};
 for(const stage of ['idle','running','done','cancelled']){
  if(stage==='running')host.state=sceneTransition(host.state,{type:'timer-start',name:'Pasta',seconds:60,now:1000});
  if(stage==='done')host.state=sceneTransition(host.state,{type:'tick',now:61000});
  if(stage==='cancelled')host.state=sceneTransition(host.state,{type:'timer',id:host.state.timer.id,action:'cancel'});
  align.call(host);assert.deepEqual(ranked(),fixed,stage);assert.equal(moves,firstMoves,stage);assert.equal(feed.scrollTop,53);assert.equal(doc.activeElement,get('home-music'));
  assert.equal(get('timer-card').dataset.overviewRank,'1');assert.equal(get('timer-card').dataset.overviewPriority,['running','done'].includes(stage)?'active':'useful');
  host.state.focus='weather';align.call(host);host.state.focus='now';align.call(host);assert.deepEqual(ranked(),fixed,stage+' return');
 }

 host.state.devices[0].status='docked';align.call(host);assert.equal(moves,firstMoves);
 host.state.focus='weather';align.call(host);host.state.focus='now';align.call(host);
 assert.deepEqual(ranked(),['timer-card','home-weather','robot','light','home-vehicle','home-music','home-radio']);assert.equal(feed.scrollTop,53);assert.equal(doc.activeElement,get('home-music'));
 // Exercise the actual resource cleanup against cards already moved out of the adapter.
 const cleanupSource=source.slice(source.indexOf(' for(const [id,node] of this.deviceNodes)'),source.indexOf(' for(const [index,d] of deviceRows.entries())'));
 const cleanup=new Function('deviceRows',cleanupSource),oldRobot=get('robot');
 host.deviceNodes=new Map([['robot',new Node('robot-detail')],['light',new Node('light-detail')]]);
 host.state.devices=host.state.devices.filter(d=>d.id!=='robot');cleanup.call(host,host.state.devices);nodes.delete('robot');align.call(host);
 assert.equal(oldRobot.parentNode,null);assert.equal(host.deviceRows.has('robot'),false);assert.equal(host.deviceNodes.has('robot'),false);assert.equal(ranked().includes('robot'),false);
 const replacement=get('robot');wrapper.insertBefore(replacement,null);host.deviceRows.set('robot',replacement);host.deviceNodes.set('robot',new Node('robot-detail'));host.state.devices.push({id:'robot',kind:'vacuum',status:'docked'});align.call(host);
 assert.equal(overview.children.filter(n=>n.id==='robot').length,1);assert.notEqual(replacement,oldRobot);assert.equal(replacement.parentNode,overview);
 // The actual device refresh guard must not send direct cards back to their adapter.
 const guard=source.match(/if\(!row\.overviewShell&&row\.parentNode!==\$\('now-view'\).*?activities\.insertBefore\(row,activities\.children\[index\]\|\|null\);/)[0];
 const refresh=new Function('$','activities','row','index',guard),afterReappearance=moves;
 for(let i=0;i<10;i++){refresh(id=>nodes.get(id),wrapper,replacement,0);align.call(host);}
 assert.equal(moves,afterReappearance);assert.equal(replacement.parentNode,overview);
 for(const node of overview.children)assert.equal(node.tabIndex,undefined);
});

test('device refresh retains direct overview cards and library selectors follow the same canonical nodes',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
 assert.match(source,/row\.parentNode!==\$\('now-view'\)&&activities\.children\[index\]!==row/);
 const {productLibrary}=await import('../../podvoice/gatekeeper/static/podview/library-catalog.js');
 for(const [familyId,kind] of [['robot','vacuum'],['lights','light']]){
  const family=productLibrary.find(item=>item.id===familyId);
  for(const sample of family.states.filter(item=>item.stage.includes('-overview-')))assert.equal(sample.selector,`#now-view > [data-kind="${kind}"]`,'isolate the complete direct-child shell, never its nested preview button');
  for(const sample of family.states.filter(item=>item.stage.includes('-rest-')))assert.equal(sample.selector,`#resource-rail [data-kind="${kind}"]`,'Ro keeps its existing resource renderer');
 }
});

test('automatic Radio M follows the actual broad timer projection and preserves authored library sizes',async()=>{
 const {readFileSync}=await import('node:fs'),{initialScene}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js'),{timerPresentation}=await import('../../podvoice/gatekeeper/static/podview/timer-view.js'),{timersFor}=await import('../../podvoice/gatekeeper/static/podview/timer-model.js'),{localRadioTransition}=await import('../../podvoice/gatekeeper/static/podview/radio-model.js');
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),alignSource=source.slice(source.indexOf(' alignOverview(){'),source.indexOf('\n renderOverviewMediaCards(')).trim(),timerSource=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/timer-view.js',import.meta.url),'utf8');
 const timerEnd=timerSource.indexOf('\n render',timerSource.indexOf(' renderOverviewActivities(s){')+2),activityBody=timerSource.slice(timerSource.indexOf(' renderOverviewActivities(s){'),timerEnd>0?timerEnd:timerSource.length).trim();
 // Extract exactly one existing method without importing the custom element host.
 const methodStart=activityBody.indexOf('{');let depth=1,index=methodStart+1;for(;index<activityBody.length&&depth;index++){if(activityBody[index]==='{')depth++;if(activityBody[index]==='}')depth--;}
 const renderActivities=new Function('timerPresentation','timersFor',`return function ${activityBody.slice(0,index)}`)(timerPresentation,timersFor);
 const radio={dataset:{},style:{}},overview={dataset:{}},nodes={'home-radio':radio,'timer-card':overview},align=new Function('$','overviewPriorities','timersFor',`return function ${alignSource}`)(id=>nodes[id],overviewPriorities,timersFor),timer={overview,overviewList:{hidden:true},shortcut:{hidden:false},nodes:new Map(),card:()=>({querySelector:()=>({disabled:false})}),canCancel:true};
 let state=localRadioTransition(initialScene(),{type:'radio-select',stationId:'p3'});state={...state,focus:'radio'};const original={station:state.radioStationId,room:state.music.playback.room,track:state.music.playback.track},host={state,dataset:{},style:{getPropertyValue:()=>'',setProperty(){}}};
 const update=()=>{host.state=state;renderActivities.call(timer,state);align.call(host);assert.equal(state.radioStationId,original.station);assert.equal(state.music.playback.room,original.room);assert.equal(state.music.playback.track,original.track);};
 update();assert.equal(radio.dataset.overviewSize,'s');state=sceneTransition(state,{type:'timer-start',seconds:60,now:1000});update();assert.equal(radio.dataset.overviewSize,'m');state=sceneTransition(state,{type:'timer',id:state.timer.id,action:'pause',now:2000});update();assert.equal(radio.dataset.overviewSize,'m');state=sceneTransition(state,{type:'timer',id:state.timer.id,action:'resume',now:3000});state=sceneTransition(state,{type:'tick',now:100000});update();assert.equal(state.timer.status,'done');assert.equal(radio.dataset.overviewSize,'m');
 for(const size of ['s','m','l']){radio.dataset.kitSize=size;update();assert.equal(radio.dataset.kitSize,size);assert.equal(radio.dataset.overviewSize,'m');}delete radio.dataset.kitSize;
 state=sceneTransition(state,{type:'timer',id:state.timer.id,action:'cancel'});update();assert.equal(radio.dataset.overviewSize,'s');
});
