// The shell's dialogs: »Tidligere svar« (in the page area), and at the body's end the timer alarm and toast (drawn
// here, filled by TimerView and the notification queue), »Afspil på«, the demo sheet (local preview only), the task
// conflict, »Skærm og enhed« and »Tilpas widget«. Opening, closing and focus stay with the host (native
// show/showModal/close); every close reports to the host's one close handler.
import {useLayoutEffect, useRef} from 'react';
import {syncKitSlider} from '../../ui/kit.js';
import {isLive, useShell} from './Topbar';
import type {ShellStore} from './store';
import type {HistoryRow, InlineStatusData} from './view';

const BUTTON = 'pv-kit pv-kit-button pv-btn';
const DIALOG = 'pv-kit pv-kit-dialog pv-dialog';
const CLOSE = 'dialog-close pv-kit pv-kit-button pv-btn pv-dialog-close';
const ROW = 'pv-kit pv-kit-listrow pv-row';

function CloseButton({store, id, label}: {store: ShellStore; id: string; label: string}) {
  return (
    <button
      className={CLOSE}
      data-close={id}
      aria-label={label}
      data-kit="button"
      data-kit-variant="icon"
      onClick={() => store.host?.closeDialog(id)}
    >
      <img src="assets/icons/x-lg.svg" alt="" />
    </button>
  );
}

const closed = (store: ShellStore, id: string) => () => store.host?.dialogClosed(id);

type InlineStatus = HTMLElement & {data?: InlineStatusData};

function HistoryEmpty({data, hidden}: {data: InlineStatusData; hidden: boolean}) {
  const node = useRef<InlineStatus>(null);
  // pv-inline-status renders itself from its `data` property (ui/components.js).
  useLayoutEffect(() => {
    if (node.current) node.current.data = data;
  }, [data]);
  return <pv-inline-status id="history-empty" ref={node} hidden={hidden}></pv-inline-status>;
}

function HistoryEntry({store, row}: {store: ShellStore; row: HistoryRow}) {
  return (
    <article className="retained-answer" hidden={row.hidden}>
      <button
        className={`history-open ${ROW}`}
        data-kit="listrow"
        aria-label={row.label}
        onClick={() => store.host?.openHistoryAnswer(row.id)}
      >
        <img className="history-domain-icon" alt="" width={32} height={32} src={row.icon} />
        <span className="history-copy">
          <strong>{row.title}</strong>
          <span className="history-excerpt" hidden={!row.excerpt}>
            {row.excerpt}
          </span>
          <small>{row.format}</small>
        </span>
        <img className="history-chevron" src="assets/icons/chevron-right.svg" alt="" />
      </button>
    </article>
  );
}

export function HistoryDialog({store}: {store: ShellStore}) {
  const {history} = useShell(store);
  return (
    <dialog
      id="history"
      aria-labelledby="history-title"
      aria-modal="false"
      className={DIALOG}
      data-kit="dialog"
      data-kit-variant="default"
      onClose={closed(store, 'history')}
    >
      <header className="pv-dialog-header">
        <h2 id="history-title">Tidligere svar</h2>
        <CloseButton store={store} id="history" label="Tilbage til visningen" />
      </header>
      <HistoryEmpty data={history.empty} hidden={history.emptyHidden} />
      <div
        id="retained"
        className="retained pv-dialog-content"
        role="group"
        aria-label="Bevarede svar"
        hidden={history.listHidden}
      >
        {history.rows.map(row => (
          <HistoryEntry key={row.id} store={store} row={row} />
        ))}
      </div>
      <p id="history-example-note" className="history-example-note" hidden={history.exampleNoteHidden}>
        Forhåndsvisning · påvirker ikke hjemmet
      </p>
    </dialog>
  );
}

function TimerAlert() {
  return (
    <dialog
      id="timer-alert"
      className={`timer-alert ${DIALOG}`}
      aria-labelledby="timer-alert-name"
      aria-describedby="timer-alert-status"
      hidden
      data-kit="dialog"
      data-kit-variant="default"
    >
      <span className="notice-icon" aria-hidden="true">
        <img src="assets/icons/timer.svg" alt="" />
      </span>
      <div className="notice-copy pv-dialog-content">
        <small id="timer-alert-kicker"></small>
        <span id="timer-alert-name" className="pv-dialog-header">
          Timeren er færdig
        </span>
        <strong>0:00</strong>
      </div>
      <p id="timer-alert-status" role="status" hidden className="pv-dialog-description"></p>
      <button
        id="timer-alert-add"
        className={`timer-notice-add ${BUTTON}`}
        hidden
        data-kit="button"
        data-kit-variant="secondary"
      >
        +1 min
      </button>
      <button
        id="timer-alert-dismiss"
        className={`timer-notice-close ${BUTTON}`}
        data-kit="button"
        data-kit-variant="primary"
      >
        Stop
      </button>
      <button
        id="timer-alert-open"
        className={`timer-notice-open ${BUTTON}`}
        data-kit="button"
        data-kit-variant="secondary"
      >
        Luk visning
      </button>
    </dialog>
  );
}

