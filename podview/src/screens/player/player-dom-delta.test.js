// Ported from tests/podview/root-player-dom-delta.test.mjs (node:test + fake DOM) to Vitest with a real DOM
// (happy-dom), when the player moved to React. Same assertions; each was first run against the pre-React
// player-view.js in the same real DOM. Adaptations: the fake view's nodes are the real shell's (player-fixture.js);
// `writes` observes real DOM mutations (and input value writes) under the fake DOM's names (recordWrites below), so
// the created seek input is named by its id, not its tag; the fake document had no window, so each fixture's window
// has no Image class (and a fresh artwork cache) until decoding() installs its probe; t.diagnostic lines are dropped;
// `doc.activeElement = node` is node.focus(); isConnected is defined with assign(); an img's relative src is read with
// getAttribute('src'); the extra <p> the fake appended to #rooms is the real dialog's own; the radio and scene models
// are imported statically; dom-assert.js keeps a failed comparison of DOM nodes from exhausting memory.
import {afterEach, test} from 'vitest';
import {livePlayerModel} from '../../../player-model.js';
import {localRadioPlayerModel, localRadioControlModel} from '../../../radio-model.js';
import {initialScene} from '../../../scene-model.js';
import assert from './dom-assert.js';
import {assign, mountPlayer, mountSpeakers} from './player-fixture.js';
import {SpeakerOutputView} from './SpeakerOutputView';


// The fake DOM's names: an element is its id, else its tag (the fake named created nodes by tag).
const name = node => node.id || node.localName;
// Attributes the fake wrote as properties (`<name>.src`); every other attribute is `<name>.attr.<attribute>`.
const PROPERTIES = {src: 'src', alt: 'alt', referrerpolicy: 'referrerPolicy', decoding: 'decoding', min: 'min',
  max: 'max', hidden: 'hidden', disabled: 'disabled'};
const styles = text => new Map(String(text || '').split(';').map(rule => rule.split(':'))
  .filter(pair => pair.length > 1).map(([key, ...value]) => [key.trim(), value.join(':').trim()]));
const tokens = text => new Set(String(text || '').split(/\s+/).filter(Boolean));
const dataKey = attribute => attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

// An input's value is a property, not an attribute: its writes are counted where the property is set.
const recorders = new Set();
const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
Object.defineProperty(HTMLInputElement.prototype, 'value', {
  ...value,
  set(next) {
    for (const rows of recorders) rows.push(`${name(this)}.value`);
    value.set.call(this, next);
  },
});

// Every DOM write under the document after this call, under the fake DOM's names: `<name>.textContent`,
// `<name>.data.<key>` / `<name>.delete.<key>`, `<name>.style.<property>`, `<name>.class.add|remove.<token>`,
// `<name>.<property>` for the PROPERTIES above and an input's value, `<name>.attr.<attribute>` /
// `<name>.removeAttribute.<attribute>`, and `<name>.insert` for added or removed elements. Real mutations are
// observed, so a write of an unchanged attribute still counts; a text write counts once per node per batch.
function recordWrites(root = document) {
  const rows = [];
  recorders.add(rows);
  const observer = new MutationObserver(() => {});
  observer.observe(root, {subtree: true, childList: true, attributes: true, characterData: true,
    attributeOldValue: true});
  const collect = () => {
    const records = observer.takeRecords(), texts = new Set();
    const text = node => {
      if (texts.has(node)) return;
      texts.add(node);
      rows.push(`${name(node)}.textContent`);
    };
    records.forEach((record, index) => {
      const target = record.target, attribute = record.attributeName;
      if (record.type === 'characterData') return text(target.parentNode);
      if (record.type === 'childList') {
        if ([...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === 3)) text(target);
        else rows.push(`${name(target)}.insert`);
        return;
      }
      const later = records.slice(index + 1).find(next => next.target === target && next.attributeName === attribute);
      const after = later ? later.oldValue : target.getAttribute(attribute);
      if (attribute === 'style') {
        const before = styles(record.oldValue), now = styles(after);
        const changed = [...new Set([...before.keys(), ...now.keys()])].filter(key => before.get(key) !== now.get(key));
        if (!changed.length) rows.push(`${name(target)}.style`);
        for (const key of changed) rows.push(`${name(target)}.style.${key}`);
      } else if (attribute === 'class') {
        const before = tokens(record.oldValue), now = tokens(after);
        const added = [...now].filter(token => !before.has(token));
        const removed = [...before].filter(token => !now.has(token));
        if (!added.length && !removed.length) rows.push(`${name(target)}.className`);
        for (const token of added) rows.push(`${name(target)}.class.add.${token}`);
        for (const token of removed) rows.push(`${name(target)}.class.remove.${token}`);
      } else if (attribute.startsWith('data-')) {
        rows.push(`${name(target)}.${after === null ? 'delete' : 'data'}.${dataKey(attribute)}`);
      } else if (PROPERTIES[attribute]) rows.push(`${name(target)}.${PROPERTIES[attribute]}`);
      else rows.push(`${name(target)}.${after === null ? 'removeAttribute' : 'attr'}.${attribute}`);
    });
  };
  return new Proxy(rows, {
    get(target, key, receiver) {
      collect();
      return Reflect.get(target, key, receiver);
    },
    set(target, key, next, receiver) {
      collect();
      return Reflect.set(target, key, next, receiver);
    },
  });
}

