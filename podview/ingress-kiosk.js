// HA owns the authenticated outer app route; the opaque ingress URL stays local
// to this iframe. Core 2026.8.2 can put /view in route.prefix, not route.path.
function parentFrame(win) {
  try {
    const parent = win.parent, origin = win.location.origin;
    if (!parent || parent === win || parent.location.origin !== origin) return null;
    const match = /^(\/(?:app\/)?[A-Za-z0-9_-]+)(?:\/view\/?)?\/?$/.exec(parent.location.pathname);
    return match ? {parent, origin, panelPath: match[1]} : null;
  } catch (_) { return null; }
}

export function isPodViewRoute(path) {
  return path === "/view" || path === "/view/";
}

function parentRoute(frame, event) {
  if (event.source !== frame.parent || event.origin !== frame.origin ||
      event.data?.type !== "home-assistant/properties") return null;
  const route = event.data.route;
  if (typeof route?.prefix !== "string" || typeof route.path !== "string") return null;
  const path = route.prefix + route.path;
  try {
    if (frame.parent.location.origin !== frame.origin ||
        path !== frame.parent.location.pathname) return null;
  } catch (_) { return null; }
  return path;
}

function inPanel(frame) {
  try {
    return frame.parent.location.origin === frame.origin &&
      [frame.panelPath, frame.panelPath + "/", frame.panelPath + "/view", frame.panelPath + "/view/"].includes(frame.parent.location.pathname);
  } catch (_) { return false; }
}

function messenger(frame) {
  return (type, extra = {}) => {
    try { frame.parent.postMessage({type, ...extra}, frame.origin); return true; }
    catch (_) { return false; }
  };
}

// Kiosk request to HA's app panel. handleSafeArea: since HA 2026.8 the panel otherwise pads the
// add-on iframe with the safe-area insets and fills the padding with the theme background, which
// is the white strip under the iPad's home bar. PodView draws full-bleed and applies the insets
// itself (--pv-safe-* below), so HA must drop that padding.
const KIOSK_PROPERTIES = Object.freeze({kioskMode: true, handleSafeArea: true});

const kioskSessions = new WeakMap();

function ingressSession(win) {
  try { return /(?:^|;\s*)ingress_session=([^;]*)/.exec(win.document?.cookie || "")?.[1] || ""; }
  catch (_) { return ""; }
}

// Loading a document through HA ingress with an expired session (e.g. after a Core restart) shows
// HA's raw "401: Unauthorized" page, where PodView cannot run. Probe the target first; on 401 wait
// for HA's app panel to renew its ingress session (it does so every 60 s) and probe once more.
// If it is still refused, stay on the current, working page instead of navigating into the 401.
export async function replaceWhenAdmitted(win, url, {ticks = 65, delay = 1000} = {}) {
  if (typeof win.fetch !== "function") { win.location.replace(url); return true; }
  const probe = async () => {
    try { return (await win.fetch(url, {credentials: "same-origin", cache: "no-store"})).status; }
    catch (_) { return 0; }
  };
  if (await probe() === 401) {
    const before = ingressSession(win);
    for (let tick = 0; tick < ticks && ingressSession(win) === before; tick++) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    if (await probe() === 401) return false;
  }
  win.location.replace(url);
  return true;
}

// Request HA's existing parent route before the normal same-origin anchor loads.
// A standalone, hidden, foreign, or no-longer-owned panel keeps ordinary link behavior.
export function requestIngressAdmin(win) {
  const session = win && kioskSessions.get(win), frame = session?.frame;
  if (!session?.active || !frame || win.parent !== frame.parent || win.document?.visibilityState === "hidden" || !inPanel(frame)) return false;
  try {
    if (![frame.panelPath + "/view", frame.panelPath + "/view/"].includes(frame.parent.location.pathname)) return false;
  } catch (_) { return false; }
  return messenger(frame)("home-assistant/navigate", {path: frame.panelPath});
}

