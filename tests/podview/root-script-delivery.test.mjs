import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {composeScriptBundle} from '../../scripts/build-scripts.mjs';
function deliveryFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'podview-delivery-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'dist'));
 fs.mkdirSync(path.join(root,'podvoice'));
 const config=path.join(root,'podvoice/config.yaml');
 fs.writeFileSync(config,'version: "2.0.97"\n');
 return {root,config};
}
test('compact delivery retains named canonical registration side effects and source pins',t=>{
 const {root}=deliveryFixture(t);
 const file=path.join(root,'dist/component.js');fs.writeFileSync(file,'class ExampleWidget {}\ncustomElements.define("pv-example",ExampleWidget);\nexport const unusedFixture="UNREFERENCED_DEMO_PAYLOAD";\n');
 const bundle={html:'dist/index.html',sources:['component.js']},output=composeScriptBundle(root,bundle),registered=[];
 vm.runInNewContext(output,{customElements:{define:(name,owner)=>registered.push([name,owner.name])}});
 assert.deepEqual(registered,[['pv-example','ExampleWidget']]);assert.equal(output.includes('UNREFERENCED_DEMO_PAYLOAD'),false);assert.match(output,/dist\/component\.js [a-f0-9]{64}/);assert.equal(composeScriptBundle(root,bundle),output);
 fs.appendFileSync(file,'\n// reviewed source change\n');assert.notEqual(composeScriptBundle(root,bundle),output,'delivery pins must detect even source-only changes');
});

test('add-on version binds the embedded build and the real diagnostic transport',t=>{
 const {root,config}=deliveryFixture(t);
 const canonical=fileURLToPath(new URL('../../podvoice/gatekeeper/static/podview/',import.meta.url));
 for(const name of ['podvoice-transport.js','request-deadline.js']){
  fs.copyFileSync(path.join(canonical,name),path.join(root,'dist',name));
 }
 const fixture=`
 import {PodVoiceTransport} from './podvoice-transport.js';
 const url='https://fixture.invalid/view/';
 globalThis.build=__PODVIEW_BUILD__;
 globalThis.diagnostic=new PodVoiceTransport({url}).diagnosticBuild;
 globalThis.override=new PodVoiceTransport({url,diagnosticBuild:'fixture-override'}).diagnosticBuild;
 `;
 fs.writeFileSync(path.join(root,'dist/component.js'),fixture);
 // A stale HTML shell cannot override the identity of the executing bundle.
 const index=path.join(root,'dist/index.html');
 fs.writeFileSync(index,'<meta name="podview-build" content="2.0.1">');
 const bundle={html:'dist/index.html',sources:['component.js']};
 for(const invalid of ['', 'version: "unknown"','version: "2.0.97"\nversion: "2.0.97"']){
  fs.writeFileSync(config,invalid);
  assert.throws(()=>composeScriptBundle(root,bundle),/PodView build version/);
 }
 const build=version=>{
  fs.writeFileSync(config,`version: "${version}"\n`);
  const sandbox={URL,document:{querySelector:()=>({content:'2.0.1'})}};
  vm.runInNewContext(composeScriptBundle(root,bundle),sandbox);
  assert.equal(sandbox.build,version);
  assert.equal(sandbox.diagnostic,version);
  assert.equal(sandbox.override,'fixture-override');
  return sandbox;
 };
 const first=build('2.0.97');
 build('2.0.98');
 assert.equal(first.diagnostic,'2.0.97','an older executing bundle retains its own identity');
});
