import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile} from '../../podvoice/gatekeeper/static/podview/ui/reconcile.js';
// Minimal tree harness: these assertions concern reconciliation identity, not rendering.
class TreeNode{
 constructor(name,attrs={},children=[]){this.nodeType=name==='#text'?3:1;this.nodeName=name;this.nodeValue=null;this.attrs={...attrs};this.childNodes=[];for(const c of children)this.insertBefore(c,null);}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}get id(){return this.attrs.id||'';}
 getAttribute(n){return this.attrs[n]??null;}hasAttribute(n){return n in this.attrs;}setAttribute(n,v){this.attrs[n]=v;}removeAttribute(n){delete this.attrs[n];}
 insertBefore(n,b){if(n.parentNode)n.parentNode.removeChild(n);const i=b?this.childNodes.indexOf(b):this.childNodes.length;this.childNodes.splice(i,0,n);n.parentNode=this;return n;}
 removeChild(n){this.childNodes.splice(this.childNodes.indexOf(n),1);n.parentNode=null;}
 cloneNode(deep){const n=new TreeNode(this.nodeName,this.attrs,deep?this.childNodes.map(c=>c.cloneNode(true)):[]);n.nodeValue=this.nodeValue;return n;}
}
const el=(name,attrs={},children=[])=>new TreeNode(name,attrs,children);
test('state updates preserve the voice anchor and its prior transition target',()=>{const anchor=el('DIV',{'data-key':'voice-anchor','data-phase':'0'});const root=el('DIV',{},[anchor]);reconcile(root,el('DIV',{},[el('DIV',{'data-key':'voice-anchor','data-phase':'1'})]));assert.equal(root.childNodes[0],anchor);assert.equal(anchor.getAttribute('data-phase'),'1');});
test('adding and removing a disclosure preserves button and live region',()=>{const button=el('BUTTON',{'data-action':'toggle'});const live=el('DIV',{'data-key':'receipt'});const root=el('DIV',{},[button,live]);reconcile(root,el('DIV',{},[el('BUTTON',{'data-action':'toggle'}),el('DIV',{'data-key':'drawer'}),el('DIV',{'data-key':'receipt'})]));assert.equal(root.childNodes[0],button);assert.equal(root.childNodes[2],live);reconcile(root,el('DIV',{},[el('BUTTON',{'data-action':'toggle'}),el('DIV',{'data-key':'receipt'})]));assert.deepEqual(root.childNodes,[button,live]);});
test('keyed choices preserve identity while reordered and selected',()=>{const a=el('BUTTON',{'data-action':'choose','data-value':'0'});const b=el('BUTTON',{'data-action':'choose','data-value':'1'});const root=el('DIV',{},[a,b]);reconcile(root,el('DIV',{},[el('BUTTON',{'data-action':'choose','data-value':'1','aria-pressed':'true'}),el('BUTTON',{'data-action':'choose','data-value':'0'})]));assert.deepEqual(root.childNodes,[b,a]);assert.equal(b.getAttribute('aria-pressed'),'true');});
test('clock style updates retain the existing clock element',()=>{const clock=el('DIV',{style:'font-size:100px'});const root=el('DIV',{},[clock]);reconcile(root,el('DIV',{},[el('DIV',{style:'font-size:56px'})]));assert.equal(root.childNodes[0],clock);assert.equal(clock.getAttribute('style'),'font-size:56px');});

test('reset synchronizes a dirty range property as well as its attribute',()=>{const slider=el('INPUT',{type:'range',value:'20'});slider.value='75';const root=el('DIV',{},[slider]);reconcile(root,el('DIV',{},[el('INPUT',{type:'range',value:'0'})]));assert.equal(root.childNodes[0],slider);assert.equal(slider.getAttribute('value'),'0');assert.equal(slider.value,'0');});
