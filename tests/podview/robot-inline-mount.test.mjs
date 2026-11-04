import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../dist/live-control-view.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf(' mountRobotInline(){'),source.indexOf('\n allowed(domain)'));
const Mount=new Function('make',`return class {${code}}`)(()=>{throw Error('existing entry expected');});
function fixture(){
 const doc={activeElement:null,body:{}},moves=[];
 class Node{constructor(name){this.name=name;this.children=[];this.parentNode=null;this.hidden=false;}contains(node){return node===this||this.children.some(child=>child.contains(node));}insertBefore(node,before){if(node.parentNode){const previous=node.parentNode;previous.children.splice(previous.children.indexOf(node),1);if(node.contains(doc.activeElement))doc.activeElement=doc.body;}const index=before===null?this.children.length:this.children.indexOf(before);this.children.splice(index,0,node);node.parentNode=this;moves.push(node.name);}append(node){this.insertBefore(node,null);}}
 const entry=new Node('entry'),note=new Node('note'),receipt=new Node('receipt'),body=new Node('body'),button=new Node('button'),panel=new Node('panel'),focus=new Node('base');entry.append(note);entry.append(receipt);entry.append(body);entry.append(button);body.append(panel);panel.append(focus);moves.length=0;doc.activeElement=focus;
 const view=new Mount();Object.assign(view,{robotEntry:entry,note,receiptNote:receipt,body,robotButton:button,robotPanel:panel,target:{entityId:'vacuum.actual'},host:{deviceNodes:new Map()}});return {view,doc,focus,entry,note,receipt,body,button,moves};
}
test('same mounted robot entry does not move focused descendants on rerender',()=>{const f=fixture();for(let i=0;i<5;i++)f.view.mountRobotInline();assert.deepEqual(f.moves,[]);assert.equal(f.doc.activeElement,f.focus);assert.deepEqual(f.entry.children,[f.note,f.receipt,f.body,f.button]);});
test('missing preceding child is inserted without moving the focused body',()=>{const f=fixture();f.entry.children.splice(0,1);f.note.parentNode=null;f.view.mountRobotInline();assert.deepEqual(f.moves,['note']);assert.equal(f.doc.activeElement,f.focus);assert.deepEqual(f.entry.children,[f.note,f.receipt,f.body,f.button]);});
