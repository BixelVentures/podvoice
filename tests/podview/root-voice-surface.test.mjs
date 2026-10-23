import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceStatus} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import { VoiceSurface, voicePresentation } from '../../podvoice/gatekeeper/static/podview/voice-surface.js';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function withBrowser(run, { reduced = false } = {}) {
  const previous = {
    document: globalThis.document,
    matchMedia: globalThis.matchMedia,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const timers = new Map();
  let nextTimer = 1;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  const env = {
    timers,
    fire(id) { const timer = timers.get(id); if (timer) { timers.delete(id); timer.callback(); } },
    latestTimer() { return [...timers.entries()].at(-1); },
  };
  try { return run(env); }
  finally {
    globalThis.document = previous.document;
    globalThis.matchMedia = previous.matchMedia;
    globalThis.setTimeout = previous.setTimeout;
    globalThis.clearTimeout = previous.clearTimeout;
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.inert = false;
    this.textContent = '';
    this.animations = [];
    const properties=new Map();this.style={setProperty:(name,value)=>properties.set(name,value),getPropertyValue:name=>properties.get(name)||'',removeProperty:name=>properties.delete(name)};
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for(const node of nodes){ if(node.parentNode){ const previous=node.parentNode.children;previous.splice(previous.indexOf(node),1); }this.children.push(node);node.parentNode=this;} }
  querySelector(selector) {
    if (selector === '.voice-copy') return this.children.find(child => child.className === 'voice-copy') ?? null;
    return null;
  }
  getBoundingClientRect(){return {top:this.visualTop??(Number.parseFloat(this.style.getPropertyValue('--pv-voice-top'))||16),height:48};}
  animate(frames, options) {
    let resolve;
    const animation = {
      frames, options, cancelled: 0,
      finished: new Promise(done => { resolve = done; }),
      cancel() { this.cancelled++; },
      finish() { resolve(); },
    };
    this.animations.push(animation);
    return animation;
  }
}

function fixture() {
  const host = new FakeElement('div');
  host.dataset.motion = 'system';
  host.isConnected = true;
  return { host, surface: new VoiceSurface(host) };
}

const view = (sessionId, turnId, phase = 'thinking') => voicePresentation({
  active: true, sessionId, turnId, phase: phase.toUpperCase() === phase ? phase : ({
    listening: 'LISTENING', thinking: 'THINKING', responding: 'AI_SPEAKING', ready: 'LOUNGE_WINDOW',
  })[phase],
});

test('same session, turn, and phase ticks do not restart acknowledgement or schedule prose', () => withBrowser(({ timers }) => {
  const { surface } = fixture();
  const first = view('s1', 't1', 'thinking');
  surface.update(first);
  const animationCount = surface.node.animations.length + surface.mark.animations.length;
  const timer = surface.slowTimer;
  surface.update({ ...first, label: 'Updated copy' });
  assert.equal(surface.node.animations.length + surface.mark.animations.length, animationCount);
  assert.equal(surface.slowTimer, timer);
  assert.equal(timers.size, 0);
}));

test('thinking stays actual phase copy without any timed slow claim', () => withBrowser(({ timers }) => {
  const { surface } = fixture();
  surface.update(view('s1', 't1', 'thinking'));
  assert.equal(timers.size, 0);
  assert.equal(surface.detail.textContent, 'Et øjeblik');
  surface.update(view('s1', 't2', 'thinking'));
  assert.equal(timers.size, 0);
  surface.update(view('s2', 't3', 'CLOSING'));
  assert.equal(surface.node.dataset.phase, 'closing');
  assert.equal(surface.label.textContent, 'Afslutter…');
  assert.equal(timers.size, 0);
}));

test('a close that is still animating cannot hide a newly reopened conversation', async () => withBrowser(async () => {
  const { surface } = fixture();
  surface.update(view('s1', 't1', 'listening'));
  surface.update(null);
  const exiting = surface.animation;
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.node.inert, true);
  surface.update(view('s2', 't1', 'responding'));
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.node.inert, false);
  exiting.finish();
  await flush();
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.label.textContent, 'Svarer…');
}));

