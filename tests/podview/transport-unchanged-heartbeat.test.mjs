// The server repeats an unchanged snapshot every second as a liveness heartbeat (only observedAt
// moves). Re-rendering the whole screen for each one blocked taps for ~1 s on a Frameo frame.
// The heartbeat must keep the connection fresh without redrawing unchanged content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PodVoiceTransport } from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';

const snapshot = (patch = {}) => ({
  schema: 'podview.snapshot.v1',
  bootId: 'boot',
  revision: 3,
  roomId: 'r0',
  voice: { active: false },
  timers: { status: 'observed', items: [] },
  capabilities: { musicRead: ['targets'], timerActions: [] },
  observedAt: 1000,
  ...patch,
});

async function fixture() {
  const calls = [];
  const transport = new PodVoiceTransport({
    url: 'https://inert.invalid/view/',
    fetch: async () => ({ ok: true, status: 200, json: async () => snapshot() }),
    EventSource: class {
      addEventListener() {}
      close() {}
    },
    onSnapshot: () => calls.push('snapshot'),
    onConnection: (state) => calls.push(`connection:${state}`),
    onHeartbeat: (value) => calls.push(`heartbeat:${value.observedAt}`),
  });
  await transport.start();
  calls.length = 0;
  return { transport, calls };
}

async function withClock(fn) {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    return await fn({ advance: (ms) => (now += ms), now: () => now });
  } finally {
    Date.now = realNow;
  }
}

test('an unchanged heartbeat keeps live reads polling but does not redraw the screen', () =>
  withClock(async (clock) => {
    const { transport, calls } = await fixture();
    try {
      for (let second = 1; second <= 5; second++) {
        clock.advance(1000);
        assert.equal(transport.accept(snapshot({ observedAt: 1000 + second }), clock.now()), true);
      }
      // Music, radio, answer and home reads still poll on the heartbeat; only the redraw is skipped.
      assert.deepEqual(calls, ['heartbeat:1001', 'heartbeat:1002', 'heartbeat:1003', 'heartbeat:1004', 'heartbeat:1005']);
      assert.equal(transport.snapshot.observedAt, 1005, 'the newest observation is still kept');
      assert.equal(transport.acceptedReadAt, clock.now(), 'freshness follows the heartbeat');
    } finally {
      transport.close();
    }
  }));

test('a real change is presented immediately', () =>
  withClock(async (clock) => {
    const { transport, calls } = await fixture();
    try {
      clock.advance(1000);
      transport.accept(snapshot({ revision: 4, observedAt: 1001 }), clock.now());
      clock.advance(1000);
      transport.accept(snapshot({ revision: 4, observedAt: 1002, voice: { active: true } }), clock.now());
      assert.deepEqual(calls, ['connection:connected', 'snapshot', 'connection:connected', 'snapshot']);
    } finally {
      transport.close();
    }
  }));

test('unchanged heartbeats still redraw every 10 s so time-based labels age', () =>
  withClock(async (clock) => {
    const { transport, calls } = await fixture();
    try {
      for (let second = 1; second <= 10; second++) {
        clock.advance(1000);
        transport.accept(snapshot({ observedAt: 1000 + second }), clock.now());
      }
      assert.equal(calls.filter((call) => call === 'snapshot').length, 1);
    } finally {
      transport.close();
    }
  }));

test('the first heartbeat after a disconnect is presented', () =>
  withClock(async (clock) => {
    const { transport, calls } = await fixture();
    try {
      transport.connected = false;
      clock.advance(1000);
      transport.accept(snapshot({ observedAt: 1001 }), clock.now());
      assert.deepEqual(calls, ['connection:connected', 'snapshot']);
    } finally {
      transport.close();
    }
  }));