function Rooms({store}: {store: ShellStore}) {
  const {demo} = useShell(store);
  return (
    <dialog
      id="rooms"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-title"
      className={DIALOG}
      data-kit="dialog"
      data-kit-variant="default"
      onClose={closed(store, 'rooms')}
    >
      <form method="dialog">
        <header className="pv-dialog-header">
          <h2 id="room-title">Afspil på</h2>
          <button className={CLOSE} value="close" aria-label="Luk" data-kit="button" data-kit-variant="icon">
            <img src="assets/icons/x-lg.svg" alt="" />
          </button>
        </header>
        <p className="pv-dialog-description">Vælg højttaler til din musik.</p>
        <div id="room-options" className="pv-dialog-content">
          {demo.targets.map(({target, detail, selected, disabled, revision}) => (
            <button
              key={target.targetId}
              className={ROW}
              data-kit="listrow"
              type="button"
              data-target-id={target.targetId}
              aria-pressed={selected}
              data-revision={revision}
              disabled={disabled}
              onClick={() => store.host?.chooseDemoTarget(target, Number(revision))}
            >
              <img src="assets/icons/speaker-output.svg" alt="" />
              <span>
                <strong>{target.name}</strong>
                <small>{detail}</small>
              </span>
              <span className="target-status"></span>
            </button>
          ))}
        </div>
      </form>
    </dialog>
  );
}

function Demo({store}: {store: ShellStore}) {
  const {demo} = useShell(store);
  const host = () => store.host;
  const offline = !demo.connected;
  return (
    <dialog id="demo" aria-labelledby="demo-title" onClose={closed(store, 'demo')}>
      <header>
        <h2 id="demo-title">Afprøv PodView</h2>
        <button className="dialog-close" data-close="demo" aria-label="Luk" onClick={() => host()?.closeDialog('demo')}>
          <img src="assets/icons/x-lg.svg" alt="" />
        </button>
      </header>
      <p>
        Dette er en interaktiv prototype. Vejr, musik, svar og hjemmets enheder er eksempeldata. Timeren kører lokalt.
        Der er ingen forbindelse til Voice PE eller hjemmet.
      </p>
      <div className="demo-scenarios">
        <button id="demo-music" onClick={() => host()?.demoMusic()}>
          Find musik
        </button>
        <button data-scenario="concise" disabled={offline} onClick={() => host()?.demoScenario('concise')}>
          Få et kort svar
        </button>
        <button id="demo-now" onClick={() => host()?.demoNow()}>
          Se det, der er i gang
        </button>
        <button id="start-timer" onClick={() => host()?.demoTimer()}>
          Timer · 1 minut
        </button>
        <button data-device="vacuum" onClick={() => host()?.demoDevice('vacuum')}>
          Robotstøvsuger
        </button>
        <button data-device="light" onClick={() => host()?.demoDevice('light')}>
          Lys
        </button>
      </div>
      <a className="library-link" href="patterns.html">
        Se visionen og alle tilstande
      </a>
      <a className="library-link" href="library.html">
        Gå til komponentbiblioteket
      </a>
      <details>
        <summary>Afprøv afbrydelser</summary>
        <div className="demo-scenarios">
          <button data-fault="empty" disabled={offline} onClick={() => host()?.demoFault('empty')}>
            Tomt svar
          </button>
          <button data-fault="error" disabled={offline} onClick={() => host()?.demoFault('error')}>
            Fejl ved svar
          </button>
          <button id="demo-offline" onClick={() => host()?.demoOffline()}>
            {demo.connected ? 'Afbryd forbindelsen' : 'Genopret forbindelsen'}
          </button>
          {['docked', 'complete', 'fault'].map(status => (
            <button
              key={status}
              data-device-observe={status}
              disabled={!demo.hasVacuum}
              onClick={() => host()?.demoObserve(status)}
            >
              {{docked: 'Robot ved basen', complete: 'Rengøring afsluttet', fault: 'Robotfejl'}[status]}
            </button>
          ))}
          <button id="demo-end" onClick={() => host()?.demoEnd()}>
            Afslut samtalen
          </button>
        </div>
      </details>
    </dialog>
  );
}

