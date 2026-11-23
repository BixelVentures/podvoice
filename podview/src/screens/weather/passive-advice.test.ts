// The passive AI weather advice (advice-store.ts, driven by the weather page). Ported from
// tests/podview/root-weather-passive-lifecycle.test.mjs (LiveWeatherAdvice): same scenarios and assertions; the
// rig's `sync()` is the page's reconcile + projection, and the transport stub is a registered PodVoiceApi.
import assert from 'node:assert/strict';
import {http, HttpResponse} from 'msw';
import {afterEach, beforeEach, test, vi} from 'vitest';
import {connectApi, fetchApi, offlineApi} from '../../lib/api/client';
import type {WeatherAdviceBinding} from '../../lib/api/client';
import type {Snapshot} from '../../lib/api/schemas';
import {connectShell} from '../../lib/store/shell';
import {API, PAGE_URL, server, listenToApi} from '../../test/msw';
import {adviceProjection, invalidateAdvice, reconcileAdvice, resetWeatherAdvice} from './advice-store.ts';
import type {PassiveAdvice} from './advice-store.ts';
import type {WeatherObservation} from './observation.ts';
import {weatherObservation} from './observation.ts';
import {adviceContext} from './useWeather.ts';
import type {Link} from './useWeather.ts';
import {liveWeatherModel} from './view-model.ts';

const origin = Date.parse('2026-10-23T10:00:00Z');
const scope = {bootId: 'boot', roomId: 'room'};

interface Deferred {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

listenToApi();

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
});
afterEach(() => {
  resetWeatherAdvice();
  vi.useRealTimers();
});

