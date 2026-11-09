import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./inert.js',import.meta.url),'utf8');
const start=source.indexOf('        host.alignOverview = () => {');
const end=source.indexOf('        const updateComposition',start);
function fixture(){
 const ids=['home-weather','robot','light','home-vehicle','home-music','home-radio','home-recipes','timer-card'];
 let moves=0,ownerCalls=0,focusCalls=0,explicit=false;
 const nodes=ids.map(id=>({id,dataset:{},style:{},isConnected:true}));let children=[...nodes].reverse();
 for(const node of nodes)Object.defineProperty(node,'nextSibling',{get:()=>children[children.indexOf(node)+1]||null});
 const active={isConnected:true,focus(){focusCalls++;document.activeElement=active;}};
 const document={activeElement:active,getElementById:id=>id==='now-view'?overview:nodes.find(n=>n.id===id)};
 const overview={hidden:false,get firstChild(){return children[0];},querySelector(selector){return selector.includes('vacuum')?nodes[1]:selector.includes('light')?nodes[2]:nodes.find(n=>'#'+n.id===selector);},insertBefore(node,cursor){moves++;children=children.filter(n=>n!==node);children.splice(cursor?children.indexOf(cursor):children.length,0,node);document.activeElement=null;}};
 const feed={scrollTop:42},properties=new Map();
 const host={style:{getPropertyValue:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)},hasAttribute:()=>explicit,querySelector:()=>feed};
 const desktop={matches:true};
 vm.runInNewContext(source.slice(start,end),{host,document,desktop,music:{removeAttribute(){}},originalMusicSize:null,alignOverview(){ownerCalls++;}});
 return {host,desktop,nodes,children:()=>children,moves:()=>moves,ownerCalls:()=>ownerCalls,focusCalls:()=>focusCalls,explicit:()=>{explicit=true;},feed,active,document};
}
test('fixed candidate order moves once, preserves focus and is inert on repeated alignment',()=>{
 const f=fixture();f.host.alignOverview();assert.deepEqual(f.children(),f.nodes);assert(f.moves()>0);assert.equal(f.ownerCalls(),0);assert.equal(f.document.activeElement,f.active);assert.equal(f.feed.scrollTop,42);
 const moves=f.moves(),focus=f.focusCalls();f.host.alignOverview();assert.equal(f.moves(),moves);assert.equal(f.focusCalls(),focus);assert.equal(f.ownerCalls(),0);assert(f.nodes.every((n,i)=>n.dataset.overviewRank===String(i)));
});
test('narrow and authored library sizes retain canonical alignment',()=>{
 const f=fixture();f.desktop.matches=false;f.host.alignOverview();assert.equal(f.ownerCalls(),1);assert.equal(f.moves(),0);
 f.desktop.matches=true;f.explicit();f.host.alignOverview();assert.equal(f.ownerCalls(),2);assert.equal(f.moves(),0);
});
