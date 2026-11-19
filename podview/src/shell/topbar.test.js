// The topbar, ported to Vitest with the real page when the shell moved to React: tests/podview/root-topbar.test.mjs
// (deleted). Same assertions. The fake host (renderTopbar, renderTopbarClock, renderTopbarScroll, renderHeaderTitle,
// renderSvarDevice, open(), the close handler and headerBackAction sliced out of widget-view.js onto stub nodes) is the
// real host on the real shell. Conversions:
// - the stub nodes are the rendered topbar, Ro and »Tidligere svar«; `nav` is .view-nav, `responses` is .responses;
// - the stubbed motion.value is a spy on the host's SceneMotion.value that records and writes the text; counted
//   animations are the page's Element.animate calls;
// - the `renderHeaderTitle(title, back)` the old fixture recorded is the shell's topbar view ({title, back});
// - a stubbed dispatch that rendered the topbar at once is the real dispatch with page motion off (navigation renders
//   at once, as without a layered page);
// - the detail Back button is React's: it is the same element while the title changes between detail pages, and a new
//   one when the topbar comes back from Hjem (the old one was re-inserted); a removed button still cannot act;
// - the source-text checks (one headerBackAction listener, no back.click()) are checked by tapping both controls.
import {afterEach, test, vi} from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mountPage, unmountPage} from './shell-fixture.js';

afterEach(unmountPage);

const podview = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const css = name => fs.readFileSync(resolve(podview, name), 'utf8');

async function fixture(stage = 'now', path) {
  const f = await mountPage(path || `/?stage=${stage}`);
  const {host} = f;
  // The old fixture's state: Hjem, connected, nothing else.
  host.state = {
    ...host.state,
    focus: stage === 'photo' ? 'photo' : 'now',
    connected: true,
    devices: [],
    answers: [],
    connectionPreview: null,
  };
  host.motion.page = undefined;
  const animations = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    animations.push({frames, options});
    return animate.call(this, frames, options);
  };
  const nav = document.querySelector('.view-nav'),
    responses = document.querySelector('.responses');
  let scroll = 0;
  const scrollWrites = [];
  Object.defineProperty(responses, 'scrollTop', {
    configurable: true,
    get: () => scroll,
    set: value => {
      scroll = value;
      scrollWrites.push(value);
    },
  });
  return {...f, animations, nav, responses, scrollWrites, title: () => f.store.view.topbar};
}

test('shared topbar changes canonical scene title once and keeps answer history action count hidden', async () => {
  const f = await fixture();
  f.host.renderTopbar();
  assert.equal(f.$('header-title').textContent, 'Lige nu');
  f.host.state.focus = 'music';
  f.host.renderTopbar();
  assert.equal(f.$('header-title').textContent, 'Find musik');
  const count = f.animations.length;
  f.host.renderTopbar();
  assert.equal(f.animations.length, count);
  assert.equal(f.$('header-history-count').hidden, true);
  assert.equal(f.$('show-photo').hidden, true);
  f.host.state.focus = 'photo';
  f.host.renderTopbar();
  assert.equal(f.$('show-photo').hidden, true);
});

