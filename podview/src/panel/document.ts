// The panel's iframe document. HA writes it with only its loader script, so relative asset URLs (icons in the
// screens, fonts and images in the stylesheet) resolve against the bundle's own directory through <base>, and the
// stylesheet Vite emits next to the bundle is linked here.
export function installPanelDocument(moduleUrl: string, doc: Document = globalThis.document) {
  const directory = new URL('./', moduleUrl).href;
  doc.documentElement.dataset.panel = 'ha';
  doc.documentElement.lang = 'da';
  if (!doc.querySelector('base[data-podview]')) {
    const base = doc.createElement('base');
    base.href = directory;
    base.dataset.podview = '';
    doc.head.prepend(base);
  }
  if (!doc.querySelector('link[data-podview]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    // In the module's own digest directory (/podvoice_static/frontend/<digest>/): a release never meets a cached
    // stylesheet. A retry's query (the loader's ?retry=n) is not part of it.
    link.href = new URL('podview-panel.css', moduleUrl).href;
    link.dataset.podview = '';
    // The stage reads the safe-area insets through this stylesheet (panel.css): measure again once it applies.
    link.addEventListener('load', () => {
      doc.defaultView?.dispatchEvent(new Event('pv-safe-area'));
    });
    doc.head.append(link);
  }
  if (!doc.querySelector('meta[name=viewport]')) {
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
    doc.head.append(meta);
  }
}

// The digest directory the running bundle came from (/podvoice_static/frontend/<digest>/), or '' outside HA.
export function runningBundle(moduleUrl: string): string {
  const match = /\/podvoice_static\/frontend\/([0-9a-f]{12})\//.exec(new URL(moduleUrl).pathname);
  return match?.[1] ?? '';
}
