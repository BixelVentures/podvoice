// HA's src/entrypoints/custom-panel.ts, reduced: load the panel module, create the element, hand it the properties.
let panelEl;
function setProperties(properties) {
  if (!panelEl) return;
  if ('setProperties' in panelEl) panelEl.setProperties(properties);
  else Object.assign(panelEl, properties);
}
function initialize(panel, properties) {
  const config = panel.config._panel_custom;
  import(config.module_url).then(() => {
    panelEl = document.createElement(config.name);
    setProperties({panel, ...properties});
    document.body.appendChild(panelEl);
  });
}
window.parent.customPanel.registerIframe(initialize, setProperties);
