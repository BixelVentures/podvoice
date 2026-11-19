// The PodView shell as a React tree: the topbar, the frame with its page containers, the player columns and the
// body-level dialogs, as podview/index.html had them. The host (pv-widget-host, widget-view.js) keeps the state
// machine; the screens' controllers mount into the page containers drawn here. Every container's child list is
// fixed (a part shows and hides with `hidden`, never by mounting), because other code moves and inserts nodes inside
// them (the voice surface moves the Svar button, the overview orders its cards, page motion adds its plate).
import {createPortal} from 'react-dom';
import {Topbar} from './Topbar';
import {Overview} from './Overview';
import {BodyDialogs, HistoryDialog} from './Dialogs';
import {RoPhoto} from './Ro';
import type {ShellStore} from './store';
import type {DetailedHTMLProps, HTMLAttributes} from 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-widget-host': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      'pv-activity-timeline': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      'pv-inline-status': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

function DeviceView({store}: {store: ShellStore}) {
  return (
    <section
      id="device-view"
      className="response-widget pv-kit-template pv-kit-template-detail"
      data-kit-template="detail"
      hidden
    >
      <header className="response-heading">
        <button
          id="device-back"
          className="detail-back"
          type="button"
          aria-label="Tilbage til forrige visning"
          onClick={() => store.host?.deviceBack()}
        >
          <img src="assets/icons/chevron-left.svg" alt="" />
        </button>
        <div data-customize="device">
          <h1 id="device-title"></h1>
          <p id="device-status"></p>
        </div>
      </header>
      <div id="device-detail"></div>
      <section className="device-history" aria-labelledby="device-history-title">
        <h2 id="device-history-title">Seneste hændelser</h2>
        <pv-activity-timeline id="device-timeline"></pv-activity-timeline>
      </section>
      <p className="device-disclaimer"></p>
    </section>
  );
}

function Responses({store}: {store: ShellStore}) {
  return (
    <section className="responses" aria-label="Svar og aktiviteter" tabIndex={0}>
      <section
        id="music-detail"
        hidden
        aria-labelledby="detail-title"
        className="pv-kit-template pv-kit-template-detail"
        data-kit-template="detail"
      ></section>
      <RoPhoto store={store} />
      <section
        id="timers-view"
        className="response-widget timers-view pv-kit-template pv-kit-template-detail"
        data-kit-template="detail"
        hidden
      ></section>
      <section
        id="weather-view"
        className="response-widget weather-view pv-kit-template pv-kit-template-detail"
        data-kit-template="detail"
        hidden
        aria-label="Vejrudsigt"
      ></section>
      <section
        id="recipe-view"
        className="response-widget pv-kit-template pv-kit-template-detail"
        data-kit-template="detail"
        hidden
        aria-label="Opskrifter"
      ></section>
      <section
        id="radio-view"
        className="response-widget pv-kit-template pv-kit-template-detail"
        data-kit-template="detail"
        hidden
        aria-label="Radio"
      ></section>
      <section
        id="vehicle-view"
        className="response-widget pv-kit-template pv-kit-template-detail"
        data-kit-template="detail"
        hidden
        aria-label="Tesla"
      ></section>
      <article
        id="music-response"
        hidden
        className="response-widget pv-kit-template pv-kit-template-detail"
        data-kit-template="detail"
        aria-label="Find musik"
      >
        <div id="find-musik"></div>
      </article>
      <section id="answer-host" aria-label="Svar"></section>
      <DeviceView store={store} />
      <Overview store={store} />
      <div
        id="resource-rail"
        className="resource-rail"
        role="group"
        aria-label="Aktiviteter der fortsætter"
        hidden
      ></div>
      <HistoryDialog store={store} />
    </section>
  );
}

export function Shell({store, body}: {store: ShellStore; body: HTMLElement}) {
  return createPortal(
    <>
      <pv-widget-host>
        <Topbar store={store} />
        <main className="frame" aria-label="PodView">
          <Responses store={store} />
          <aside className="player" hidden aria-labelledby="player-title"></aside>
          <aside id="player-empty" className="player-empty" hidden></aside>
          <aside id="svar-today" className="svar-today" hidden aria-labelledby="svar-today-title">
            <header>
              <h2 id="svar-today-title">I dag</h2>
              <span>Nyeste øverst</span>
            </header>
            <div className="svar-today-rows" role="group" aria-labelledby="svar-today-title"></div>
          </aside>
        </main>
        <div className="bottom-gesture-zone" aria-hidden="true"></div>
      </pv-widget-host>
      <BodyDialogs store={store} />
    </>,
    body,
  );
}
