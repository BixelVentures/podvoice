import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {isReduced,SceneMotion,REDUCED_MOTION_QUERY} from '../../podview/ui/motion.js';

const media=matches=>({matches});

test('the system preference alone makes motion reduced',()=>{
 assert.equal(isReduced({dataset:{}},media(true)),true);
 assert.equal(isReduced({dataset:{}},media(false)),false);
 assert.equal(isReduced(null,media(true)),true);
});

test('a host, an ancestor or a shadow host marked data-motion=reduced makes motion reduced',()=>{
 assert.equal(isReduced({dataset:{motion:'reduced'}},null),true);
 assert.equal(isReduced({dataset:{motion:'normal'}},null),false);
 const inKit={dataset:{},closest:selector=>selector==='[data-motion="reduced"]'?{}:null};
 assert.equal(isReduced(inKit,null),true);
 const shadowHost={dataset:{motion:'reduced'}};
 const inShadow={dataset:{},closest:()=>null,getRootNode:()=>({host:shadowHost})};
 assert.equal(isReduced(inShadow,null),true);
 const plain={dataset:{},closest:()=>null,getRootNode:()=>({})};
 assert.equal(isReduced(plain,null),false);
});

test('without a media list the node document view is asked with the one query',()=>{
 const asked=[],view={matchMedia:query=>{asked.push(query);return media(true);}};
 assert.equal(isReduced({dataset:{},ownerDocument:{defaultView:view}}),true);
 assert.deepEqual(asked,[REDUCED_MOTION_QUERY]);
});

function rootFixture(){
 let writes=0;const data={};
 const dataset=new Proxy(data,{set(target,key,value){writes++;target[key]=value;return true;}});
 const host={dataset:{},ownerDocument:{documentElement:{dataset}}};
 return {host,data,get writes(){return writes;}};
}

test('SceneMotion writes :root[data-pv-motion] once and follows the host when it changes',()=>{
 const previous=globalThis.matchMedia;globalThis.matchMedia=()=>media(false);
 try{
  const f=rootFixture(),motion=new SceneMotion(f.host);
  assert.equal(f.data.pvMotion,'full');assert.equal(f.writes,1);
  motion.cancel();motion.syncRoot();assert.equal(f.writes,1,'unchanged value is not rewritten');
  f.host.dataset.motion='reduced';motion.cancel();
  assert.equal(f.data.pvMotion,'reduced');assert.equal(motion.reduced,true);
  f.host.dataset.motion='normal';assert.equal(motion.syncRoot(),false);assert.equal(f.data.pvMotion,'full');
 }finally{globalThis.matchMedia=previous;}
});

test('SceneMotion follows the system preference it captured',()=>{
 const previous=globalThis.matchMedia,list=media(true);globalThis.matchMedia=()=>list;
 try{
  const f=rootFixture(),motion=new SceneMotion(f.host);
  assert.equal(f.data.pvMotion,'reduced');
  list.matches=false;motion.syncRoot();assert.equal(f.data.pvMotion,'full');
 }finally{globalThis.matchMedia=previous;}
});

test('no other screen module asks for reduced motion on its own',()=>{
 const dir=new URL('../../podview/',import.meta.url);
 const files=[...readdirSync(dir).filter(name=>name.endsWith('.js')),
  ...readdirSync(new URL('ui/',dir)).filter(name=>name.endsWith('.js')).map(name=>'ui/'+name)]
  .filter(name=>!name.endsWith('.bundle.js')&&name!=='ui/motion.js');
 const own=/prefers-reduced-motion|motion===?['"]reduced|data-motion=["']?reduced/;
 const offenders=files.filter(name=>own.test(readFileSync(new URL(name,dir),'utf8')));
 assert.deepEqual(offenders,[]);
});