test('cleanup cancels timers and every active animation and hides the detached surface', () => withBrowser(({ timers }) => {
  const { surface } = fixture();
  surface.update(view('s1', 't1', 'thinking'));
  const animations = [surface.animation, surface.copyAnimation, surface.markAnimation].filter(Boolean);
  assert.equal(timers.size, 0);
  surface.cleanup();
  assert.equal(timers.size, 0);
  assert.ok(animations.every(animation => animation.cancelled > 0));
  assert.equal(surface.node.hidden, true);
  assert.equal(surface.node.inert, true);
  assert.equal(surface.value, null);
}));

test('reduced motion keeps state feedback without starting Web Animations', () => withBrowser(() => {
  const { surface } = fixture();
  surface.host.dataset.motion = 'reduced';
  surface.update(view('s1', 't1', 'listening'));
  assert.equal(surface.node.hidden, false);
  assert.equal(surface.node.dataset.phase, 'listening');
  assert.equal(surface.label.textContent, 'Lytter…');
  assert.equal(surface.node.animations.length, 0);
  assert.equal(surface.mark.animations.length, 0);
}));

test('inactive and disconnected voice has no presentation; unknown phase is a neutral waiting state', () => {
  assert.equal(voicePresentation({ active: true, phase: 'NOT_A_PHASE' }), null);
  assert.equal(voicePresentation({ active: false, phase: 'THINKING' }), null);
  assert.equal(voicePresentation({ active: true, phase: 'THINKING' }, false), null);
  assert.equal(voicePresentation({ active: true, phase: 'THINKING' }).phase, 'thinking');
  assert.equal(voicePresentation({ active: true, phase: 'UNKNOWN' }).phase, 'waiting');
  assert.equal(voicePresentation({ active: false, phase: 'CLOSING' }), null);
  assert.equal(voicePresentation({ active: true, phase: 'CLOSING' }, false), null);
  assert.deepEqual([voicePresentation({ active: true, phase: 'CLOSING' }).phase,voicePresentation({ active: true, phase: 'CLOSING' }).label],['closing','Afslutter…']);
});

test('presentation keys change across boot sessions, turns, and phases', () => {
  const one = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-1', phase: 'THINKING' });
  const same = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-1', phase: 'THINKING' });
  const nextTurn = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-2', phase: 'THINKING' });
  const nextBoot = voicePresentation({ active: true, sessionId: 'boot-b', turnId: 'turn-1', phase: 'THINKING' });
  const nextPhase = voicePresentation({ active: true, sessionId: 'boot-a', turnId: 'turn-1', phase: 'AI_SPEAKING' });
  assert.equal(one.key, same.key);
  assert.notEqual(one.key, nextTurn.key);
  assert.notEqual(one.key, nextBoot.key);
  assert.notEqual(one.key, nextPhase.key);
});

test('a live reduced-motion preference change cancels an in-flight exit and cleanup detaches the listener',()=>withBrowser(()=>{
 const media=new EventTarget();media.matches=false;globalThis.matchMedia=()=>media;
 const {surface}=fixture();surface.update(view('s1','t1','thinking'));surface.update(null);const exiting=surface.animation;
 media.matches=true;media.dispatchEvent(new Event('change'));
 assert.ok(exiting.cancelled>0);assert.equal(surface.node.hidden,true);assert.equal(surface.animation,null);
 surface.cleanup();surface.node.hidden=false;media.dispatchEvent(new Event('change'));assert.equal(surface.node.hidden,false);
}));

test('a detached host cannot reopen or schedule a new voice surface',()=>withBrowser(({timers})=>{
 const {surface,host}=fixture();host.isConnected=false;surface.update(view('s1','t1','thinking'));
 assert.equal(surface.node.hidden,true);assert.equal(surface.node.inert,true);assert.equal(timers.size,0);
}));

