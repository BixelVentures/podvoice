// Entry of podview-loader.js (built separately by build/panel-loader.mjs; see src/panel/loader.ts).
import {attemptUrl, loadWithRetry} from '../panel/loader';

const bundle = new URL('./podview-panel.js', import.meta.url);
const shown: {status: HTMLElement | null} = {status: null};

const wake = (resume: () => void) => {
  const visible = () => {
    if (document.visibilityState === 'visible') resume();
  };
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', visible);
  };
};

await loadWithRetry(attempt => import(/* @vite-ignore */ attemptUrl(bundle, attempt)), {
  wake,
  onFailure(failures, error) {
    console.warn(`PodView: the panel could not load (attempt ${String(failures)}); trying again`, error);
    const status = shown.status ?? document.createElement('p');
    if (!shown.status) {
      status.setAttribute('role', 'status');
      status.style.cssText = 'font:16px system-ui,sans-serif;color:#555;margin:32px;text-align:center';
      document.body.append(status);
      shown.status = status;
    }
    status.textContent = `Henter PodView … (forsøg ${String(failures + 1)})`;
  },
});
shown.status?.remove();
