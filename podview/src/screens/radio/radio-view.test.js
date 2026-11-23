// The radio page (RadioScreen.tsx), ported from the RadioView suite (itself from
// tests/podview/root-radio-view.test.mjs) when the page moved from a shell-driven controller to a React component the
// shell mounts once. Same behaviours. Adaptations: `view.render(input)` renders <RadioDetail input> (Testing Library,
// real DOM); the old choice list's `data` projection is read from the tiles themselves (aria-pressed, aria-busy,
// disabled, their copy); a station pv-action became a real click on its tile; the hidden »Se afspiller« row is gone
// (it was never shown and could not navigate), so its tests became the assertion that no such row exists. The live
// start runs on a real radio source (source-fixture.js) and, over the wire, on fetchApi against MSW.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {act, render} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {createElement as h} from 'react';
import {test} from 'vitest';
import {useStore} from 'zustand';
import {useShallow} from 'zustand/shallow';
import {Providers} from '../../app/Providers';
import {connectApi, fetchApi} from '../../lib/api/client';
import {ownerStationIds, radioStation, stations} from '../../lib/api/radio';
import {ingestConnection, ingestSnapshot, readSnapshot} from '../../lib/query/live';
import {connectShell} from '../../lib/store/shell';
import {API, PAGE_URL, listenToApi, server} from '../../test/msw';
import {previewScene} from '../../../preview-scenes.js';
import {RadioDetail, RadioScreen} from './RadioScreen';
import {connectionOf, radioOf, radioFrame} from './source-fixture.js';
import {publishRadioScene, radioInput, radioSource, resetRadioState} from './state';

listenToApi();

const podview = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = resolve(podview, '..');
const read = name => readFileSync(resolve(podview, name), 'utf8');

function shell() {
  document.body.innerHTML = '<section id="radio-view" class="response-widget" aria-label="Radio"></section>';
  return document.getElementById('radio-view');
}

// The page for one projection at a time, as the shell's page container holds it.
function fixture() {
  const root = shell(), calls = [];
  let mounted = null;
  const page = input => h(RadioDetail, {input, onChoose: station => calls.push([station.id, station])});
  const part = selector => root.querySelector(selector);
  const view = {
    render(input) {
      if (mounted) mounted.rerender(page(input));
      else mounted = render(page(input), {container: root, wrapper: Providers});
      return view;
    },
    destroy() {
      mounted?.unmount();
    },
    get header() { return part(':scope>header'); },
    get subtitle() { return part(':scope>header p'); },
    get hero() { return part(':scope>.radio-hero'); },
    get stationArt() { return part('.radio-hero-art'); },
    get stationStatusLine() { return part('.radio-hero-status'); },
    get stationTitle() { return part('.radio-hero [data-kit-slot="title"]'); },
    get stationStatus() { return part('.radio-hero [data-kit-slot="body"]'); },
    get feedback() { return part('.radio-hero [data-kit-slot="feedback"]'); },
    get needle() { return part('.radio-scale-needle'); },
    get list() { return part(':scope>pv-station-list'); },
    get buttons() { return [...root.querySelectorAll('pv-station-list button')]; },
  };
  return {root, view, calls};
}
const selected = view => view.buttons.find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.optionId
  ?? null;
const detail = (view, index) => view.buttons[index].querySelector('.pv-meta').textContent;
const choosable = view => view.buttons.every(button => !button.disabled);
const tap = button => {
  act(() => {
    button.click();
  });
};

test('five actual radio choices occupy complete two plus three rows without a filler action', () => {
  const css = read('ui-kit.css'),
    selector = 'pv-widget-host #radio-view .radio-station-tiles .pv-list:has(>button:nth-child(5):last-child)';
  assert.ok(css.includes(selector + '{grid-template-columns:repeat(6,minmax(0,1fr))}'));
  assert.ok(css.includes(selector + '>button{grid-column:span 2}'));
  assert.ok(css.includes(selector + '>button:nth-child(-n+2){grid-column:span 3}'));
  const {view} = fixture();
  view.render({live: false, connected: true});
  assert.equal(view.buttons.length, 5);
  assert.deepEqual(view.buttons.map(button => button.dataset.optionId), stations.map(item => item.id));
  assert.ok(view.buttons.every(button => !/[Ff]lere stationer/.test(button.textContent)));
});

