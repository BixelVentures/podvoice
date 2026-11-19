// Kit-Topbar: Ro key or Back title on the left, the Svar button, and weather and the clock on the right. The host
// decides the title, level and connection; the clocks' digits are rolled by SceneMotion.value (P5) into the empty
// #header-clock and #photo-clock, which React never fills.
import {useSyncExternalStore} from 'react';
import type {ShellStore} from './store';

// Kit-SvarKnap: the five-by-three grille the Svar bars are drawn from (ui-kit.css).
const GRILLE: readonly (readonly [string, string])[] = [
  ['2.0', '2.0'],
  ['8.4', '1.4'],
  ['15.4', '1.4'],
  ['22.4', '1.4'],
  ['29.4', '1.4'],
  ['36.4', '1.4'],
  ['44.0', '2.0'],
  ['2.0', '9.6'],
  ['8.4', '8.9'],
  ['15.4', '8.9'],
  ['22.4', '8.9'],
  ['29.4', '8.9'],
  ['36.4', '8.9'],
  ['44.0', '9.6'],
  ['2.0', '17.1'],
  ['8.4', '16.4'],
  ['15.4', '16.4'],
  ['22.4', '16.4'],
  ['29.4', '16.4'],
  ['36.4', '16.4'],
  ['44.0', '17.1'],
];

const flag = (value: boolean | null) => value ?? undefined;

export function useShell(store: ShellStore) {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

export function Topbar({store}: {store: ShellStore}) {
  const {topbar, clock} = useShell(store);
  const host = () => store.host;
  const svarActive = topbar.svarActive;
  return (
    <nav
      className="view-nav pv-kit pv-kit-topbar pv-topbar"
      aria-label="Visning"
      data-kit="topbar"
      data-connection-state={clock.connectionState ?? undefined}
      data-offline={clock.connectionState === null ? undefined : String(clock.offline)}
      data-night={clock.connectionState === null ? undefined : String(clock.night)}
    >
      <div className="header-left">
        <div className="header-navigation">
          <button
            id="show-photo"
            type="button"
            aria-label="Gå til Ro"
            data-navigation="rest"
            hidden={!topbar.rest}
            onClick={() => host()?.headerBackAction()}
          >
            <img src="assets/icons/moon.svg" alt="" />
            <span className="rest-label">Ro</span>
          </button>
          <button
            id="show-now"
            hidden
            aria-pressed={flag(topbar.nowPressed)}
            onClick={() => host()?.showFocus('now', false)}
          >
            Lige nu
          </button>
          <button
            id="show-music"
            hidden
            aria-pressed={flag(topbar.musicPressed)}
            onClick={() => host()?.showMusicFromTopbar()}
          >
            Musik
          </button>
        </div>
        <h1 id="header-title" className="header-title" tabIndex={-1}>
          {topbar.back ? (
            <button
              id="header-title-action"
              type="button"
              className="topbar-title-action"
              data-pv-press="quiet"
              aria-label={`${topbar.title} · Tilbage`}
              onClick={() => host()?.headerTitleBack()}
            >
              <img className="topbar-back-icon" src="assets/icons/arrow-left-long.svg" alt="" aria-hidden="true" />
              <span className="topbar-title-copy">{topbar.title}</span>
            </button>
          ) : (
            topbar.title
          )}
        </h1>
        <span className="header-activity"></span>
      </div>
      <span className="header-context">
        <button
          id="open-history"
          className="header-history"
          aria-haspopup="dialog"
          aria-controls="history"
          aria-expanded="false"
          aria-label="Svar · Se tidligere svar"
          data-active={svarActive === null ? undefined : String(svarActive)}
          aria-current={svarActive === null ? undefined : svarActive ? 'page' : 'false'}
          data-device={topbar.svarOffline ? 'offline' : undefined}
          aria-description={topbar.svarOffline ? 'Voice PE er offline. Dagens svar kan stadig læses.' : undefined}
          onClick={() => host()?.openSvar()}
        >
          <span className="pv-svar-grille" aria-hidden="true">
            {GRILLE.map(([left, top], index) => (
              <i key={index} style={{left: `${left}px`, top: `${top}px`}}></i>
            ))}
          </span>
          <span>
            <strong>{topbar.svarOffline ? 'Offline' : 'Svar'}</strong>
            <small id="header-history-count" hidden>
              {topbar.historyCount}
            </small>
          </span>
        </button>
        <button id="header-weather" hidden className="header-weather" onClick={() => host()?.showFocus('weather')}>
          <img src="assets/icons/cloud-sun.svg" alt="" />
          <span>
            <strong>16°</strong>
            <small>Let skyet</small>
          </span>
        </button>
        <button
          id="header-ro"
          className="header-time"
          aria-description={clock.roDescription}
          aria-haspopup="dialog"
          aria-controls="quick-sheet"
          onClick={event => host()?.openScreenSettings(event.currentTarget)}
        >
          <strong id="header-clock"></strong>
          <span className="header-date-line">
            <span
              id="header-offline-dot"
              className="header-offline-dot"
              aria-hidden="true"
              hidden={!clock.connectionMark}
            ></span>
            <ClockText id="header-date" text={clock.headerDate} label={clock.label} />
          </span>
        </button>
      </span>
      {isLive() ? null : (
        <button
          id="open-demo"
          aria-haspopup="dialog"
          hidden
          onClick={event => host()?.open('demo', event.currentTarget)}
        >
          Afprøv
        </button>
      )}
    </nav>
  );
}

export function ClockText({id, text, label}: {id: string; text: string; label: string | null}) {
  return (
    <span id={id} role="status" aria-live="polite" aria-atomic="true" aria-label={label ?? undefined}>
      {text}
    </span>
  );
}

// The live page (/view/) has no demo controls: no Afprøv button, no demo dialog.
export function isLive(): boolean {
  return globalThis.location.pathname.includes('/view/');
}