function Conflict({store}: {store: ShellStore}) {
  const host = () => store.host;
  return (
    <dialog
      id="conflict"
      aria-labelledby="conflict-title"
      className={DIALOG}
      data-kit="dialog"
      data-kit-variant="default"
      onClose={closed(store, 'conflict')}
    >
      <h2 id="conflict-title" className="pv-dialog-header">
        Bevar den igangværende opgave?
      </h2>
      <p className="pv-dialog-description">
        Du er midt i en opgave. Du kan fortsætte eller åbne det nye svar. Den tidligere opgave findes under Tidligere
        svar.
      </p>
      <div className="demo-scenarios pv-dialog-content pv-dialog-actions">
        <button
          id="continue-task"
          className={BUTTON}
          data-kit="button"
          data-kit-variant="secondary"
          onClick={() => host()?.resolveConflict('continue')}
        >
          Fortsæt opgaven
        </button>
        <button
          id="replace-task"
          className={BUTTON}
          data-kit="button"
          data-kit-variant="primary"
          onClick={() => host()?.resolveConflict('replace')}
        >
          Åbn det nye svar
        </button>
      </div>
    </dialog>
  );
}

const READ_ONLY = {
  className: ROW,
  'data-kit': 'listrow',
  'data-kit-variant': 'read-only',
  'data-kit-identity': 'neutral',
};

function Brightness({store}: {store: ShellStore}) {
  const {screen} = useShell(store);
  const input = useRef<HTMLInputElement>(null);
  // A native range: its value is the model's (the host re-renders after a change), its fill follows every move
  // (the kit Slider), and a value is committed on release (`change`), not per move.
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const value = String(screen.brightness);
    if (node.value !== value) node.value = value;
    syncKitSlider(node);
  }, [screen.brightness]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const paint = () => syncKitSlider(node);
    const commit = () => {
      store.host?.screenBrightness(Number(node.value));
    };
    node.addEventListener('input', paint);
    node.addEventListener('change', commit);
    return () => {
      node.removeEventListener('input', paint);
      node.removeEventListener('change', commit);
    };
  }, [store]);
  return (
    <input
      id="screen-device-brightness"
      ref={input}
      type="range"
      min="0"
      max="100"
      defaultValue="0"
      disabled={!screen.enabled}
      aria-valuetext={screen.brightnessText}
      className="pv-kit pv-kit-slider pv-slider"
      data-kit="slider"
      data-kit-identity="neutral"
    />
  );
}

