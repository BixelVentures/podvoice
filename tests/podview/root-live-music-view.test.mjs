import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMusicTracks} from '../../podvoice/gatekeeper/static/podview/live-music-view.js';

test('music catalogue projects up to three real tracks with validated artwork and navigation only',()=>{
 const tracks=projectMusicTracks({ok:true,data:{tracks:[
  {name:'Faktisk sang',artist:'Faktisk kunstner',uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/ab67616d0000b2730123456789abcdef'},images:['https://example.invalid/fake.jpg']},
  {name:'En anden',artist:'Kunstner to',uri:'spotify:track:0123456789ABCDEFGHIJKM'},
  {name:'Tre',artist:'Kunstner tre',uri:'spotify:track:0123456789ABCDEFGHIJKN'},
  {name:'Fire',artist:'Kunstner fire',uri:'spotify:track:0123456789ABCDEFGHIJKO'},
  {name:'Ugyldig URI',artist:'Ingen',uri:'https://example.invalid/song'}
 ]}});
 assert.equal(tracks.length,3);
 assert.deepEqual(tracks[0],{
  uri:'spotify:track:0123456789ABCDEFGHIJKL',title:'Faktisk sang',artist:'Faktisk kunstner',
  artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/ab67616d0000b2730123456789abcdef'},
  spotifyUrl:'https://open.spotify.com/track/0123456789ABCDEFGHIJKL'
 });
 assert.equal(tracks[1].artwork,null);
 assert.equal(tracks.every(track=>!('action'in track)&&!('option_id'in track)),true);
});

test('artwork validator rejects credentialed, query, foreign-host and malformed image references',()=>{
 const tracks=projectMusicTracks({ok:true,data:{tracks:[
  {name:'A',artist:'B',uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:{kind:'album_cover',provider:'spotify',url:'https://evil.example/image/id'}},
  {name:'C',artist:'D',uri:'spotify:track:0123456789ABCDEFGHIJKM',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/id?token=x'}},
  {name:'E',artist:'F',uri:'spotify:track:0123456789ABCDEFGHIJKN',artwork:{kind:'album_cover',provider:'spotify',url:'https://user@i.scdn.co/image/id'}}
 ]}});
 assert.ok(tracks);
 assert.equal(tracks.every(track=>track.artwork===null),true);
});

test('music catalogue distinguishes a valid empty list from malformed or failed source data',()=>{
 assert.deepEqual(projectMusicTracks({ok:true,data:{tracks:[]}}),[]);
 assert.equal(projectMusicTracks({ok:false,data:{tracks:[]}}),null);
 assert.equal(projectMusicTracks({ok:true,data:{tracks:{}}}),null);
});

test('account-bound catalogue rejects missing or different provider account echo',()=>{
 const body={ok:true,data:{config_entry_id:'selected',tracks:[{name:'A',artist:'B',uri:'spotify:track:0123456789ABCDEFGHIJKL'}]}};
 assert.equal(projectMusicTracks(body,'selected').length,1);assert.equal(projectMusicTracks(body,'other'),null);delete body.data.config_entry_id;assert.equal(projectMusicTracks(body,'selected'),null);
});
