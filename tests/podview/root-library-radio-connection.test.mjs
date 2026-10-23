import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/library.js',import.meta.url),'utf8');
const start=source.indexOf('function radioPreviewConnection('),end=source.indexOf('\nradioConnectionPreview.addEventListener',start);
const forward=new Function('location',`${source.slice(start,end)};return radioPreviewConnection;`)({origin:'http://localhost:53882'});
function fixture(){const events=[],host={live:false,dataset:{mode:'demo'},state:{connected:true,generation:7},dispatch(event){events.push(event);this.state.connected=event.type==='snapshot';}},doc={location:{origin:'http://localhost:53882',pathname:'/'},querySelector:()=>host};return{host,doc,frame:{contentDocument:doc},events,calls:()=>events.length};}
test('library control forwards the existing local fault events without replacing the frame or host',()=>{const f=fixture();assert.equal(forward(f.frame),'Afbryd forbindelsen · lokalt');assert.equal(f.calls(),0);assert.equal(forward(f.frame,true),'Genopret forbindelsen · lokalt');assert.equal(forward(f.frame,true),'Afbryd forbindelsen · lokalt');assert.equal(f.calls(),2);assert.deepEqual(f.events,[{type:'offline'},{type:'snapshot',generation:7}]);assert.equal(f.frame.contentDocument,f.doc);});
test('fault forwarding refuses live, nonlocal, wrong-path, uninitialized and unloaded previews',()=>{for(const mutate of [f=>f.host.live=true,f=>f.host.dataset.mode='live',f=>f.doc.location.pathname='/view/home',f=>f.doc.location.origin='https://example.com',f=>f.host.state=null]){const f=fixture();mutate(f);assert.equal(forward(f.frame,true),null);assert.equal(f.calls(),0);}assert.equal(forward(null,true),null);});
