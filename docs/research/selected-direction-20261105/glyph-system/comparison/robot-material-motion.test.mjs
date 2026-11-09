import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const owner = pathToFileURL('/Users/madsbachandersen/Developer/podvoice/podvoice/gatekeeper/static/podview/ui/robot-motion.js').href;
const candidate = (await readFile(new URL('./robot-material-motion.js', import.meta.url), 'utf8'))
    .replace("'/ui/robot-motion.js'", JSON.stringify(owner));
const { RobotMaterialMotion } = await import(`data:text/javascript;base64,${Buffer.from(candidate + '\n//# sourceURL=robot-material-motion-review.js').toString('base64')}`);

// Exercise lifecycle outcomes with the existing owner's injection seams. These
// fakes model visibility and cancellation, not CSS or browser painting.
function fixture(patch = {}) {
    let time = 100000, serial = 0, observer;
    const jobs = new Map(), layers = [];
    const document = new EventTarget();
    document.hidden = false;
    document.documentElement = { dataset: {}, clientWidth: 1280, clientHeight: 720 };
    const media = new EventTarget();
    media.matches = false;
    class Observer {
        constructor(callback) { this.callback = callback; observer = this; }
        observe() { this.active = true; }
        disconnect() { this.active = false; }
    }
    const device = { id: 'vacuum.review', status: 'cleaning', ...patch };
    const surface = {
        dataset: { target: device.id }, isConnected: true, visible: true, children: [],
        getClientRects() { return this.visible ? [{}] : []; },
        getBoundingClientRect() { return { left: 20, top: 20, right: 300, bottom: 200 }; },
        append(layer) { layer.isConnected = true; layer.parent = this; this.children.push(layer); },
        querySelector() { return icon; }
    };
    const icon = { closest() { return surface; } };
    document.createElement = () => {
        const layer = {
            dataset: {}, isConnected: false, calls: [], attributes: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            remove() { this.isConnected = false; this.parent.children = this.parent.children.filter(item => item !== this); },
            animate(frames, options) {
                let resolve;
                const animation = {
                    frames, options, cancelled: false,
                    finished: new Promise(done => { resolve = done; }),
                    cancel() { this.cancelled = true; resolve(); },
                    finish() { resolve(); }
                };
                this.calls.push(animation);
                return animation;
            }
        };
        layers.push(layer);
        return layer;
    };
    const host = {
        isConnected: true, live: false, dataset: {}, state: { connected: true, devices: [device], focus: 'now' },
        querySelectorAll(selector) { return selector.startsWith('.resource-preview') ? [surface] : []; }
    };
    const motion = new RobotMaterialMotion(host, {
        document, media, Observer, now: () => time,
        setTimer(fn, ms) { const id = ++serial; jobs.set(id, { fn, at: time + ms }); return id; },
        clearTimer(id) { jobs.delete(id); }
    });
    const advance = ms => {
        time += ms;
        for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); }
    };
    return { host, motion, document, media, device, surface, layers, jobs, advance, observer: () => observer };
}
const loops = f => f.layers.flatMap(layer => layer.calls).filter(animation => animation.options.iterations === Infinity);
const reveals = f => f.layers.flatMap(layer => layer.calls).filter(animation => animation.options.iterations !== Infinity);

test('one observed cleaning sweep survives repeated renders; pause settles it without moving state', () => {
    const f = fixture();
    try {
        f.motion.sync(); const sweep = loops(f)[0];
        f.motion.sync(); f.device.observedAt = 101; f.motion.sync();
        assert.equal(loops(f).length, 1); assert.equal(sweep.cancelled, false);
        assert.equal(reveals(f).length, 1);
        f.device.status = 'paused'; f.motion.sync();
        assert.equal(sweep.cancelled, true); assert.equal(f.motion.animations.size, 0);
        assert.equal(f.layers[0].dataset.phase, 'paused'); assert.equal(f.layers[0].dataset.motion, 'settled');
        assert.equal(f.device.status, 'paused');
        f.motion.sync(); assert.equal(reveals(f).length, 2, 'same paused observation must not restart transition');
    } finally { f.motion.cleanup(); }
});

test('pending, unknown, disconnected and missing authoritative source never claim cleaning activity', () => {
    for (const patch of [{ pending: { action: 'pause' } }, { status: 'unknown' }, { stale: true }, { live: true, observedAt: 100 }]) {
        const f = fixture(patch);
        try { f.motion.sync(); assert.equal(loops(f).length, 0, JSON.stringify(patch)); }
        finally { f.motion.cleanup(); }
    }
    const f = fixture();
    try { f.motion.sync(); f.host.state.connected = false; f.motion.sync(); assert.equal(loops(f)[0].cancelled, true); assert.equal(f.layers[0].dataset.phase, 'none'); }
    finally { f.motion.cleanup(); }
});

