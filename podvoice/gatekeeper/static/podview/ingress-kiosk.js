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
  return stop;
}

export function beginIngressKiosk(win) {
  const frame = parentFrame(win);
  if (!frame) return () => {};
  const send = messenger(frame);
  let subscribed = false, leaving = false, routeBound = false;
  const session = {frame, active: true}; kioskSessions.set(win, session);
  const viewPath = frame.panelPath + "/view";
  function subscribe() {
    if (!subscribed && !leaving && inPanel(frame)) subscribed = send("home-assistant/subscribe-properties", {kioskMode: true});
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
  // HA (e.g. the iPad Companion app after a locked screen or a Core restart) can rebuild its
  // panel and forget the kiosk request; it then ignores a repeated request (fejl 14, 13 Nov).
  // Full screen: nothing is sent, so a tap (focus) never flashes HA's toolbar. Not full screen:
  // ask again from a clean state, at most every 10 s. Unknown geometry: only ask again.
  let renewedAt = -Infinity;
  function reassert() {
    if (leaving || !session.active || win.document?.visibilityState === "hidden" || !inPanel(frame)) return;
    const full = fullScreen();
    if (full === true) return;
    if (full === null) { subscribed = send("home-assistant/subscribe-properties", {kioskMode: true}); return; }
    if (Date.now() - renewedAt < 10000) return;
    renewedAt = Date.now();
    send("home-assistant/unsubscribe-properties");
    subscribed = send("home-assistant/subscribe-properties", {kioskMode: true});
  }
  // A wall screen gets no tap after a Core restart: check every few seconds and on resize.
  const watch = win.setInterval?.(reassert, 5000);
  win.addEventListener("message", onProperties);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  win.addEventListener("focus", reassert);
  win.addEventListener("online", reassert);
  win.addEventListener("resize", reassert);
  win.document?.addEventListener?.("visibilitychange", reassert);
  subscribe();
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
    win.clearInterval?.(watch);
    win.document?.removeEventListener?.("visibilitychange", reassert);
    session.active = false; if (kioskSessions.get(win) === session) kioskSessions.delete(win);
  };
}

if (typeof window !== "undefined") {
  if (window.document?.querySelector(".podview-link")) beginIngressRoot(window);
  else if (window.document?.querySelector("pv-widget-host")) beginIngressKiosk(window);
}
