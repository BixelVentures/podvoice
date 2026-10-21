import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOverviewMediaValues} from '../../podvoice/gatekeeper/static/podview/music-results.js';
const view=(vm,live=false)=>{const nodes={'home-music':{textContent:'',dataset:{}},'home-radio':{textContent:'',dataset:{}}};renderOverviewMediaValues({live,playerView:{progressVM:vm},ownerDocument:{getElementById:id=>({dataset:{},querySelector:()=>nodes[id]})}});return Object.fromEntries(Object.entries(nodes).map(([id,node])=>[id,node.textContent]));};
test('overview uses admitted media and labels stale observation honestly',()=>{assert.equal(view({active:true,title:'Heartless',playing:true,fresh:true})['home-music'],'Spiller: Heartless');assert.equal(view({active:true,title:'Heartless',playing:true,fresh:false},true)['home-music'],'Sidst kendt: Heartless');assert.equal(view({active:false,title:'Fixture'},true)['home-music'],'Ingen seneste afspilning');});
test('radio is separate from music and no default station is invented',()=>{const actual=view({active:true,title:'P3',playing:false,sourceKind:'radio'});assert.equal(actual['home-radio'],'P3 · På pause');assert.equal(actual['home-music'],'Ingen seneste afspilning');assert.equal(view({},true)['home-radio'],'Ikke forbundet');});

test('M Music adds only the known source artist in its optional second line and clears it honestly',()=>{
 for(const live of [false,true]){assert.equal(view({active:true,title:'Heartless',artist:'Kanye West',playing:true,fresh:true},live)['home-music'],'Spiller: Heartless\nKanye West');assert.equal(view({active:true,title:'Heartless',artist:'Kanye West',playing:false,fresh:false},live)['home-music'],'Sidst kendt: Heartless\nKanye West');
  for(const artist of [null,undefined,0,{},'','   '])assert.equal(view({active:true,title:'Heartless',artist,playing:true},live)['home-music'],'Spiller: Heartless');
  assert.equal(view({active:false,title:'Heartless',artist:'Kanye West'},live)['home-music'],'Ingen seneste afspilning');assert.equal(view({active:true,title:'P3',artist:'DR',sourceKind:'radio'},live)['home-music'],'Ingen seneste afspilning');
 }
 const node={textContent:'',dataset:{}},host={playerView:{progressVM:{active:true,title:'Heartless',artist:'Kanye West',playing:true}},ownerDocument:{getElementById:id=>id==='home-music'?{dataset:{},querySelector:()=>node}:null}};renderOverviewMediaValues(host);assert.equal(node.dataset.mediaMetadata,'true');let writes=0;const old=node.textContent;Object.defineProperty(node,'textContent',{get:()=>old,set:()=>writes++});renderOverviewMediaValues(host);assert.equal(writes,0);delete host.playerView.progressVM.artist;renderOverviewMediaValues(host);assert.equal(node.dataset.mediaMetadata,'false');
});