test('radio detail reuses response heading and the kit choice-list anatomy with authored station marks, '
  + 'without an extra player', () => {
  const {root, view} = fixture();
  view.render({live: false, connected: true, stationId: 'p3'});
  assert.deepEqual([...root.children].map(node => node.tagName), ['HEADER', 'SECTION', 'DIV', 'PV-STATION-LIST']);
  assert.equal(view.hero.dataset.kit, 'hero');
  assert.equal(view.stationTitle.textContent, 'P3');
  assert.equal(view.stationStatusLine.textContent, 'Valgt');
  assert.equal(root.children[0].children[0].children[0].textContent, 'Radio');
  const list = view.list;
  assert.equal(list.dataset.component, 'choice-list');
  assert.ok(list.classList.contains('pv-component'));
  assert.equal(list.firstElementChild.className, 'pv-content');
  assert.equal(list.firstElementChild.firstElementChild.className, 'pv-list');
  assert.ok(choosable(view));
  assert.equal(selected(view), 'p3');
  assert.deepEqual(view.buttons.map(button => [button.dataset.optionId, button.querySelector('strong').textContent]),
    stations.map(({id, label}) => [id, label]));
  assert.match(detail(view, 1), /^Valgt/);
  assert.equal(detail(view, 4), 'Jazz');
  const heading = view.header;
  view.render({live: false, connected: true, stationId: 'p8-jazz'});
  assert.equal(root.children[0], heading);
  assert.equal(view.list, list);
  assert.equal(selected(view), 'p8-jazz');
});

test('local explicit selection delegates one stable station ID and rejects a repeated choice', () => {
  const {view, calls} = fixture();
  view.render({live: false, connected: true, stationId: 'p3'});
  tap(view.buttons[4]);
  assert.deepEqual(calls, [['p8-jazz', stations[4]]]);
  view.render({live: false, connected: true, stationId: 'p8-jazz'});
  tap(view.buttons[4]);
  assert.equal(calls.length, 1, 'the chosen station is not chosen again');
  const buttons = view.buttons;
  view.destroy();
  for (const button of buttons) button.click();
  assert.equal(calls.length, 1);
});

test('live and disconnected render remain visibly present but cannot select a station', () => {
  const {view, calls} = fixture();
  view.render({live: true, connected: true, stationId: 'p3'});
  assert.equal(view.list.dataset.state, 'unsupported');
  assert.ok(view.buttons.every(button => button.disabled));
  assert.match(view.subtitle.textContent, /ikke klar på højttalerne/i);
  tap(view.buttons[0]);
  assert.equal(calls.length, 0);
  view.render({live: false, connected: false, stationId: 'p3'});
  assert.ok(view.buttons.every(button => button.disabled));
  tap(view.buttons[0]);
  assert.equal(calls.length, 0);
  view.render({live: false, connected: true, stationId: 'p3'});
  tap(view.buttons[0]);
  assert.deepEqual(calls, [['p1', stations[0]]]);
});

test('disconnected state keeps selected context', () => {
  const {view} = fixture();
  view.render({live: false, connected: false, stationId: 'p8-jazz'});
  assert.equal(selected(view), 'p8-jazz');
  assert.equal(view.list.dataset.state, 'offline');
  assert.match(view.subtitle.textContent, /Ikke forbundet/);
  assert.equal(detail(view, 4), 'Valgt · Jazz');
});

test('station identities reuse sourced DR marks and playback indication follows only the local owner model', () => {
  const {view} = fixture();
  view.render({live: false, connected: true, stationId: 'p3', playing: true});
  assert.deepEqual(view.buttons.map(button => button.querySelector('img').getAttribute('src')),
    stations.map(station => `assets/radio-${station.id}.svg`));
  assert.ok(view.buttons.every(button => button.dataset.current === 'false' && !button.hasAttribute('aria-current')));
  assert.match(detail(view, 1), /^Valgt/);
  const list = view.list;
  view.render({live: false, connected: true, stationId: 'p3', playing: false});
  assert.equal(view.list, list);
  assert.match(detail(view, 1), /^Stoppet/);
  view.render({live: true, connected: true, stationId: 'p3', playing: true});
  assert.equal(selected(view), null);
  assert.ok(view.buttons.every((_, index) => !/^Spiller|^Valgt|^Stoppet/.test(detail(view, index))));
});

