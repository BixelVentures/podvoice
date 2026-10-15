import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {beginIngressKiosk} from '../../podvoice/gatekeeper/static/podview/ingress-kiosk.js';

const origin = 'https://ha.example';

function frame(pathname = '/app/local_podvoice', ingressPage = '') {
  const sent = [], listeners = new Map(), replacements = [];
  const parent = {
    location: {origin, pathname},
    postMessage(message, targetOrigin) { sent.push({message, targetOrigin}); },
  };
  const win = {
    parent,
    location: {
      origin,
      href: `${origin}/api/hassio_ingress/session123/${ingressPage}`,
      replace(url) { replacements.push(url); },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  return {
    win, parent, sent, replacements,
    emit(type, event) { listeners.get(type)?.(event); },
  };
}

function properties(f, path, source = f.parent, eventOrigin = origin) {
  f.emit('message', {
    source, origin: eventOrigin,
    data: {type: 'home-assistant/properties', route: {path}},
  });
}

test('PodView requests kiosk only from its same-origin HA parent and releases it on route exit', () => {
  const f = frame('/app/local_podvoice/view', 'view/');
  const stop = beginIngressKiosk(f.win);
  assert.deepEqual(f.sent, [{message: {type: 'home-assistant/subscribe-properties', kioskMode: true}, targetOrigin: origin}]);
  properties(f, '', {}, origin);
  properties(f, '', f.parent, 'https://other.example');
  properties(f, ''); // Direct legacy ingress navigation has no outer route binding.
  assert.equal(f.replacements.length, 0);
  properties(f, '/view');
  assert.equal(f.replacements.length, 0);
  properties(f, '');
  assert.deepEqual(f.sent.at(-1), {message: {type: 'home-assistant/unsubscribe-properties'}, targetOrigin: origin});
  assert.deepEqual(f.replacements, [`${origin}/api/hassio_ingress/session123/`]);
  f.emit('pagehide', {});
  assert.equal(f.sent.length, 2);
  stop();
});

test('restored PodView resubscribes; standalone and foreign-origin frames never request kiosk', () => {
  const f = frame('/app/local_podvoice/view', 'view/');
  beginIngressKiosk(f.win);
  f.emit('pagehide', {});
  f.emit('pageshow', {persisted: true});
  assert.deepEqual(f.sent.map(row => row.message.type), [
    'home-assistant/subscribe-properties',
    'home-assistant/unsubscribe-properties',
    'home-assistant/subscribe-properties',
  ]);
  properties(f, '/view');
  properties(f, '');
  f.emit('pageshow', {persisted: true});
  assert.equal(f.sent.at(-1).message.type, 'home-assistant/subscribe-properties');
  const standalone = frame();
  standalone.win.parent = standalone.win;
  beginIngressKiosk(standalone.win);
  assert.equal(standalone.sent.length, 0);
  const foreign = frame();
  foreign.parent.location.origin = 'https://other.example';
  beginIngressKiosk(foreign.win);
  assert.equal(foreign.sent.length, 0);
});

function rootPanel(f) {
  const html = readFileSync(new URL('../../podvoice/gatekeeper/static/index.html', import.meta.url), 'utf8');
  const marker = '<script>\n"use strict";\n// Keep the HA app URL stable';
  const start = html.indexOf(marker);
  assert.ok(start >= 0);
  const end = html.indexOf('</script>', start);
  const script = html.slice(start + '<script>'.length, end);
  let click;
  const link = {addEventListener(type, handler) { if (type === 'click') click = handler; }};
  vm.runInNewContext(script, {
    window: f.win,
    document: {querySelector(selector) { return selector === '.podview-link' ? link : null; }},
    URL,
  });
  return {click: event => click(event)};
}

test('panel link navigates the stable outer app route and reload resolves that route into the same ingress iframe', () => {
  const f = frame('/app/local_podvoice');
  const panel = rootPanel(f);
  assert.deepEqual(f.sent.map(row => row.message.type), [
    'home-assistant/unsubscribe-properties',
    'home-assistant/subscribe-properties',
  ]);
  let prevented = false;
  panel.click({button: 0, preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(f.sent.at(-1).message.type, 'home-assistant/navigate');
  assert.equal(f.sent.at(-1).message.path, '/app/local_podvoice/view');
  assert.equal(f.sent.at(-1).targetOrigin, origin);
  properties(f, '/view', {}, origin);
  properties(f, '/view', f.parent, 'https://other.example');
  assert.equal(f.replacements.length, 0);
  properties(f, '/view');
  assert.deepEqual(f.replacements, [`${origin}/api/hassio_ingress/session123/view/`]);
  f.emit('pagehide', {});
  assert.equal(f.sent.at(-1).message.type, 'home-assistant/unsubscribe-properties');
});

test('restored root panel re-subscribes, rejects hidden/foreign messages and routes once again', () => {
  const f = frame('/app/local_podvoice');
  rootPanel(f);
  properties(f, '/view');
  assert.equal(f.replacements.length, 1);
  f.emit('pagehide', {});
  const hiddenSent = f.sent.length;
  properties(f, '/view');
  assert.equal(f.replacements.length, 1);
  f.emit('pagehide', {});
  assert.equal(f.sent.length, hiddenSent);
  f.emit('pageshow', {persisted: true});
  assert.deepEqual(f.sent.slice(-2).map(row => row.message.type), [
    'home-assistant/unsubscribe-properties', 'home-assistant/subscribe-properties',
  ]);
  properties(f, '/view', {}, origin);
  properties(f, '/view', f.parent, 'https://other.example');
  assert.equal(f.replacements.length, 1);
  properties(f, '/view');
  properties(f, '/view/');
  assert.equal(f.replacements.length, 2);
  assert.equal(f.replacements[1], `${origin}/api/hassio_ingress/session123/view/`);
  assert.ok(f.sent.every(row => row.targetOrigin === origin));
});

test('root lifecycle attaches once and ordinary pageshow never duplicates its subscription', () => {
  const f = frame('/app/local_podvoice');
  const first = rootPanel(f);
  rootPanel(f);
  assert.equal(f.sent.length, 2);
  f.emit('pageshow', {persisted: false});
  assert.equal(f.sent.length, 2);
  let prevented = false;
  first.click({button: 0, preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  properties(f, '/view');
  assert.equal(f.replacements.length, 1);
  f.emit('pagehide', {});
  assert.equal(f.sent.at(-1).message.type, 'home-assistant/unsubscribe-properties');
});
