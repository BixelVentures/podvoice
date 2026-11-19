import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKitComponent,runKitButtonAction} from '../../podview/ui/kit.js';

class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.className='';this.attributes=new Map();this.dataset={};
  this.children=[];if(this.tagName==='BUTTON')this.disabled=false;}
 setAttribute(name,value){this.attributes.set(name,String(value));
  if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
 getAttribute(name){return this.attributes.get(name)??null;}
 append(...nodes){this.children.push(...nodes);}
}
const document={createElement:tag=>new Element(tag)};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const variants=['primary','secondary','icon','destructive',undefined];

test('every kit Button with an async action is busy while it runs, ignores a second tap and then clears',async()=>{
 for(const variant of variants){
  const button=createKitComponent('button',{document,text:'Afspil',variant});
  assert.equal(button.dataset.kit,'button');
  const gate=deferred();let calls=0;
  const first=runKitButtonAction(button,()=>{calls++;return gate.promise;});
  assert.equal(button.getAttribute('aria-busy'),'true',`${variant}: busy while in flight`);
  assert.equal(button.dataset.feedback,'progress',`${variant}: kit progress spinner`);
  await runKitButtonAction(button,()=>{calls++;});
  assert.equal(calls,1,`${variant}: second tap is ignored while busy`);
  gate.resolve('ok');
  assert.equal(await first,'ok');
  assert.equal(button.getAttribute('aria-busy'),'false',`${variant}: busy clears`);
  assert.notEqual(button.dataset.state,'error');
 }
});

test('busy clears and the button shows error when the action fails, and the next tap starts clean',async()=>{
 for(const variant of variants){
  const button=createKitComponent('button',{document,text:'Opdater liste',variant});
  await runKitButtonAction(button,async()=>{throw new Error('netværk');});
  assert.equal(button.getAttribute('aria-busy'),'false',`${variant}: busy never sticks after failure`);
  assert.equal(button.dataset.state,'error');
  await runKitButtonAction(button,()=>{throw new Error('synkron fejl');});
  assert.equal(button.getAttribute('aria-busy'),'false');
  await runKitButtonAction(button,async()=>'ok');
  assert.equal(button.dataset.state,undefined,`${variant}: a new tap clears the error`);
  assert.equal(button.getAttribute('aria-busy'),'false');
 }
});

test('owner-held feedback choice is kept and the kit styles busy and disabled once for every Button',()=>{
 const button=createKitComponent('button',{document,text:'Afspil',feedback:'label'});
 void runKitButtonAction(button,()=>new Promise(()=>{}));
 assert.equal(button.dataset.feedback,'label');
 const css=readFileSync(new URL('../../podview/ui-kit.css',import.meta.url),'utf8');
 assert.ok(css.includes('.pv-kit.pv-kit-button[aria-busy=true]:not(.result-play)::after{'),'one spinner for every busy Button');
 assert.ok(css.includes('.pv-kit.pv-kit-button[data-kit=button]:is(:disabled,[aria-disabled=true]):not([aria-busy=true]){'),
  'one disabled style for every Button');
});

test('async Buttons without an owner pending model use the kit busy contract',()=>{
 const root=new URL('../../podview/',import.meta.url);
 const read=name=>readFileSync(new URL(name,root),'utf8');
 assert.ok(read('live-music-selection-view.js').includes('runKitButtonAction(this.confirmButton,()=>this.send())'));
 assert.ok(read('src/screens/player/SpeakerOutputView.tsx').includes('runKitButtonAction(this.refresh, () => this.open())'));
 assert.ok(read('timer-notice.js').includes("applyKitComponent(this.stop,'button',{feedback:'progress',loading:busy&&this.allowed})"),'a Stop that cannot be used shows no spinner');
});

test('a control the user cannot use is disabled without a spinner and re-enables with its dependency',()=>{
 const root=new URL('../../podview/',import.meta.url);
 const read=name=>readFileSync(new URL(name,root),'utf8');
 assert.ok(read('room-player-controls.js').includes('const busy=!node?.disabled&&('),'transport spinner only on usable buttons');
 assert.ok(read('src/screens/timer/TimerView.tsx').includes('loading: !disabled && !!(pending'),'timer ±1 min');
 assert.ok(read('src/screens/light/LightLampView.tsx').includes('busy: busy && !!binding'),'lamp toggle');
 assert.ok(read('src/screens/light/LightRoomView.tsx').includes("['turn_on', 'turn_off'].includes(command.action ?? '') && row.enabled,"),
  'room power tile');
 assert.ok(read('src/screens/radio/model.ts').includes('loading: available && pendingStationId === id'),'radio tile');
 assert.ok(read('src/screens/robot/RobotControlPanel.tsx').includes('const busy = !blocked && value.directPendingAction === action;'),
  'robot');
 assert.ok(!read('src/screens/player/SpeakerOutputView.tsx').includes('this.refresh.disabled = false'),
  'Opdater liste needs a list to read');
 assert.ok(read('live-media-view.js').includes('const canOutput=model.canOutput===true&&!!this.account;'),'chip');
 assert.ok(read('src/screens/vehicle/VehicleView.tsx').includes("ui.lockConfirm.disabled = this.connected === false || this.model.mode !== 'observed';"));
});