// Lærred v190 »A-Radio« (issue 393): the hero shows the station shown, its description and whether it plays or
// stopped.
test('radio hero shows the chosen station while selected tiles distinguish playing-model selection and stop', () => {
  const {view} = fixture();
  for (const playing of [true, false]) {
    view.render({live: false, connected: true, stationId: 'p3', playing});
    assert.equal(view.subtitle.textContent, 'Vælg eller skift station nedenfor.');
    assert.equal(view.stationTitle.textContent, 'P3');
    assert.equal(view.stationStatus.textContent, 'Musik og underholdning');
    assert.equal(view.stationStatusLine.textContent, playing ? 'Spiller' : 'Stoppet');
    assert.match(detail(view, 1), playing ? /^Valgt/ : /^Stoppet/);
  }
  view.render({live: false, connected: true, stationId: 'p3', playing: true, speaker: ' Stuen '});
  assert.equal(view.stationStatusLine.textContent, 'Spiller på Stuen');
  view.render({live: true, connected: true, stationId: 'p3', playing: true});
  assert.match(view.stationStatus.textContent, /ikke klar på højttalerne/);
  assert.doesNotMatch(view.subtitle.textContent, /P3|Stoppet|Valgt i afspilleren/);
});

test('station assets retain verified DR Design source bytes instead of recreated lettering', async () => {
  const sources = JSON.parse(await readFile(resolve(repo, 'docs/RADIO-LOGO-SOURCES.json'), 'utf8'));
  for (const station of stations) {
    const record = sources.assets[station.id];
    const svg = await readFile(resolve(podview, 'public/' + record.localAsset.replace(/^dist\//, '')), 'utf8');
    const encoded = svg.match(/href="data:(image\/(?:png|webp));base64,([^"]+)"/);
    assert.ok(encoded, station.id);
    assert.equal(encoded[1], record.sourceContentType);
    const bytes = Buffer.from(encoded[2], 'base64');
    if (encoded[1] === 'image/webp') {
      assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
      assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    } else assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(record.page, /^https:\/\/www\.drdesign\.org\//);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sourceSha256);
    assert.doesNotMatch(svg, /<text|font-family/);
  }
});

test('only real stations occupy tiles; no player row selects or pretends audio', () => {
  const {root, view, calls} = fixture();
  view.render({live: false, connected: true, stationId: 'p3', playing: true});
  assert.equal(view.buttons.length, 5);
  assert.equal(root.querySelectorAll('button').length, 5, 'the page has no other button (no »Se afspiller«)');
  assert.deepEqual(calls, []);
  assert.equal(view.subtitle.textContent, 'Vælg eller skift station nedenfor.');
  assert.doesNotMatch(view.subtitle.textContent, /Spiller/);
});

test('radio Hero follows the selection and displays the actual unavailable cause while tiles retain known '
  + 'identity', () => {
  const {view} = fixture();
  view.render({live: false, connected: true});
  const hero = view.hero, art = view.stationArt;
  assert.equal(view.stationTitle.textContent, 'Vælg station');
  assert.equal(view.stationStatusLine.textContent, 'Ingen station valgt');
  assert.equal(art.hidden, true);
  assert.equal(view.needle.hidden, true);
  view.render({live: false, connected: true, stationId: 'p6-beat', playing: true});
  assert.equal(view.hero, hero);
  assert.equal(view.stationArt, art);
  assert.equal(art.getAttribute('src'), 'assets/radio-p6-beat.svg');
  assert.equal(art.hidden, false);
  assert.equal(view.stationTitle.textContent, 'P6 Beat');
  view.render({live: false, connected: false, stationId: 'p6-beat', playing: false});
  assert.equal(view.stationTitle.textContent, 'Radio');
  assert.match(view.stationStatus.textContent, /Ikke forbundet/);
  assert.equal(selected(view), 'p6-beat');
  assert.match(detail(view, 3), /^Stoppet/);
  assert.ok(view.buttons.every(button => button.disabled));
  assert.equal(art.getAttribute('src'), 'assets/radio-p6-beat.svg', 'the logo stays while no station is shown');
  assert.equal(view.needle.style.left, '70%', 'the needle stays too');
});

test('a station change keeps every Hero node and the artwork', () => {
  const {view} = fixture();
  view.render({live: false, connected: true});
  const hero = view.hero, art = view.stationArt, title = view.stationTitle, status = view.stationStatus;
  const children = [...hero.children];
  for (const input of [{stationId: 'p4-ostjylland', playing: true}, {stationId: 'p4-ostjylland', playing: false},
    {stationId: 'p4-ostjylland', playing: false, connected: false}])
    view.render({live: false, connected: true, ...input});
  assert.strictEqual(view.hero, hero);
  assert.strictEqual(view.stationArt, art);
  assert.strictEqual(view.stationTitle, title);
  assert.strictEqual(view.stationStatus, status);
  assert.deepEqual([...hero.children], children);
  assert.equal(art.width, 144);
  assert.equal(art.height, 144);
  assert.match(status.textContent, /Ikke forbundet/);
});

test('connected denial retains known station context, blocks selection, and only explicit recovery '
  + 'reopens local choice', () => {
  const {view, calls} = fixture();
  view.render({live: false, connected: true, stationId: 'p6-beat', playing: false});
  const list = view.list, hero = view.hero, art = view.stationArt;
  view.render({live: false, connected: true, blocked: true, stationId: 'p6-beat', playing: false});
  assert.ok(view.buttons.every(button => button.disabled));
  assert.equal(list.dataset.state, 'unsupported');
  assert.equal(selected(view), 'p6-beat');
  assert.equal(view.stationTitle.textContent, 'Radio');
  assert.match(view.stationStatus.textContent, /Adgang afvist/);
  assert.match(detail(view, 3), /^Stoppet/);
  assert.match(view.subtitle.textContent, /Adgang afvist/);
  assert.doesNotMatch(view.subtitle.textContent, /Ikke forbundet/);
  tap(view.buttons[0]);
  assert.deepEqual(calls, []);
  assert.equal(view.hero, hero);
  assert.equal(view.stationArt, art);
  view.render({live: false, connected: true, blocked: false, stationId: 'p6-beat', playing: false});
  assert.ok(choosable(view));
  tap(view.buttons[0]);
  assert.deepEqual(calls, [[stations[0].id, stations[0]]]);
});

test('first-denied, connected denial and live-unsupported Radio all disable actual station Buttons before '
  + 'a click', () => {
  const scene = previewScene('first-denied'), {view, calls} = fixture();
  const cases = [{live: false, connected: scene.connected}, {live: false, connected: true, blocked: true},
    {live: true, connected: true}, {live: true, connected: true, enabled: true, canStart: false, status: 'unknown'}];
  let retained;
  for (const input of cases) {
    view.render(input);
    const buttons = view.buttons;
    assert.equal(buttons.length, stations.length);
    assert.ok(buttons.every(button => button.disabled === true));
    if (retained) assert.deepEqual(buttons, retained);
    retained = buttons;
    for (const button of buttons) tap(button);
    assert.deepEqual(calls, []);
    assert.equal(selected(view), null);
  }
  view.render({live: false, connected: true});
  const buttons = view.buttons;
  assert.deepEqual(buttons, retained);
  assert.ok(buttons.every(button => button.disabled === false));
  tap(buttons[1]);
  assert.deepEqual(calls.map(([id]) => id), ['p3']);
});

test('Radio intro uses the same retained Hero message roles across selection and denied recovery without '
  + 'extra authority', () => {
  const {view, calls} = fixture();
  view.render({live: false, connected: true});
  const hero = view.hero, copy = hero.children[0].children[1];
  assert.equal(hero.dataset.kitVariant, 'message');
  assert.equal(view.stationArt.dataset.kitSlot, 'icon');
  assert.equal(copy.dataset.kitSlot, 'copy');
  assert.equal(view.stationTitle.dataset.kitSlot, 'title');
  assert.equal(view.stationStatus.dataset.kitSlot, 'body');
  view.render({live: false, connected: false, blocked: true});
  assert.equal(view.hero, hero);
  assert.equal(view.hero.dataset.kitVariant, 'message');
  assert.match(view.stationStatus.textContent, /Adgang afvist/);
  assert.ok(view.buttons.every(button => button.disabled));
  view.render({live: false, connected: true, stationId: 'p3'});
  assert.equal(view.hero, hero);
  assert.equal(hero.children[0].children[1], copy);
  assert.equal(view.stationTitle.textContent, 'P3');
  assert.equal(selected(view), 'p3');
  assert.deepEqual(calls, []);
});

test('pending station uses the tile loading state without changing selection and feedback naturally hides', () => {
  const {view} = fixture();
  view.render({live: true, connected: true, enabled: true, canStart: false, pending: true, stationId: 'p3',
    playing: true, pendingStationId: 'p1'});
  assert.equal(selected(view), 'p3');
  assert.deepEqual(view.buttons.filter(button => button.getAttribute('aria-busy') === 'true')
    .map(button => button.dataset.optionId), ['p1']);
  assert.equal(detail(view, 0), 'Starter…');
  assert.equal(view.feedback.hidden, true);
  const list = view.list;
  view.render({live: true, connected: true, enabled: true, stationId: null,
    feedback: {state: 'unknown', message: 'Udfald ukendt'}});
  assert.equal(view.list, list);
  assert.equal(view.feedback.hidden, false);
  assert.equal(view.feedback.dataset.state, 'unknown');
  assert.equal(view.feedback.textContent, 'Udfald ukendt');
  assert.ok(view.buttons.every(button => button.getAttribute('aria-busy') === 'false'));
  view.render({live: true, connected: true, enabled: true});
  assert.equal(view.feedback.hidden, true);
  assert.equal(view.feedback.textContent, '');
});

test('radio outcome feedback occupies the shared Hero copy feedback slot after body, never the icon grid '
  + 'column', () => {
  const {view} = fixture();
  view.render({live: true, connected: true, enabled: true,
    feedback: {state: 'unknown', message: 'Radiohandlingen har ukendt udfald. Handlingen gentages ikke.'}});
  const copy = view.hero.children[0].children[1];
  assert.equal(copy.dataset.kitSlot, 'copy');
  assert.equal(view.feedback.parentNode, copy);
  assert.deepEqual([...copy.children].map(node => node.dataset.kitSlot), [undefined, 'title', 'body', 'feedback']);
  assert.equal(view.feedback.dataset.kitVariant, 'feedback');
  assert.equal(view.feedback.getAttribute('role'), 'status');
  assert.equal(view.feedback.hidden, false);
  const css = read('ui-kit.css');
  assert.ok(css.includes('.pv-kit-hero[data-kit-variant=message]:not([hidden]'
    + ') [data-kit-slot=feedback]{grid-column:2;grid-row:3;'));
  view.render({live: true, connected: true, enabled: true, pending: true, pendingStationId: 'p1'});
  assert.equal(view.feedback.hidden, true);
  assert.equal(view.feedback.textContent, '');
  assert.equal(view.feedback.parentNode, copy);
});

const liveScene = {live: true, connected: false, blocked: false, stationId: null, playing: false,
  pendingStationId: null, speaker: null};

test('held live start retains exact logos, labels only the requested tile Starter and previews the '
  + 'requested player without changing the selected observation', async () => {
  const snapshot = {bootId: 'b', roomId: 'r'}, now = Date.now() / 1000, frames = [];
  const dto = (stationId = 'p3', generation = 1) => ({ok: true, schema: 'podview.radio.v1', ...snapshot, enabled: true,
    revision: generation, stations: ownerStationIds.map(id => ({id, name: radioStation(id).label})),
    targets: [{id: 'a', name: 'Stuen', selectable: true, availability: 'available', default: true}],
    actions: ['start', 'stop', 'move', 'volume'], state: {status: 'playing', stationId, targetId: 'a', generation,
      sourceKind: 'radio', ownerGeneration: generation, volumePercent: 37, observedAt: now},
    retrievedAt: now, validUntil: now + 30, physicalResultVerified: false});
  let offerResolve, actionResolve, posts = 0;
  const host = {liveSnapshot: snapshot, liveTransport: {connected: true,
    radioOffer: () => new Promise(done => { offerResolve = done; }),
    radioAction: () => { posts++; return new Promise(done => { actionResolve = done; }); },
    radio: async () => dto('p1', 2)},
  playerView: {}};
  const radio = radioOf(host);
  radio.setState({value: dto()});
  radio.setState({lastConfirmed: {...radio.getState().value.state}});
  // What the shared player draws for radio on every change (Player.tsx reads radioFrame's model).
  radio.subscribe(() => {
    const frame = radioFrame(radio);
    if (frame) frames.push(frame.model);
  });
  function Live() {
    const input = useStore(radio, useShallow(() => radioInput(liveScene, radio, connectionOf(host))));
    return h(RadioDetail, {input, onChoose: station => void radio.choose(station.id)});
  }
  const root = shell();
  render(h(Live), {container: root, wrapper: Providers});
  const buttons = [...root.querySelectorAll('pv-station-list button')];
  const logos = buttons.map(button => button.querySelector('img')), sources = logos.map(img => img.getAttribute('src'));
  let operation;
  act(() => { operation = radio.choose('p1'); });
  const view = {buttons};
  assert.equal(selected(view), 'p3');
  assert.equal(frames.at(-1).title, 'P1');
  assert.equal(frames.at(-1).playing, false);
  assert.equal(frames.at(-1).fresh, false);
  assert.equal(frames.at(-1).loading, true);
  assert.equal(frames.at(-1).volume, 37);
  assert.deepEqual(buttons.filter(button => button.getAttribute('aria-busy') === 'true'), [buttons[0]]);
  assert.ok(buttons.every(button => button.dataset.feedback === 'label'));
  assert.equal(buttons[0].querySelector('span').textContent, 'Starter…');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[0].querySelector('strong').textContent, 'P1');
  assert.equal(posts, 0);
  await act(async () => {
    offerResolve({...snapshot, taskId: 't', optionId: 'o', expiresAt: Date.now() / 1000 + 5});
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(posts, 1);
  assert.equal(frames.at(-1).title, 'P1');
  assert.equal(radio.getState().value.state.stationId, 'p3');
  assert.equal(buttons[0].getAttribute('aria-busy'), 'true');
  await act(async () => {
    actionResolve({status: 'accepted'});
    await operation;
  });
  assert.deepEqual([...root.querySelectorAll('pv-station-list button')], buttons);
  assert.equal(selected(view), 'p1');
  assert.equal(frames.at(-1).title, 'P1');
  assert.ok(buttons.every(button => button.getAttribute('aria-busy') === 'false'));
  assert.deepEqual(buttons.map(button => button.querySelector('img')), logos);
  assert.deepEqual(logos.map(img => img.getAttribute('src')), sources);
  radio.invalidate(true);
});

test('station surfaces retain normal shadow and exactly one native2px selected frame with no artwork '
  + 'spinner variant', () => {
  const css = read('ui-kit.css');
  assert.ok(!css.includes('.pv-kit:is(.pv-kit-card,.pv-kit-hero,.pv-kit-tile),pv-widget-host #radio-view'));
  assert.ok(css.includes('pv-widget-host #radio-view .radio-station-tiles .pv-list>.pv-kit-button[aria-pressed=true]{'
    + 'background:var(--pv-surface)!important;border-color:var(--pv-ink)!important;box-shadow:none}'));
  assert.ok(!css.includes('data-progress-slot'));
  assert.ok(css.includes('.pv-kit.pv-kit-button[data-feedback=label][aria-busy=true'
    + ']::after{content:none!important;animation:none!important}'));
});

// An unchanged input must write nothing at all and a station change must not rebuild the screen (no blink).
function recordMutations() {
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
  return () => observer.takeRecords();
}
test('an unchanged radio input writes nothing to the DOM and a station change rebuilds nothing', () => {
  const {root, view} = fixture(), state = {live: false, connected: true, stationId: 'p3', playing: true,
    speaker: 'Stuen'};
  view.render(state);
  const records = recordMutations(), children = [...root.querySelectorAll('*')];
  view.render({...state});
  view.render(state);
  assert.deepEqual(records(), []);
  view.render({...state, stationId: 'p1'});
  const removed = records().filter(record => record.type === 'childList' &&
    [...record.removedNodes].some(node => node.nodeType === 1));
  assert.deepEqual(removed, [], 'no element is removed');
  for (const node of children) assert.ok(node.isConnected, 'every element is kept');
  assert.equal(view.stationTitle.textContent, 'P1');
  assert.equal(view.needle.style.left, '10%');
});

// The mounted page (RadioScreen): the local preview's tap is a scene event for the shell; live it is the radio
// source's one explicit action over the wire (offer, then the action, then the observation that proves it).
test('the local preview page asks the shell to choose the station', () => {
  resetRadioState();
  const chosen = [];
  connectShell({selectLocalRadio: id => chosen.push(id)});
  publishRadioScene({live: false, connected: true, blocked: false, stationId: null, playing: false,
    pendingStationId: null, speaker: null});
  const root = shell();
  render(h(RadioScreen), {container: root, wrapper: Providers});
  tap(root.querySelectorAll('pv-station-list button')[1]);
  assert.deepEqual(chosen, ['p3']);
  act(() => {
    publishRadioScene({live: false, connected: true, blocked: false, stationId: 'p3', playing: true,
      pendingStationId: null, speaker: 'Stuen'});
  });
  assert.equal(root.querySelector('.radio-hero-status').textContent, 'Spiller på Stuen');
});

test('a live tap sends one offer and one action, and the page shows the station once the owner observes '
  + 'it', async () => {
  resetRadioState();
  const now = () => Date.now() / 1000, snapshot = {schema: 'podview.snapshot.v1', bootId: 'b', roomId: 'r',
    revision: 1, timers: {status: 'observed', items: []}, capabilities: {timerActions: []}};
  let generation = 1, station = null, status = 'stopped';
  const observation = () => ({ok: true, schema: 'podview.radio.v1', bootId: 'b', roomId: 'r', revision: generation,
    enabled: true, stations: ownerStationIds.map(id => ({id, name: radioStation(id).label})),
    targets: [{id: 'a', name: 'Stuen', selectable: true, availability: 'available', default: true}],
    actions: ['start', 'stop', 'move', 'volume'], state: {status, stationId: station, targetId: station ? 'a' : null,
      generation, sourceKind: station ? 'radio' : 'none', ownerGeneration: 1, volumePercent: 30, observedAt: now()},
    retrievedAt: now(), validUntil: now() + 30, physicalResultVerified: false});
  const wire = [];
  server.use(
    http.get(`${API}/radio`, ({request}) => {
      wire.push(['GET radio', new URL(request.url).searchParams.get('room')]);
      return HttpResponse.json(observation());
    }),
    http.post(`${API}/radio/offer`, async ({request}) => {
      const intent = await request.json();
      wire.push(['POST offer', intent.action, intent.stationId, intent.targetId,
        request.headers.get('X-PodView-Request')]);
      return HttpResponse.json({ok: true, bootId: 'b', roomId: 'r', taskId: 'task', optionId: 'option',
        expiresAt: now() + 10});
    }),
    http.post(`${API}/radio/actions`, async ({request}) => {
      const body = await request.json();
      wire.push(['POST action', body.taskId, body.optionId]);
      generation = 2;
      station = 'p3';
      status = 'playing';
      return HttpResponse.json({ok: true, schema: 'podview.radio-action.v1', status: 'accepted', retryAllowed: false});
    }),
  );
  ingestSnapshot(snapshot);
  ingestConnection({mode: 'live', status: 'connected', connected: true, blocked: false, sessionExpired: false,
    browserOffline: false, acceptedReadAt: Date.now()});
  connectApi(fetchApi({pageUrl: PAGE_URL, snapshot: readSnapshot}));
  publishRadioScene({...liveScene});
  const root = shell();
  render(h(RadioScreen), {container: root, wrapper: Providers});
  await act(async () => {
    await radioSource.refresh({immediate: true});
  });
  const buttons = [...root.querySelectorAll('pv-station-list button')];
  assert.ok(buttons.every(button => !button.disabled), 'an admitted owner offering start makes every tile choosable');
  assert.equal(root.querySelector('.radio-hero-status').textContent, 'Ingen station valgt');
  // The tap starts the command at once (pending); it settles when the owner's observation proves it.
  const settled = () => new Promise(done => {
    const stop = radioSource.subscribe(state => {
      if (state.pending) return;
      stop();
      done();
    });
  });
  await act(async () => {
    buttons[1].click();
    assert.equal(radioSource.getState().pending, true);
    await settled();
  });
  assert.deepEqual(wire, [['GET radio', 'r'], ['POST offer', 'start', 'p3', 'a', '1'],
    ['POST action', 'task', 'option'], ['GET radio', 'r']], 'one tap is one offer and one action, never resent');
  assert.equal(root.querySelector('.radio-hero-status').textContent, 'Spiller på Stuen');
  assert.equal(root.querySelector('.radio-hero [data-kit-slot="title"]').textContent, 'P3');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(radioSource.getState().unknown, false);
  resetRadioState();
});