test('actual active phases own their mark activity without moving or resizing the pill; ready and closing settle once',()=>withBrowser(()=>{
 const {surface}=fixture();for(const phase of ['LISTENING','THINKING','AI_SPEAKING','LOUNGE_WINDOW','CLOSING','UNKNOWN']){
  const presentation=voicePresentation({active:true,sessionId:'s',turnId:'turn',phase});surface.update(presentation);const copy=surface.copyAnimation||surface.animation;assert.equal(copy.options.duration,120);assert(copy.frames.every(frame=>!Object.hasOwn(frame,'transform')));
  const mark=surface.markAnimation;assert(mark,phase);assert.equal(mark.options.iterations,['LOUNGE_WINDOW','CLOSING'].includes(phase)?1:Infinity);const count=surface.mark.animations.length;surface.update({...presentation});assert.equal(surface.markAnimation,mark);assert.equal(surface.mark.animations.length,count);assert.equal(mark.cancelled,0);
 }
 surface.cleanup();assert.equal(surface.markAnimation,null);
}));

test('closing stays visible without animation under reduced motion, then hides on inactivity',()=>withBrowser(()=>{
 const {surface,host}=fixture();host.dataset.motion='reduced';
 surface.update(voicePresentation({active:true,sessionId:'s',turnId:'t',phase:'CLOSING'}));
 assert.equal(surface.node.hidden,false);assert.equal(surface.node.dataset.phase,'closing');assert.equal(surface.label.textContent,'Afslutter…');assert.equal(surface.mark.animations.length,0);
 surface.update(voicePresentation({active:false,sessionId:'s',turnId:'t',phase:'CLOSING'}));
 assert.equal(surface.node.hidden,true);assert.equal(surface.value,null);
}));
test('voice surface retains one host node outside hidden or transformed topbar slots',()=>withBrowser(()=>{
 const host=new FakeElement('div'),slot=new FakeElement('span');host.dataset.motion='system';host.isConnected=true;host.querySelector=selector=>selector==='.header-activity'?slot:null;const surface=new VoiceSurface(host);assert.deepEqual(slot.children,[]);assert.deepEqual(host.children,[surface.node]);surface.update(view('s','t','responding'));surface.cleanup();assert.equal(host.children.length,1);assert.equal(surface.node.hidden,true);
}));
test('visual enrichment arrival, revision and completion never replay unchanged speech status',()=>withBrowser(()=>{
 const {surface}=fixture(),voice={active:true,sessionId:'s',turnId:'t',phase:'AI_SPEAKING'};
 surface.update(voicePresentation(voice));
 const entry=surface.animation,mark=surface.markAnimation;
 for(const pending of [{sessionId:'s',taskId:'answer',revision:1},{sessionId:'s',taskId:'answer',revision:2},null]){
  surface.update(voicePresentation(voice,true,pending));
  assert.equal(surface.animation,entry);assert.equal(surface.markAnimation,mark);
  assert.equal(entry.cancelled,0);assert.ok(mark);assert.equal(mark.cancelled,0);
  assert.equal(surface.label.textContent,'Svarer…');assert.equal(surface.detail.hidden,true);
 }
 assert.equal(surface.mark.animations.length,1);surface.cleanup();
}));
test('switching the local motion setting during exit hides the status immediately',()=>withBrowser(()=>{
 const {surface,host}=fixture();surface.update(view('s','t','responding'));surface.update(null);
 const exiting=surface.animation;assert.equal(surface.node.hidden,false);
 host.dataset.motion='reduced';surface.update(null);
 assert.equal(exiting.cancelled,1);assert.equal(surface.node.hidden,true);
 assert.equal(surface.animation,null);assert.equal(surface.node.inert,true);
 surface.update(view('s','t2','listening'));assert.equal(surface.node.hidden,false);
 assert.equal(surface.mark.animations.length,1);assert.equal(surface.markAnimation,null);assert.equal(surface.label.textContent,'Lytter…');
 surface.cleanup();
}));
test('opaque session and turn separators cannot collide and suppress an actual new turn',()=>{
 assert.notEqual(view('session:turn','next').key,view('session','turn:next').key);
});


