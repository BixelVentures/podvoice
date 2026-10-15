// Home Assistant owns the outer app frame and its ingress session. This page only
// asks that frame to hide its chrome while PodView is the active app route.
export function isPodViewRoute(path) {
  return path === "/view" || path === "/view/";
}

export function beginIngressKiosk(win) {
  const parent = win.parent;
  if (!parent || parent === win) return () => {};

  const origin = win.location.origin;
  try {
    if (parent.location.origin !== origin) return () => {};
  } catch (_) {
    return () => {};
  }

  let subscribed = false;
  let leaving = false;
  let routeBound = false;
  function send(type, extra = {}) {
    try {
      parent.postMessage({ type, ...extra }, origin);
      return true;
    } catch (_) {
      return false;
    }
  }
  function subscribe() {
    if (!subscribed && !leaving) {
      subscribed = send("home-assistant/subscribe-properties", { kioskMode: true });
    }
  }
  function unsubscribe() {
    if (subscribed) {
      subscribed = false;
      send("home-assistant/unsubscribe-properties");
    }
  }
  function onProperties(event) {
    if (event.source !== parent || event.origin !== origin) return;
    if (event.data?.type !== "home-assistant/properties") return;
    const path = event.data.route?.path;
    if (typeof path !== "string") return;
    if (isPodViewRoute(path)) {
      routeBound = true;
      return;
    }
    // A direct legacy ingress link has no outer /view route to leave.
    if (!routeBound || leaving) return;
    leaving = true;
    unsubscribe();
    win.location.replace(new URL("../", win.location.href).href);
  }
  function onPageShow(event) {
    if (event.persisted) {
      leaving = false;
      subscribe();
    }
  }
  win.addEventListener("message", onProperties);
  win.addEventListener("pagehide", unsubscribe);
  win.addEventListener("pageshow", onPageShow);
  subscribe();

  return () => {
    leaving = true;
    unsubscribe();
    win.removeEventListener("message", onProperties);
    win.removeEventListener("pagehide", unsubscribe);
    win.removeEventListener("pageshow", onPageShow);
  };
}

if (typeof window !== "undefined") beginIngressKiosk(window);
