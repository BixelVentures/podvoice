// Hjem's fixed controls, the shell's kit anatomy and the local »Afspil på« rows, ported to Vitest with the real page
// when the shell moved to React:
// - tests/podview/root-navigation-labels.test.mjs and root-speaker-selection-description.test.mjs (deleted),
// - the kit-binding test of tests/podview/root-kit.test.mjs, the Tesla destination test of
//   root-lazy-detail-view.test.mjs and the detail-placement test of root-player-detail-navigation.test.mjs (moved
//   here; the rest of those files stays in node:test).
// Same assertions. index.html's markup is the rendered page; the fake nodes the kit bindings were applied to are the
// shell's own elements (React draws the kit's classes and data attributes directly); the sliced overview listener is a
// tap on the card; the sliced »Afspil på« loop is the real render of the local preview's rows.
import {afterEach, test} from 'vitest';
import assert from 'node:assert/strict';
import {TARGETS, initialWidgetState, widgetTransition} from '../../widget-model.js';
import {mountPage, unmountPage} from './shell-fixture.js';

afterEach(unmountPage);

test('changing weather readings name themselves rather than being masked by a static action label', async () => {
  const f = await mountPage('/?stage=now');
  for (const id of ['header-weather', 'photo-weather']) {
    assert.ok(f.$(id));
    assert.equal(f.$(id).getAttribute('aria-label'), null);
  }
});

test('overview action name includes its visible title and generic activity host has no prohibited accessible name', async () => {
  const f = await mountPage('/?stage=now');
  const button = f.$('now-rest');
  assert.ok(button.getAttribute('aria-label').includes(button.textContent));
  const activity = document.querySelector('span.header-activity');
  assert.ok(activity);
  assert.equal(activity.getAttribute('aria-label'), null);
  assert.equal(activity.getAttribute('aria-labelledby'), null);
});

