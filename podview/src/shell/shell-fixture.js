// The whole PodView page in happy-dom for the shell's Vitest suites: the React shell (src/shell) mounted into the
// body and the real host (widget-view.js, pv-widget-host) started on it, at a preview stage (`/?stage=…`) or as the
// live page (`/view/`). The live page gets no server: fetch never answers and there is no EventSource, so the host
// stays »connecting« until a test sets its transport, status and snapshot itself.
import {beforeAll, vi} from 'vitest';
import {mountShell, unmountShell} from './mount.tsx';

class QuietAnimation {
  constructor() {
    this.playState = 'running';
    this.finished = new Promise(resolve => {
      this.settle = resolve;
    });
    this.effect = {getComputedTiming: () => ({progress: 1})};
    setTimeout(() => this.finish(), 1);
  }
  finish() {
    this.playState = 'finished';
    this.settle(this);
    this.onfinish?.({});
  }
  cancel() {
    this.playState = 'idle';
    this.settle(this);
  }
  addEventListener() {}
  removeEventListener() {}
  commitStyles() {}
  persist() {}
  pause() {}
  play() {}
  reverse() {}
  updatePlaybackRate() {}
}

let defined = false;

// The host and every screen are imported once per suite, before its first test (a cold import takes seconds).
beforeAll(async () => {
  await import('../../widget-view.js');
  defined = true;
}, 60000);

// Reduced motion and animations that end at once: page and Ro layers land in a few milliseconds.
function quietMotion() {
  window.matchMedia = query => ({
    matches: /reduce/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  Element.prototype.animate = function () {
    return new QuietAnimation();
  };
}

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Mounts the page at `path` and returns the started host. `before(window)` runs before the host starts.
export async function mountPage(path = '/?stage=now', {before} = {}) {
  unmountPage();
  quietMotion();
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  vi.stubGlobal('EventSource', undefined);
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  document.body.replaceChildren();
  window.history.replaceState(null, '', path);
  before?.(window);
  if (!defined) {
    await import('../../widget-view.js');
    defined = true;
  }
  const store = mountShell(document);
  const host = document.querySelector('pv-widget-host');
  return {host, store, $: id => document.getElementById(id)};
}

// A test's stand-in transport may lack close(): the host closes its transport first when it leaves the document,
// and a throw there would skip the rest of its cleanup (timers, observers) and leak into the next test.
export function unmountPage() {
  for (const host of document.querySelectorAll('pv-widget-host')) {
    const transport = host.liveTransport;
    if (transport && typeof transport.close !== 'function') transport.close = () => {};
  }
  unmountShell(document);
  forgetDetachedIds();
  vi.unstubAllGlobals();
}

// happy-dom can keep a removed live page in its id index (the removed host still reports isConnected), so
// getElementById would return the previous page's node. A browser's never does: keep only nodes under the document.
function forgetDetachedIds() {
  const key = Object.getOwnPropertySymbols(document).find(symbol => symbol.description === 'elementIdMap');
  const map = key && document[key];
  if (!map) return;
  for (const [id, entry] of map) {
    entry.elements = entry.elements.filter(element => {
      let node = element;
      while (node.parentNode) node = node.parentNode;
      return node === document;
    });
    if (!entry.elements.length) map.delete(id);
  }
}
