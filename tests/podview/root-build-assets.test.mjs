import test from 'node:test';
import assert from 'node:assert/strict';
import {composeStyles} from '../../scripts/build-assets.mjs';

test('generated stylesheet inlines exact small local SVG bytes after rebasing nested ownership',()=>{
 const icon=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h3"/></svg>'),reads=[];
 const source='.x{background:url("../../assets/icons/check.svg")}';
 const output=composeStyles(['ui/library/library.css'],()=>source,path=>{reads.push(path);return icon;});
 assert.deepEqual(reads,['assets/icons/check.svg']);
 const encoded=output.match(/data:image\/svg\+xml;base64,([^"\)]+)/)[1];
 assert.deepEqual(Buffer.from(encoded,'base64'),icon);
 assert.equal(output,composeStyles(['ui/library/library.css'],()=>source,()=>icon));
});
test('large SVG keeps its exact file request rather than inflating CSS',()=>{
 const source='.x{background:url(assets/icons/large.svg)}';
 const output=composeStyles(['widget-view.css'],()=>source,()=>Buffer.alloc(4097,32));
 assert.match(output,/url\(assets\/icons\/large.svg\)/);assert.doesNotMatch(output,/base64/);
});
test('external, query, fragment, non-icon and traversal URLs never become inline reads',()=>{
 const values=['https://example.test/a.svg','data:image/svg+xml;base64,AA==','#symbol','assets/icons/check.svg?v=1','assets/icons/check.svg#symbol','assets/photo.svg','../outside.svg'];
 const source=values.map(value=>`.x{background:url("${value}")}`).join('');
 const output=composeStyles(['widget-view.css'],()=>source,()=>assert.fail('unadmitted icon read'));
 for(const value of values)assert(output.includes(value),value);
});

import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareCheckout} from '../../scripts/prepare-podview-checkout.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function checkoutFixture(t,{staging=true}={}){
 const root=await mkdtemp(path.join(tmpdir(),'podview-prepare-test-')),source=path.join(root,'canonical'),dist=path.join(root,'dist');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(source,{recursive:true});
 const initial={'widget-view.js':'widget original','index.html':'index original','ui-kit.css':'css original','podview.css':'generated original','podview.bundle.js':'bundle original'};
 const manifest={schema:'podview.assets.v1',files:Object.entries(initial).map(([name,value])=>({path:name,sha256:sha(value)}))};
 for(const [name,value] of Object.entries(initial))await writeFile(path.join(source,name),value);
 await writeFile(path.join(source,'asset-manifest.json'),JSON.stringify(manifest));
 if(staging){await mkdir(dist);for(const [name,value] of Object.entries(initial))await writeFile(path.join(dist,name),value);await writeFile(path.join(dist,'asset-manifest.json'),JSON.stringify(manifest));}
 return {source,dist,manifest,initial};
}

test('prepare populates a missing dist and safely syncs canonical-only changes from manifest baseline',async t=>{
 const f=await checkoutFixture(t,{staging:false});await prepareCheckout({source:f.source,staging:f.dist});assert.equal(await readFile(path.join(f.dist,'widget-view.js'),'utf8'),f.initial['widget-view.js']);
 await writeFile(path.join(f.source,'index.html'),'canonical version 133');await writeFile(path.join(f.source,'ui-kit.css'),'canonical css update');await prepareCheckout({source:f.source,staging:f.dist});assert.equal(await readFile(path.join(f.dist,'index.html'),'utf8'),'canonical version 133');assert.equal(await readFile(path.join(f.dist,'ui-kit.css'),'utf8'),'canonical css update');
});

test('prepare rejects staged-only or divergent edits before applying any planned copies',async t=>{
 for(const kind of ['staged-only','divergent','unknown-baseline','staged-extra','staged-deleted']){
  const f=await checkoutFixture(t);await writeFile(path.join(f.source,'index.html'),'safe canonical change');
  if(kind==='staged-extra')await writeFile(path.join(f.dist,'private-note.txt'),'keep this');else if(kind==='staged-deleted')await rm(path.join(f.dist,'ui-kit.css'));else{await writeFile(path.join(f.dist,'ui-kit.css'),'local staged work');if(kind==='divergent')await writeFile(path.join(f.source,'ui-kit.css'),'other canonical work');if(kind==='unknown-baseline'){f.manifest.files=f.manifest.files.filter(row=>row.path!=='ui-kit.css');await writeFile(path.join(f.source,'asset-manifest.json'),JSON.stringify(f.manifest));}}
  await assert.rejects(()=>prepareCheckout({source:f.source,staging:f.dist}),/PodView staging(?: conflict|-only file)/,kind);
  assert.equal(await readFile(path.join(f.dist,'index.html'),'utf8'),f.initial['index.html'],kind+' must not apply an earlier safe copy');if(kind==='staged-deleted')await assert.rejects(()=>readFile(path.join(f.dist,'ui-kit.css')),error=>error.code==='ENOENT');else assert.equal(await readFile(path.join(f.dist,kind==='staged-extra'?'private-note.txt':'ui-kit.css'),'utf8'),kind==='staged-extra'?'keep this':'local staged work');
 }
});

test('prepare ignores generated output differences and adds missing source without deleting staged work',async t=>{
 const f=await checkoutFixture(t);await writeFile(path.join(f.dist,'podview.css'),'locally built css');await writeFile(path.join(f.dist,'podview.bundle.js'),'locally built bundle');await mkdir(path.join(f.source,'assets'));await writeFile(path.join(f.source,'assets','new.txt'),'new source');await prepareCheckout({source:f.source,staging:f.dist});assert.equal(await readFile(path.join(f.dist,'podview.css'),'utf8'),'locally built css');assert.equal(await readFile(path.join(f.dist,'podview.bundle.js'),'utf8'),'locally built bundle');assert.equal(await readFile(path.join(f.dist,'assets','new.txt'),'utf8'),'new source');
});

test('prepare detects a staged directory blocking a new canonical file before any copy',async t=>{
 const f=await checkoutFixture(t);await writeFile(path.join(f.source,'index.html'),'canonical change');await writeFile(path.join(f.source,'new-file'),'new source');await mkdir(path.join(f.dist,'new-file'));await assert.rejects(()=>prepareCheckout({source:f.source,staging:f.dist}),/PodView staging conflict: new-file is not a file/);assert.equal(await readFile(path.join(f.dist,'index.html'),'utf8'),f.initial['index.html']);
});

test('prepare rejects a baseline source missing from both trees before any planned copy',async t=>{
 const f=await checkoutFixture(t);await writeFile(path.join(f.source,'index.html'),'canonical change');await rm(path.join(f.source,'ui-kit.css'));await rm(path.join(f.dist,'ui-kit.css'));await assert.rejects(()=>prepareCheckout({source:f.source,staging:f.dist}),/PodView canonical file missing: ui-kit\.css/);assert.equal(await readFile(path.join(f.dist,'index.html'),'utf8'),f.initial['index.html']);
});

test('prepare rejects malformed or unsafe manifest entries without changing staging',async t=>{
 for(const mutate of [m=>m.files.push({path:'../outside',sha256:sha('x')}),m=>m.files.push({...m.files[0]}),m=>m.files[0].sha256='invalid']){const f=await checkoutFixture(t);await writeFile(path.join(f.source,'index.html'),'canonical change');mutate(f.manifest);await writeFile(path.join(f.source,'asset-manifest.json'),JSON.stringify(f.manifest));await assert.rejects(()=>prepareCheckout({source:f.source,staging:f.dist}),/Invalid PodView asset manifest/);assert.equal(await readFile(path.join(f.dist,'index.html'),'utf8'),f.initial['index.html']);}
});
