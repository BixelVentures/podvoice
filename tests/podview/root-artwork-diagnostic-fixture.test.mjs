import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {artworkDiagnosticAsset,artworkDiagnosticFixture} from '../../scripts/artwork-diagnostic.mjs';
import {fixtureRequest} from '../../scripts/live-fixture.mjs';
const response=()=>{const res=new EventEmitter();Object.assign(res,{headers:{},status:200,setHeader(key,value){this.headers[key]=value;},writeHead(status){this.status=status;},end(value){this.value=value;this.finished=true;this.resolve?.();}});return res;};
test('normal fixture route serves the canonical renderer diagnostic and closed bundled-image aliases only',async()=>{
 const req=new EventEmitter();req.url='/fixture-artwork';req.method='GET';const res=response();await fixtureRequest(req,res);assert.equal(res.status,200);assert.equal(res.headers['Content-Type'],'text/html');assert.match(res.value,/ingen Spotifydata eller lyd/);assert.match(res.value,/src="\/fixture-artwork-client.js"/);
 const moduleReq=new EventEmitter();moduleReq.url='/fixture-artwork-client.js';const moduleRes=response();await fixtureRequest(moduleReq,moduleRes);assert.equal(moduleRes.headers['Content-Type'],'text/javascript');assert.match(moduleRes.value,/import \{MusicResults\} from '\/view\/music-results.js'/);
 assert.deepEqual(artworkDiagnosticAsset('/view/assets/diagnostic/shared-slow.webp'),{file:'assets/editorial-vinyl.webp',delay:4000});assert.deepEqual(artworkDiagnosticAsset('/view/assets/diagnostic/account-next.webp'),{file:'assets/editorial-ocean.webp',delay:6000});for(const path of ['/view/assets/diagnostic/../kitchen.webp','/view/assets/diagnostic/unknown.webp','https://i.scdn.co/image/x'])assert.equal(artworkDiagnosticAsset(path),null);
});
test('actual delayed image response retains original approved bytes and stays incomplete during the pending window',async()=>{
 const req=new EventEmitter(),res=response(),url=new URL('http://localhost/view/assets/diagnostic/shared-slow.webp');req.method='GET';const at=Date.now(),done=new Promise(resolve=>res.resolve=resolve);
 assert.equal(await artworkDiagnosticFixture(req,res,url),true);assert.equal(res.finished,undefined);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(res.finished,undefined,'no early load/decode completion is fabricated');await done;
 assert.ok(Date.now()-at>=3900);assert.equal(res.headers['Content-Type'],'image/webp');assert.equal(res.headers['Cache-Control'],'no-store');assert.deepEqual(res.value,await readFile('podvoice/gatekeeper/static/podview/assets/editorial-vinyl.webp'));
});
test('client disconnect cancels a pending diagnostic response without sending late image bytes',async()=>{
 const req=new EventEmitter(),res=response();req.method='GET';assert.equal(await artworkDiagnosticFixture(req,res,new URL('http://localhost/view/assets/diagnostic/account-next.webp')),true);res.emit('close');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(res.finished,undefined);
 const wrong=response();req.method='POST';assert.equal(await artworkDiagnosticFixture(req,wrong,new URL('http://localhost/view/assets/diagnostic/shared-slow.webp')),true);assert.equal(wrong.status,405);assert.equal(wrong.finished,true);
});