test('pending suppresses initial phase reveal and cancels an in-flight reveal without losing observed material', () => {
    const initial = fixture({ pending: { action: 'pause' } });
    try {
        initial.motion.sync();
        assert.equal(reveals(initial).length, 0);
        assert.equal(initial.layers[0].dataset.phase, 'cleaning');
        initial.device.pending = null;
        initial.motion.sync();
        assert.equal(reveals(initial).length, 0, 'settling pending must not replay an unchanged phase');
    } finally { initial.motion.cleanup(); }
    const active = fixture();
    try {
        active.motion.sync();
        const reveal = reveals(active)[0];
        active.device.pending = { action: 'pause' };
        active.motion.sync();
        assert.equal(reveal.cancelled, true);
        assert.equal(active.motion.transitions.size, 0);
        assert.equal(active.layers[0].dataset.phase, 'cleaning');
        assert.equal(active.layers[0].dataset.motion, 'settled');
        active.device.pending = null;
        active.motion.sync();
        assert.equal(reveals(active).length, 1, 'pending resolution must not restart the same reveal');
    } finally { active.motion.cleanup(); }
});

test('hidden/reduced cancels activity; returning resumes current sweep but never replays phase reveal', () => {
    for (const mode of ['hidden', 'reduced', 'surface']) {
        const f = fixture();
        try {
            f.motion.sync(); const first = loops(f)[0];
            if (mode === 'hidden') { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); }
            if (mode === 'reduced') { f.media.matches = true; f.media.dispatchEvent(new Event('change')); }
            if (mode === 'surface') { f.surface.visible = false; f.motion.sync(); }
            assert.equal(first.cancelled, true, mode); assert.equal(f.motion.animations.size, 0);
            assert.equal(f.motion.transitions.size, 0);
            f.document.hidden = false; f.media.matches = false; f.surface.visible = true; f.motion.sync();
            assert.equal(loops(f).length, 2); assert.equal(reveals(f).length, 1, `${mode}: no deferred phase cue`);
        } finally { f.motion.cleanup(); }
    }
});

test('root and host reduced-motion contracts both suppress material motion', () => {
    for (const scope of ['host', 'root']) {
        const f = fixture();
        try {
            (scope === 'host' ? f.host : f.document.documentElement).dataset.motion = 'reduced';
            f.motion.sync(); assert.equal(loops(f).length, 0, scope); assert.equal(reveals(f).length, 0, scope);
        } finally { f.motion.cleanup(); }
    }
});

test('an explicit live-source observation expires without needing another snapshot', () => {
    const f = fixture({ live: true, source: 'home_assistant_state', observedAt: 100 });
    try {
        f.motion.sync(); assert.equal(loops(f).length, 1);
        f.advance(90001);
        assert.equal(loops(f)[0].cancelled, true, 'freshness expiry must stop a running sweep autonomously');
        assert.equal(f.motion.animations.size, 0);
    } finally { f.motion.cleanup(); }
});

test('unmount cancels all owned effects and removes decorative layers/listeners', () => {
    const f = fixture();
    f.motion.sync(); const animations = f.layers[0].calls.slice();
    f.host.isConnected = false; f.observer().callback();
    assert(animations.every(animation => animation.cancelled));
    assert.equal(f.surface.children.length, 0); assert.equal(f.surface.dataset.materialOwner, undefined);
    assert.equal(f.motion.animations.size, 0); assert.equal(f.motion.transitions.size, 0);
    assert.equal(f.motion.attached, false); assert.equal(f.observer().active, false); assert.equal(f.jobs.size, 0);
    f.media.dispatchEvent(new Event('change')); assert.equal(f.layers.length, 1);
});

test('a previously queued freshness callback cannot reattach an owner after cleanup', () => {
    const f = fixture({ live: true, source: 'home_assistant_state', observedAt: 100 });
    f.motion.sync();
    const queued = [...f.jobs.values()][0].fn;
    f.motion.cleanup();
    queued();
    assert.equal(f.motion.attached, false, 'a cancelled expiry callback must not revive presentation');
    assert.equal(f.surface.children.length, 0);
    assert.equal(f.layers.length, 1);
    assert.equal(f.motion.animations.size, 0);
    f.motion.cleanup();
});

test('scrolling the material out of the viewport stops sweep even if it retains a layout box', () => {
    const f = fixture();
    try {
        f.motion.sync();
        f.surface.getBoundingClientRect = () => ({ left: 20, right: 300, top: 800, bottom: 980 });
        f.document.dispatchEvent(new Event('scroll'));
        assert.equal(loops(f)[0].cancelled, true);
        assert.equal(f.motion.animations.size, 0);
    } finally { f.motion.cleanup(); }
});

test('completion of an interrupted reveal cannot delete the newer phase transition', async () => {
    const f = fixture();
    try {
        f.motion.sync();
        f.device.status = 'paused'; f.motion.sync();
        const latest = reveals(f).at(-1);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        assert.equal(f.motion.transitions.get(f.surface), latest);
        latest.finish();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        assert.equal(f.motion.transitions.size, 0);
    } finally { f.motion.cleanup(); }
});