// P5 (docs/MOTION.md §3.6): the header clock goes through SceneMotion.value with the clock's forward direction;
// the digit roll itself is covered in motion-value.test.mjs.
test('clock minute changes animate only once; offline replaces date and explicit night hook follows lifecycle', async () => {
  const f = await fixture(),
    time = new Date(2026, 9, 20, 12, 34),
    values = [];
  vi.spyOn(f.host.motion, 'value').mockImplementation((node, text, options) => {
    values.push({node, text, options});
    if (node.textContent !== text) node.textContent = text;
  });
  f.animations.length = 0;
  f.host.renderTopbarClock(time);
  assert.match(f.$('header-clock').textContent, /12[.:]34/);
  const raw = time.toLocaleDateString('da-DK', {weekday: 'short', day: 'numeric', month: 'short'});
  assert.equal(f.$('header-date').textContent, raw.charAt(0).toLocaleUpperCase('da-DK') + raw.slice(1));
  assert.notEqual(f.$('header-date').textContent, f.$('header-date').textContent.toLocaleUpperCase('da-DK'));
  f.host.renderTopbarClock(time);
  assert.equal(f.animations.length, 0);
  f.host.renderTopbarClock(new Date(2026, 9, 20, 12, 35));
  assert.equal(f.animations.length, 0);
  const header = values.filter(v => v.node === f.$('header-clock'));
  assert.match(header.at(-1).text, /12[.:]35/);
  assert.deepEqual(header.at(-1).options, {direction: 1});
  assert.equal(f.$('header-clock').textContent, header.at(-1).text);
  f.host.state.connected = false;
  f.host.dataset.night = 'true';
  f.host.renderTopbarClock(time);
  assert.equal(f.$('header-date').textContent, 'Forbindelsen er afbrudt');
  assert.equal(f.nav.dataset.connectionState, 'offline');
  assert.equal(f.$('header-offline-dot').hidden, false);
  assert.equal(f.nav.dataset.night, 'true');
});

test('reduced title and clock changes use opacity-only transitions at most120ms', async () => {
  const f = await fixture();
  f.host.dataset.motion = 'reduced';
  f.animations.length = 0;
  f.host.renderTopbar();
  f.host.state.focus = 'timers';
  f.host.renderTopbar();
  for (const animation of f.animations) {
    const duration = typeof animation.options === 'number' ? animation.options : animation.options?.duration;
    assert.ok(duration <= 120);
    const frames = Array.isArray(animation.frames) ? animation.frames : [animation.frames];
    assert.ok(frames.every(frame => !('transform' in frame)));
  }
});

test('header scroll separator follows existing response scroll, and Svar reflects focused answer only', async () => {
  const f = await fixture();
  f.responses.scrollTop = 0;
  f.host.renderTopbar();
  assert.equal(f.nav.dataset.scrolled, 'false');
  assert.equal(f.$('open-history').dataset.active, 'false');
  f.responses.scrollTop = 8;
  f.host.renderTopbarScroll();
  assert.equal(f.nav.dataset.scrolled, 'false');
  f.responses.scrollTop = 9;
  f.host.renderTopbarScroll();
  assert.equal(f.nav.dataset.scrolled, 'true');
  f.host.state.answers = [{id: 'answer-1', title: 'Et svar'}];
  f.host.state.focus = 'answer-1';
  f.host.renderTopbar();
  assert.equal(f.$('open-history').dataset.active, 'true');
  assert.equal(f.$('open-history').getAttribute('aria-current'), 'page');
  f.host.state.focus = 'now';
  f.host.renderTopbar();
  assert.equal(f.$('open-history').dataset.active, 'false');
  f.responses.scrollTop = 0;
  f.host.renderTopbarScroll();
  assert.equal(f.nav.dataset.scrolled, 'false');
});

test('unavailable weather slot remains pending only while connecting and clears after resolution', async () => {
  const f = await fixture();
  f.$('header-weather').disabled = true;
  f.host.state.connectionPreview = {status: 'connecting'};
  f.host.renderTopbar();
  assert.equal(f.$('header-weather').getAttribute('aria-busy'), 'true');
  f.host.state.connectionPreview = {status: 'disconnected'};
  f.host.renderTopbar();
  assert.equal(f.$('header-weather').getAttribute('aria-busy'), 'false');
  f.host.state.connectionPreview = {status: 'connecting'};
  f.$('header-weather').disabled = false;
  f.host.renderTopbar();
  assert.equal(f.$('header-weather').getAttribute('aria-busy'), 'false');
});

test('connected first-run with no capabilities keeps the date instead of claiming offline', async () => {
  const f = await fixture();
  f.host.state.connected = false;
  f.host.state.connectionPreview = {status: 'connected'};
  f.host.renderTopbarClock(new Date(2026, 9, 20, 12, 34));
  assert.notEqual(f.$('header-date').textContent, 'Offline');
  assert.equal(f.$('header-offline-dot').hidden, true);
});