function rig() {
  let time = origin;
  let visible = true;
  const calls: {binding: WeatherAdviceBinding; signal: AbortSignal | undefined}[] = [];
  const deferred: Deferred[] = [];
  const raw = {
    source: 'Met.no',
    location: 'hjemmet',
    retrievedAt: new Date(origin).toISOString(),
    observedAt: origin / 1000,
    units: {temperature: '°C', precipitation: 'mm', windSpeed: 'km/h'},
    current: {temperature: 12, condition: 'cloudy'},
    forecastType: 'hourly',
    forecast: [{datetime: new Date(origin + 3600000).toISOString(), temperature: 13, precipitation: 0}],
  };
  const cap = {
    schema: 'podview.weather-advice-capability.v1',
    ...scope,
    weatherKey: 'a'.repeat(64),
    source: raw.source,
    sourceRetrievedAt: origin / 1000,
    availability: 'available',
    status: 'idle',
    validUntil: origin / 1000 + 60,
  };
  const state = {
    focus: 'now',
    liveWeather: weatherObservation(raw),
    weatherAdvice: cap as Record<string, unknown>,
    homeScope: JSON.stringify([scope.bootId, scope.roomId]),
  };
  const host = {
    state,
    snapshot: {...scope, capabilities: {timerActions: [], homeRead: ['weather']}} as unknown as Snapshot,
    connection: {mode: 'live', status: 'connected', connected: true, blocked: false, sessionExpired: false,
      browserOffline: false} as Link,
    isConnected: true,
    reads: 0,
    onRead: undefined as (() => void) | undefined,
  };
  connectApi({
    ...offlineApi,
    timerAction: () => Promise.reject(new Error('unused')),
    weatherAdvice: (binding, {signal}) => {
      calls.push({binding, signal});
      return new Promise((resolve, reject) => deferred.push({resolve, reject}));
    },
  });
  connectShell({
    loadHome: () => {
      host.reads++;
      host.onRead?.();
    },
  });
  const context = () =>
    host.isConnected
      ? adviceContext(
          {kind: 'live', weather: state.liveWeather, readStatus: null, readScope: null, scope: state.homeScope,
            adviceCapability: state.weatherAdvice},
          host.snapshot,
          host.connection,
          state.focus === 'weather',
          visible,
          time,
        )
      : null;
  // What the page does on each render: start what the binding needs, then show its projection.
  const sync = (): PassiveAdvice | null => {
    const value = context();
    reconcileAdvice(value, () => time);
    return adviceProjection(value, time);
  };
  const dto = (status = 'pending', key = state.weatherAdvice.weatherKey) => ({
    schema: 'podview.passive-weather-advice.v1',
    ...scope,
    weatherKey: key,
    requestId: 'b'.repeat(32),
    source: raw.source,
    sourceRetrievedAt: Date.parse(raw.retrievedAt) / 1000,
    validUntil: origin / 1000 + 60,
    status,
    summaryKind: 'ai_advice',
    summary: status === 'ready' ? 'Tag jakken med – skyerne bliver hængende.' : null,
    evidenceFactIds: status === 'ready' ? ['current:temperature'] : [],
  });
  return {
    host,
    state,
    calls,
    deferred,
    cap,
    dto,
    sync,
    timers: () => vi.getTimerCount(),
    hide() {
      visible = false;
    },
    model() {
      const p = sync();
      return liveWeatherModel(state.liveWeather, {now: time, passiveContext: p?.context ?? null,
        passiveAdvice: p?.advice, passiveStatus: p?.status});
    },
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
    },
    async tick(ms = 1000) {
      time += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

test('held POST shows the pending slot without polling; server admission alone starts completion reads', async () => {
  const h = rig();
  assert.equal(h.sync(), null);
  assert.equal(h.calls.length, 0);
  h.state.focus = 'weather';
  assert.equal(h.sync()?.status, 'requesting');
  assert.equal(h.model().summaryState, 'pending');
  assert.equal(h.model().summary, '');
  assert.equal(h.calls.length, 1);
  for (let i = 0; i < 5; i++) h.sync();
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers(), 0);
  await h.tick(2500);
  assert.equal(h.host.reads, 0);
  assert.equal(h.timers(), 0);
  assert.equal(h.state.weatherAdvice.status, 'idle');
  assert.equal(h.model().summaryState, 'pending');
  h.deferred[0]?.resolve(h.dto());
  await h.settle();
  assert.equal(h.model().summaryState, 'pending');
  assert.equal(h.model().summary, '');
  assert.equal(h.model().current?.temperature, '12°');
  assert.equal(h.model().hours[0]?.rain, '');
  assert.equal(h.timers(), 1);
  h.host.onRead = () => {
    h.state.weatherAdvice = {...h.cap, status: 'ready'};
    h.state.liveWeather = {...h.state.liveWeather, passiveAdvice: h.dto('ready')} as WeatherObservation;
  };
  await h.tick();
  assert.equal(h.host.reads, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.model().summary, h.dto('ready').summary);
  assert.equal(h.model().summaryState, 'ready');
  assert.equal(h.timers(), 0);
});

test('navigation aborts local work, ignores late result and never repeats paid POST on return or cleanup', async () => {
  const h = rig();
  h.state.focus = 'weather';
  h.sync();
  h.state.focus = 'now';
  h.sync();
  assert.equal(h.calls[0]?.signal?.aborted, true);
  h.deferred[0]?.resolve(h.dto('ready'));
  await h.settle();
  assert.equal(h.sync(), null);
  h.state.focus = 'weather';
  assert.equal(h.model().summaryState, 'unavailable');
  assert.equal(h.calls.length, 1);
  await h.tick();
  assert.equal(h.host.reads, 1);
  invalidateAdvice();
  h.sync();
  assert.equal(h.calls.length, 1);
  invalidateAdvice();
});

test('same-key changed source, boot, room, access and visibility cannot publish a late receipt', async () => {
  const changes: ((h: ReturnType<typeof rig>) => void)[] = [
    h => {
      h.state.liveWeather = {...h.state.liveWeather, current: {temperature: 30, condition: 'sunny'}};
    },
    h => {
      h.host.snapshot = {...h.host.snapshot, bootId: 'new'};
    },
    h => {
      h.host.snapshot = {...h.host.snapshot, roomId: 'other'};
    },
    h => {
      h.host.snapshot = {...h.host.snapshot, capabilities: {timerActions: [], homeRead: []}};
    },
    h => {
      h.host.connection = {...h.host.connection, connected: false};
    },
    h => {
      h.hide();
    },
    h => {
      h.host.isConnected = false;
    },
  ];
  for (const change of changes) {
    const h = rig();
    h.state.focus = 'weather';
    h.sync();
    change(h);
    h.sync();
    h.deferred[0]?.resolve(h.dto('ready'));
    await h.settle();
    assert.notEqual(h.model().summary, h.dto('ready').summary);
    assert.equal(h.calls.length, 1);
    resetWeatherAdvice();
  }
});

test('new admitted key can request once while wrong key or request identity never replaces its weather', async () => {
  const h = rig();
  h.state.focus = 'weather';
  h.sync();
  h.deferred[0]?.resolve(h.dto('ready', 'f'.repeat(64)));
  await h.settle();
  assert.equal(h.model().summaryState, 'unavailable');
  assert.equal(h.model().current?.temperature, '12°');
  h.sync();
  assert.equal(h.calls.length, 1);
  h.state.weatherAdvice = {...h.cap, weatherKey: 'c'.repeat(64)};
  h.sync();
  assert.equal(h.calls.length, 2);
  h.deferred[1]?.resolve(h.dto());
  await h.settle();
  h.state.liveWeather = {...h.state.liveWeather,
    passiveAdvice: {...h.dto('ready'), requestId: 'd'.repeat(32)}} as WeatherObservation;
  assert.equal(h.model().summaryState, 'unavailable');
});

test('read-only pending recovery is bounded and unavailable capability cannot generate or display old prose',
  async () => {
    const h = rig();
    h.state.focus = 'weather';
    h.state.weatherAdvice = {...h.cap, status: 'pending'};
    assert.equal(h.model().summaryState, 'pending');
    assert.equal(h.calls.length, 0);
    for (let i = 0; i < 9; i++) {
      await h.tick();
      h.sync();
    }
    assert.equal(h.host.reads, 8);
    assert.equal(h.model().summaryState, 'unavailable');
    assert.equal(h.timers(), 0);
    assert.equal(h.model().current?.temperature, '12°');
    h.state.weatherAdvice = {...h.cap, availability: 'unavailable', status: 'unavailable'};
    h.state.liveWeather = {...h.state.liveWeather, passiveAdvice: h.dto('ready')} as WeatherObservation;
    assert.equal(h.model().summaryState, 'unavailable');
    assert.equal(h.model().summary, 'Vejrrådet er ikke tilgængeligt lige nu.');
    assert.equal(h.calls.length, 0);
  });

test('POST failure remains honest and never retries; stale binding refreshes only home', async () => {
  for (const code of [undefined, 'stale_weather_binding', 'read_access_denied']) {
    const h = rig();
    h.state.focus = 'weather';
    assert.equal(h.model().summaryState, 'pending');
    assert.equal(h.timers(), 0);
    assert.equal(h.host.reads, 0);
    h.deferred[0]?.reject(Object.assign(Error('unavailable'), {code}));
    await h.settle();
    assert.equal(h.model().summaryState, 'unavailable');
    assert.equal(h.model().summary, 'Vejrrådet er ikke tilgængeligt lige nu.');
    assert.equal(h.host.reads, code === undefined ? 0 : 1);
    h.sync();
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers(), 0);
    resetWeatherAdvice();
  }
});