function QuickSheet({store}: {store: ShellStore}) {
  const {screen, retry} = useShell(store);
  const host = () => store.host;
  return (
    <dialog
      id="quick-sheet"
      aria-labelledby="quick-title"
      className={DIALOG}
      data-kit="dialog"
      data-kit-variant="default"
      data-device-state={screen.deviceState ?? undefined}
      onClose={closed(store, 'quick-sheet')}
    >
      <header className="pv-dialog-header">
        <h2 id="quick-title">Skærm og enhed</h2>
        <CloseButton store={store} id="quick-sheet" label="Luk Skærm og enhed" />
      </header>
      <p id="screen-device-note" className="screen-explanation pv-dialog-description">
        {screen.note}
      </p>
      <div id="screen-settings-content" className="pv-dialog-content">
        <section className="screen-device-brightness" aria-labelledby="screen-device-brightness-label">
          <div className="screen-device-label">
            <label id="screen-device-brightness-label" htmlFor="screen-device-brightness">
              Lysstyrke
            </label>
            <output id="screen-device-brightness-value" htmlFor="screen-device-brightness">
              {screen.brightnessText}
            </output>
          </div>
          <Brightness store={store} />
        </section>
        <div
          id="screen-device-dimming"
          className={`screen-device-dimming ${ROW}`}
          data-kit="listrow"
          data-kit-variant="settings"
          data-kit-identity="neutral"
        >
          <span>
            <strong id="screen-device-auto-label">Automatisk dæmpning</strong>
            <small id="screen-device-dim-rule">{screen.dimRule}</small>
          </span>
          <button
            id="screen-device-auto-dim"
            type="button"
            aria-checked={screen.autoDim}
            aria-labelledby="screen-device-auto-label"
            aria-describedby="screen-device-dim-rule"
            disabled={!screen.enabled}
            className="pv-kit pv-kit-toggle pv-toggle"
            data-kit="toggle"
            data-kit-variant="settings"
            data-kit-identity="neutral"
            role="switch"
            onClick={() => host()?.screenAutoDim()}
          >
            <span id="screen-device-auto-state">{screen.autoText}</span>
          </button>
        </div>
        {/* Lærred »A-Skaerm«: »Om skærmen« is a label over open rows; the native disclosure stays open. */}
        <details id="screen-device-more" open>
          <summary
            id="screen-device-more-summary"
            className={ROW}
            data-kit="listrow"
            data-kit-variant="disclosure"
            data-kit-identity="neutral"
            onClick={event => {
              event.preventDefault();
            }}
          >
            <span>Om skærmen</span>
            <img src="assets/icons/chevron-down.svg" alt="" aria-hidden="true" />
          </summary>
          <div id="screen-device-network" className="screen-device-network">
            <div id="screen-device-wifi-row" {...READ_ONLY} hidden>
              <span>Wi-Fi</span>
              <span id="screen-device-wifi">{screen.wifi}</span>
            </div>
            <div id="screen-device-browser-row" {...READ_ONLY} hidden>
              <span>Browser</span>
              <span id="screen-device-browser">{screen.browser}</span>
            </div>
            <div id="screen-device-home-row" {...READ_ONLY}>
              <span>Home Assistant</span>
              <span id="screen-device-home" role="status" aria-label={screen.homeLabel ?? undefined}>
                {screen.home}
              </span>
            </div>
            <button
              ref={node => {
                store.keepRetryButton(node);
              }}
              className={BUTTON}
              data-kit="button"
              data-kit-variant="secondary"
              type="button"
              hidden={retry.hidden}
              aria-disabled={retry.busy}
              aria-busy={retry.busy}
              onClick={() => host()?.retryConnection()}
            >
              Prøv igen
            </button>
          </div>
          <div {...READ_ONLY} className={`${ROW} screen-build-row`}>
            <span>PodView-version</span>
            <p id="screen-device-info" className="screen-explanation">
              {screen.info}
            </p>
          </div>
          <a
            className={BUTTON}
            data-kit="button"
            data-kit-variant="secondary"
            hidden={!screen.enrollmentHref}
            href={screen.enrollmentHref ?? undefined}
          >
            Gendan skærmens adgang
          </a>
          <a
            className={BUTTON}
            data-kit="button"
            data-kit-variant="secondary"
            hidden={!screen.adminHref}
            href={screen.adminHref ?? undefined}
            onClick={event => host()?.screenAdmin(event.nativeEvent, event.currentTarget)}
          >
            Administration
          </a>
        </details>
      </div>
    </dialog>
  );
}

function Customize({store}: {store: ShellStore}) {
  const {customize} = useShell(store);
  return (
    <dialog
      id="customize-sheet"
      aria-labelledby="customize-title"
      className={DIALOG}
      data-kit="dialog"
      data-kit-variant="default"
      onClose={closed(store, 'customize-sheet')}
    >
      <header className="pv-dialog-header">
        <h2 id="customize-title">Tilpas widget</h2>
        <CloseButton store={store} id="customize-sheet" label="Luk" />
      </header>
      <div className="demo-scenarios pv-dialog-content pv-dialog-actions">
        <button
          id="pin-widget"
          aria-pressed={customize.pinned}
          className={BUTTON}
          data-kit="button"
          data-kit-variant="secondary"
          onClick={() => store.host?.togglePin()}
        >
          {customize.pinned ? 'Frigør widget' : 'Fastgør widget'}
        </button>
        <button
          id="hide-widget"
          className={BUTTON}
          data-kit="button"
          data-kit-variant="destructive"
          disabled={customize.hideDisabled}
          onClick={() => store.host?.hideWidget()}
        >
          Skjul widget
        </button>
      </div>
    </dialog>
  );
}

export function BodyDialogs({store}: {store: ShellStore}) {
  return (
    <>
      <TimerAlert />
      <p id="playback-status" className="action-feedback" role="status" aria-live="polite" hidden></p>
      <Rooms store={store} />
      {isLive() ? null : <Demo store={store} />}
      <Conflict store={store} />
      <QuickSheet store={store} />
      <Customize store={store} />
    </>
  );
}
