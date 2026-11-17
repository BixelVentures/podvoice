// P4 list (docs/MOTION.md §3.5): rows enter from 8px on the snappy spring with a 30 ms stagger (max five), leave
// where they stood while neighbours close the gap on the smooth spring, and the playing indicator travels as one.
// All reads come before any write. Reduced: enter/leave fade, reorder is immediate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneMotion,springCurve,SPRING,DUR} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';

const SNAPPY=springCurve(SPRING.snappy),SMOOTH=springCurve(SPRING.smooth),ROW=60;
function list(){
 const log=[];
 const container={isConnected:true,children:[],clientLeft:0,clientTop:0,scrollLeft:0,scrollTop:0,log,
  getClientRects:()=>[{}],getBoundingClientRect(){log.push('read');return {x:0,y:100,width:400,height:600};},
  querySelectorAll(){return this.children.filter(node=>node.row);},
  querySelector(selector){for(const row of this.children){const hit=row.find?.(selector);if(hit)return hit;}return null;},
  append(node){this.children=this.children.filter(n=>n!==node);this.children.push(node);node.parentNode=this;},
 };
 const animated=node=>{node.animations=[];node.animate=(frames,options)=>{log.push('write');const animation={frames,
  options,cancelled:false,cancel(){this.cancelled=true;},finished:new Promise(()=>{})};node.animations.push(animation);
  return animation;};};
 const row=id=>{const node={id,row:true,dataset:{},style:{},parentNode:null,getClientRects:()=>[{}],
  setAttribute(key,value){this[key]=value;},
  getBoundingClientRect(){log.push('read');const index=container.children.filter(n=>n.row&&n.dataset.pvLeave===undefined)
   .indexOf(node);return {x:0,y:100+index*ROW,width:400,height:ROW};},
  remove(){container.children=container.children.filter(n=>n!==node);node.parentNode=null;},
  contains(other){return other===node||other===node.eq;},find(selector){return selector==='.eq'?node.eq:null;}};
  animated(node);return node;};
 const set=nodes=>{container.children=nodes;for(const node of nodes)node.parentNode=container;};
 return {container,row,set,log,animated};
}
const motion=({reduced=false}={})=>new SceneMotion({dataset:{motion:reduced?'reduced':'system'},isConnected:true,
 ownerDocument:{documentElement:{dataset:{}}}});

test('new rows enter from 8px on the snappy spring, staggered 30 ms for the first five',()=>{
 const f=list(),m=motion(),rows=Array.from({length:8},(_,i)=>f.row(`r${i}`));f.set([]);
 m.list(f.container,()=>f.set(rows));
 const delays=rows.map(row=>row.animations[0].options.delay);
 assert.deepEqual(delays,[0,30,60,90,120,150,150,150]);
 for(const row of rows){
  assert.deepEqual(row.animations[0].frames,[{opacity:0,translate:'0 8px'},{opacity:1,translate:'0 0'}]);
  assert.equal(row.animations[0].options.duration,SNAPPY.ms);assert.equal(row.animations[0].options.easing,SNAPPY.easing);
  assert.equal(row.animations[0].options.fill,'backwards','a waiting row is held invisible');
 }
});

test('a removed row leaves where it stood and the rows below close the gap on the smooth spring; reads first',()=>{
 const f=list(),m=motion(),[a,b,c]=['a','b','c'].map(f.row);f.set([a,b,c]);
 m.list(f.container,()=>{b.remove();f.log.push('mutate');});
 const firstWrite=f.log.indexOf('write'),lastRead=f.log.lastIndexOf('read');
 assert(lastRead<firstWrite,'every box is read before the first write');
 assert.equal(a.animations.length,0,'a row that did not move is left alone');
 assert.deepEqual(c.animations[0].frames,[{translate:`0px ${ROW}px`},{translate:'0 0'}]);
 assert.equal(c.animations[0].options.duration,SMOOTH.ms);
 assert.equal(b.parentNode,f.container,'the leaving row is shown again, out of the flow');
 assert.equal(b.dataset.pvLeave,'');assert.equal(b.inert,true);assert.equal(b['aria-hidden'],'true');
 assert.deepEqual([b.style.position,b.style.top,b.style.height,b.style.pointerEvents],['absolute','60px','60px','none']);
 assert.deepEqual(b.animations[0].frames,[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.98)'}]);
 assert.equal(b.animations[0].options.duration,DUR.quick);assert.equal(b.animations[0].options.fill,'forwards');
});

test('the playing indicator travels from its old row to the new one as one element',()=>{
 const f=list(),m=motion(),[a,b,c]=['a','b','c'].map(f.row);f.set([a,b,c]);
 const old={},next={};a.eq=old;old.getBoundingClientRect=()=>({x:10,y:110,width:20,height:20});
 next.getClientRects=()=>[{}];f.animated(next);
 next.getBoundingClientRect=()=>{const top=b.getBoundingClientRect().y;return {x:10,y:top+10,width:20,height:20};};
 m.list(f.container,()=>{a.remove();delete a.eq;b.eq=next;},{track:'.eq'});
 // b moved up one row (FLIP +60); the indicator's own offset is what is left of the travel: from row a to row b.
 assert.deepEqual(b.animations[0].frames[0],{translate:`0px ${ROW}px`});
 assert.deepEqual(next.animations[0].frames,[{translate:'0px -60px'},{translate:'0 0'}]);
 assert.equal(next.animations[0].options.easing,SMOOTH.easing);
});

test('reduced: rows fade in and out, and a reorder is immediate',()=>{
 const f=list(),m=motion({reduced:true}),[a,b,c,d]=['a','b','c','d'].map(f.row);f.set([a,b,c]);
 m.list(f.container,()=>{b.remove();f.container.append(d);});
 assert.equal(c.animations.length,0,'no slide');
 assert.deepEqual(d.animations[0].frames,[{opacity:0},{opacity:1}]);
 assert.deepEqual(b.animations[0].frames,[{opacity:1},{opacity:0}]);assert.equal(b.animations[0].options.duration,DUR.reduced);
});

test('a hidden list only mutates',()=>{
 const f=list(),m=motion(),a=f.row('a');f.set([]);f.container.getClientRects=()=>[];let ran=0;
 m.list(f.container,()=>{ran++;f.set([a]);});assert.equal(ran,1);assert.equal(a.animations.length,0);
});

test('a pressed row (scaled about its centre) is measured by its centre, so it does not slide sideways',()=>{
 const f=list(),m=motion(),[a,b]=['a','b'].map(f.row);f.set([a,b]);
 const read=b.getBoundingClientRect;b.getBoundingClientRect=()=>{const box=read();
  return {x:box.x+4,y:box.y+1.2,width:box.width-8,height:box.height-2.4};};
 m.list(f.container,()=>{a.remove();b.getBoundingClientRect=read;});
 assert.deepEqual(b.animations[0].frames[0],{translate:`0px ${ROW}px`});
});
