import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
test('actual local music render gate defers hidden first construction, mounts on entry and keeps later updates',()=>{
 const block=source.match(/if\(\(s\.focus==='music'\|\|this\.localMusicSignature!==undefined\).*?this\.localMusicSignature=musicSignature;\}/)?.[0];assert.ok(block);const run=Function('s','musicSignature','musicProjection',block),calls=[],host={musicResults:{render:model=>calls.push(model)}};
 run.call(host,{focus:'photo'},'first',{id:1});assert.equal(calls.length,0);assert.equal(host.localMusicSignature,undefined);
 run.call(host,{focus:'music'},'first',{id:1});assert.equal(calls.length,1);run.call(host,{focus:'now'},'first',{id:1});assert.equal(calls.length,1);run.call(host,{focus:'now'},'second',{id:2});assert.equal(calls.length,2);
});
test('actual queue render gate preserves player independently and defers queue until its first visit',()=>{
 const block=source.match(/if\(s\.focus==='player'\|\|this\.localQueueMounted\)\{.*?this\.localQueueMounted=true;\}/)?.[0];assert.ok(block);const run=Function('s','radioPreview','localQueueModel',block),calls=[],host={playerView:{renderQueue:items=>calls.push(items)}};
 let projections=0;const model=()=>{projections++;return [{id:'track'}];};run.call(host,{focus:'photo'},false,model);assert.equal(projections,0);run.call(host,{focus:'player'},false,model);assert.equal(calls.length,1);run.call(host,{focus:'now'},false,model);assert.equal(calls.length,2);assert.equal(host.localQueueMounted,true);
});
