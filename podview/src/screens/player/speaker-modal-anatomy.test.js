// Ported from tests/podview/root-speaker-modal-anatomy.test.mjs (node:test with a native-like fake DOM) to Vitest
// with a real DOM (happy-dom) when the speaker picker moved to React. Same assertions; each port was first run
// against the old speaker-output-view.js in the same real DOM. Adaptations for
// the real DOM: the hand-built fake #rooms dialog became the real shell (playerShell, which applies the kit dialog as
// the fake fixture did), an existing actions slot is appended to its form before the view is made, as before; the
// fake child arrays became [...children] and a NodeList is spread, compared node by node; the fake click() (dropped
// when disabled) became the real button.click(); the stylesheet is read by path (the DOM's URL is not Node's).
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'vitest';
import {assign, playerShell} from './player-fixture.js';
import {SpeakerOutputView} from './SpeakerOutputView';


// Native document order and parent ownership matter here: a direct child of a grid Dialog is a separate track.
// Layout remains a browser QA gate.
function fixture({existingActions = false} = {}) {
  const host = playerShell(), $ = id => document.getElementById(id);
  const rooms = $('rooms'), form = rooms.querySelector('form'), rows = $('room-options');
  let actions;
  if (existingActions) {
    actions = document.createElement('div');
    actions.className = 'pv-dialog-actions';
    form.append(actions);
  }
  const calls = [], effects = [];
  assign(host, {
    isConnected: true,
    liveSnapshot: {bootId: 'boot', roomId: 'room', capabilities: {musicRead: ['targets']}},
    liveMedia: {account: 'account'},
    liveTransport: {
      connected: true,
      music: async (...args) => {
        calls.push(args);
        return {
          ok: true, schema: 'podview.speaker-catalogue.v1', bootId: 'boot', roomId: 'room', accountId: 'account',
          status: 'observed', catalogueId: 'c'.repeat(64), retrievedAt: Date.now() / 1000,
          source: 'podconnect.get_targets',
          speakers: [{speakerId: 'a'.repeat(64), accountId: 'account', kind: 'configured_alias',
            nativeRoomId: 'native-room', homepodId: '42', name: 'Køkken', availability: 'available', default: true,
            nativeSelected: true, outputSelected: false, selectable: false}],
          moveAvailable: false, physicalResultVerified: false,
        };
      },
      controlAction: (...args) => effects.push(args),
    },
    liveControls: {musicContext: () => null, moveSpeaker: (...args) => effects.push(args)},
  });
  const view = new SpeakerOutputView(host);
  return {rooms, form, rows, actions, host, view, calls, effects};
}

for (const existingActions of [false, true])
  test(`speaker refresh belongs to one canonical actions slot inside the dialog form; existing slot=${existingActions}`,
    ({onTestFinished}) => {
      const f = fixture({existingActions});
      onTestFinished(() => f.view.cleanup());
      const actions = f.form.querySelector('.pv-dialog-actions');
      assert.ok(actions, 'refresh uses the shared Dialog actions anatomy');
      assert.equal(f.view.refresh.parentNode, actions,
        'refresh cannot create a second stretchable direct Dialog track');
      assert.equal(actions.parentNode, f.form);
      assert.equal([...f.rooms.children].includes(f.view.refresh), false);
      const children = [...f.rooms.children];
      assert.equal(children.length, 1);
      assert.equal(children[0], f.form);
      assert.equal(f.form.querySelectorAll('.pv-dialog-actions').length, 1);
      if (existingActions) assert.equal(actions, f.actions, 'an existing canonical footer is reused');
      const buttons = [...actions.querySelectorAll('button')];
      assert.equal(buttons.length, 1);
      assert.equal(buttons[0], f.view.refresh);
      assert.equal(f.view.refresh.type, 'button', 'refresh cannot submit or close the dialog form');
      assert.equal(f.view.refresh.dataset.kit, 'button');
      assert.equal(f.view.refresh.textContent, 'Opdater liste');
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.effects, []);
    });

test('relocated refresh retains one explicit passive catalogue read and no playback or device effect',
  async ({onTestFinished}) => {
    const f = fixture();
    onTestFinished(() => f.view.cleanup());
    assert.deepEqual(f.calls, []);
    f.view.refresh.click();
    f.view.refresh.click();
    assert.deepEqual(f.calls, [['speakers', 'account']], 'pending repeated activation cannot duplicate the read');
    assert.equal(f.view.refresh.disabled, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.view.refresh.disabled, false);
    assert.equal(f.rows.children.length, 1);
    assert.equal(f.rows.children[0].disabled, true);
    assert.equal(f.rows.children[0].dataset.speakerId, 'a'.repeat(64));
    assert.deepEqual(f.effects, []);
    assert.equal(f.host.liveSnapshot.roomId, 'room');
  });

test('shared non-toast Dialog and its immediate form use intrinsic content tracks', async () => {
  const css = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../../ui-kit.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({selector: selector.trim(), body}));
  const intrinsic = rule => /height\s*:\s*fit-content/.test(rule.body) && /min-height\s*:\s*0/.test(rule.body)
    && /grid-auto-rows\s*:\s*max-content/.test(rule.body) && /align-content\s*:\s*start/.test(rule.body);
  assert.ok(rules.some(rule => rule.selector.includes('.pv-kit-dialog') && rule.selector.includes('toast')
    && !rule.selector.includes('#quick-sheet') && intrinsic(rule)),
  'content sizing belongs to the canonical non-toast Dialog, not only the settings sheet');
  assert.ok(rules.some(rule => /\.pv-kit-dialog\s*>\s*form/.test(rule.selector)
    && /grid-auto-rows\s*:\s*max-content/.test(rule.body) && /align-content\s*:\s*start/.test(rule.body)),
  'the retained method=dialog form also uses content tracks');
});