test('conversation status uses a neutral container with valid live-region semantics',()=>withBrowser(()=>{
 const host={dataset:{},isConnected:true,querySelector(){return null;},append(){}};const surface=new VoiceSurface(host);assert.equal(surface.node.tagName,'div');assert.equal(surface.node.getAttribute('role'),'status');assert.equal(surface.node.getAttribute('aria-live'),'polite');assert.equal(surface.node.getAttribute('aria-atomic'),'true');assert.equal(surface.mark.getAttribute('aria-hidden'),'true');surface.cleanup();
}));


test('Svar and active voice occupy one retained center slot with the original button as sole history authority',()=>withBrowser(()=>{
 const host=new FakeElement('div'),slot=new FakeElement('span'),history=new FakeElement('button');
 host.dataset={motion:'system',view:'active'};host.isConnected=true;
 host.querySelector=selector=>selector==='.header-activity'?slot:selector==='#open-history'?history:null;
 history.setAttribute('aria-label','Svar · Se tidligere svar');history.setAttribute('aria-expanded','true');history.setAttribute('aria-controls','history');
 const originalIcon=new FakeElement('img'),originalCopy=new FakeElement('span');history.append(originalIcon,originalCopy);
 const surface=new VoiceSurface(host),phase=view('s','t','thinking');surface.update(phase);
 assert.equal(surface.node.parentNode,host);assert.equal(history.parentNode,slot);assert.deepEqual(slot.children,[history]);assert.deepEqual(host.children,[surface.node]);assert.deepEqual(history.children,[originalIcon,originalCopy]);assert.equal(history.dataset.voicePhase,'thinking');assert.equal(host.dataset.voicePhase,'thinking');assert.equal(history.getAttribute('aria-label'),'Tænker… · Se tidligere svar');
 const retained=[...slot.children],animation=surface.markAnimation;surface.update({...phase});assert.deepEqual(slot.children,retained);assert.equal(surface.markAnimation,animation);
 host.dataset.view='rest';surface.update(phase);assert.equal(surface.node.parentNode,host);assert.equal(history.parentNode,slot);assert.equal(history.dataset.voicePhase,undefined);assert.equal(host.dataset.voicePhase,undefined);assert.equal(history.getAttribute('aria-label'),'Svar · Se tidligere svar');
 host.dataset.view='active';surface.update(phase);assert.equal(surface.node.parentNode,host);assert.equal(surface.markAnimation,animation);assert.deepEqual(history.children,[originalIcon,originalCopy]);
 surface.update(null);assert.equal(surface.node.hidden,false);assert.equal(surface.node.inert,true);assert.equal(surface.node.parentNode,host);assert.equal(history.dataset.voicePhase,undefined);assert.equal(host.dataset.voicePhase,undefined);assert.equal(history.getAttribute('aria-expanded'),'true');assert.equal(history.getAttribute('aria-controls'),'history');
 surface.update(view('s','t2','responding'));surface.cleanup();assert.equal(history.dataset.voicePhase,undefined);assert.equal(host.dataset.voicePhase,undefined);assert.equal(history.getAttribute('aria-label'),'Svar · Se tidligere svar');assert.equal(surface.node.hidden,true);assert.equal(history.parentNode,slot);
}));

test('phase activity ends on owner exit, settles at ready, and never survives background or disconnect',()=>withBrowser(()=>{
 const doc=new EventTarget();doc.createElement=tag=>new FakeElement(tag);doc.hidden=false;globalThis.document=doc;
 const {surface,host}=fixture();surface.update(view('s','t','listening'));const mic=surface.markAnimation;assert.equal(surface.icon.src,'assets/icons/mic.svg');assert.equal(mic.options.iterations,Infinity);
 surface.update(view('s','t','thinking'));assert.equal(mic.cancelled,1);const thinking=surface.markAnimation;assert.equal(surface.icon.src,'assets/icons/chat-circle.svg');assert.equal(surface.label.textContent,'Tænker…');assert(surface.label.textContent.endsWith('…'));assert.equal(surface.label.textContent.match(/…/g).length,1);
 surface.update(view('s','t','responding'));assert.equal(thinking.cancelled,1);const speaking=surface.markAnimation;assert.equal(surface.icon.src,'assets/icons/soundwave.svg');
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(speaking.cancelled,1);assert.equal(surface.markAnimation,null);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(surface.markAnimation.options.iterations,Infinity);
 surface.update(view('s','t','ready'));assert.equal(surface.markAnimation.options.iterations,1);assert.equal(surface.icon.src,'assets/icons/chat-circle.svg');surface.update(null);assert.equal(surface.markAnimation,null);
 surface.update(view('s','t2','thinking'));const active=surface.markAnimation;host.isConnected=false;surface.update(view('s','t2','thinking'));assert.equal(active.cancelled,1);assert.equal(surface.node.hidden,true);assert.equal(surface.markAnimation,null);const count=surface.mark.animations.length;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(surface.mark.animations.length,count);
}));

