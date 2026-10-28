import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {composeScriptBundle} from '../../scripts/build-scripts.mjs';
test('compact delivery retains named canonical registration side effects and source pins',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'podview-delivery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'dist'));
 const index=path.join(root,'dist/index.html');fs.writeFileSync(index,'<meta name="podview-build" content="2.0.97">');
 const file=path.join(root,'dist/component.js');fs.writeFileSync(file,'class ExampleWidget {}\ncustomElements.define("pv-example",ExampleWidget);\nexport const unusedFixture="UNREFERENCED_DEMO_PAYLOAD";\n');
 const bundle={html:'dist/index.html',sources:['component.js']},output=composeScriptBundle(root,bundle),registered=[];
 vm.runInNewContext(output,{customElements:{define:(name,owner)=>registered.push([name,owner.name])}});
 assert.deepEqual(registered,[['pv-example','ExampleWidget']]);assert.equal(output.includes('UNREFERENCED_DEMO_PAYLOAD'),false);assert.match(output,/dist\/component\.js [a-f0-9]{64}/);assert.equal(composeScriptBundle(root,bundle),output);
 fs.appendFileSync(file,'\n// reviewed source change\n');assert.notEqual(composeScriptBundle(root,bundle),output,'delivery pins must detect even source-only changes');
});

test('build identity is embedded and missing, duplicate or malformed metadata fails closed',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'podview-version-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'dist'));const index=path.join(root,'dist/index.html');fs.writeFileSync(path.join(root,'dist/component.js'),'globalThis.version=__PODVIEW_BUILD__;');const bundle={html:'dist/index.html',sources:['component.js']};
 for(const html of ['', '<meta name="podview-build" content="unknown">','<meta name="podview-build" content="2.0.97"><meta name="podview-build" content="2.0.97">']){fs.writeFileSync(index,html);assert.throws(()=>composeScriptBundle(root,bundle),/PodView build/);}
 fs.writeFileSync(index,'<meta name="podview-build" content="2.0.97">');const first=composeScriptBundle(root,bundle),one={};vm.runInNewContext(first,one);assert.equal(one.version,'2.0.97');fs.writeFileSync(index,'<meta name="podview-build" content="2.0.98">');const second=composeScriptBundle(root,bundle),two={};vm.runInNewContext(second,two);assert.equal(two.version,'2.0.98');assert.equal(one.version,'2.0.97','older loaded bundle keeps its own identity');
});
