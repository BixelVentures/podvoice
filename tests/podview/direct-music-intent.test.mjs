import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';

test('direct music intent sends one closed request and retains action diagnostics', async()=>{
 const requestId='01234567-0123-4567-89ab-0123456789ab';
 const t=new PodVoiceTransport({url:'https://ha.example/view/',diagnosticStorage:null});
 let calls=0,body;
 t.request=async (_url,options)=>{calls++;body=JSON.parse(options.body);return {status:200,ok:true,json:async()=>({ok:true,requestId,outcome:'accepted',retryAllowed:false,physicalResultVerified:false})};};
 const intent={bootId:'a'.repeat(32),roomId:'kitchen',action:'pause',target:{accountId:'account',kind:'spotify_device',targetId:'target',expectedBindingId:'b'.repeat(64)},args:{},requestId,issuedAt:Date.now()};
 assert.equal((await t.controlIntent(intent)).outcome,'accepted');
 assert.equal(calls,1);
 assert.deepEqual(body,{bootId:intent.bootId,roomId:intent.roomId,domain:'music',action:intent.action,target:intent.target,args:{},requestId,issuedAt:intent.issuedAt});
 for(let i=0;i<150;i++)t.recordDiagnostic('request',{code:'ok'});
 assert(t.diagnostics().records.some(row=>row.stage==='control_action'&&row.action==='pause'&&row.domain==='music'&&row.code==='accepted'));
 t.request=async()=>{calls++;throw Error('network');};
 assert.equal((await t.controlIntent({...intent,action:'next'})).outcome,'unknown');
 assert.equal(calls,2,'an unknown result does not replay the command');
});
