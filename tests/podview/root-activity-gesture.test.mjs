import test from 'node:test';
import assert from 'node:assert/strict';
import {TimerView} from '../../podvoice/gatekeeper/static/podview/timer-view.js';

test('timer-only overview installs no activity carousel or horizontal gesture owner',()=>{
 const node=()=>({hidden:false,dataset:{}}),overview=node(),shortcut=node(),overviewList=node(),view=Object.assign(Object.create(TimerView.prototype),{overview,shortcut,overviewList,nodes:new Map(),host:{live:true}});
 overview.addEventListener=()=>assert.fail('timer-only overview must not capture gestures');
 for(const state of [{timer:null,devices:[{id:'robot',kind:'vacuum',status:'cleaning'}]},{timer:null,vehicle:{mode:'observed',source:'home_assistant_state',charging:{status:'charging'}}}]){view.renderOverviewActivities(state);assert.equal(shortcut.hidden,false);assert.equal(overviewList.hidden,true);assert.equal(view.overviewSelectedId,null);assert.equal(view.activityChoices,undefined);assert.equal(view.activityResource,undefined);}
 assert.equal(view.bindActivityGesture,undefined);assert.equal(view.finishActivityGesture,undefined);
});