test('a pending answer polls home after one second, then shows the completed advice once', async () => {
  const h = rig();
  h.state.focus = 'weather';
  assert.equal(h.sync()?.status, 'requesting');
  h.deferred[0]?.resolve(h.dto());
  await h.settle();
  assert.equal(h.sync()?.status, 'pending');
  assert.equal(h.timers(), 1);
  h.host.onRead = () => {
    h.state.weatherAdvice = {...h.cap, status: 'ready'};
    h.state.liveWeather = {...h.state.liveWeather, passiveAdvice: h.dto('ready')} as WeatherObservation;
  };
  await h.tick(999);
  assert.equal(h.host.reads, 0);
  await h.tick(1);
  assert.equal(h.host.reads, 1);
  assert.equal(h.sync()?.status, 'ready');
  assert.equal(h.timers(), 0);
  assert.equal(h.calls.length, 1);
});

test('ready capability without a valid completion receipt stays honest and cannot leave a blank ready claim',
  () => {
    for (const receipt of [null, {invalid: true}]) {
      const h = rig();
      h.state.focus = 'weather';
      h.state.weatherAdvice = {...h.cap, status: 'ready'};
      h.state.liveWeather = {...h.state.liveWeather, passiveAdvice: receipt} as unknown as WeatherObservation;
      const model = h.model();
      assert.equal(model.summaryState, 'unavailable');
      assert.equal(model.summary, 'Vejrrådet er ikke tilgængeligt lige nu.');
      assert.equal(model.current?.temperature, '12°');
      assert.equal(h.calls.length, 0);
      assert.equal(h.timers(), 0);
      resetWeatherAdvice();
    }
  });

// The wire: one POST to …/view/api/weather-advice with the binding; a 409 means the binding is stale.
test('the API client posts the binding once and names a stale binding', async () => {
  vi.useRealTimers();
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API}/weather-advice`, async ({request}) => {
      bodies.push({room: new URL(request.url).searchParams.get('room'), header: request.headers.get('X-PodView-Request'),
        body: await request.json()});
      return bodies.length === 1 ? HttpResponse.json({ok: true}) : new HttpResponse(null, {status: 409});
    }),
  );
  const api = fetchApi({pageUrl: PAGE_URL, snapshot: () => null});
  const binding = {availability: 'available', bootId: 'boot', roomId: 'room', weatherKey: 'a'.repeat(64)};
  assert.deepEqual(await api.weatherAdvice(binding, {}), {ok: true});
  await assert.rejects(api.weatherAdvice(binding, {}), (error: {code?: string}) => error.code === 'stale_weather_binding');
  assert.deepEqual(bodies[0], {room: 'room', header: '1', body: {bootId: 'boot', roomId: 'room', weatherKey: 'a'.repeat(64)}});
});