test('history Back uses canonical Svar title then overview then Ro without stopping resources', async () => {
  for (const origin of ['music', 'now', 'photo']) {
    const f = await fixture();
    const timer = {id: 'retained', remaining: 42},
      music = {...f.host.state.music, playback: {...f.host.state.music.playback, active: true}};
    const history = f.$('history'),
      opener = f.$('open-history'),
      under = f.$('now-view');
    f.host.state = {...f.host.state, focus: origin, timer, music};
    f.host.render();
    under.inert = false;
    f.responses.scrollTop = 91;
    f.host.open('history', opener);
    assert.equal(f.$('header-title').textContent, 'Svar');
    assert.equal(f.$('show-photo').hidden, true);
    assert.equal(f.$('show-photo').getAttribute('aria-label'), 'Gå til Ro');
    assert.equal(f.host.dataset.view, 'active');
    assert.equal(under.inert, true);
    assert.equal(f.host.state.focus, origin);
    f.scrollWrites.length = 0;
    f.host.headerBackAction();
    await vi.waitFor(() => assert.equal(f.$('header-title').textContent, 'Lige nu'));
    assert.equal(history.open, false);
    assert.equal(f.host.dataset.view, 'active');
    assert.equal(under.inert, false);
    // Closing restores the feed's scroll; the page change to Hjem then starts the new page at its top.
    assert.equal(f.scrollWrites[0], 91);
    assert.equal(f.host.state.timer, timer);
    assert.equal(f.host.state.music.playback.active, true);
    assert.equal(f.host.state.focus, 'now');
    f.host.headerBackAction();
    assert.equal(f.host.state.focus, 'photo');
    assert.equal(f.host.state.timer, timer);
    assert.equal(f.host.state.music.playback.active, true);
    unmountPage();
  }
});

