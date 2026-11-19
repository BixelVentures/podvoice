import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceMusicCards} from '../../podview/music-results.js';
import {initialWidgetState,widgetTransition as step,resultsFor,FEELING_PLAYLISTS,TRACKS,COLLECTIONS} from '../../podview/widget-model.js';
import {collectionSample,moodPreview} from '../../podview/music-selection-model.js';
import {PodVoiceTransport} from '../../podview/podvoice-transport.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/feeling-route.json',import.meta.url)));

test('actual mocked Python route composes into the shared playlist cards; source kinds cannot cross into Stemning or tracks',()=>{assert.equal(fixture.evidence,'mocked_owner_io_actual_route_not_live');const {paired,preview,snapshot}=fixture;const source=collectionSample(paired,'account-alpha','feeling',snapshot);assert.ok(source);const cards=sourceMusicCards(source.tracks);assert.equal(cards.length,3);assert.deepEqual(cards.map(c=>c.name),['Mere energi','Helt ned i tempo','Noget velkendt']);assert.ok(cards.every(c=>c.uri.startsWith('spotify:playlist:')));assert.equal(collectionSample(paired,'account-alpha','mood',snapshot),null);assert.equal(collectionSample(paired,'account-alpha','top',snapshot),null);assert.ok(moodPreview(preview,'account-alpha',snapshot,Date.now(),'feeling'));assert.equal(moodPreview(preview,'account-alpha',snapshot),null);const changed=structuredClone(paired);changed.data.tracks[0].themeTitle='You seem sad';assert.equal(collectionSample(changed,'account-alpha','feeling',snapshot),null);});

test('feeling refresh and authority renewal use the exact additive request flags without a mood/liked alias',async()=>{const urls=[],transport=new PodVoiceTransport({url:'https://example.test/view/',fetch:async url=>{urls.push(new URL(url));return {ok:true,json:async()=>({ok:true})};}});transport.connected=true;transport.closed=false;transport.snapshot={capabilities:{musicRead:['feeling']}};transport.controller=new AbortController();await transport.music('feeling','account','refresh');await transport.music('feeling','account','renew');assert.deepEqual(urls.map(u=>[u.searchParams.get('kind'),u.searchParams.get('refresh'),u.searchParams.get('renew')]),[['feeling','1',null],['feeling',null,'1']]);});

test('generated mood artwork never crosses into the closed feeling owner schema',()=>{
 for(const kind of ['paired','preview']){const value=structuredClone(fixture[kind]);const row=value.data.tracks.find(row=>row.themeId==='calm');assert.ok(row);row.themeArt='theme-art/calm/'+'a'.repeat(64)+'.webp';assert.equal(kind==='paired'?collectionSample(value,'account-alpha','feeling',fixture.snapshot):moodPreview(value,'account-alpha',fixture.snapshot,Date.now(),'feeling'),null);}
});

test('Vibe pagination is validated on the owner response for both catalogue custody modes',()=>{
 const {snapshot}=fixture,account='account-alpha',now=Date.now();
 const page=[['lounge','Lounge','lake'],['nineties_techno','90’er-techno','indie'],['party','Festmusik','kitchen']];
 for(const kind of ['paired','preview']){
  const body=structuredClone(fixture[kind]);
  const read=()=>kind==='paired'?collectionSample(body,account,'feeling',snapshot,now):moodPreview(body,account,snapshot,now,'feeling');
  body.refreshAvailable=false;
  for(const [index,[themeId,themeTitle,art]] of page.entries())Object.assign(body.data.tracks[index],{themeId,themeTitle,artist:themeTitle,themeArt:`assets/${art}.webp`});
  assert.deepEqual(read().tracks.map(row=>row.themeTitle),page.map(([,title])=>title));
  assert.equal(read().refreshAvailable,false);
  body.refreshAvailable='false';
  assert.equal(read(),null);
 }
});

test('For dig retains the top collection and describes the actual fallback without mix claims',()=>{const before=initialWidgetState(),after=step(before,{type:'collection',value:'top'});assert.equal(after.collection,'top');assert.equal(after.playback,before.playback);assert.equal(COLLECTIONS.top.title,'For dig');assert.equal(COLLECTIONS.top.description,'Dine topsange');assert.deepEqual(resultsFor(after),resultsFor({...before,collection:'top'}));assert.doesNotMatch(JSON.stringify(COLLECTIONS.top),/daylist|Discover Weekly|Mix/i);});
