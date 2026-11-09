import { vehicleRailPresentation } from '/vehicle-model.js';

// Local candidate binding to the existing vehicle observation projection.
// The moving light marks admitted charging, never battery progress or speed.
const installations = new WeakMap();
export function installVehicleMaterial(host, {
    document = globalThis.document,
    window = document?.defaultView || globalThis.window,
    media = window?.matchMedia?.('(prefers-reduced-motion: reduce)'),
    Observer = globalThis.MutationObserver
} = {}) {
    if (host.live !== false || document.documentElement.dataset.design !== 'candidate') return;
    if (installations.has(host)) return;
    const renderFacts = host.renderOverviewFacts;
    const cleanup = host.cleanup;
    let disposed = false;
    let observer;
    const surfaces = new Set();
    const sync = () => {
        if (disposed) return;
        if (!host.isConnected) { dispose(); return; }
        const observation = vehicleRailPresentation(host.state.vehicle, {
            ...host.vehicleChargeContext, live: false
        });
        const current = observation?.status === 'charging' && !observation.stale;
        const reduced = media?.matches || host.dataset.motion === 'reduced' || document.documentElement.dataset.motion === 'reduced';
        const wanted = new Set();
        for (const surface of host.querySelectorAll('#home-vehicle, #vehicle-view .vehicle-hero')) {
            wanted.add(surface);
            let material = surface.querySelector(':scope > .pv-vehicle-energy');
            if (!material) {
                material = document.createElement('span');
                material.className = 'pv-vehicle-energy';
                material.setAttribute('aria-hidden', 'true');
                surface.append(material);
            }
            surfaces.add(surface);
            const rect = surface.getBoundingClientRect();
            const visible = !document.hidden && !!surface.getClientRects().length &&
                rect.bottom > 0 && rect.right > 0 && rect.top < document.documentElement.clientHeight && rect.left < document.documentElement.clientWidth;
            const state = current ? (visible && !reduced ? 'charging' : 'still') : 'none';
            if (surface.dataset.energy !== state) surface.dataset.energy = state;
        }
        for (const surface of surfaces) if (!wanted.has(surface)) {
            surface.querySelector(':scope > .pv-vehicle-energy')?.remove();
            delete surface.dataset.energy;
            surfaces.delete(surface);
        }
    };
    const render = host.renderOverviewFacts = (...args) => { const result = renderFacts.apply(host, args); sync(); return result; };
    document.addEventListener('visibilitychange', sync);
    document.addEventListener('scroll', sync, true);
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        observer?.disconnect();
        window?.removeEventListener('resize', sync);
        media?.removeEventListener('change', sync);
        document.removeEventListener('visibilitychange', sync);
        document.removeEventListener('scroll', sync, true);
        for (const surface of surfaces) {
            surface.querySelector(':scope > .pv-vehicle-energy')?.remove();
            delete surface.dataset.energy;
        }
        surfaces.clear();
        if (host.renderOverviewFacts === render) host.renderOverviewFacts = renderFacts;
        if (host.cleanup === teardown) host.cleanup = cleanup;
        installations.delete(host);
    };
    const teardown = host.cleanup = (...args) => { dispose(); return cleanup.apply(host, args); };
    installations.set(host, dispose);
    window?.addEventListener('resize', sync);
    media?.addEventListener('change', sync);
    if (Observer) {
        observer = new Observer(sync);
        observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open', 'data-motion', 'data-view'] });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    }
    sync();
}