export function beginIngressRoot(win, link = win.document?.querySelector(".podview-link")) {
  if (win.__podviewRootIngressLifecycle) return win.__podviewRootIngressLifecycle;
  const frame = parentFrame(win);
  if (!frame) return () => {};
  const send = messenger(frame);
  let subscribed = false, enteringView = false;
  const viewPath = frame.panelPath + "/view";
  function subscribe() {
    if (!subscribed && inPanel(frame)) subscribed = send("home-assistant/subscribe-properties");
  }
  function unsubscribe() {
    if (!subscribed) return;
    subscribed = false;
    send("home-assistant/unsubscribe-properties");
  }
  function onProperties(event) {
    if (!subscribed || enteringView) return;
    const path = parentRoute(frame, event);
    if (path !== viewPath && path !== viewPath + "/") return;
    enteringView = true;
    replaceWhenAdmitted(win, new URL("view/", win.location.href).href).then(entered => {
      if (!entered) enteringView = false;
    });
  }
  function onClick(event) {
    if (!subscribed || event.defaultPrevented || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || (event.button != null && event.button !== 0)) return;
    try {
      // A retained hidden root document cannot redirect another HA panel.
      if (!inPanel(frame) || ![frame.panelPath, frame.panelPath + "/"].includes(frame.parent.location.pathname)) return;
    } catch (_) { return; }
    if (send("home-assistant/navigate", {path: viewPath})) event.preventDefault();
  }
  function onPageShow(event) {
    if (!event.persisted || !inPanel(frame)) return;
    enteringView = false;
    subscribed = false;
    send("home-assistant/unsubscribe-properties");
    subscribe();
  }
  win.addEventListener("message", onProperties);
  win.addEventListener("pagehide", unsubscribe);
  win.addEventListener("pageshow", onPageShow);
  link?.addEventListener("click", onClick);
  const stop = () => {
    unsubscribe();
    win.removeEventListener("message", onProperties);
    win.removeEventListener("pagehide", unsubscribe);
    win.removeEventListener("pageshow", onPageShow);
    link?.removeEventListener("click", onClick);
    delete win.__podviewRootIngressLifecycle;
  };
  win.__podviewRootIngressLifecycle = stop;
  send("home-assistant/unsubscribe-properties");
  subscribe();
  // The wall iPad opens the add-on panel in the HA app's kiosk mode, which lands on this settings page.
  // The first time per app start (the parent page's session), go straight on to PodView; afterwards the
  // settings stay reachable from PodView as before.
  if (wallStart(win, frame) && send("home-assistant/navigate", {path: viewPath})) enteringView = false;
  return stop;
}

// The HA Companion app on a touch screen, opened on the bare panel, once per app session.
export function wallStart(win, frame) {
  try {
    const companion = /Home ?Assistant\//i.test(win.navigator?.userAgent || "");
    const touch = !!win.matchMedia?.("(pointer: coarse)")?.matches;
    if (!companion || !touch) return false;
    if (![frame.panelPath, frame.panelPath + "/"].includes(frame.parent.location.pathname)) return false;
    const store = frame.parent.sessionStorage, key = "podview-wall-start";
    if (store.getItem(key)) return false;
    store.setItem(key, "1");
    return true;
  } catch (_) { return false; }
}

