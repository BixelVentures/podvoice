import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const owner=new URL('../../../../../podvoice/gatekeeper/static/podview/vehicle-model.js', import.meta.url).href;
const {vehicleFixture}=await import(owner);
const source=(await readFile(new URL('./vehicle-material-motion.js',import.meta.url),'utf8')).replace("'/vehicle-model.js'",JSON.stringify(owner));
const {installVehicleMaterial}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function fixture(){
 const document=new EventTarget(),window=new EventTarget(),media=new EventTarget();
 document.documentElement={dataset:{design:'candidate'},clientWidth:1000,clientHeight:700};
 let callback,visible=true,top=20,material=null,cleanupCalls=0;
 class Observer {constructor(fn){callback=fn;}observe(){}disconnect(){this.disconnected=true;}}
 const surface={dataset:{},getClientRects:()=>visible?[{}]:[],getBoundingClientRect:()=>({left:20,right:200,top,bottom:top+150}),querySelector:()=>material,append:m=>{material=m;}};
 document.createElement=()=>({setAttribute(){},remove(){material=null;}});
 const render=function(){return 'rendered';},cleanup=function(){cleanupCalls++;};
 const host={live:false,isConnected:true,dataset:{},state:{vehicle:vehicleFixture({charging:true})},vehicleChargeContext:{scope:'local',sourceScope:'local',connected:true,readGranted:true},renderOverviewFacts:render,cleanup,querySelectorAll:()=>[surface]};
 const options={document,window,media,Observer};installVehicleMaterial(host,options);
 return {host,document,window,media,surface,render,cleanup,options,change:()=>callback(),setVisible:v=>{visible=v;},setTop:v=>{top=v;},material:()=>material,cleanupCalls:()=>cleanupCalls};
}
test('visibility, resize and motion settings settle/resume current charging without new render',()=>{
 const f=fixture();try{
 assert.equal(f.surface.dataset.energy,'charging');
 f.setTop(800);f.window.dispatchEvent(new Event('resize'));assert.equal(f.surface.dataset.energy,'still');
 f.setTop(20);f.window.dispatchEvent(new Event('resize'));assert.equal(f.surface.dataset.energy,'charging');
 f.setVisible(false);f.change();assert.equal(f.surface.dataset.energy,'still');f.setVisible(true);f.change();
 f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(f.surface.dataset.energy,'still');
 f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.equal(f.surface.dataset.energy,'charging');
 f.host.dataset.motion='reduced';f.change();assert.equal(f.surface.dataset.energy,'still');delete f.host.dataset.motion;
 f.document.documentElement.dataset.motion='reduced';f.change();assert.equal(f.surface.dataset.energy,'still');delete f.document.documentElement.dataset.motion;
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.surface.dataset.energy,'still');
 f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.surface.dataset.energy,'charging');
 f.host.vehicleChargeContext.connected=false;f.host.renderOverviewFacts();assert.equal(f.surface.dataset.energy,'none');
 }finally{f.host.cleanup();}
});
test('cleanup restores owners; queued observers and events cannot recreate material',()=>{
 const f=fixture(),wrapped=f.host.renderOverviewFacts;
 installVehicleMaterial(f.host,f.options);assert.equal(f.host.renderOverviewFacts,wrapped);
 f.host.cleanup();assert.equal(f.host.renderOverviewFacts,f.render);assert.equal(f.host.cleanup,f.cleanup);assert.equal(f.cleanupCalls(),1);
 f.change();f.window.dispatchEvent(new Event('resize'));f.media.dispatchEvent(new Event('change'));wrapped();
 assert.equal(f.material(),null);assert.equal(f.surface.dataset.energy,undefined);
});
test('removed surfaces and disconnected host discard owned presentation',()=>{
 const f=fixture();f.host.querySelectorAll=()=>[];f.change();assert.equal(f.material(),null);assert.equal(f.surface.dataset.energy,undefined);
 f.host.querySelectorAll=()=>[f.surface];f.change();assert(f.material());
 f.host.isConnected=false;f.change();assert.equal(f.material(),null);assert.equal(f.host.renderOverviewFacts,f.render);f.host.cleanup();
});
