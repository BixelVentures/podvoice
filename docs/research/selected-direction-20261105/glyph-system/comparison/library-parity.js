// Local documentation adapter. Forward only review presentation parameters to
// the pinned library's nested product frames; their renderer/data stay intact.
const params = new URLSearchParams(location.search);
const candidate = params.get('design') === 'candidate';

if (location.pathname === '/library.html' && candidate) {
    const forward = frame => {
        const source = frame.getAttribute('src');
        if (!source) return;
        const url = new URL(source, location.href);
        if (url.origin !== location.origin || !['/', '/index.html'].includes(url.pathname)) return;
        let changed = url.searchParams.get('design') !== 'candidate';
        url.searchParams.set('design', 'candidate');
        if (params.get('motion') === 'reduced') {
            changed ||= url.searchParams.get('motion') !== 'reduced';
            url.searchParams.set('motion', 'reduced');
        }
        if (changed) frame.src = url.href;
    };
    const observe = () => {
        for (const frame of document.querySelectorAll('iframe')) forward(frame);
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['src'] });
    observe();
    // The native library applies its own initial default after frame load.
    // Respect the outer comparison's explicit accessibility setting afterward.
    const loaded = event => {
        const frame = event.target;
        if (!(frame instanceof HTMLIFrameElement) || params.get('motion') !== 'reduced') return;
        queueMicrotask(() => {
            const host = frame.contentDocument?.querySelector('pv-widget-host');
            if (host?.live !== false) return;
            host.dataset.motion = 'reduced';
            host.motion?.cancel();
            host.robotMotion?.sync();
        });
    };
    document.addEventListener('load', loaded, true);
    window.addEventListener('pagehide', () => {
        observer.disconnect();
        document.removeEventListener('load', loaded, true);
    }, { once:true });
}

// Optional documentation crop for all six existing Small owners, including the
// Recipe shortcut omitted from the pinned library's size-picker target table.
// It sets the same authored size attributes used by library.js; no new renderer.
const targets = {
    light:'.resource-card[data-kind="light"]', tesla:'#home-vehicle',
    music:'#home-music', radio:'#home-radio', recipes:'#home-recipes', timer:'#timer-card'
};
const selector = targets[params.get('widgetSpecimen')];
const size = params.get('size') || 's';
if (['/', '/index.html'].includes(location.pathname) && selector && ['s', 'm', 'l'].includes(size)) {
    window.addEventListener('DOMContentLoaded', async () => {
        await customElements.whenDefined('pv-widget-host');
        const host = document.querySelector('pv-widget-host');
        if (host?.live !== false) return;
        const originalMotion = host.dataset.motion;
        const restoreMotion = () => {
            if (originalMotion === undefined) delete host.dataset.motion;
            else host.dataset.motion = originalMotion;
        };
        host.dataset.motion = 'reduced';
        host.motion?.cancel();
        host.motion?.releaseGeometry(false);
        host.dispatch({type:'show', id:'now'});
        const widget = host.querySelector('#now-view')?.querySelector(selector);
        if (!widget) { restoreMotion(); return; }
        // Active Timer has its own canonical activity anatomy, not an S/M/L shortcut.
        if (params.get('widgetSpecimen') === 'timer' && widget.dataset.activityKind === 'timer') { restoreMotion(); return; }
        widget.dataset.kitSize = size;
        widget.dataset.libraryWidgetPreview = 'true';
        if (!document.querySelector('link[href="/comparison/component-parity.css"]')) {
            const sheet = document.createElement('link');
            sheet.rel = 'stylesheet';
            sheet.href = '/comparison/component-parity.css';
            document.head.append(sheet);
        }
        const sync = () => {
            if (host.state.focus === 'now') {
                host.dataset.libraryWidgetSizes = 'true';
                document.documentElement.dataset.widgetSpecimen = params.get('widgetSpecimen');
                const feed = host.querySelector('.responses');
                if (feed) { feed.scrollTop = 0; host.scrollEdges?.measure(feed); }
            } else {
                delete host.dataset.libraryWidgetSizes;
                delete document.documentElement.dataset.widgetSpecimen;
            }
        };
        sync();
        host.render();
        requestAnimationFrame(() => {
            host.motion?.cancel();
            host.motion?.releaseGeometry(false);
            restoreMotion();
            host.robotMotion?.sync();
        });
        const observer = new MutationObserver(sync);
        observer.observe(host, {attributes:true, attributeFilter:['data-level', 'data-view']});
        window.addEventListener('pagehide', () => observer.disconnect(), {once:true});
    }, {once:true});
}
