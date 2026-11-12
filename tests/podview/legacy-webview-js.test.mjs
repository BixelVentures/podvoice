import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installRandomUUID} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';

// Oldest supported wall screen: Android System WebView 107 (Frameo, Android 6), opening
// HA ingress over plain http — an insecure context without crypto.randomUUID.
const root=fileURLToPath(new URL('../../',import.meta.url));
const podview=path.join(root,'podvoice/gatekeeper/static/podview');
const sources=dir=>readdirSync(dir).flatMap(name=>{
 const file=path.join(dir,name);
 if(statSync(file).isDirectory())return sources(file);
 return name.endsWith('.js')&&!name.endsWith('.bundle.js')?[file]:[];
});

test('insecure http context: a request id is still a v4 UUID, from getRandomValues',()=>{
 let calls=0;
 const insecure={getRandomValues(bytes){calls++;for(let i=0;i<bytes.length;i++)bytes[i]=(i*37+calls*11)&255;return bytes;}};
 assert.equal(installRandomUUID(insecure),true);
 const first=insecure.randomUUID(),second=insecure.randomUUID();
 for(const id of [first,second])assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.notEqual(first,second);
});

test('a secure context keeps the native randomUUID, and no random source means no fake id',()=>{
 const native=()=>'native',secure={randomUUID:native,getRandomValues(){throw Error('unused');}};
 assert.equal(installRandomUUID(secure),false);
 assert.equal(secure.randomUUID,native);
 const bare={};
 assert.equal(installRandomUUID(bare),false);
 assert.equal('randomUUID' in bare,false);
});

test('live transport installs the request-id fallback when its module loads, before any action',()=>{
 const transport=readFileSync(path.join(podview,'podvoice-transport.js'),'utf8');
 assert.match(transport,/^installRandomUUID\(\);$/m);
});

test('delivery bundle targets Chrome 107 and screen code uses no API newer than Chrome 107',()=>{
 assert.match(readFileSync(path.join(root,'scripts/build-scripts.mjs'),'utf8'),/target:'chrome107'/);
 const newer=[
  /\bObject\.groupBy\(/,/\bMap\.groupBy\(/,/\bArray\.fromAsync\(/,/\bPromise\.withResolvers\(/,
  /\.toSorted\(/,/\.toReversed\(/,/\.toSpliced\(/,/\bAbortSignal\.any\(/,/\bURL\.canParse\(/,
  /\.showPopover\(/,/\.togglePopover\(/,/\bIterator\.from\(/,/\.isWellFormed\(/,/\bdocument\.startViewTransition\(/,
 ];
 const found=[];
 for(const file of sources(podview)){
  const text=readFileSync(file,'utf8');
  for(const pattern of newer)if(pattern.test(text))found.push(`${path.relative(podview,file)} ${pattern}`);
 }
 assert.deepEqual(found,[]);
});
