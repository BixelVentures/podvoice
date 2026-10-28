import test from 'node:test';
import assert from 'node:assert/strict';
import {placeOutputHeader} from '../../podvoice/gatekeeper/static/podview/player-view.js';
class Node{constructor(){this.children=[];this.parentNode=null;this.attributes={};this.textContent='';}append(node){if(node.parentNode)node.parentNode.children.splice(node.parentNode.children.indexOf(node),1);this.children.push(node);node.parentNode=this;}insertBefore(node,next){this.append(node);if(next){this.children.pop();this.children.splice(this.children.indexOf(next),0,node);}}replaceWith(node){const parent=this.parentNode;if(node.parentNode)node.parentNode.children.splice(node.parentNode.children.indexOf(node),1);parent.children.splice(parent.children.indexOf(this),1,node);node.parentNode=parent;this.parentNode=null;}getAttribute(key){return this.attributes[key];}setAttribute(key,value){this.attributes[key]=value;}}
function surface(){const output=new Node(),parent=new Node(),next=new Node(),emptyTitle=new Node(),copy=new Node(),state=new Node(),room=new Node();parent.append(output);parent.append(next);copy.append(emptyTitle);output.listenerIdentity={};const view={doc:{getElementById:id=>id==='player-state'?state:room},outputPlacement:{output,parent,next,emptyTitle,copy}};return {view,output,parent,next,emptyTitle,copy,state,room};}
test('idle uses the same output node and neutral empty header, never fake playing metadata',()=>{const s=surface(),identity=s.output.listenerIdentity;placeOutputHeader(s.view,{active:false,canOutput:true});assert.equal(s.copy.children[0],s.output);assert.equal(s.output.listenerIdentity,identity);assert.equal(s.output.disabled,false);assert.equal(s.room.textContent,'Musik');assert.equal(s.state.textContent,'');assert.equal(s.output.attributes['aria-label'],'Musik · Se aktuelle højttalere');});
test('populated playback restores the same canonical output node',()=>{const s=surface();placeOutputHeader(s.view,{active:false,canOutput:true});placeOutputHeader(s.view,{active:true,canOutput:true});assert.deepEqual(s.parent.children,[s.output,s.next]);assert.equal(s.copy.children[0],s.emptyTitle);});
for(const state of [{active:false,loading:true,canOutput:true},{active:false,canOutput:false},{active:false,loading:false,canOutput:false}])test(`empty room header survives first read, disconnection and failure without granting control: ${JSON.stringify(state)}`,()=>{const s=surface(),identity=s.output.listenerIdentity;placeOutputHeader(s.view,{active:false,canOutput:true,configuredTarget:'Køkkenalrum HomePod'});placeOutputHeader(s.view,{...state,configuredTarget:'Køkkenalrum HomePod'});assert.deepEqual(s.copy.children,[s.output]);assert.deepEqual(s.parent.children,[s.next]);assert.equal(s.output.listenerIdentity,identity);assert.equal(s.output.disabled,true);assert.equal(s.room.textContent,'Køkkenalrum HomePod');assert.equal(s.state.textContent,'');assert.equal(s.output.attributes['aria-label'],'Konfigureret højttaler: Køkkenalrum HomePod');});
test('repeated idle renders never duplicate control or header',()=>{const s=surface();for(let i=0;i<3;i++)placeOutputHeader(s.view,{active:false,canOutput:true});assert.deepEqual(s.copy.children,[s.output]);placeOutputHeader(s.view,{active:true});placeOutputHeader(s.view,{active:false,canOutput:true});assert.deepEqual(s.copy.children,[s.output]);assert.deepEqual(s.parent.children,[s.next]);});


test('idle output accessible name always includes its visible heading across configured and unavailable states',()=>{
 const s=surface();
 for(const value of [{canOutput:true},{canOutput:false},{canOutput:true,configuredTarget:'Køkkenalrum HomePod'},{canOutput:false,configuredTarget:'Stue'}]){
  placeOutputHeader(s.view,{active:false,...value});
  assert.ok(s.room.textContent);assert.ok(s.output.getAttribute('aria-label').includes(s.room.textContent));
  assert.equal(s.output.disabled,!value.canOutput);
 }
});

test('idle next destination replaces configured display with explicit nonplaying intent in the same retained header',()=>{
 const s=surface(),identity=s.output.listenerIdentity;placeOutputHeader(s.view,{active:false,canOutput:true,configuredTarget:'Køkkenalrum HomePod',nextDestinationLabel:'Svend’s HomePod'});assert.equal(s.room.textContent,'Svend’s HomePod');assert.equal(s.state.textContent,'');assert.equal(s.output.getAttribute('aria-label'),'Næste afspilning: Svend’s HomePod');assert.equal(s.output.listenerIdentity,identity);assert.equal(s.copy.children[0],s.output);assert.equal(s.output.disabled,false);
 placeOutputHeader(s.view,{active:false,canOutput:true,configuredTarget:'Køkkenalrum HomePod'});assert.equal(s.room.textContent,'Køkkenalrum HomePod');assert.equal(s.output.getAttribute('aria-label'),'Konfigureret højttaler: Køkkenalrum HomePod');
});