export function beginIngressKiosk(win) {
  const frame = parentFrame(win);
  if (!frame) return () => {};
  const send = messenger(frame);
  let subscribed = false, leaving = false, routeBound = false;
  const session = {frame, active: true}; kioskSessions.set(win, session);
  const viewPath = frame.panelPath + "/view";
  function subscribe() {
    if (!subscribed && !leaving && inPanel(frame)) subscribed = send("home-assistant/subscribe-properties", KIOSK_PROPERTIES);
  }
  function unsubscribe() {
    if (!subscribed) return;
    subscribed = false;
    send("home-assistant/unsubscribe-properties");
  }
  function onProperties(event) {
    if (!subscribed || leaving) return;
    const path = parentRoute(frame, event);
    if (path === null) return;
    if (path === viewPath || path === viewPath + "/") { routeBound = true; return; }
    // Legacy direct iframe navigation has no outer /view route to leave.
    if (!routeBound) return;
    leaving = true;
    session.active = false;
    unsubscribe();
    unpin();
    if (path === frame.panelPath || path === frame.panelPath + "/") {
      replaceWhenAdmitted(win, new URL("../", win.location.href).href);
    }
  }
  function onPageHide() { session.active = false; unsubscribe(); }
  function onPageShow(event) {
    if (event.persisted && inPanel(frame)) { session.active = true; leaving = false; subscribe(); }
  }
  // Whether HA shows PodView full screen: its toolbar or sidebar moves the iframe in from the
  // top or left (safe areas are padding inside the iframe). null when the frame cannot be seen.
  function fullScreen() {
    try {
      const rect = win.frameElement?.getBoundingClientRect?.();
      return rect ? rect.top < 40 && rect.left < 40 : null;
    } catch (_) { return null; }
  }
  // Full screen means the whole screen: HA keeps its own padding for the iPad's status bar and home
  // indicator around the iframe, which showed as light strips above and below PodView. In kiosk full
  // screen the iframe is pinned over HA's whole viewport, and the parent's safe areas are handed to the
  // stage (ui/stage.js) so the topbar and player keep clear of them while Ro's photo runs under them.
  const frameStyle = (() => { try { return win.frameElement?.getAttribute("style"); } catch (_) { return null; } })();
  let pinned = false, probed = false, safe = "";
  // fitScreen reads layout in HA's document and writes style in both documents, so it runs only when geometry can
  // have changed: once at start, on resize, orientation change, the parent's visual viewport resizing, the page
  // becoming visible and after a kiosk request (never on a timer). Several triggers in a frame share one run.
  let fitFrame = 0;
  function scheduleFit() {
    if (fitFrame || leaving) return;
    const raf = win.requestAnimationFrame?.bind(win);
    if (!raf) { fitScreen(); return; }
    fitFrame = raf(() => { fitFrame = 0; fitScreen(); });
  }
  function fitScreen() {
    try {
      const el = win.frameElement, pdoc = el?.ownerDocument, pwin = pdoc?.defaultView;
      if (!el || !pwin || leaving) return;
      if (!pinned && fullScreen() !== true) return;
      if (!pinned) {
        // A wall screen never scrolls or pull-to-refreshes: no rubber band on HA's page under PodView.
        for (const node of [pdoc.documentElement, pdoc.body]) {
          node.style.setProperty("overscroll-behavior", "none");
          node.style.setProperty("overflow", "hidden");
        }
        el.style.setProperty("position", "fixed");
        el.style.setProperty("inset", "0");
        el.style.setProperty("width", "100%");
        el.style.setProperty("height", "100%");
        el.style.setProperty("max-height", "none");
        el.style.setProperty("z-index", "2");
        el.style.setProperty("border", "0");
        // HA's own page behind PodView takes PodView's background, so no light edge can show through.
        for (const node of [pdoc.documentElement, pdoc.body])
          node.style.setProperty("background", "var(--pv-bg-frame, #E9E7E2)");
        pinned = true;
      }
      // A transformed or contained HA ancestor turns »fixed« into »inside that box«, which left a light strip
      // under PodView on the iPad. Measure where the frame really is and stretch it over HA's whole viewport.
      const vw = Math.max(pwin.innerWidth, pdoc.documentElement.clientWidth || 0);
      const vh = Math.max(pwin.innerHeight, pwin.visualViewport?.height || 0, pdoc.documentElement.clientHeight || 0);
      const box = el.getBoundingClientRect();
      const top = (parseFloat(el.style.top) || 0) - box.top, left = (parseFloat(el.style.left) || 0) - box.left;
      if (Math.abs(box.top) > 0.5 || Math.abs(box.left) > 0.5 || Math.abs(box.width - vw) > 0.5 || Math.abs(box.height - vh) > 0.5) {
        el.style.setProperty("inset", "auto");
        el.style.setProperty("top", `${top}px`);
        el.style.setProperty("left", `${left}px`);
        el.style.setProperty("width", `${vw}px`);
        el.style.setProperty("height", `${vh}px`);
      }
      // env() resolves when a custom property is computed: read the parent's safe areas without a probe node.
      // The probes are written once; PodView's own properties and the event only when an inset changed.
      const proot = pdoc.documentElement, root = win.document.documentElement;
      const sides = ["top", "right", "bottom", "left"];
      if (!probed) {
        for (const side of sides)
          proot.style.setProperty(`--pv-safe-${side}-probe`, `env(safe-area-inset-${side},0px)`);
        probed = true;
      }
      const cs = pwin.getComputedStyle(proot);
      const insets = sides.map(side => `${parseFloat(cs.getPropertyValue(`--pv-safe-${side}-probe`)) || 0}px`);
      if (insets.join(" ") === safe) return;
      safe = insets.join(" ");
      sides.forEach((side, index) => root.style.setProperty(`--pv-safe-${side}`, insets[index]));
      win.dispatchEvent(new win.Event("pv-safe-area"));
    } catch (_) { /* a frame we cannot reach keeps HA's layout */ }
  }
  function unpin() {
    if (!pinned) return;
    pinned = false; probed = false; safe = "";
    try {
      const el = win.frameElement;
      if (frameStyle === null) el.removeAttribute("style"); else el.setAttribute("style", frameStyle);
      for (const node of [el.ownerDocument.documentElement, el.ownerDocument.body]) {
        node.style.removeProperty("overscroll-behavior");
        node.style.removeProperty("overflow");
        node.style.removeProperty("background");
      }
    } catch (_) {}
  }
  // HA (e.g. the iPad Companion app after a locked screen or a Core restart) can rebuild its
  // panel and forget the kiosk request; it then ignores a repeated request (fejl 14, 13 Nov).
  // Full screen: nothing is sent, so a tap (focus) never flashes HA's toolbar. Not full screen:
  // ask again from a clean state, at most every 10 s. Unknown geometry: only ask again.
  let renewedAt = -Infinity;
  function reassert() {
    if (leaving || !session.active || win.document?.visibilityState === "hidden" || !inPanel(frame)) return;
    const full = fullScreen();
    if (full === true) return;
    if (full === null) { subscribed = send("home-assistant/subscribe-properties", KIOSK_PROPERTIES); return; }
    if (Date.now() - renewedAt < 10000) return;
    renewedAt = Date.now();
    send("home-assistant/unsubscribe-properties");
    subscribed = send("home-assistant/subscribe-properties", KIOSK_PROPERTIES);
    scheduleFit();
  }
  // A wall screen gets no tap after a Core restart: check the kiosk every few seconds (one rect read, nothing
  // written while full screen). Fitting the frame follows geometry events instead (scheduleFit).
  const watch = win.setInterval?.(reassert, 5000);
  const onVisibility = () => { reassert(); if (win.document?.visibilityState !== "hidden") scheduleFit(); };
  const parentViewport = (() => {
    try { return win.frameElement?.ownerDocument?.defaultView?.visualViewport || null; } catch (_) { return null; }
  })();
  win.addEventListener("message", onProperties);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  win.addEventListener("focus", reassert);
  win.addEventListener("online", reassert);
  win.addEventListener("resize", reassert);
  win.addEventListener("resize", scheduleFit);
  win.addEventListener("orientationchange", scheduleFit);
  parentViewport?.addEventListener?.("resize", scheduleFit);
  win.document?.addEventListener?.("visibilitychange", onVisibility);
  subscribe();
  fitScreen();
  return () => {
    leaving = true;
    session.active = false;
    unsubscribe();
    win.removeEventListener("message", onProperties);
    win.removeEventListener("pagehide", onPageHide);
    win.removeEventListener("pageshow", onPageShow);
    win.removeEventListener("focus", reassert);
    win.removeEventListener("online", reassert);
    win.removeEventListener("resize", reassert);
    win.removeEventListener("resize", scheduleFit);
    win.removeEventListener("orientationchange", scheduleFit);
    parentViewport?.removeEventListener?.("resize", scheduleFit);
    if (fitFrame) win.cancelAnimationFrame?.(fitFrame);
    fitFrame = 0;
    unpin();
    win.clearInterval?.(watch);
    win.document?.removeEventListener?.("visibilitychange", onVisibility);
    session.active = false; if (kioskSessions.get(win) === session) kioskSessions.delete(win);
  };
}

if (typeof window !== "undefined") {
  if (window.document?.querySelector(".podview-link")) beginIngressRoot(window);
  else if (window.document?.querySelector("pv-widget-host")) beginIngressKiosk(window);
}
