// Ported from tests/podview/root-speaker-modal-anatomy.test.mjs (node:test with a native-like fake DOM) to Vitest
// with a real DOM (happy-dom), then onto the React sheet (SpeakerSheet.tsx in the shell's dialog, mountSpeakers).
// Same assertions: one canonical actions slot inside the dialog form, »Opdater liste« a non-submitting kit button,
// one passive catalogue read however often it is tapped, and intrinsic content tracks in the stylesheet. The fake
// child arrays became [...children], compared node by node; the fake click() is the real button.click() in act().
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {act} from '@testing-library/react';
import {test} from 'vitest';
import {mountSpeakers, settle} from './player-fixture.js';


// Native document order and parent ownership matter here: a direct child of a grid Dialog is a separate track.
// Layout remains a browser QA gate.
// The sheet is drawn by React (SpeakerSheet.tsx) inside the shell's dialog: there is no pre-existing actions slot to
// reuse any more (the old variant with one is gone), so the test asserts the one canonical slot it draws.
function fixture() {
  const calls = [], effects = [];
  const {host, view, $} = mountSpeakers({
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
  const rooms = $('rooms');
  return {rooms, form: rooms.querySelector('form'), rows: $('room-options'), host, view, calls, effects};
}

{
  test('speaker refresh belongs to one canonical actions slot inside the dialog form',
    ({onTestFinished}) => {
      const f = fixture();
      onTestFinished(() => f.view.cleanup());
      const actions = f.form.querySelector('.pv-dialog-actions');
      assert.ok(actions, 'refresh uses the shared Dialog actions anatomy');
      assert.ok(f.view.refresh.parentNode === actions,
        'refresh cannot create a second stretchable direct Dialog track');
      assert.ok(actions.parentNode === f.form);
      assert.equal([...f.rooms.children].includes(f.view.refresh), false);
      const children = [...f.rooms.children];
      assert.equal(children.length, 1);
      assert.ok(children[0] === f.form);
      assert.equal(f.form.querySelectorAll('.pv-dialog-actions').length, 1);
      const buttons = [...actions.querySelectorAll('button')];
      assert.equal(buttons.length, 1);
      assert.ok(buttons[0] === f.view.refresh);
      assert.equal(f.view.refresh.type, 'button', 'refresh cannot submit or close the dialog form');
      assert.equal(f.view.refresh.dataset.kit, 'button');
      assert.equal(f.view.refresh.textContent, 'Opdater liste');
      // The kit dialog's parts, drawn by the sheet (the shell's applyKitDialog no longer reaches inside #rooms).
      assert.match(f.form.querySelector('header').className, /pv-dialog-header/);
      assert.match(f.form.querySelector('p').className, /pv-dialog-description/);
      assert.match(f.rows.className, /pv-dialog-content/);
      assert.match(f.form.querySelector('.dialog-close').className, /pv-dialog-close/);
      assert.equal(f.form.querySelector('.dialog-close').dataset.kitVariant, 'icon');
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.effects, []);
    });
}

test('relocated refresh retains one explicit passive catalogue read and no playback or device effect',
  async ({onTestFinished}) => {
    const f = fixture();
    onTestFinished(() => f.view.cleanup());
    assert.deepEqual(f.calls, []);
    act(() => {
      f.view.refresh.click();
    });
    act(() => {
      f.view.refresh.click();
    });
    assert.deepEqual(f.calls, [['speakers', 'account']], 'pending repeated activation cannot duplicate the read');
    assert.equal(f.view.refresh.disabled, true);
    await settle();
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
