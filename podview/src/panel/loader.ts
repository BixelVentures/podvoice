// The panel's loader (custom_components/podvoice/frontend/podview-loader.js, the panel's module_url). HA loads the
// panel module once and, if that import fails (HA busy, a slow eMMC, an update in progress), shows »Unable to load
// the panel source« until someone reloads the wall. This module is tiny and stable; it imports the real bundle next
// to it and retries a failed import with backoff, forever, sooner when the network or the page comes back. Each
// retry asks for a fresh URL, because a browser remembers a failed module import for its URL. The loader's own
// import resolves only when the bundle has defined <podview-panel> (top-level await), so HA creates the element then.
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];

export const retryDelay = (failures: number) =>
  RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0] ?? 1000;

export interface LoadOptions {
  // Waits `ms`, or less when `wake` is called (the network or the page came back).
  wait?: (ms: number, wake: (resume: () => void) => () => void) => Promise<void>;
  wake?: (resume: () => void) => () => void;
  onFailure?: (failures: number, error: unknown) => void;
}

const sleep = (ms: number, wake: (resume: () => void) => () => void) =>
  new Promise<void>(resolve => {
    let stop = () => undefined as unknown;
    const timer = setTimeout(() => {
      stop();
      resolve();
    }, ms);
    stop = wake(() => {
      clearTimeout(timer);
      stop();
      resolve();
    });
  });

export async function loadWithRetry(
  load: (attempt: number) => Promise<unknown>,
  {wait = sleep, wake = () => () => undefined, onFailure = () => undefined}: LoadOptions = {},
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await load(attempt);
      return;
    } catch (error) {
      onFailure(attempt + 1, error);
      await wait(retryDelay(attempt + 1), wake);
    }
  }
}

// The bundle's URL for an attempt: the first is the plain (cached) URL, retries are fresh.
export const attemptUrl = (bundle: URL, attempt: number) =>
  attempt === 0 ? bundle.href : `${bundle.href}${bundle.search ? '&' : '?'}retry=${String(attempt)}`;
