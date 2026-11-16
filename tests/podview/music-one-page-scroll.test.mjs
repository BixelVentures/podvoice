import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiveMusicCatalogueView} from '../../podvoice/gatekeeper/static/podview/live-music-view.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/feeling-route.json',import.meta.url)));

// Green-tjek F5 (2.1.9): on the one-page Musik every collection is an open section in one scroll. A tap on a lower
// heading restored that collection's old scroll position, so the page jumped and the cards above went out of view and
// came back (»blink«). The page keeps its scroll; per-collection scroll only belongs to the tabbed page.
function catalogue(onePage){
 const pane={scrollTop:0,hasAttribute:name=>onePage&&name==='data-discovery-preview'};
 const host={state:{focus:'music'},liveSnapshot:fixture.snapshot,musicResults:{render(){}},
  querySelector:selector=>selector==='#music-response'?pane:null};
 const view=new LiveMusicCatalogueView(host,()=>{});
 view.updateCapabilities(true,fixture.snapshot.capabilities.musicRead);
 view.resetAccount('account-alpha');
 return {view,pane};
}

test('a heading tap on the one-page Musik never moves the page',()=>{
 const {view,pane}=catalogue(true);
 try{
  view.select('feeling');view.tracks('feeling',fixture.paired,'account-alpha');
  pane.scrollTop=0;view.select('mood');
  pane.scrollTop=517;view.select('feeling');
  assert.equal(pane.scrollTop,517,'the visited collection does not restore its old scroll');
  pane.scrollTop=213;view.select('top');
  assert.equal(pane.scrollTop,213,'a collection without a read does not jump to the top');
 }finally{clearTimeout(view.expiryTimer);}
});

test('the tabbed page still keeps a scroll position per collection',()=>{
 const {view,pane}=catalogue(false);
 try{
  view.select('feeling');view.tracks('feeling',fixture.paired,'account-alpha');
  pane.scrollTop=120;view.select('mood');
  assert.equal(pane.scrollTop,0);
  view.select('feeling');
  assert.equal(pane.scrollTop,120);
 }finally{clearTimeout(view.expiryTimer);}
});