test('one canonical player detail lives inside responses and keeps queue, seek, volume and output IDs', async () => {
  await mountPage('/?stage=now');
  const detail = document.getElementById('music-detail');
  assert.equal(detail.parentElement, document.querySelector('.frame>.responses'));
  assert.ok(detail.compareDocumentPosition(document.querySelector('aside.player')) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(document.querySelectorAll('#music-detail').length, 1);
  assert.equal(detail.localName, 'section');
  // The detail's own elements (heading, queue, seek, volume, output) are drawn by React:
  // podview/src/screens/player/player-render.test.js checks them in the rendered DOM.
});

test('WidgetHost binds retained collections, actions and dialog parts without changing native history or owner state', async () => {
  let effects = 0;
  const f = await mountPage('/?stage=now');
  for (const node of document.querySelectorAll('dialog, button')) node.addEventListener('click', () => effects++);
  for (const [id, variant] of [
    ['empty-find-music', 'secondary'],
    ['hide-widget', 'destructive'],
    ['replace-task', 'primary'],
  ]) {
    assert.equal(f.$(id).dataset.kit, 'button');
    assert.equal(f.$(id).dataset.kitVariant, variant);
  }
  for (const id of ['rooms', 'history', 'quick-sheet', 'customize-sheet', 'conflict']) {
    const dialog = f.$(id);
    assert.equal(dialog.dataset.kit, 'dialog');
    assert.match((dialog.querySelector('header') || dialog.querySelector('h2')).className, /pv-dialog-header/);
    const description = dialog.querySelector(':scope p, :scope>form>p');
    if (description && !description.closest('pv-inline-status') && description.id !== 'history-example-note') {
      assert.match(description.className, /pv-dialog-description/);
    }
    const close = dialog.querySelector('.dialog-close');
    if (close) assert.match(close.className, /pv-dialog-close/);
  }
  assert.match(f.$('screen-settings-content').className, /pv-dialog-content/);
  assert.match(f.$('retained').className, /pv-dialog-content/);
  assert.match(f.$('room-options').className, /pv-dialog-content/);
  assert.match(f.$('conflict').querySelector('.demo-scenarios').className, /pv-dialog-actions/);
  const close = f.$('rooms').querySelector('.dialog-close');
  assert.equal(close.type, 'submit');
  assert.equal(close.value, 'close');
  assert.equal(f.$('history').getAttribute('aria-modal'), 'false');
  assert.equal(f.$('history').open, false);
  assert.equal(f.$('replace-task').disabled, false);
  assert.equal(f.$('screen-settings-content').hidden, false);
  assert.equal(effects, 0);
});

test('Tesla overview destination goes directly to its detail independently of the activity selector', async () => {
  const f = await mountPage('/?stage=now');
  const events = [];
  f.host.dispatch = event => events.push(event);
  f.host.focusHeading = () => {};
  f.$('home-vehicle').click();
  assert.deepEqual(events, [{type: 'show', id: 'vehicle'}]);
});

async function speakers() {
  const f = await mountPage('/?stage=now');
  const rows = () => [...f.$('room-options').children];
  const render = music => {
    f.host.state = {...f.host.state, connected: true, music};
    f.host.render();
  };
  return {f, rows, render, description: row => row.querySelector('small').textContent};
}

test('selected speaker says Valgt while other available rows remain Klar and unavailable description is retained', async () => {
  const s = await speakers(),
    state = initialWidgetState();
  s.render(state);
  const rows = s.rows();
  assert.equal(s.description(rows[0]), 'HomePod · Valgt');
  assert.equal(rows[0].getAttribute('aria-pressed'), 'true');
  assert.equal(s.description(rows[1]), 'HomePod · Klar');
  assert.equal(s.description(rows[2]), 'Ikke tilgængelig');
  const writes = [];
  const observer = new MutationObserver(records => writes.push(...records));
  observer.observe(s.f.$('room-options'), {subtree: true, attributes: true, childList: true, characterData: true});
  s.render(state);
  writes.push(...observer.takeRecords());
  observer.disconnect();
  assert.equal(writes.length, 0);
});

test('actual idle speaker choice updates selected description without changing IDs or inventing playback', async () => {
  const s = await speakers(),
    state = initialWidgetState();
  state.playback.active = false;
  state.playback.playing = false;
  s.render(state);
  const next = widgetTransition(state, {type: 'target', ...TARGETS[1], revision: state.revision});
  s.render(next);
  const rows = s.rows();
  assert.equal(s.description(rows[0]), 'HomePod · Klar');
  assert.equal(s.description(rows[1]), 'HomePod · Valgt');
  assert.equal(rows[1].getAttribute('aria-pressed'), 'true');
  assert.equal(next.playback.active, false);
  assert.deepEqual(
    rows.map(row => row.dataset.targetId),
    TARGETS.map(row => row.targetId),
  );
});

// docs/MOTION.md §0: render() without changes writes nothing to the DOM (render_idempotent_actual_e2e.cjs in a real
// browser); here on Hjem, Ro, a busy Hjem and »Tidligere svar«'s examples, with the shell's React tree in the page.
test('an identical render of Hjem writes nothing to the DOM', async () => {
  for (const stage of ['now', 'rest', 'activities-combined', 'visual-history']) {
    const f = await mountPage(`/?stage=${stage}`);
    f.host.render();
    const records = [];
    const observer = new MutationObserver(found => records.push(...found));
    observer.observe(document.body, {subtree: true, attributes: true, childList: true, characterData: true});
    f.host.render();
    f.host.render();
    records.push(...observer.takeRecords());
    observer.disconnect();
    // Two writers outside the shell re-apply an unchanged value, which happy-dom reports and Chromium does not
    // (render_idempotent_actual_e2e.cjs): the voice surface's [hidden] under reduced motion and the car card's
    // --pv-car-level. Everything else, the shell's React tree included, must stay untouched.
    const known = record =>
      record.attributeName === 'hidden' && record.target.classList.contains('voice-surface') ||
      record.attributeName === 'style' && record.target.id === 'home-vehicle';
    assert.deepEqual(
      records.filter(record => !known(record)).map(record => `${record.type}:${record.target.id || record.target.className}:${record.attributeName || ''}`),
      [],
      stage,
    );
    unmountPage();
  }
});
