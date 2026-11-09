import { RobotMotion, robotIsCleaning } from '/ui/robot-motion.js';

// A local presentation variant of the existing RobotMotion owner. It reads the
// same device observations and never dispatches commands or advances progress.
export class RobotMaterialMotion extends RobotMotion {
    constructor(host, options) {
        super(host, options);
        this.transitions = new Map();
        this.materials = new Map();
    }

    attach() {
        if (this.attached) return;
        super.attach();
        this.document?.addEventListener('scroll', this.onChange, true);
    }

    candidates() {
        const candidates = super.candidates();
        // RobotControlPanel owns the visible detail observation; its data model
        // has no resource context, so resolve through that existing owner.
        for (const panel of this.host.querySelectorAll('pv-robot-control-panel')) {
            candidates.push({ icon: panel.observation?.querySelector('.pv-instrument img'), device: panel.value?.device });
        }
        return candidates;
    }

    sync() {
        if (!this.host.isConnected) { this.cleanup(); return; }
        this.attach();
        const reduced = this.media?.matches || this.host.dataset.motion === 'reduced' || this.document?.documentElement?.dataset.motion === 'reduced';
        const visible = !this.document?.hidden;
        const connected = this.host.state?.connected !== false;
        const wanted = new Set();
        const nextStates = new Map();
        const now = this.now();
        let expiryAt = null;
        for (const { icon, device } of this.candidates()) {
            const surface = icon?.closest('.resource-preview[data-kind="vacuum"], pv-vacuum-widget');
            if (!surface || !device || wanted.has(surface)) continue;
            wanted.add(surface);
            const status = device.status;
            const known = connected && !device.stale && !device.hidden &&
                !['unknown', 'unavailable', 'error', 'offline'].includes(status);
            const phase = known && ['docked', 'cleaning', 'paused', 'returning', 'docking'].includes(status) ? status : 'none';
            const previous = this.materials.get(surface);
            let layer = previous?.layer;
            if (!layer?.isConnected) {
                layer = this.document.createElement('span');
                layer.className = 'pv-robot-material';
                layer.setAttribute('aria-hidden', 'true');
                surface.append(layer);
                surface.dataset.materialOwner = 'robot-motion';
            }
            const changed = previous?.phase !== phase;
            if (layer.dataset.phase !== phase) layer.dataset.phase = phase;
            const rect = surface.getBoundingClientRect();
            const viewport = this.document.documentElement;
            const onScreen = visible && !!surface.getClientRects().length && rect.bottom > 0 && rect.right > 0 && rect.top < viewport.clientHeight && rect.left < viewport.clientWidth;
            if (changed) {
                this.transitions.get(surface)?.cancel();
                this.transitions.delete(surface);
                if (onScreen && !reduced && !device.pending && phase !== 'none') {
                    const frames = phase === 'paused'
                        ? [{ opacity: .85 }, { opacity: .6 }]
                        : [{ opacity: .55 }, { opacity: 1 }];
                    const reveal = layer.animate(frames, { duration: phase === 'paused' ? 240 : 620, easing: 'cubic-bezier(.2,.75,.2,1)' });
                    reveal.id = 'pv-robot-material-phase';
                    this.transitions.set(surface, reveal);
                    reveal.finished.catch(() => {}).finally(() => {
                        if (this.transitions.get(surface) === reveal) this.transitions.delete(surface);
                    });
                }
            }
            if ((!onScreen || reduced || device.pending || phase === 'none') && this.transitions.has(surface)) {
                this.transitions.get(surface).cancel(); this.transitions.delete(surface);
            }
            const running = onScreen && !reduced && robotIsCleaning(device, { connected, live: false, now });
            if (running && !this.animations.has(layer)) {
                const sweep = layer.animate([
                    { backgroundPosition: '150% 0' },
                    { backgroundPosition: '-150% 0' }
                ], { duration: 2800, iterations: Infinity, easing: 'linear' });
                sweep.id = 'pv-robot-material-cleaning';
                this.animations.set(layer, sweep);
            } else if (!running && this.animations.has(layer)) {
                this.animations.get(layer).cancel(); this.animations.delete(layer);
            }
            if (running && device.live) {
                const expires = device.observedAt * 1000 + 90001;
                expiryAt = expiryAt === null ? expires : Math.min(expiryAt, expires);
            }
            const motion = running ? 'cleaning' : 'settled';
            if (layer.dataset.motion !== motion) layer.dataset.motion = motion;
            this.materials.set(surface, { layer, phase });
            nextStates.set(device.id, status);
        }
        for (const [surface, { layer }] of this.materials) if (!wanted.has(surface)) {
            this.animations.get(layer)?.cancel(); this.animations.delete(layer);
            this.transitions.get(surface)?.cancel(); this.transitions.delete(surface);
            layer.remove(); delete surface.dataset.materialOwner; this.materials.delete(surface);
        }
        this.states = nextStates;
        if (this.expiryAt !== expiryAt) {
            this.clearExpiry();
            if (expiryAt !== null) {
                this.expiryAt = expiryAt;
                let handle;
                handle = this.setTimer(() => { if (this.expiryTimer !== handle) return; this.expiryTimer = null; this.expiryAt = null; this.sync(); }, Math.max(1, expiryAt - now));
                this.expiryTimer = handle;
                this.expiryTimer?.unref?.();
            }
        }
    }

    cleanup() {
        for (const transition of this.transitions.values()) transition.cancel();
        this.transitions.clear();
        this.document?.removeEventListener('scroll', this.onChange, true);
        super.cleanup();
        for (const [surface, { layer }] of this.materials) {
            layer.remove(); delete surface.dataset.materialOwner;
        }
        this.materials.clear();
    }
}

export function installRobotMaterial(host) {
    if (host.live !== false || document.documentElement.dataset.design !== 'candidate') return;
    host.robotMotion?.cleanup();
    host.robotMotion = new RobotMaterialMotion(host);
    host.robotMotion.sync();
}
