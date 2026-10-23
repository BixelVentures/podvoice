import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOverviewMediaValues} from '../../podvoice/gatekeeper/static/podview/music-results.js';
class Node {
 constructor(){this.dataset={};this.children=[];this.attrs=new Map();this.textContent='';this.hidden=false;}
 querySelector(selector){return this.children.find(node=>'.'+node.className===selector)||null;}
 replaceChildren(...children){this.children=children;}
 getAttribute(key){return this.attrs.get(key)??null;}
 setAttribute(key,value){this.attrs.set(key,value);}
 removeAttribute(key){this.attrs.delete(key);}
}
function fixture(vm,live=false){const nodes=Object.fromEntries(['home-music','home-radio'].map(id=>[id,new Node()])),cards=Object.fromEntries(Object.entries(nodes).map(([id,node])=>{const card=new Node();card.querySelector=()=>node;return [id,card];})),host={live,playerView:{progressVM:vm},ownerDocument:{createElement:()=>new Node(),getElementById:id=>cards[id]}};return {nodes,cards,host,render(){renderOverviewMediaValues(host);}};}
const lines=node=>node.children.map(item=>item.textContent);
test('compact music gives real title and artist separate roles, with visible freshness and accessible playback status',()=>{
 const f=fixture({active:true,title:'Heartless',artist:'Kanye West',playing:true,fresh:true});f.render();const node=f.nodes['home-music'];assert.deepEqual(lines(node),['Heartless','Kanye West']);assert.deepEqual(node.children.map(item=>item.className),['overview-media-title','overview-media-artist']);assert.equal(f.cards['home-music'].getAttribute('aria-description'),'Afspiller');assert.equal(f.cards['home-music'].getAttribute('aria-label'),null);
 const children=[...node.children];f.render();assert.equal(node.children[0],children[0]);assert.equal(node.children[1],children[1]);
 f.host.playerView.progressVM={...f.host.playerView.progressVM,fresh:false};f.render();assert.deepEqual(lines(node),['Sidst kendt · Heartless','Kanye West']);assert.equal(f.cards['home-music'].getAttribute('aria-description'),'Sidst kendte afspilning');
 f.host.playerView.progressVM={active:false,title:'Old title',artist:'Old artist'};f.render();assert.deepEqual(lines(node),['Vælg musik','']);assert.equal(node.children[1].hidden,true);assert.equal(node.dataset.mediaMetadata,'false');assert.equal(f.cards['home-music'].getAttribute('aria-description'),null);
});
test('radio retains station and status without inventing a default or music identity',()=>{
 const f=fixture({active:true,title:'P3',playing:false,fresh:true,sourceKind:'radio'},false);f.render();assert.deepEqual(lines(f.nodes['home-radio']),['P3','På pause']);assert.deepEqual(lines(f.nodes['home-music']),['Vælg musik','']);f.host.playerView.progressVM={};f.host.live=true;f.render();assert.deepEqual(lines(f.nodes['home-radio']),['Ikke tilgængelig','']);
});
test('absent artist clears the secondary line and full media layout keeps its existing owner',()=>{
 const f=fixture({active:true,title:'Long real title',artist:'Artist',playing:false});f.render();for(const artist of [null,undefined,0,{},'','   ']){f.host.playerView.progressVM.artist=artist;f.render();assert.deepEqual(lines(f.nodes['home-music']),['Long real title','']);assert.equal(f.nodes['home-music'].children[1].hidden,true);}
 assert.equal(f.cards['home-music'].getAttribute('aria-description'),'På pause');f.cards['home-music'].dataset.mediaLayout='media';f.nodes['home-music'].replaceChildren();f.render();assert.equal(f.nodes['home-music'].children.length,0);assert.equal(f.cards['home-music'].getAttribute('aria-description'),null);f.cards['home-music'].dataset.mediaLayout='compact';f.render();assert.equal(f.cards['home-music'].getAttribute('aria-description'),'På pause');
});


test('all compact size roles use actual empty read state and transport fallback without new authority',()=>{
 const cases=[['offline','Ikke forbundet'],['error','Kan ikke hentes'],['account-selection','Vælg musikkonto'],['loading','Afventer data'],['unconfirmed','Vælg musik'],[undefined,'Vælg musik']];
 for(const size of ['s','m','l'])for(const [emptyState,copy]of cases){const f=fixture({active:false,emptyState},true);f.cards['home-music'].dataset={kitSize:size,mediaLayout:'compact'};f.render();assert.deepEqual(lines(f.nodes['home-music']),[copy,'']);assert.deepEqual(lines(f.nodes['home-radio']),['Ikke tilgængelig','']);assert.equal(f.cards['home-music'].getAttribute('aria-label'),null);}
 const f=fixture({active:false},true);f.host.liveTransport={connected:false};f.render();assert.equal(lines(f.nodes['home-music'])[0],'Ikke forbundet');f.host.playerView.progressVM.emptyState='loading';f.render();assert.equal(lines(f.nodes['home-music'])[0],'Afventer data');f.host.playerView.progressVM.emptyState='account-selection';f.render();assert.equal(lines(f.nodes['home-music'])[0],'Vælg musikkonto');
});
test('local radio distinguishes silent example, observed playback and last known station',()=>{
 const f=fixture({active:true,title:'P3',sourceKind:'radio',playing:true,fresh:false,exampleOnly:true});f.render();assert.deepEqual(lines(f.nodes['home-radio']),['P3','Ingen lyd']);delete f.host.playerView.progressVM.exampleOnly;f.render();assert.deepEqual(lines(f.nodes['home-radio']),['Sidst kendt · P3','Afspiller']);f.host.playerView.progressVM.fresh=true;f.host.playerView.progressVM.previewLabel='Radio · ingen lyd';f.host.playerView.progressVM.fresh=false;f.render();assert.deepEqual(lines(f.nodes['home-radio']),['P3','Ingen lyd']);delete f.host.playerView.progressVM.previewLabel;f.host.playerView.progressVM.fresh=false;f.render();assert.deepEqual(lines(f.nodes['home-radio']),['Sidst kendt · P3','Afspiller']);f.host.live=true;f.render();assert.deepEqual(lines(f.nodes['home-radio']),['Ikke tilgængelig','']);
});

test('fresh account-only read names the track without asserting confirmed speaker or granting playback authority',()=>{
 for(const playing of [false,true]){
  const vm={active:true,title:'Observed song',artist:'Observed artist',readOnly:true,fresh:false,positionFresh:false,playing},before=structuredClone(vm),f=fixture(vm,true);f.render();
  assert.deepEqual(lines(f.nodes['home-music']),['Observed song','Observed artist']);assert.equal(f.cards['home-music'].getAttribute('aria-description'),`${playing?'Afspiller':'På pause'} · højttaler ikke bekræftet`);
  const children=[...f.nodes['home-music'].children];f.render();assert.deepEqual(f.nodes['home-music'].children,children);assert.deepEqual(vm,before);
  vm.readOnly=false;f.render();assert.equal(lines(f.nodes['home-music'])[0],'Sidst kendt · Observed song');assert.equal(f.cards['home-music'].getAttribute('aria-description'),'Sidst kendte afspilning');
 }
});
