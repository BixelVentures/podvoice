// crypto.randomUUID() only exists in secure contexts (HTTPS/localhost). A wall screen that opens
// Home Assistant over plain http://homeassistant.lan:8123 threw on every music, robot and control
// action ("crypto.randomUUID is not a function"). Request ids must work there too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, supplyRandomUUID } from '../../podvoice/gatekeeper/static/podview/ui/request-id.js';

const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const insecureCrypto = {
  getRandomValues: (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 255;
    return bytes;
  },
};

test('an insecure page (no randomUUID) still gets a valid v4 request id', () => {
  const id = randomUUID(insecureCrypto);
  assert.match(id, UUID_V4);
});

test('a secure page keeps using the native randomUUID', () => {
  assert.equal(randomUUID({ randomUUID: () => 'native-id', getRandomValues: insecureCrypto.getRandomValues }),
    'native-id');
});

test('without any crypto there is no id, so callers keep their existing refusal', () => {
  assert.equal(randomUUID(null), undefined);
});

test('a plain-HTTP page gets crypto.randomUUID before any action runs', async () => {
  const pageCrypto = { getRandomValues: insecureCrypto.getRandomValues };
  supplyRandomUUID(pageCrypto);
  assert.match(pageCrypto.randomUUID(), UUID_V4);
  const native = { randomUUID: () => 'native-id', getRandomValues: insecureCrypto.getRandomValues };
  supplyRandomUUID(native);
  assert.equal(native.randomUUID(), 'native-id', 'a secure page keeps its own randomUUID');
  const entry = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url), 'utf8');
  assert.match(entry.split('\n').find((line) => line.startsWith('import ')), /ui\/request-id\.js/,
    'the polyfill is the screen entry\'s first import');
});