afterEach(() => {
  recorders.clear();
  delete document.defaultView;
});

// The document's window with another Image class (React reads the rest of it). The fake document had no window, so
// artwork was shown without an Image probe: each fixture's window has none (and so a fresh artwork cache), until
// decoding() installs the probe class.
const windowWith = Image => {
  const view = new Proxy(window, {
    get(target, key) {
      if (key === 'Image') return Image;
      const value = Reflect.get(target, key);
      return typeof value === 'function' && !/^[A-Z]/.test(String(key)) ? value.bind(target) : value;
    },
  });
  Object.defineProperty(document, 'defaultView', {value: view, configurable: true});
};
function fixture() {
  windowWith(undefined);
  const {host, view, $} = mountPlayer({host: {state: {focus: 'now'}}});
  return {writes: recordWrites(), nodes: {get: $}, host, view};
}
const srcOf = node => node.getAttribute('src');
const active={active:true,fresh:true,playing:true,title:'Observed song',artist:'Observed artist',target:'Køkkenalrum HomePod',uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/abc'},canOutput:true,canDiscover:true};
const controls={playing:true,previous:true,next:true,toggle:true,blocked:false,volume:35,canVolume:true};

test('identical configured empty player and controls produce zero DOM writes without clearing and refilling its room',()=>{
 const f=fixture(),empty={active:false,configuredTarget:'Køkkenalrum HomePod',canOutput:true,canDiscover:true,emptyState:'unconfirmed',empty:'Vælg musik til rummet.'};f.view.renderPlayer(empty);const output=f.nodes.get('output');f.writes.length=0;f.view.renderPlayer({...empty});assert.deepEqual([...f.writes],[]);assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');assert.equal(f.nodes.get('output'),output);
});
test('identical populated player and controls do not write; title-only changes touch title leaves only',()=>{
 const f=fixture();f.view.renderPlayer(active);f.view.renderControls(controls);f.writes.length=0;f.view.renderPlayer({...active,artwork:{...active.artwork}});f.view.renderControls({...controls});assert.deepEqual([...f.writes],[]);
 f.view.renderPlayer({...active,title:'New title'});assert.deepEqual([...f.writes].sort(),['cover.alt','detail-cover.alt','detail-track.textContent','track-name.textContent'].sort());assert.equal(srcOf(f.nodes.get('cover')),active.artwork.url);
});
test('changed permissions revoke retained controls immediately without resetting a volume gesture',()=>{
 const f=fixture();f.view.renderPlayer(active);f.view.renderControls(controls);const input=f.nodes.get('volume');input.value='42';f.writes.length=0;f.view.renderControls({...controls,blocked:true,gesture:input});for(const id of ['previous','next','play-pause','volume'])assert.equal(f.nodes.get(id).disabled,true);assert.equal(input.value,'42');assert.equal(f.writes.includes('volume.value'),false);assert.equal(srcOf(f.nodes.get('cover')),active.artwork.url);
});

test('repeated first-read and feedback states are no-ops and never clear the configured room',()=>{
 const f=fixture(),loading={active:false,loading:true,configuredTarget:'Køkkenalrum HomePod',canOutput:false,canDiscover:true};f.view.renderPlayer(loading);f.writes.length=0;f.view.renderPlayer({...loading});assert.deepEqual([...f.writes],[]);const feedback={...loading,feedback:{pending:true,message:'Afventer afspilning i rummet.'}};f.view.renderPlayer(feedback);assert.equal(f.nodes.get('player-empty').querySelector('p').hidden,false);f.writes.length=0;f.view.renderPlayer({...feedback,feedback:{...feedback.feedback}});assert.deepEqual([...f.writes],[]);assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');assert.equal(f.nodes.get('play-pause').disabled,true);
});
test('a volume-only update changes only actual slider/output leaves',()=>{
 const f=fixture();f.view.renderPlayer(active);f.view.renderControls(controls);f.writes.length=0;f.view.renderControls({...controls,volume:36});assert.deepEqual([...f.writes].sort(),['volume.value','detail-volume.value','volume-value.textContent','detail-volume-value.textContent','volume.attr.aria-valuetext','detail-volume.attr.aria-valuetext','volume.style.--pv-slider-progress','detail-volume.style.--pv-slider-progress'].sort());
});

const queueItem={id:'real-occurrence:1',title:'Actual song',artist:'Actual artist',uri:active.uri,artwork:active.artwork,order:1,revision:1,selectable:true};
test('identical queue projections keep focus, scroll, row identity and every DOM leaf unchanged',()=>{
 const f=fixture();f.view.renderQueue([queueItem]);const queue=f.nodes.get('queue'),row=queue.children[0];row.focus();queue.scrollTop=91;f.writes.length=0;
 f.view.renderQueue([{...queueItem,artwork:{...queueItem.artwork}}]);assert.deepEqual([...f.writes],[]);assert.equal(queue.children[0],row);assert.equal(document.activeElement,row);assert.equal(queue.scrollTop,91);
});
test('queue title-only and immediate permission changes update only their actual leaves',()=>{
 const f=fixture(),selected=[];f.view.chooseQueue=item=>selected.push(item);f.view.renderQueue([queueItem]);const row=f.nodes.get('queue').children[0];f.writes.length=0;
 f.view.renderQueue([{...queueItem,title:'New actual title'}]);assert.deepEqual([...f.writes].sort(),['button.attr.aria-label','strong.textContent','img.alt'].sort());assert.equal(row.children[2].children[0].textContent,'New actual title');
 f.writes.length=0;f.view.renderQueue([{...queueItem,title:'New actual title',selectable:false}]);assert.deepEqual([...f.writes].sort(),['button.disabled','button.attr.aria-label'].sort());assert.equal(row.disabled,true);row.dispatchEvent(new Event('click'));assert.deepEqual(selected,[]);assert.equal(f.nodes.get('queue').children[0],row);
});
test('unchanged empty and first-read queue states retain existing nodes and do not remove and append placeholders',()=>{
 for(const status of ['ready','loading','stale','error','unknown']){const f=fixture();f.view.renderQueue([],{status});const queue=f.nodes.get('queue'),children=[...queue.children];queue.scrollTop=37;f.writes.length=0;f.view.renderQueue([],{status});assert.deepEqual([...f.writes],[],status);assert.deepEqual([...queue.children],children,status);assert.equal(queue.scrollTop,37,status);}
});

function decoding(){const probes=[];class Probe{constructor(){probes.push(this);this.ready=new Promise(resolve=>this.resolve=resolve);}decode(){return this.ready;}removeAttribute(name){if(name==='src')this.src=null;}}windowWith(Probe);return probes;}
const flushDecode=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('removing an existing queue occurrence cancels its exact image probe before any late decode can commit',async()=>{
 const f=fixture(),probes=decoding();f.view.renderQueue([queueItem]);const image=f.nodes.get('queue').children[0].children[1],probe=probes[0],late=probe.onload;late();await flushDecode();const src=image.src;f.view.renderQueue([]);assert.equal(probe.onload,null);assert.equal(probe.onerror,null);assert.equal(probe.src,null);assert.equal(image.artworkRequest,null);assert.equal(image.dataset.artworkPending,undefined);probe.resolve();late();await flushDecode();assert.equal(image.src,src);assert.equal(f.view.rows.size,0);
});
test('player owner cleanup cancels cover, detail and queue probes; late decode does not change retained nodes or sources',async()=>{
 const f=fixture(),probes=decoding();f.view.renderPlayer(active);f.view.renderQueue([queueItem]);assert.equal(probes.length,3);const images=[f.nodes.get('cover'),f.nodes.get('detail-cover'),f.nodes.get('queue').children[0].children[1]],late=probes.map(probe=>probe.onload);for(const callback of late)callback();await flushDecode();const sources=images.map(image=>image.src),row=f.nodes.get('queue').children[0];row.focus();f.nodes.get('queue').scrollTop=79;f.view.cleanup();
 for(const probe of probes){assert.equal(probe.onload,null);assert.equal(probe.onerror,null);assert.equal(probe.src,null);probe.resolve();}for(const callback of late)callback();await flushDecode();assert.deepEqual(images.map(image=>image.src),sources);for(const image of images){assert.equal(image.artworkRequest,null);assert.equal(image.dataset.artworkPending,undefined);}assert.equal(f.nodes.get('queue').children[0],row);assert.equal(document.activeElement,row);assert.equal(f.nodes.get('queue').scrollTop,79);f.writes.length=0;f.view.cleanup();assert.deepEqual([...f.writes],[]);
});

test('unchanged source position writes nothing and a source advance changes only timeline leaves',()=>{
 const f=fixture(),vm={...active,progressMs:84000,durationMs:187000,positionFresh:true};f.view.renderPlayer(vm);f.writes.length=0;f.view.renderPlayer({...vm});assert.deepEqual([...f.writes],[]);f.view.renderPlayer({...vm,progressMs:85000});assert.deepEqual([...f.writes].sort(),['player-progress-meter.attr.value','player-progress-meter.attr.aria-label','player-elapsed.textContent','detail-progress-meter.attr.value','detail-progress-meter.attr.aria-label','detail-elapsed.textContent'].sort());
});


test('identical local seek position does not repaint fill or reset slider',()=>{
 const f=fixture(),vm={...active,examplePosition:true,trackId:'example',seekOperation:1,canSeek:true,progressMs:90000,durationMs:180000,positionFresh:true};f.view.renderPlayer(vm);assert.equal(f.view.seekControl.style.getPropertyValue('--seek-progress'),'50%');f.writes.length=0;f.view.renderPlayer({...vm});assert.deepEqual([...f.writes],[]);
 f.view.renderPlayer({...vm,progressMs:180000});assert.equal(f.view.seekControl.style.getPropertyValue('--seek-progress'),'100%');assert.equal(f.writes.filter(write=>write===`${name(f.view.seekControl)}.style.--seek-progress`).length,1);
});

test('paused player has no redundant visual caption and retains its position, resume control and spoken state',()=>{
 const f=fixture(),vm={...active,playing:false,progressMs:84000,durationMs:187000,positionFresh:true};f.view.renderPlayer(vm);f.view.renderControls({...controls,playing:false});
 assert.equal(f.nodes.get('player-state').textContent,'');assert.equal(f.nodes.get('detail-status').textContent,'');assert.equal(srcOf(f.nodes.get('play-icon')),'assets/icons/play-fill.svg');assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'),'Fortsæt musikken');assert.match(f.nodes.get('output').getAttribute('aria-label'),/På pause/);assert.equal(f.nodes.get('player-progress').hidden,false);assert.equal(f.nodes.get('player-elapsed').textContent,'1:24');assert.equal(f.nodes.get('player-duration').textContent,'3:07');assert.equal(f.nodes.get('player-progress-meter').getAttribute('value'),'84000');
 const position=f.nodes.get('player-progress-meter');f.writes.length=0;f.view.renderPlayer({...vm});f.view.renderControls({...controls,playing:false});assert.deepEqual([...f.writes],[]);assert.equal(f.nodes.get('player-progress-meter'),position);
 f.view.renderPlayer({...vm,feedback:{message:'Afventer svar',pending:true}});assert.equal(f.nodes.get('player-state').textContent,'Afventer svar');assert.equal(f.nodes.get('detail-status').textContent,'Afventer svar');
 f.view.renderPlayer({...vm,fresh:false,feedback:{message:'Udfald ukendt',pending:false}});assert.equal(f.nodes.get('player-state').textContent,'Udfald ukendt');
});

test('stopped radio keeps a truthful subtitle and accessible state without duplicate visual status copy',()=>{
 const f=fixture(),scene={...initialScene(),radioStationId:'p3',radioPlaying:false},vm=localRadioPlayerModel('p3',active,{playing:false,connected:true});f.view.renderPlayer(vm);f.view.renderControls(localRadioControlModel(scene));
 assert.equal(f.nodes.get('track-name').textContent,'P3');assert.equal(f.nodes.get('track-artist').textContent,'Direkte radio · ingen lyd');assert.equal(f.nodes.get('player-state').textContent,'');assert.equal(f.nodes.get('detail-status').textContent,'');assert.equal(srcOf(f.nodes.get('play-icon')),'assets/icons/play-fill.svg');assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'),'Start radio ved livepunkt');assert.match(f.nodes.get('output').getAttribute('aria-label'),/Radio stoppet · ingen lyd/);assert.equal(f.nodes.get('previous').hidden,true);assert.equal(f.nodes.get('next').hidden,true);assert.equal(vm.exampleOnly,true);assert.equal(vm.fresh,false);assert.equal('stream' in vm,false);
 for(const feedback of [{message:'Afventer radio',pending:true},{message:'Radio kunne ikke startes',pending:false}]){f.view.renderPlayer({...vm,feedback});assert.equal(f.nodes.get('player-state').textContent,'');assert.equal(f.nodes.get('detail-status').textContent,'');assert.equal(f.nodes.get('player-state').hidden,true);assert.equal(f.nodes.get('detail-status').hidden,true);}
 f.view.renderPlayer({...active,sourceKind:'radio',playing:false,fresh:false,artist:'Direkte radio'});assert.equal(f.nodes.get('player-state').textContent,'Ikke opdateret');f.view.renderPlayer({...active,sourceKind:'radio',artist:''});assert.equal(f.nodes.get('track-artist').textContent,'Direkte radio');f.view.renderPlayer({...active,sourceKind:'radio',artist:'Faktisk kildebeskrivelse'});assert.equal(f.nodes.get('track-artist').textContent,'Faktisk kildebeskrivelse');
});

test('queue-only detail omits routine playback caption and retains long-title rows, actions and source errors',()=>{
 const f=fixture(),selected=[];f.view.chooseQueue=item=>selected.push(item);f.view.renderPlayer(active);assert.equal(f.nodes.get('detail-status').textContent,'');
 const long={...queueItem,title:'En meget lang faktisk titel '.repeat(12),artist:'Kildekunstner '.repeat(8),reorderable:true};f.view.renderQueue([long,{...queueItem,id:'other',order:2}]);const queue=f.nodes.get('queue'),first=queue.children[0],second=queue.children[1];assert.equal(first.children[2].children[0].textContent,long.title);assert.equal(first.children[2].children[1].textContent,long.artist);first.dispatchEvent(new Event('click'));assert.equal(selected[0].id,long.id);f.view.renderQueue([{...long},{...queueItem,id:'other',order:2}]);assert.equal(queue.children[0],first);assert.equal(queue.children[1],second);assert.equal(first.dataset.reorderable,undefined);assert.doesNotMatch(first.getAttribute('aria-label'),/Flyt|Alt/);
 f.view.renderPlayer({...active,feedback:{message:'Afspilning kunne ikke bekræftes',pending:false}});assert.equal(f.nodes.get('detail-status').textContent,'Afspilning kunne ikke bekræftes');
});


test('actual configured label owner keeps rendered idle player heading through TTL and passive refresh failure without observed output authority',async()=>{
 const f=fixture(),originalNow=Date.now,originalTimeout=globalThis.setTimeout,callbacks=[],reads=[];let now=originalNow();Date.now=()=>now;globalThis.setTimeout=fn=>{callbacks.push(fn);return callbacks.length;};
 assign(f.host,{isConnected:true});f.host.liveMedia={account:'account'};f.host.liveSnapshot={bootId:'boot',roomId:'r0',capabilities:{musicRead:['targets']},mediaRoomBindings:[{accountId:'account',bindingId:'a'.repeat(64),roomId:'r0',targetId:'engine',nativeRoomId:'r0',nativeHomepodId:'42'}]};
 f.host.liveTransport={connected:true,music:async(...args)=>{reads.push(args);return {ok:true,schema:'podview.speaker-catalogue.v1',bootId:'boot',roomId:'r0',accountId:'account',status:'observed',catalogueId:'c'.repeat(64),retrievedAt:now/1000,source:'podconnect.get_targets',speakers:[{speakerId:'a'.repeat(64),accountId:'account',kind:'configured_alias',nativeRoomId:'r0',homepodId:'42',name:'Køkkenalrum HomePod',availability:'available',default:true,nativeSelected:true,outputSelected:true,selectable:false}],moveAvailable:false,physicalResultVerified:false};}};
 const outputs=new SpeakerOutputView(f.host),render=()=>f.view.renderPlayer(livePlayerModel(null,true,'ready',f.host.liveSnapshot,outputs.configuredLabel()));f.host.liveMedia.render=render;
 try{
  await outputs.refreshConfiguredLabel();render();const output=f.nodes.get('output');assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');
  now+=30001;callbacks[0]();render();assert.equal(outputs.observedDestination('a'.repeat(64)),false);assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');
  let reject;f.host.liveTransport.music=(...args)=>{reads.push(args);return new Promise((_,r)=>reject=r);};const pending=outputs.refreshConfiguredLabel();render();assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');reject(Error('network'));await pending;render();
  assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum HomePod');assert.equal(f.nodes.get('player-state').textContent,'');assert.equal(f.nodes.get('output'),output);assert.equal(output.getAttribute('aria-label'),'Konfigureret højttaler: Køkkenalrum HomePod');assert.equal(outputs.selectionDestination(),null);assert.deepEqual(reads,[['speakers','account'],['speakers','account']]);
 }finally{outputs.cleanup();Date.now=originalNow;globalThis.setTimeout=originalTimeout;}
});

test('queue failure remains visible with known current song and repeated renders preserve row and player content without toast emission',()=>{const f=fixture(),events=[];f.host.showFeedback=(...args)=>events.push(args);f.view.renderPlayer(active);const current={...queueItem,current:true,playing:true},items=[current];f.view.renderQueue(items,{status:'error'});const row=f.nodes.get('queue').children[0];assert.equal(f.nodes.get('queue-meta').textContent,'Køen kunne ikke hentes');assert.equal(f.nodes.get('track-name').textContent,active.title);assert.equal(row.children[2].children[0].textContent,queueItem.title);f.writes.length=0;f.view.renderQueue(items,{status:'error'});assert.deepEqual([...f.writes],[]);assert.equal(f.nodes.get('queue').children[0],row);assert.deepEqual(events,[]);});

test('autoplay promotion keeps the displayed node and focus without retargeting an earlier press',()=>{
 const f=fixture(),sent=[];
 f.view.chooseQueue=item=>sent.push(item.id);
 const preview={
  ...queueItem,id:'a'.repeat(24),displayId:'display-'+'c'.repeat(24),queueTaskId:'queue:'+'a'.repeat(32),
 };
 const promotion={...preview,id:'b'.repeat(24),queueTaskId:'queue:'+'b'.repeat(32)};
 f.view.renderQueue([preview]);
 const queue=f.nodes.get('queue'),row=queue.children[0];
 row.focus();
 queue.scrollTop=87;
 row.dispatchEvent(new Event('pointerdown'));
 f.view.renderQueue([promotion]);
 assert.equal(queue.children[0],row);
 assert.equal(queue.scrollTop,87);
 assert.equal(document.activeElement,row);
 row.dispatchEvent(new Event('click'));
 assert.deepEqual(sent,[]);
 row.dispatchEvent(new Event('pointerdown'));
 row.dispatchEvent(new Event('click'));
 assert.deepEqual(sent,[promotion.id]);
});
