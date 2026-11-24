// <podview-panel>: the custom element Home Assistant creates for the panel (panel_custom, embed_iframe). HA hands it
// `hass`, `panel`, `narrow` and `route` as properties (or through setProperties); the element feeds the HA transport
// and renders the React shell. It lives in its own iframe document, so PodView's stylesheet, React Aria's overlays and
// the stage scaling apply exactly as on the wall page, without touching HA's own document.
//
// It is built to hang on a wall for weeks: a root error boundary remounts the shell, a heartbeat watchdog rebuilds
// the React root if it stops committing, window errors and recoveries reach HA's log (report.ts), and the wall beats
// to HA's »PodView væg online« sensor (health.ts). HA tears a hidden panel's iframe down after five minutes, so the
// page cold-starts often: only the last known players survive that (media.ts); the room comes from the URL.
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {Providers} from '../app/Providers';
import {installFrameMeter} from '../lib/diagnostics/frame-meter';
import {installLastKnown} from '../lib/ha/media';
import {installResync} from '../lib/ha/resync';
import {transport} from '../lib/ha/transport';
import type {Hass, HassPanel} from '../lib/ha/hass';
import {RootBoundary} from './boundary';
import {runningBundleId, setRunningBundle} from './build';
import {installFrameReports, installHeartbeat} from './health';
import {currentScreen, routeArea, useNav} from './nav';
import type {Reporter} from './report';
import {createReporter, installErrorReporting} from './report';
import {Shell} from './Shell';
import {createWatchdog, Pulse} from './watchdog';
import type {Watchdog} from './watchdog';

let panelConfig: Record<string, unknown> | null = null;
const numberOption = (name: string, fallback: number) => {
  const value = panelConfig?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

type Props = Record<'hass' | 'panel' | 'narrow' | 'route', unknown>;

export class PodViewPanel extends HTMLElement {
  #root: Root | null = null;
  #cleanup: (() => void)[] = [];
  #watchdog: Watchdog | null = null;
  #reporter: Reporter | null = null;
  #connected = false;
  #route: unknown = null;

  // HA sets this too; the wall layout does not depend on it.
  narrow = false;

  constructor() {
    super();
    // Properties set before the element was defined (custom-element upgrade): an own property would hide the setters.
    const self = this as unknown as Props;
    for (const name of ['hass', 'panel', 'narrow', 'route'] as const) {
      if (!Object.hasOwn(this, name) || name === 'narrow') continue;
      const value = self[name];
      Reflect.deleteProperty(this, name);
      self[name] = value;
    }
  }

  set hass(value: Hass) {
    transport.setHass(value);
    const connected = value.connected !== false;
    if (connected && !this.#connected) this.#reporter?.flush();
    this.#connected = connected;
  }

  set panel(value: HassPanel | null) {
    panelConfig = value?.config ?? null;
    transport.setPanel(value);
  }

  get route(): unknown {
    return this.#route;
  }

  // /podview/<area_id>: the kiosk URL fixes the wall's room.
  set route(value: unknown) {
    this.#route = value;
    useNav.getState().setRouteRoom(routeArea(value));
  }

  setProperties(properties: Record<string, unknown>) {
    if ('panel' in properties) this.panel = properties.panel as HassPanel | null;
    if ('hass' in properties && properties.hass) this.hass = properties.hass as Hass;
    if ('narrow' in properties) this.narrow = properties.narrow === true;
    if ('route' in properties) this.route = properties.route;
  }

  #render() {
    const report = this.#reporter ? this.#reporter.report.bind(this.#reporter) : () => undefined;
    const watchdog = this.#watchdog;
    const beat = () => {
      watchdog?.beat();
    };
    this.#root = createRoot(this, {
      onUncaughtError: error => {
        report({kind: 'error', message: String(error)});
      },
    });
    this.#root.render(
      <Providers>
        <RootBoundary onReport={report}>
          <Shell onReport={report} />
        </RootBoundary>
        <Pulse onBeat={beat} />
      </Providers>,
    );
  }

  // React went silent: a new root on the same element and caches (HA's data stays).
  rebuild(reason = 'watchdog') {
    this.#reporter?.report({kind: 'remount', message: `React root rebuilt (${reason})`});
    try {
      this.#root?.unmount();
    } catch {
      // A wedged root may not unmount cleanly; the new one replaces its DOM.
    }
    this.replaceChildren();
    this.#render();
  }

  connectedCallback() {
    if (this.#root) return;
    const doc = this.ownerDocument;
    const win = doc.defaultView ?? window;
    // The stage reads HA's safe-area insets (panel.css maps them) whenever they change.
    win.dispatchEvent(new Event('pv-safe-area'));
    const reporter = createReporter({context: () => ({bundle: runningBundleId(), room: useNav.getState().routeRoom})});
    this.#reporter = reporter;
    this.#watchdog = createWatchdog({
      onStale: () => {
        this.rebuild();
      },
      visible: () => doc.visibilityState === 'visible',
    });
    const meter = installFrameMeter(win);
    this.#cleanup.push(
      meter.dispose,
      installResync(),
      installLastKnown(),
      installErrorReporting(reporter, win),
      installFrameReports(reporter, meter.take),
      installHeartbeat({
        win,
        seconds: () => numberOption('heartbeat_seconds', 60),
        info: () => {
          const nav = useNav.getState();
          return {bundle: runningBundleId() || 'dev', room: nav.room ?? nav.routeRoom, screen: currentScreen(nav)};
        },
      }),
    );
    this.#render();
    this.#watchdog.start();
  }

  disconnectedCallback() {
    // HA empties the iframe on pagehide and creates a new element on pageshow.
    this.#watchdog?.stop();
    this.#root?.unmount();
    this.#root = null;
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
  }
}

export function definePanel(name = 'podview-panel', runningBundle = '') {
  setRunningBundle(runningBundle);
  if (!customElements.get(name)) customElements.define(name, PodViewPanel);
}
