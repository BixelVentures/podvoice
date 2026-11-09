// Review-only document scrolling for the existing mobile navigation owner.
// Commands and same-view updates keep their current scroll position.
const installed = new WeakSet();
export function installNavigationScroll(host, {
    document = host.ownerDocument || globalThis.document,
    window = document?.defaultView || globalThis.window
} = {}) {
    if (host.live !== false || document?.documentElement?.dataset.design !== 'candidate' || installed.has(host)) return;
    const dispatch = host.dispatch, cleanup = host.cleanup;
    const positions = new Map();
    let disposed = false, lastWidth;
    const wrapped = host.dispatch = function (...args) {
        if (disposed || this !== host) return dispatch.apply(this, args);
        const width = window.innerWidth;
        if (width !== lastWidth) { positions.clear(); lastWidth = width; }
        const narrow = width < 760;
        const previous = this.state?.focus;
        const scroller = document.scrollingElement;
        const offset = scroller?.scrollTop || 0;
        const result = dispatch.apply(this, args);
        const destination = this.state?.focus;
        // The synchronous canonical dispatch owns the resulting destination.
        // A resize during dispatch must not apply offsets from another layout.
        if (!disposed && narrow && window.innerWidth === width && scroller && destination !== previous) {
            positions.set(previous, offset);
            const target = positions.get(destination) || 0;
            if (typeof scroller.scrollTo === 'function') scroller.scrollTo({top: target, behavior: 'instant'});
            else scroller.scrollTop = target;
        }
        return result;
    };
    const teardown = host.cleanup = function (...args) {
        if (!disposed) {
            disposed = true;
            positions.clear();
            installed.delete(host);
            if (host.dispatch === wrapped) host.dispatch = dispatch;
            if (host.cleanup === teardown) host.cleanup = cleanup;
        }
        return cleanup.apply(this, args);
    };
    installed.add(host);
}