test('active conversation exit reveals the retained Svar action over120ms and releases all status activity',async()=>withBrowser(async()=>{
 const host=new FakeElement('div'),slot=new FakeElement('span'),history=new FakeElement('button');host.dataset={motion:'system',view:'active'};host.isConnected=true;history.setAttribute('aria-label','Svar · Se tidligere svar');history.setAttribute('aria-controls','history');host.querySelector=selector=>selector==='.header-activity'?slot:selector==='#open-history'?history:null;
 const surface=new VoiceSurface(host);surface.update(view('s','t','thinking'));const pulse=surface.markAnimation;surface.update(null);const exit=surface.animation;
 assert.equal(pulse.cancelled,1);assert.equal(surface.markAnimation,null);assert.equal(surface.node.hidden,false);assert.equal(surface.node.inert,true);assert.equal(surface.node.getAttribute('aria-hidden'),'true');assert.equal(history.getAttribute('aria-label'),'Svar · Se tidligere svar');assert.equal(history.getAttribute('aria-controls'),'history');assert.equal(history.inert,false);assert.equal(history.parentNode,slot);assert.equal(exit.options.duration,120);assert(exit.frames.every(frame=>Object.keys(frame).length===1));
 surface.update(null);assert.equal(surface.animation,exit,'repeated inactive snapshots retain the same exit');exit.finish();await flush();assert.equal(surface.node.hidden,true);assert.equal(surface.animation,null);const count=surface.node.animations.length;surface.update(null);assert.equal(surface.node.animations.length,count);surface.cleanup();
}));

test('thinking and waiting remain legible throughout a visible breathing cue and preserve the same activity on repeated observations',()=>withBrowser(()=>{
 for(const phase of ['THINKING','UNKNOWN']){const {surface}=fixture(),presentation=voicePresentation({active:true,sessionId:'s',turnId:'t',phase});surface.update(presentation);const activity=surface.markAnimation;
  assert.equal(activity.options.iterations,Infinity);assert(activity.frames.every(frame=>frame.opacity>=.8),'active symbol must not disappear into a dim gray outline');assert.notEqual(activity.frames[0].transform,activity.frames[1].transform,'work activity must be visible through geometry as well as a slight tone change');
  surface.update({...presentation});assert.equal(surface.markAnimation,activity);assert.equal(activity.cancelled,0);surface.update(null);assert.equal(activity.cancelled,1);assert.equal(surface.markAnimation,null);surface.cleanup();
 }
}));


