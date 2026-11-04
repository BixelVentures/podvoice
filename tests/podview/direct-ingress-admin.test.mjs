import test from 'node:test';
import assert from 'node:assert/strict';
import {beginIngressKiosk,requestIngressAdmin} from '../../dist/ingress-kiosk.js';
const origin='https://ha.example',panel='/23375871_podvoice';
function fixture(){const sent=[],listeners=new Map(),parent={location:{origin,pathname:panel+'/view'},postMessage(message,target){sent.push({message,target});}},win={parent,location:{origin,href:origin+'/opaque/view/',replace(){}},document:{visibilityState:'visible'},addEventListener(type,fn){listeners.set(type,fn)},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type)}};const stop=beginIngressKiosk(win);sent.length=0;return {win,parent,sent,listeners,stop};}
test('admin link moves only the currently owned HA parent to its existing root',()=>{
 for(const tail of ['/view','/view/']){const f=fixture();try{f.parent.location.pathname=panel+tail;assert.equal(requestIngressAdmin(f.win),true);assert.deepEqual(f.sent,[{message:{type:'home-assistant/navigate',path:panel},target:origin}]);}finally{f.stop();}}
});
test('hidden, stale, standalone, foreign or stopped panels never receive navigation',()=>{
 for(const change of [f=>f.win.document.visibilityState='hidden',f=>f.parent.location.pathname=panel,f=>f.parent.location.pathname='/other/view',f=>f.parent.location.pathname='/api/hassio_ingress/secret/view',f=>f.parent.location.origin='https://other.example',f=>f.win.parent=f.win,f=>f.listeners.get('pagehide')(),f=>f.stop()]){const f=fixture();change(f);f.sent.length=0;assert.equal(requestIngressAdmin(f.win),false);assert.deepEqual(f.sent,[]);f.stop();}
});
test('BFCache restores only its original owned panel',()=>{const f=fixture();try{f.listeners.get('pagehide')();f.sent.length=0;f.parent.location.pathname='/other/view';f.listeners.get('pageshow')({persisted:true});assert.equal(requestIngressAdmin(f.win),false);f.parent.location.pathname=panel+'/view';f.listeners.get('pageshow')({persisted:true});f.sent.length=0;assert.equal(requestIngressAdmin(f.win),true);assert.equal(f.sent[0].message.path,panel);}finally{f.stop();}});
