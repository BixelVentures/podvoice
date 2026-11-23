// <podview-panel>: the custom element Home Assistant creates for the panel (panel_custom, embed_iframe). HA hands it
// `hass`, `panel`, `narrow` and `route` as properties (or through setProperties); the element feeds the HA transport
// and renders the React shell once. It lives in its own iframe document, so PodView's stylesheet, React Aria's
// overlays and the stage scaling apply exactly as on the wall page, without touching HA's own document.
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {Providers} from '../app/Providers';
import {installLastKnown} from '../lib/ha/media';
import {installResync} from '../lib/ha/resync';
import {transport} from '../lib/ha/transport';
import type {Hass, HassPanel} from '../lib/ha/hass';
import {Shell} from './Shell';

export class PodViewPanel extends HTMLElement {
  #root: Root | null = null;
  #cleanup: (() => void)[] = [];

  set hass(value: Hass) {
    transport.setHass(value);
  }

  set panel(value: HassPanel | null) {
    transport.setPanel(value);
  }

  // HA sets these too; the wall layout does not depend on them.
  narrow = false;
  route: unknown = null;

  setProperties(properties: Record<string, unknown>) {
    if ('panel' in properties) this.panel = properties.panel as HassPanel | null;
    if ('hass' in properties && properties.hass) this.hass = properties.hass as Hass;
    if ('narrow' in properties) this.narrow = properties.narrow === true;
    if ('route' in properties) this.route = properties.route;
  }

  connectedCallback() {
    if (this.#root) return;
    const doc = this.ownerDocument;
    // The stage reads HA's safe-area insets (panel.css maps them) whenever they change.
    doc.defaultView?.dispatchEvent(new Event('pv-safe-area'));
    this.#cleanup.push(installResync(), installLastKnown());
    this.#root = createRoot(this);
    this.#root.render(
      <Providers>
        <Shell />
      </Providers>,
    );
  }

  disconnectedCallback() {
    // HA empties the iframe on pagehide and creates a new element on pageshow.
    this.#root?.unmount();
    this.#root = null;
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
  }
}

export function definePanel(name = 'podview-panel') {
  if (!customElements.get(name)) customElements.define(name, PodViewPanel);
}