test('all voice phases retain one host node and existing activity while its separate position follows Ro and active views',()=>withBrowser(()=>{
 const host=new FakeElement('div'),slot=new FakeElement('span'),history=new FakeElement('button');host.dataset={motion:'system',view:'active'};host.isConnected=true;
 let photoReads=0;const photo={getBoundingClientRect(){photoReads++;return {top:24,height:650};}};
 host.querySelector=selector=>selector==='.header-activity'?slot:selector==='#open-history'?history:selector==='#photo-view'?photo:null;
 const surface=new VoiceSurface(host),node=surface.node,copy=surface.node.querySelector('.voice-copy'),mark=surface.mark;
 for(const phase of ['LISTENING','THINKING','AI_SPEAKING','LOUNGE_WINDOW','CLOSING','UNKNOWN']){
  const presentation=voicePresentation({active:true,sessionId:'s',turnId:'t',phase});surface.update(presentation);const activity=surface.markAnimation,entrance=surface.animation,copyAnimation=surface.copyAnimation;
  for(const [screen,level] of [['rest','home'],['active','home'],['active','detail'],['rest','home'],['active','detail']]){host.dataset.view=screen;host.dataset.level=level;surface.update({...presentation});
   assert.equal(surface.node,node);assert.equal(surface.node.parentNode,host);assert.equal(surface.node.querySelector('.voice-copy'),copy);assert.equal(surface.mark,mark);assert.equal(surface.markAnimation,activity);assert.equal(surface.animation,entrance);assert.equal(surface.copyAnimation,copyAnimation);assert.equal(node.hidden,false);assert.deepEqual(host.children,[node]);assert.deepEqual(slot.children,[history]);assert.equal(node.style.getPropertyValue('--pv-voice-top'),screen==='rest'?'48px':'16px');
  }
 }
 assert.ok(photoReads>0);surface.cleanup();assert.equal(surface.node.hidden,true);assert.equal(surface.markAnimation,null);assert.equal(surface.positionAnimation,null);
}));


test('each actual voice phase owns its semantic icon and one static ellipsis only for ongoing activity',()=>withBrowser(()=>{
 const {surface}=fixture();
 const expected=[['LISTENING','Lytter…','mic'],['THINKING','Tænker…','chat-circle'],['AI_SPEAKING','Svarer…','soundwave'],['LOUNGE_WINDOW','Spørg videre','chat-circle'],['CLOSING','Afslutter…','chat-circle'],['UNKNOWN','Venter…','chat-circle']];
 for(const [phase,label,icon] of expected){surface.update(voicePresentation({active:true,sessionId:'s',turnId:'t',phase}));
  assert.equal(surface.label.textContent,label);assert.equal(surface.icon.src,`assets/icons/${icon}.svg`);assert.equal(surface.mark.children.length,1);assert.equal(surface.node.querySelector('.voice-copy').children.length,2,'status uses its actual label and existing hidden detail, with no separate dots element');assert.equal((label.match(/…/g)||[]).length,phase==='LOUNGE_WINDOW'?0:1);
  const activity=surface.markAnimation;surface.update(voicePresentation({active:true,sessionId:'s',turnId:'t',phase}));assert.equal(surface.markAnimation,activity);
 }
 surface.update(null);assert.equal(surface.markAnimation,null);surface.cleanup();
}));

test('Ro position moves240ms from the topbar into the measured photo without replaying the ongoing phase',async()=>withBrowser(async()=>{
 const {host,surface}=fixture(),photo={getBoundingClientRect:()=>({top:24,height:650})};host.dataset.view='active';host.querySelector=selector=>selector==='#photo-view'?photo:null;
 const value=view('s','t','thinking');surface.update(value);const mark=surface.markAnimation,entrance=surface.animation,icon=surface.icon,label=surface.label.textContent;assert.equal(surface.positionAnimation,null);assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'16px');
 host.dataset.view='rest';surface.update({...value});const move=surface.positionAnimation;assert.equal(move.options.duration,240);assert.equal(move.options.iterations,1);assert.equal(move.options.easing,'cubic-bezier(.2,0,0,1)');assert.deepEqual(move.frames,[{transform:'translateY(-32px)'},{transform:'none'}]);assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'48px');
 surface.update({...value});assert.equal(surface.positionAnimation,move);assert.equal(surface.markAnimation,mark);assert.equal(surface.animation,entrance);assert.equal(mark.cancelled,0);assert.equal(surface.icon,icon);assert.equal(surface.label.textContent,label);
 surface.update(view('s','t','responding'));assert.equal(surface.positionAnimation,move);assert.equal(move.cancelled,0);assert.equal(mark.cancelled,1);move.finish();await flush();await flush();assert.equal(surface.positionAnimation,null);surface.cleanup();
}));

