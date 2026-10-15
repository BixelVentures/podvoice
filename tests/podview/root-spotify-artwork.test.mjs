import test from 'node:test';
import assert from 'node:assert/strict';
import {spotifyArtwork,spotifyItemUrl,spotifyTrackUrl,renderSpotifyArtwork} from '../../podvoice/gatekeeper/static/podview/spotify-artwork.js';
const art={kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/ab67616d0000b273abc'};
const uri='spotify:track:0123456789ABCDEFGHIJKL';
test('closed artwork allowlist rejects noncanonical ports, credentials, paths and executable extensions',()=>{
 assert.deepEqual(spotifyArtwork(art),art);
 for(const url of ['http://i.scdn.co/image/abc','https://i.scdn.co:443/image/abc','https://user@i.scdn.co/image/abc','https://i.scdn.co/image/abc?x=1','https://i.scdn.co/image/abc#x','https://other.example/image/abc','https://i.scdn.co/image/%61bc','https://i.scdn.co/image/../abc','https://i.scdn.co/image/abc.svg','data:image/png;base64,xxx'])assert.equal(spotifyArtwork({...art,url}),null,url);
 assert.equal(spotifyArtwork({...art,html:'<script>'}),null);assert.equal(spotifyArtwork({...art,provider:'model'}),null);
});
test('provider links require canonical source IDs and grant no playback authority',()=>{
 assert.equal(spotifyTrackUrl(uri),'https://open.spotify.com/track/0123456789ABCDEFGHIJKL');
 assert.equal(spotifyItemUrl(uri.replace('track','episode')),'https://open.spotify.com/episode/0123456789ABCDEFGHIJKL');
 for(const value of ['spotify:track:abc','spotify:track:0123456789ABCDEFGHIJKL?play=1','https://spotify.com/fake',null])assert.equal(spotifyItemUrl(value),null);
 assert.equal(spotifyTrackUrl(uri.replace('track','episode')),null);
});
function image(){const attrs=new Map(),classes=new Set(),events=new Map();return {dataset:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},getAttribute:k=>attrs.get(k),set src(v){attrs.set('src',v);},get src(){return attrs.get('src');},addEventListener:(type,fn)=>events.set(type,fn),error:()=>events.get('error')()};}
test('current identity uses actual art; failed image keeps source identity and does not retry forever',()=>{
 const node=image(),track={uri,name:'Source song',artwork:art};assert.equal(renderSpotifyArtwork(node,track),true);assert.equal(node.src,art.url);assert.match(node.alt,/Source song/);
 node.error();assert.equal(node.src,'assets/icons/music-note-beamed.svg');assert.equal(renderSpotifyArtwork(node,track),false);assert.equal(node.src,'assets/icons/music-note-beamed.svg');
 assert.equal(renderSpotifyArtwork(node,{...track,uri:uri.replace(/L$/,'M')}),true);assert.equal(node.src,art.url);
 assert.equal(renderSpotifyArtwork(node,{...track,artwork:undefined}),false);assert.equal(node.src,'assets/icons/music-note-beamed.svg');
 assert.equal(renderSpotifyArtwork(node,{...track,uri:'spotify:track:abc'}),false);
});
