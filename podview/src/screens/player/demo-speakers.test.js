// The local preview's example speakers in the speaker sheet: the shell publishes them after each render
// (widget-view.js, publishDemoSpeakers) and SpeakerSheet.tsx draws them. Moved from
// tests/podview/root-speaker-selection-description.test.mjs (which ran the shell's row painter over fake rows) onto
// the real sheet: the shell's own publishing line runs against the real scene model. Same assertions: the chosen
// speaker says Valgt, the others keep their own description, an unchanged scene rewrites nothing, and an idle choice
// changes the description without changing IDs or inventing playback.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {act} from '@testing-library/react';
import {test} from 'vitest';
import {TARGETS, initialWidgetState, widgetTransition} from '../../../widget-model.js';
import {playerShell} from './player-fixture.js';
import {publishDemoSpeakers} from './SpeakerSheet';

// Read by path: the DOM's URL is not Node's.
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../widget-view.js'), 'utf8');
const start = source.indexOf(' if(!this.live)publishDemoSpeakers(');
const code = source.slice(start, source.indexOf('\n', start));

function fixture() {
  const {$} = playerShell({live: false});
  const publish = new Function('publishDemoSpeakers', 'TARGETS', 's', 'm', '$', code);
  const shell = {live: false, state: {music: {revision: 0}}, music() {}};
  let mutations = 0;
  new MutationObserver(records => {
    mutations += records.length;
  }).observe($('room-options'), {subtree: true, childList: true, characterData: true, attributes: true});
  return {
    render: music => act(() => {
      shell.state.music = music;
      publish.call(shell, publishDemoSpeakers, TARGETS, {connected: true}, music, $);
    }),
    rows: () => [...$('room-options').children],
    mutations: () => mutations,
  };
}
const detail = row => row.querySelector('small').textContent;

test('selected speaker says Valgt while other available rows remain Klar and unavailable description is retained',
  async () => {
    const f = fixture(), state = initialWidgetState();
    f.render(state);
    const [first, second, third] = f.rows();
    assert.equal(detail(first), 'HomePod · Valgt');
    assert.equal(first.getAttribute('aria-pressed'), 'true');
    assert.equal(detail(second), 'HomePod · Klar');
    assert.equal(detail(third), 'Ikke tilgængelig');
    await new Promise(resolve => setTimeout(resolve, 0));
    const before = f.mutations();
    f.render(state);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.mutations(), before, 'an unchanged scene rewrites nothing');
  });

test('actual idle speaker choice updates selected description without changing IDs or inventing playback', () => {
  const f = fixture(), state = initialWidgetState();
  state.playback.active = false;
  state.playback.playing = false;
  f.render(state);
  const next = widgetTransition(state, {type: 'target', ...TARGETS[1], revision: state.revision});
  f.render(next);
  const rows = f.rows();
  assert.equal(detail(rows[0]), 'HomePod · Klar');
  assert.equal(detail(rows[1]), 'HomePod · Valgt');
  assert.equal(rows[1].getAttribute('aria-pressed'), 'true');
  assert.equal(next.playback.active, false);
  assert.deepEqual(rows.map(row => row.dataset.targetId), TARGETS.map(row => row.targetId));
});
