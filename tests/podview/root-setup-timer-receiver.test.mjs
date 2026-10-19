import test from 'node:test';
import assert from 'node:assert/strict';
import {SetupFlow} from '../../podvoice/gatekeeper/static/podview/setup.js';

test('default browser timers retain their global receiver through polling and failure cleanup',async()=>{
 const original={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const jobs=new Map(),views=[];let serial=0;
 globalThis.setTimeout=function(fn,ms){
  if(this!==globalThis)throw new TypeError('Illegal invocation: setTimeout receiver');
  const id=++serial;jobs.set(id,{fn,ms});return id;
 };
 globalThis.clearTimeout=function(id){
  if(this!==globalThis)throw new TypeError('Illegal invocation: clearTimeout receiver');
  jobs.delete(id);
 };
 try{
  const transport={connected:true,snapshot:{bootId:'boot',roomId:'kitchen',controllerContinuity:{available:true}},close(){},async accessRequest(){return {requestId:'a'.repeat(32),matchSignal:'ABC234',expiresIn:300};},async accessClaim(){return {status:'pending',expiresIn:298};}};
  const flow=new SetupFlow({transport,render:view=>views.push(view),navigate:()=>assert.fail('No approval was given'),now:()=>0});
  flow.connection('connected');await flow.submit('Mac');
  assert.equal(flow.phase,'pending');assert.equal(jobs.size,1);
  const [first,job]=jobs.entries().next().value;jobs.delete(first);await job.fn();
  assert.equal(flow.phase,'pending');assert.equal(jobs.size,1);
  flow.connection('disconnected');assert.equal(jobs.size,0);assert.equal(flow.phase,'unknown');
  flow.close();
  const failed=new SetupFlow({transport:{...transport,async accessRequest(){throw Error('offline');}},render:view=>views.push(view),navigate:()=>assert.fail('No approval was given')});
  failed.connection('connected');await failed.submit('Mac');
  assert.equal(failed.phase,'unknown');assert.match(views.at(-1).status,/Adgangen kunne ikke bekræftes/);assert.equal(jobs.size,0);failed.close();
 }finally{globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;}
});
