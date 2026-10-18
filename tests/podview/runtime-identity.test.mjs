import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('../../podvoice/gatekeeper/static/index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('function renderRuntimeIdentity('),html.indexOf('function renderSub('));
function fixture(){const node={textContent:''};const ctx={document:{getElementById:()=>node}};runInNewContext(code,ctx);return {node,render:ctx.renderRuntimeIdentity};}
const valid={runtime_identity:{version:'2.0.58',git_sha:'a'.repeat(40),artifact_kind:'rootfs-v1',artifact_sha256:'b'.repeat(64)}};
test('actual renderer full identity, stale state, and missing replacement',()=>{const {node,render}=fixture();render(valid,true);assert.match(node.textContent,/Gemt build-identitet: b{64}/);assert.match(node.textContent,/Commit: a{40}/);render(valid,false);assert.match(node.textContent,/Sidst kendte/);render({},true);assert.doesNotMatch(node.textContent,/a{40}|b{64}/);assert.match(node.textContent,/ukendt/);});
test('fallback and invalid projection never inherit old marker',()=>{const {node,render}=fixture();render(valid,true);render({runtime_identity:{...valid.runtime_identity,artifact_kind:'source-fallback-v1'}},true);assert.match(node.textContent,/Lokal kildeidentitet/);assert.doesNotMatch(node.textContent,/Gemt build/);render({runtime_identity:{...valid.runtime_identity,git_sha:'private',artifact_kind:'untrusted'}},true);assert.doesNotMatch(node.textContent,/private|b{64}/);assert.match(node.textContent,/Ikke en ny måling/);});
test('existing anatomy wraps full hashes without new fetch or HTML injection',()=>{assert.match(html,/id="runtime_identity" class="sub" style="overflow-wrap:anywhere;white-space:pre-line"/);assert.doesNotMatch(code,/innerHTML|fetch\(|setInterval|setTimeout/);});
test('actual poll fences late pre-loss responses and only current GET restores identity freshness',async()=>{
 const nodes={runtime_identity:{textContent:''},sub:{textContent:'',style:{}},status_connection:{hidden:false,textContent:''},svc:{setAttribute(){}}};let stream,resolve;
 const context={document:{getElementById:id=>nodes[id]},Date:{now:()=>100000},connected:true,lastObservedMs:99000,lastStatus:valid,rooms:{},wakeStatusAvailable:true,renderWakeWordStatus(){},applyEvent(){},renderServices(){},renderCapabilities(){},renderRooms(){},renderMetrics(){},renderActivity(){},renderLifecycle(){},acceptLiveStatus(){},liveStatusWatermarks:{},window:{dispatchEvent(){}},CustomEvent:class{},EventSource:class{constructor(){stream=this;}},fetch:()=>new Promise(r=>resolve=r)};
 runInNewContext(html.slice(html.indexOf('var statusReadGeneration'),html.indexOf('\n',html.indexOf('var statusReadGeneration'))),context);
 runInNewContext(html.slice(html.indexOf('function renderRuntimeIdentity('),html.indexOf('function renderServices(')),context);
 runInNewContext(html.slice(html.indexOf('function applyStatus(data)'),html.indexOf('function fmtClock')),context);
 runInNewContext(html.slice(html.indexOf('async function poll()'),html.indexOf('renderMetrics({});\npoll();')),context);
 context.runtimeIdentityFresh=true;context.openStream();const pending=context.poll();stream.onerror();stream.onopen();
 assert.match(nodes.runtime_identity.textContent,/Sidst kendte/);
 resolve({ok:true,json:async()=>({...valid,rooms:[]})});await pending;
 assert.match(nodes.runtime_identity.textContent,/Sidst kendte/);
 const current=context.poll();resolve({ok:true,json:async()=>({...valid,rooms:[]})});await current;
 assert.doesNotMatch(nodes.runtime_identity.textContent,/Sidst kendte/);assert.match(nodes.runtime_identity.textContent,/Commit: a{40}/);
});
test('array hashes are not strings',()=>{const {node,render}=fixture();render({runtime_identity:{...valid.runtime_identity,git_sha:['a'.repeat(40)],artifact_sha256:['b'.repeat(64)]}},true);assert.doesNotMatch(node.textContent,/a{40}|b{64}/);});
