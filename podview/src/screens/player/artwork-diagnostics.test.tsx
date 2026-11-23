// The player's covers record a failed picture on the player's own transport (ported from
// tests/podview/canonical-field88-artwork-diagnostics: »actual PlayerView artwork call supplies its host owner«): one
// row with the failure's code, never the title or the image URL.
import assert from 'node:assert/strict';
import {act, render} from '@testing-library/react';
import {afterEach, test} from 'vitest';
import {Providers} from '../../app/Providers';
import {Artwork} from './Artwork';
import {bindPlayer, resetPlayer} from './store';

const realImage = globalThis.Image;
afterEach(() => {
  globalThis.Image = realImage;
  resetPlayer();
});

test('a failed player cover records one resource_error on the player transport, without private text', async () => {
  interface Probe {
    src?: string;
    onerror: (event: Event) => void;
  }
  const records: Record<string, unknown>[] = [], probes: Probe[] = [];
  globalThis.Image = class {
    onerror: (event: Event) => void = () => undefined;
    constructor() {
      probes.push(this);
    }
  } as unknown as typeof Image;
  bindPlayer({live: true, liveTransport: {recordDiagnostic: (stage, fields) => {
    records.push({stage, ...fields});
  }}});
  const view = render(
    <Providers>
      <Artwork id="cover" item={{uri: 'spotify:track:0123456789ABCDEFGHIJKL', title: 'Private title',
        artwork: {kind: 'album_cover', provider: 'spotify', url: 'https://i.scdn.co/image/private'}}} />
    </Providers>,
  );
  assert.equal(probes.length, 1);
  const probe = probes[0];
  if (!probe) throw Error('no cover was requested');
  assert.equal(probe.src, 'https://i.scdn.co/image/private');
  await act(async () => {
    probe.onerror(new Event('error'));
    await Promise.resolve();
  });
  assert.deepEqual(records, [{stage: 'artwork', code: 'resource_error'}]);
  const image = view.container.querySelector('#cover');
  assert.ok(image);
  assert.equal(image.getAttribute('src'), 'assets/icons/music-note-beamed.svg');
  assert.ok(image.classList.contains('live-art-fallback'));
});
