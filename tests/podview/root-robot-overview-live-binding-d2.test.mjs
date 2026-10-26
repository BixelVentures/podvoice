import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {liveScene} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {deviceActions} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {applyKitComponent} from '../../podvoice/gatekeeper/static/podview/ui/kit.js';
import {resourceOverviewAction,applyResourceFactBudget} from '../../podvoice/gatekeeper/static/podview/ui/resource-tile.js';

// Execute the actual WidgetHost method with native-DOM ports. The owner below is
// inert: it records intent and closes its offered lane; it cannot call a service.
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const method=source.slice(source.indexOf(' renderOverviewAction('),source.indexOf('\n openOverviewRobot(')).trim();
class Node{
 constructor(){this.children=[];this.dataset={};this.attrs={};this.handlers={};this.hidden=false;this.inert=false;}
 append(node){if(node.parentNode){const siblings=node.parentNode.children;siblings.splice(siblings.indexOf(node),1);}this.children.push(node);node.parentNode=this;}
 insertBefore(node,before){this.children.splice(this.children.indexOf(before),0,node);node.parentNode=this;}
 addEventListener(type,handler){this.handlers[type]=handler;}
 getAttribute(name){return this.attrs[name]??null;}
 setAttribute(name,value){this.attrs[name]=String(value);}
}
const render=new Function('document','deviceActions','resourceOverviewAction','applyKitComponent','applyResourceFactBudget',`return function ${method}`)({createElement:()=>new Node()},deviceActions,resourceOverviewAction,applyKitComponent,applyResourceFactBudget);
function rig(){
 const robot={id:'vacuum.actual',kind:'vacuum',source:'home_assistant_state',live:true,status:'cleaning',revision:7};
 const base={focus:'now',devices:[robot],answers:[],extraTimers:[],timer:null,music:{playback:{}}};
 const snapshot={bootId:'boot',roomId:'screen-room',voice:{},capabilities:{homeRead:['vacuum']},timers:{status:'observed',items:[]}};
 const state=liveScene(base,snapshot),intents=[],localEvents=[],host={live:true,state,liveTransport:{connected:true},dispatch:event=>localEvents.push(event)};
 let offered=true;
 host.liveControls={pending:false,allowed:domain=>domain==='vacuum',robotOverviewAction(device){return offered?{id:'pause',label:'Pause rengøring',resourceId:device.id,status:'cleaning',revision:7,disabled:this.pending}:null;},robotOverviewIntent(id,action){this.pending=true;intents.push({id,action});},prepareRobotOverview(){}};
 const parent=new Node(),row=new Node();parent.append(row);row.dataset={target:robot.id,kind:'vacuum',kitSize:'m',status:'cleaning',resourceStatus:'cleaning'};
 const draw=()=>render.call(host,row,state.devices.find(device=>device.id===robot.id));
 return {host,state,robot:state.devices.find(device=>device.id===robot.id),row,draw,intents,localEvents,setOffered:value=>offered=value};
}
test('actual liveScene keeps local effects closed while connected transport permits one current M Robot owner intent',()=>{
 const f=rig();assert.equal(f.state.connected,false);f.draw();const action=f.row.overviewAction;
 assert.equal(action.hidden,false);assert.equal(action.disabled,false);assert.equal(action.textContent,'Pause');
 action.handlers.click();action.handlers.click();assert.deepEqual(f.intents,[{id:'vacuum.actual',action:'pause'}]);assert.deepEqual(f.localEvents,[]);assert.equal(f.state.connected,false);
 f.draw();assert.equal(f.row.overviewAction,action);assert.equal(action.hidden,false);assert.equal(action.disabled,true,'pending retains its canonical action without a second admission');
});
test('transport loss is rechecked at click without relying on a later repaint',()=>{
 const f=rig();f.draw();assert.equal(f.row.overviewAction.hidden,false);f.host.liveTransport.connected=false;f.row.overviewAction.handlers.click();assert.deepEqual(f.intents,[]);f.draw();assert.equal(f.row.overviewAction.hidden,true);
});
for(const mode of ['unknown','stale','no-offer','foreign-revision','permission'])test(`current live Robot ${mode} cannot borrow local or display authority`,()=>{
 const f=rig();f.draw();const action=f.row.overviewAction;
 if(mode==='unknown')f.robot.status='unknown';if(mode==='stale')f.robot.stale=true;if(mode==='no-offer')f.setOffered(false);if(mode==='foreign-revision')f.robot.revision=8;if(mode==='permission')f.host.liveControls.allowed=()=>false;
 action.handlers.click();assert.deepEqual(f.intents,[]);assert.deepEqual(f.localEvents,[]);f.draw();assert.equal(action.hidden,true);
});
test('local branch retains its own scene connection and never borrows the live transport flag',()=>{
 const f=rig();f.host.live=false;f.robot.live=false;f.host.localRobot={allowed:()=>true};f.draw();assert.equal(f.row.overviewAction.hidden,true);f.row.overviewAction.handlers.click();assert.deepEqual(f.intents,[]);assert.deepEqual(f.localEvents,[]);
 f.state.connected=true;f.host.liveTransport.connected=false;f.draw();assert.equal(f.row.overviewAction.hidden,false);f.row.overviewAction.handlers.click();assert.equal(f.localEvents.length,1);assert.equal(f.localEvents[0].action,'pause');assert.deepEqual(f.intents,[]);
});
