// What the wall runs: the digest directory its bundle was loaded from (set once by the entry) and the add-on version
// the bundle was built with. The diagnostics corner and the heartbeat show these.
let bundle = '';

export const setRunningBundle = (digest: string) => {
  bundle = digest;
};
export const runningBundleId = () => bundle;
export const BUILD = typeof __PODVIEW_BUILD__ === 'string' ? __PODVIEW_BUILD__ : 'dev';
