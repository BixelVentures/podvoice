import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRobotHistory} from '../../podvoice/gatekeeper/static/podview/live-home-view.js';

class Node {
 constructor(){this.children=[];this.dataset={};this.hidden=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 querySelector(){return null;}
 closest(){return this;}
}

test('missing robot history never claims readiness from cleaning, fault or stale observations',()=>{
 const previous=globalThis.document;
 try{
  for(const status of ['cleaning','fault','docked'])for(const stale of [false,true])for(const historyStatus of ['observed','unavailable']){
   const section=new Node(),timeline=new Node();
   globalThis.document={createElement:()=>new Node(),getElementById:id=>id==='robot-recent'?section:timeline};
   renderRobotHistory({state:{focus:'vacuum.actual',devices:[{id:'vacuum.actual',kind:'vacuum',live:true,status,stale,history:{status:historyStatus,items:[]},telemetry:{status:'unavailable',items:[]}}]}});
   assert.equal(section.hidden,false);
   const empty=section.children.find(node=>node.className==='robot-history-empty');
   assert.equal(empty.children[0].textContent,'Ingen rengøringshistorik endnu');
   assert.equal(empty.children[1].textContent,'Tidligere rengøringer er endnu ikke tilgængelige.');
   assert.equal(timeline.hidden,true);
  }
 }finally{globalThis.document=previous;}
});