test('one native detail button contains arrow and title, retains the h1 and invokes one shared Back handler', async () => {
  const f = await fixture();
  let backClicks = 0;
  f.host.headerBackAction = () => {
    backClicks++;
  };
  const heading = f.$('header-title');
  f.host.state.focus = 'music';
  f.$('history').setAttribute('open', '');
  f.host.renderTopbar();
  const action = heading.querySelector('button'),
    copy = action.querySelector('span');
  assert.equal(heading.tagName, 'H1');
  assert.equal(action.tagName, 'BUTTON');
  assert.equal(action.type, 'button');
  assert.equal(action.dataset.pvPress, 'quiet');
  assert.equal(action.parentNode, heading);
  assert.equal(heading.textContent, 'Svar');
  assert.deepEqual(
    [...action.children].map(child => child.tagName),
    ['IMG', 'SPAN'],
  );
  assert.equal(action.children[0].getAttribute('src'), 'assets/icons/arrow-left-long.svg');
  assert.equal(action.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(action.children[1], copy);
  assert.equal(action.getAttribute('aria-label'), 'Svar · Tilbage');
  action.click();
  assert.equal(backClicks, 1);
  const writes = [];
  const observer = new MutationObserver(records => writes.push(...records));
  observer.observe(heading, {subtree: true, attributes: true, childList: true, characterData: true});
  f.host.renderTopbar();
  writes.push(...observer.takeRecords());
  observer.disconnect();
  assert.equal(writes.length, 0);
  f.$('history').removeAttribute('open');
  f.host.renderTopbar();
  assert.equal(heading.textContent, 'Find musik');
  assert.equal(heading.querySelector('button'), action);
  assert.equal(action.querySelector('span'), copy);
  action.click();
  assert.equal(backClicks, 2);
  f.host.state.focus = 'now';
  f.host.renderTopbar();
  assert.equal(heading.querySelector('button'), null);
  assert.equal(action.parentNode, null);
  assert.equal(heading.textContent, 'Lige nu');
  action.click();
  assert.equal(backClicks, 2, 'a detached detail button cannot act on the home destination');
  f.host.state.focus = 'photo';
  f.host.renderTopbar();
  assert.equal(heading.textContent, 'Ro');
  f.host.state.focus = 'weather';
  f.host.renderTopbar();
  const again = heading.querySelector('button');
  assert.equal(again.parentNode, heading);
  assert.equal(again.children.length, 2);
  again.click();
  assert.equal(backClicks, 3, 'repeated navigation does not duplicate the shared listener');
});

test('answer history is a detail destination even when opened over home or Ro', async () => {
  for (const focus of ['now', 'photo', 'music', 'answer-1']) {
    const f = await fixture();
    f.host.state.focus = focus;
    f.host.state.answers = focus === 'answer-1' ? [{id: 'answer-1', title: 'Et talt spørgsmål'}] : [];
    f.$('history').setAttribute('open', '');
    f.host.renderTopbar();
    assert.equal(f.host.dataset.level, 'detail');
    assert.equal(f.$('show-photo').hidden, true);
    assert.equal(f.$('header-title').textContent, 'Svar');
    f.$('history').removeAttribute('open');
    f.host.renderTopbar();
    assert.equal(f.host.dataset.level, ['now', 'photo'].includes(focus) ? 'home' : 'detail');
    assert.equal(f.$('show-photo').hidden, focus !== 'now');
    if (focus === 'answer-1')
      assert.equal(f.$('header-title').textContent, 'Svar', 'spoken question belongs to the answer card');
    unmountPage();
  }
});

test('desktop header keeps its divider at80 and gives the scroll viewport the initial16px inset', () => {
  const kit = css('ui-kit.css'),
    frame = css('frame-layout.css'),
    effects = css('widget-redesign.css');
  const start = kit.indexOf('/* The header ends at 80px.'),
    end = kit.indexOf('/* Hero facts', start);
  const boundary = kit.slice(start, end);
  assert.match(boundary, /@media\(min-width:760px\)/, 'mobile retains its existing document flow');
  assert.match(
    frame,
    /\[data-topbar=true\]\[data-view=active\] \.view-nav\{[^}]*height:80px;min-height:80px;max-height:80px/,
  );
  assert.match(boundary, /\.view-nav\{margin-bottom:0\}/);
  assert.match(boundary, /\.view-nav::after\{bottom:0\}/);
  assert.match(
    boundary,
    /\.frame>\.responses\{box-sizing:border-box;padding-block-start:var\(--pv-topbar-content-gap\)\}/,
  );
  assert.match(
    boundary,
    /\.frame>:is\(\.player\.pv-card,#player-empty\)\{margin-block-start:var\(--pv-topbar-content-gap\);height:calc\(100% - var\(--pv-topbar-content-gap\)\);max-height:min\(calc\(100% - var\(--pv-topbar-content-gap\)\),692px\)\}/,
  );
  assert.match(effects, /\.frame::before\{top:0;height:48px;/, 'the existing fade starts at the viewport edge');
  assert.doesNotMatch(
    boundary,
    /(?:translate|transform|position:\s*absolute|bottom:calc\(-1)/,
    'geometry comes from normal flow',
  );
  // Moving the gap inside the larger viewport preserves the initial card and
  // player edges, while a real scroll can consume that gap up to header80.
  for (const canvas of [640, 800, 1080]) {
    const header = 80,
      gap = 16,
      bottom = 16,
      oldViewport = canvas - header - gap - bottom,
      newViewport = canvas - header - bottom;
    assert.equal(header + gap, 96);
    assert.equal(header + gap - 16, 80);
    assert.equal(Math.min(newViewport - gap, 692), Math.min(oldViewport, 692), 'player height is preserved');
    assert.equal(
      header + gap + Math.min(newViewport - gap, 692),
      header + gap + Math.min(oldViewport, 692),
      'player bottom is preserved',
    );
  }
});

test('retained connection states remain distinct in the header without changing resources or navigation', async () => {
  const f = await fixture(),
    timer = {id: 'known', remaining: 42},
    music = f.host.state.music,
    answer = {id: 'answer-1', title: 'Known answer'};
  Object.assign(f.host.state, {connected: false, timer, answers: [answer]});
  for (const [status, label, state] of [
    ['connecting', 'Genopretter forbindelse…', 'connecting'],
    ['disconnected', 'Forbindelsen er afbrudt', 'offline'],
  ]) {
    f.host.state.connectionPreview = {status, snapshot: {}};
    f.host.renderTopbarClock(new Date(2026, 9, 23, 12, 34));
    assert.equal(f.$('header-date').textContent, label);
    assert.equal(f.nav.dataset.connectionState, state);
    assert.equal(f.host.state.timer, timer);
    assert.equal(f.host.state.music, music);
    assert.equal(f.host.state.answers[0], answer);
    assert.equal(f.host.state.focus, 'now');
  }
  f.host.browserOffline = true;
  f.host.renderTopbarClock(new Date());
  assert.equal(f.$('header-date').textContent, 'Ingen netværksforbindelse');
  assert.equal(f.nav.dataset.connectionState, 'offline');
});

test('only overview exposes the distinct Ro shortcut; detail uses its one arrow-and-title button', async () => {
  const f = await fixture(),
    icon = f.$('show-photo').querySelector('img'),
    label = f.$('show-photo').querySelector('.rest-label');
  f.host.renderTopbar();
  assert.equal(f.$('show-photo').hidden, false);
  assert.equal(f.$('show-photo').dataset.navigation, 'rest');
  assert.equal(icon.getAttribute('src'), 'assets/icons/moon.svg');
  assert.equal(label.hidden, false);
  assert.equal(label.textContent, 'Ro');
  assert.equal(f.$('show-photo').getAttribute('aria-label'), 'Gå til Ro');
  f.host.state.focus = 'music';
  f.host.renderTopbar();
  assert.equal(f.$('show-photo').hidden, true);
  assert.equal(f.$('show-photo').dataset.navigation, 'rest');
  assert.equal(icon.getAttribute('src'), 'assets/icons/moon.svg');
  f.host.state.focus = 'photo';
  f.host.renderTopbar();
  assert.equal(f.$('show-photo').hidden, true);
});

test('home titles remain plain while detail and history titles keep Back, independently of the separate Ro shortcut', async () => {
  const f = await fixture(),
    music = f.host.state.music,
    timer = {id: 'kept', remaining: 41};
  f.host.state.timer = timer;
  for (const [focus, title, back] of [
    ['now', 'Lige nu', false],
    ['photo', 'Ro', false],
    ['music', 'Find musik', true],
    ['weather', 'Vejr', true],
  ]) {
    f.host.state.focus = focus;
    f.host.renderTopbar();
    assert.deepEqual({title: f.title().title, back: f.title().back}, {title, back});
    assert.equal(f.host.state.music, music);
    assert.equal(f.host.state.timer, timer);
  }
  f.host.state.focus = 'now';
  f.$('history').setAttribute('open', '');
  f.host.renderTopbar();
  assert.deepEqual({title: f.title().title, back: f.title().back}, {title: 'Svar', back: true});
  f.$('history').removeAttribute('open');
  f.host.renderTopbar();
  assert.deepEqual({title: f.title().title, back: f.title().back}, {title: 'Lige nu', back: false});
  assert.equal(f.$('show-photo').getAttribute('aria-label'), 'Gå til Ro');
  assert.equal(f.$('show-photo').hidden, false);
});

test('initial markup preserves the focusable heading and only the separate Ro shortcut', async () => {
  const f = await fixture();
  const heading = f.$('header-title');
  assert.equal(heading.outerHTML, '<h1 id="header-title" class="header-title" tabindex="-1">Lige nu</h1>');
  const ro = f.$('show-photo');
  assert.deepEqual(
    [ro.getAttribute('type'), ro.getAttribute('aria-label'), ro.dataset.navigation],
    ['button', 'Gå til Ro', 'rest'],
  );
  const [moon, rest] = ro.children;
  assert.equal(ro.children.length, 2);
  assert.deepEqual(
    [moon.localName, moon.getAttribute('src'), moon.getAttribute('alt'), moon.attributes.length],
    ['img', 'assets/icons/moon.svg', '', 2],
  );
  assert.equal(rest.outerHTML, '<span class="rest-label">Ro</span>');
  // One shared Back owner: the Ro key and the detail title both call it directly, once per tap.
  let back = 0,
    roClicks = 0;
  f.host.headerBackAction = () => {
    back++;
  };
  ro.addEventListener('click', () => {
    roClicks++;
  });
  ro.click();
  assert.equal(back, 1);
  f.host.state.focus = 'weather';
  f.host.renderTopbar();
  heading.querySelector('button').click();
  assert.equal(back, 2);
  assert.equal(roClicks, 1, 'detail Back invokes the shared owner directly, never a second hidden target');
});

test('tapping the overview Ro shortcut opens Foto-Ro and keeps music and timer', async () => {
  const f = await fixture(),
    timer = {id: 'kept', remaining: 40},
    music = f.host.state.music;
  const icon = f.$('show-photo').querySelector('img'),
    label = f.$('show-photo').querySelector('.rest-label');
  f.host.state = {...f.host.state, focus: 'now', timer};
  f.host.renderTopbar();
  assert.equal(f.$('show-photo').hidden, false);
  assert.equal(f.$('show-photo').getAttribute('aria-label'), 'Gå til Ro');
  assert.equal(label.textContent, 'Ro');
  assert.equal(icon.getAttribute('src'), 'assets/icons/moon.svg');
  f.$('show-photo').click();
  assert.equal(f.host.state.focus, 'photo');
  assert.equal(f.host.state.timer, timer);
  assert.equal(f.host.state.music, music);
  await vi.waitFor(() => assert.equal(f.$('show-photo').hidden, true));
});

test('Svar shows the canvas offline pill »Offline« while Voice PE is offline and returns to Svar', async () => {
  const f = await fixture();
  const button = f.$('open-history'),
    label = button.querySelector('strong');
  f.host.live = true;
  f.host.liveSnapshot = {voice: {device: 'offline'}};
  f.host.renderTopbar();
  assert.equal(label.textContent, 'Offline');
  assert.equal(button.dataset.device, 'offline');
  assert.match(button.getAttribute('aria-description'), /Voice PE er offline/);
  f.host.liveSnapshot = {voice: {device: 'online'}};
  f.host.renderTopbar();
  assert.equal(label.textContent, 'Svar');
  assert.equal(button.dataset.device, undefined);
  assert.equal(button.getAttribute('aria-description'), null);
});

test('current navigation shell is committed before a failing domain render without swallowing the error', async () => {
  const f = await fixture(),
    failure = new Error('authored light projection failure'),
    timer = {id: 'kept', remaining: 42};
  const music = f.host.state.music;
  f.host.state.timer = timer;
  f.host.renderTopbar();
  assert.deepEqual({title: f.title().title, back: f.title().back}, {title: 'Lige nu', back: false});
  f.host.state.focus = 'radio';
  f.host.state.connected = false;
  f.host.syncLightArea = () => {
    throw failure;
  };
  assert.throws(
    () => f.host.render(),
    error => error === failure,
  );
  assert.equal(f.host.dataset.level, 'detail');
  assert.equal(f.host.dataset.view, 'active');
  assert.deepEqual({title: f.title().title, back: f.title().back}, {title: 'Radio', back: true});
  assert.equal(f.host.state.timer, timer);
  assert.equal(f.host.state.music, music);
  assert.equal(f.host.state.focus, 'radio');
});