test('a rapid reverse starts at the visible moving pill and superseded completion cannot release the current move',async()=>withBrowser(async()=>{
 const {host,surface}=fixture();host.dataset.view='active';host.querySelector=selector=>selector==='#photo-view'?{getBoundingClientRect:()=>({top:24,height:650})}:null;const value=view('s','t','listening');surface.update(value);const mark=surface.markAnimation;
 host.dataset.view='rest';surface.update(value);const old=surface.positionAnimation;surface.node.visualTop=30;host.dataset.view='active';surface.update(value);const current=surface.positionAnimation;assert.equal(old.cancelled,1);assert.deepEqual(current.frames,[{transform:'translateY(14px)'},{transform:'none'}]);old.finish();await flush();await flush();assert.equal(surface.positionAnimation,current);assert.equal(surface.markAnimation,mark);assert.equal(mark.cancelled,0);surface.cleanup();assert.equal(current.cancelled,1);assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'');
}));

test('viewport resize uses the current photo boundary, preserves activity, and detaches its position listeners on cleanup',()=>withBrowser(()=>{
 const doc=new EventTarget(),window=new EventTarget();window.visualViewport=new EventTarget();doc.defaultView=window;doc.createElement=tag=>new FakeElement(tag);globalThis.document=doc;
 let top=24;const {host,surface}=fixture();host.dataset.view='rest';host.querySelector=selector=>selector==='#photo-view'?{getBoundingClientRect:()=>({top,height:650})}:null;const value=view('s','t','responding');surface.update(value);const mark=surface.markAnimation;assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'48px');
 top=60;window.dispatchEvent(new Event('resize'));const move=surface.positionAnimation;assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'84px');assert.equal(move.options.duration,240);window.visualViewport.dispatchEvent(new Event('resize'));assert.equal(surface.positionAnimation,move);assert.equal(surface.markAnimation,mark);assert.equal(mark.cancelled,0);
 surface.cleanup();assert.equal(move.cancelled,1);top=100;window.dispatchEvent(new Event('resize'));window.visualViewport.dispatchEvent(new Event('resize'));assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'');assert.equal(surface.positionAnimation,null);
}));

test('reduced motion settles the pill inside Ro immediately and disconnect releases the finite position owner',()=>withBrowser(()=>{
 const media=new EventTarget();media.matches=false;globalThis.matchMedia=()=>media;const {host,surface}=fixture();host.dataset.view='active';host.querySelector=selector=>selector==='#photo-view'?{getBoundingClientRect:()=>({top:40,height:650})}:null;const value=view('s','t','thinking');surface.update(value);host.dataset.view='rest';surface.update(value);const move=surface.positionAnimation;
 media.matches=true;media.dispatchEvent(new Event('change'));assert.equal(move.cancelled,1);assert.equal(surface.positionAnimation,null);assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'64px');host.dataset.view='active';surface.update(value);assert.equal(surface.positionAnimation,null);assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'16px');
 media.matches=false;host.dataset.view='rest';surface.update(value);const current=surface.positionAnimation;assert.ok(current);host.isConnected=false;surface.update(value);assert.equal(current.cancelled,1);assert.equal(surface.positionAnimation,null);assert.equal(surface.node.hidden,true);assert.equal(surface.node.style.getPropertyValue('--pv-voice-top'),'');
}));


test('continuation window is distinct from actual listening and has no success tick or microphone claim',()=>withBrowser(()=>{
 const {surface}=fixture(),ready=voicePresentation({active:true,phase:'LOUNGE_WINDOW',sessionId:'s',turnId:'t'}),listening=voicePresentation({active:true,phase:'LISTENING',sessionId:'s',turnId:'t'});
 assert.equal(ready.label,'Spørg videre');assert.equal(ready.detail,'');assert.equal(voiceStatus('LOUNGE_WINDOW'),ready.label);surface.update(ready);assert.equal(surface.icon.src,'assets/icons/chat-circle.svg');assert.equal(surface.markAnimation.options.iterations,1);
 surface.update(listening);assert.equal(listening.label,'Lytter…');assert.equal(voiceStatus('LISTENING'),listening.label);assert.equal(surface.icon.src,'assets/icons/mic.svg');surface.cleanup();assert.equal(surface.node.hidden,true);
}));
