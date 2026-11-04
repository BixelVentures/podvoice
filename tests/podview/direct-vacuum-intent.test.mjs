import test from 'node:test';
import assert from 'node:assert/strict';
import {robotTransportOffer} from '../../dist/home-model.js';
import {PodVoiceTransport} from '../../dist/podvoice-transport.js';

test('robot transport offer is fresh, entity and state bound; direct intent sends once',async()=>{
 const now=Date.now()/1000,base={status:'observed',source:'home_assistant_state',entityId:'vacuum.house',observedAt:now,actions:['pause','stop','return']};
 assert.deepEqual(robotTransportOffer(base,'vacuum.house','cleaning',now),base);
 assert.equal(robotTransportOffer(base,'vacuum.other','cleaning',now),null);
 assert.equal(robotTransportOffer(base,'vacuum.house','paused',now),null);
 assert.equal(robotTransportOffer(base,'vacuum.house','cleaning',now+16),null);
 assert.equal(robotTransportOffer({...base,actions:['pause','invented']},'vacuum.house','cleaning',now),null);
 const t=new PodVoiceTransport({url:'https://ha.example/view/',diagnosticStorage:null}),requestId='01234567-0123-4567-89ab-0123456789ab';let count=0,body;
 t.request=async (_url,options)=>{count++;body=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({ok:true,requestId,outcome:'accepted',retryAllowed:false,physicalResultVerified:false,partial:false,completedSteps:1,startSent:false})};};
 const issuedAt=Date.now(),result=await t.controlIntent({bootId:'a'.repeat(32),roomId:'kitchen',domain:'vacuum',action:'pause',target:{entityId:'vacuum.house'},args:{},requestId,issuedAt});
 assert.deepEqual(body,{bootId:'a'.repeat(32),roomId:'kitchen',domain:'vacuum',action:'pause',target:{entityId:'vacuum.house'},args:{},requestId,issuedAt});
 assert.equal(result.outcome,'accepted');assert.equal(result.completedSteps,1);assert.equal(result.startSent,false);assert.equal(count,1);
 t.request=async()=>{count++;throw Error('network');};assert.equal((await t.controlIntent({...body,requestId})).outcome,'unknown');assert.equal(count,2);
});
