import test from 'node:test';
import assert from 'node:assert/strict';
import {updateResourceTile} from '../../podvoice/gatekeeper/static/podview/ui/resource-tile.js';
import {timerTime} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
test('resource end time uses Danish clock punctuation while countdown stays colon-delimited',()=>{
 const node=()=>({hidden:false,textContent:'',style:{},getAttribute:()=>'',setAttribute(){}}),parts=new Map(['strong','small','.resource-value','.resource-visual img','svg'].map(key=>[key,node()]));
 const attrs=new Map([['aria-label','obsolete']]);
 const button={dataset:{},style:{getPropertyValue:()=>'',setProperty(){}},querySelector:key=>parts.get(key),getAttribute:key=>attrs.get(key)??null,setAttribute(key,value){attrs.set(key,String(value));},removeAttribute(key){attrs.delete(key);}};
 const deadline=new Date(2026,9,20,15,47).getTime();
 updateResourceTile(button,{kind:'timer',title:'Timer',status:'running',deadline,remaining:519,duration:600,value:timerTime(519)});
 assert.equal(parts.get('small').textContent,'Slutter 15.47');assert.equal(parts.get('.resource-value').textContent,'8:39');assert.equal(button.getAttribute('aria-label'),null);assert.deepEqual(['.resource-value','strong','small'].map(key=>parts.get(key).textContent),['8:39','Timer','Slutter 15.47']);
});
