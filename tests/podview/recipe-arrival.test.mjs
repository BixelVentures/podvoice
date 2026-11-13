import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// A recipe shared from a phone (Del → Home Assistant) appears on the wall screen without a
// reload: the snapshot's recipeRevision grows, the catalogue refreshes in place, and the calm
// status toast says "Ny opskrift: <navn>"; tapping it opens that recipe.
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const begin=source.indexOf(' recipeArrivals(snapshot){'),end=source.indexOf(' showFeedback(message,pending,options={})',begin);
assert.ok(begin>0&&end>begin,'recipe arrival methods precede showFeedback');
const methods=new Function('$',`return class {${source.slice(begin,end)}}`);

function host({visible=false}={}){
 const listeners={};
 const nodes={'recipe-view':{hidden:!visible},'playback-status':{dataset:{},addEventListener:(type,fn)=>{listeners[type]=fn;}}};
 const Host=methods(id=>nodes[id]);
 const now=Date.now();
 const old={title:'Rugbrød',createdAt:now-86400000,source:{url:'https://a.example/rugbroed'}};
 const fresh={title:'Kanelsnegle',createdAt:now-2000,source:{url:'https://b.example/kanel'}};
 const owner={saved:[old],fetches:0,opened:null,title:{focus(){}},
  async refreshPublishedCatalog(){this.fetches++;this.saved=[old,fresh];return true;},
  recipe(r){this.opened=r;}};
 if(visible)owner.catalogRefresh={now:async()=>{owner.renders=(owner.renders||0)+1;owner.saved=[old,fresh];}};
 const h=Object.assign(new Host(),{recipeView:owner,isConnected:true,feedback:[],dispatched:[],
  showFeedback(message,pending,options){this.feedback.push([message,options.source]);this.notifications={current:{source:options.source},dismiss(){this.current=null;}};},
  dispatch(action){this.dispatched.push(action);}});
 return {h,owner,fresh,listeners};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('first snapshot is only a baseline; a higher recipeRevision announces the new recipe',async()=>{
 const {h,owner,fresh,listeners}=host();
 h.recipeArrivals({bootId:'b1',recipeRevision:3});await settle();
 assert.equal(owner.fetches,0,'no fetch and no notice on the first snapshot');
 h.recipeArrivals({bootId:'b1',recipeRevision:3});await settle();
 assert.equal(owner.fetches,0,'an unchanged count does nothing (no flash)');
 h.recipeArrivals({bootId:'b1',recipeRevision:4});await settle();
 assert.equal(owner.fetches,1);
 assert.deepEqual(h.feedback,[['Ny opskrift: Kanelsnegle','recipe']]);
 listeners.click();
 assert.deepEqual(h.dispatched,[{type:'show',id:'recipes'}]);
 assert.equal(owner.opened,fresh,'tapping the notice opens the new recipe');
 h.recipeArrivals({bootId:'b1',recipeRevision:5});await settle();
 assert.equal(h.feedback.length,1,'the same recipe is never announced twice');
});

test('an open catalogue refreshes in place instead of a separate fetch',async()=>{
 const {h,owner}=host({visible:true});
 h.recipeArrivals({bootId:'b1',recipeRevision:0});
 h.recipeArrivals({bootId:'b1',recipeRevision:1});await settle();
 assert.equal(owner.renders,1);assert.equal(owner.fetches,0);
 assert.deepEqual(h.feedback,[['Ny opskrift: Kanelsnegle','recipe']]);
});

test('a restarted add-on or a missing count starts a new baseline',async()=>{
 const {h,owner}=host();
 h.recipeArrivals({bootId:'b1',recipeRevision:7});
 h.recipeArrivals({bootId:'b2',recipeRevision:0});
 h.recipeArrivals({bootId:'b2'});
 h.recipeArrivals({bootId:'b2',recipeRevision:-1});await settle();
 assert.equal(owner.fetches,0);assert.deepEqual(h.feedback,[]);
});
