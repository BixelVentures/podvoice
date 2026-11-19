// The player's elements: the card on Home (`aside.player`), its empty state (`#player-empty`) and the full player
// (`#music-detail`) with the queue. The same elements, ids, classes, kit attributes and aria as the markup that
// was in index.html once player-view.js had set it up (kit classes, the output control before the volume, the
// empty card's live copy). The three containers stay native in index.html (the shell shows, hides and moves them);
// React draws their insides from the controller's faces (paint.ts). The tree never changes shape apart from the
// queue rows, so the nodes the controller places natively (the seek range, the output control in the empty card)
// and the properties other code paints natively (transport and volume, see player-controls.js) are left alone.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import type {Faces, Paint} from './paint';
import {props, text} from './paint';

export type SlotMode = 'eq' | 'icon' | 'text';

export interface QueueRowShape {
  key: string;
  slot: SlotMode;
}

export interface QueueShape {
  rows: readonly QueueRowShape[];
  placeholders: boolean;
  empty: boolean;
}

interface Drawn {
  faces: Faces;
  paint: Paint;
}

const KIT_BUTTON = {'data-kit': 'button'};

function Transport({paint, faces, prefix}: Drawn & {prefix: 'player' | 'detail'}) {
  const detail = prefix === 'detail';
  const icon = detail ? 'detail-play-icon' : 'play-icon';
  return (
    <>
      <button
        id={detail ? 'detail-previous' : 'previous'}
        className="round pv-kit pv-kit-button pv-btn"
        aria-label="Forrige nummer"
        {...KIT_BUTTON}
      >
        <img src="assets/icons/skip-start-fill.svg" alt="" />
      </button>
      <button
        id={detail ? 'detail-toggle' : 'play-pause'}
        className="round main-control pv-kit pv-kit-button pv-btn"
        aria-label="Sæt musik på pause"
        {...KIT_BUTTON}
      >
        <img id={icon} ref={paint.ref(icon)} src="assets/icons/pause-fill.svg" alt="" {...props(faces[icon])} />
      </button>
      <button
        id={detail ? 'detail-next' : 'next'}
        className="round pv-kit pv-kit-button pv-btn"
        aria-label="Næste nummer"
        {...KIT_BUTTON}
      >
        <img src="assets/icons/skip-end-fill.svg" alt="" />
      </button>
    </>
  );
}

function Progress({paint, faces, prefix}: Drawn & {prefix: 'player' | 'detail'}) {
  const id = (part: string) => `${prefix}-${part}`;
  const root = id('progress'), meter = id('progress-meter'), elapsed = id('elapsed'), duration = id('duration');
  return (
    <div id={root} ref={paint.ref(root)} className="player-progress" hidden {...props(faces[root])}>
      <progress
        id={meter}
        ref={paint.ref(meter)}
        max="1"
        value="0"
        aria-label="Afspilningsposition"
        {...props(faces[meter])}
      />
      <div className="player-progress-times">
        <span id={elapsed} ref={paint.ref(elapsed)} {...props(faces[elapsed])}>{text(faces[elapsed], '')}</span>
        <span id={duration} ref={paint.ref(duration)} {...props(faces[duration])}>{text(faces[duration], '')}</span>
      </div>
    </div>
  );
}

// The card on Home (inside aside.player).
export function PlayerCard({paint, faces}: Drawn) {
  const f = (key: string) => props(faces[key]);
  const t = (key: string, fallback: string) => text(faces[key], fallback);
  return (
    <>
      <button id="track" ref={paint.ref('track')} className="track" aria-label="Åbn afspilleren" {...f('track')}>
        <strong id="track-name" ref={paint.ref('track-name')} {...f('track-name')}>
          {t('track-name', 'Soft Light')}
        </strong>
        <span id="track-artist" ref={paint.ref('track-artist')} {...f('track-artist')}>
          {t('track-artist', 'North')}
        </span>
      </button>
      <p id="radio-live" ref={paint.ref('radio-live')} className="radio-live" hidden {...f('radio-live')}>
        <i aria-hidden="true"></i>
        <span ref={paint.ref('radio-live-word')} {...f('radio-live-word')}>{t('radio-live-word', 'Direkte')}</span>
      </p>
      <button
        id="player-detail"
        ref={paint.ref('player-detail')}
        className="cover-button"
        aria-label="Åbn afspilleren"
        {...f('player-detail')}
      >
        <img
          id="cover"
          ref={paint.ref('cover')}
          className="cover"
          src="assets/lake.webp"
          alt="Omslag: solnedgang over en bjergsø"
          {...f('cover')}
        />
        <span className="cover-hint">
          <img src="assets/icons/chevron-up.svg" alt="" />
        </span>
      </button>
      <Progress paint={paint} faces={faces} prefix="player" />
      <div className="transport" role="group" aria-label="Afspilningskontroller">
        <Transport paint={paint} faces={faces} prefix="player" />
      </div>
      <button
        id="output"
        ref={paint.ref('output')}
        className="output"
        aria-label="Vælg højttaler"
        aria-haspopup="dialog"
        {...f('output')}
      >
        <h2 id="player-title">
          <span id="player-state" ref={paint.ref('player-state')} {...f('player-state')}>
            {t('player-state', 'Spiller på')}
          </span>
          <span className="output-room">
            <img src="assets/icons/speaker-output.svg" alt="" />
            <strong id="player-room" ref={paint.ref('player-room')} {...f('player-room')}>
              {t('player-room', 'Stuen')}
            </strong>
          </span>
        </h2>
      </button>
      <div className="volume" ref={paint.ref('player-volume')}>
        <button
          id="volume-mute"
          ref={paint.ref('volume-mute')}
          type="button"
          className="volume-mute pv-kit pv-kit-button pv-btn"
          aria-label="Slå lyden fra"
          aria-pressed="false"
          disabled
          data-kit="button"
          data-kit-variant="icon"
          {...f('volume-mute')}
        >
          <img
            ref={paint.ref('volume-mute-icon')}
            src="assets/icons/volume-up-fill.svg"
            alt=""
            {...f('volume-mute-icon')}
          />
        </button>
        <label className="sr-only" htmlFor="volume">
          Musikkens lydstyrke
        </label>
        <input
          id="volume"
          type="range"
          min="0"
          max="100"
          defaultValue="35"
          className="pv-kit pv-kit-slider pv-slider"
          data-kit="slider"
        />
        <output id="volume-value" htmlFor="volume" className="sr-only">
          35 %
        </output>
      </div>
      <button
        id="move-here"
        ref={paint.ref('move-here')}
        className="move-here"
        type="button"
        hidden
        {...f('move-here')}
      >
        <span className="move-here-dots" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <img
          ref={paint.ref('move-here-icon')}
          src="assets/icons/speaker-output.svg"
          alt=""
          {...f('move-here-icon')}
        />
        <span id="move-here-label" ref={paint.ref('move-here-label')} {...f('move-here-label')}>
          {t('move-here-label', 'Flyt hertil')}
        </span>
      </button>
    </>
  );
}

// The empty card (inside aside#player-empty).
export function EmptyCard({paint, faces}: Drawn) {
  const f = (key: string) => props(faces[key]);
  const t = (key: string, fallback: string) => text(faces[key], fallback);
  return (
    <>
      <div className="player-empty-art" aria-hidden="true">
        <img id="empty-cover" className="live-art-fallback" src="assets/icons/music-note-beamed.svg" alt="" />
      </div>
      <div className="player-empty-copy">
        <h2 ref={paint.ref('empty-title')}>Musik</h2>
        <p
          ref={paint.ref('empty-copy')}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          {...f('empty-copy')}
        >
          {t('empty-copy', 'Ingen musik spiller lige nu')}
        </p>
      </div>
      <button id="empty-find-music" ref={paint.ref('empty-find-music')} {...f('empty-find-music')}>
        {t('empty-find-label', 'Vælg musik')}
        <small className="empty-find-context" ref={paint.ref('empty-find-context')} {...f('empty-find-context')}>
          {t('empty-find-context', '')}
        </small>
        <img src="assets/icons/chevron-right.svg" alt="" />
      </button>
    </>
  );
}

function QueueRow({paint, faces, row}: Drawn & {row: QueueRowShape}) {
  const key = `row:${row.key}`;
  const f = (part: string) => props(faces[`${key}${part}`]);
  const slot = `${key}:slot`;
  return (
    <button
      ref={paint.ref(key)}
      type="button"
      className="queue-track pv-row pv-btn pv-kit pv-kit-listrow"
      data-kit="listrow"
      data-track-id={row.key}
      {...f('')}
    >
      <span ref={paint.ref(slot)} className="queue-order" {...f(':slot')}>
        {row.slot === 'eq' ? (
          <span className="queue-eq">
            <i></i>
            <i></i>
            <i></i>
          </span>
        ) : row.slot === 'icon' ? (
          <img ref={paint.ref(`${key}:icon`)} alt="" width="24" height="24" {...f(':icon')} />
        ) : (
          text(faces[slot], '')
        )}
      </span>
      <img ref={paint.ref(`${key}:cover`)} className="queue-cover" alt="" />
      <span className="queue-copy">
        <strong ref={paint.ref(`${key}:title`)} {...f(':title')}>{text(faces[`${key}:title`], '')}</strong>
        <small ref={paint.ref(`${key}:artist`)} {...f(':artist')}>{text(faces[`${key}:artist`], '')}</small>
      </span>
      <img
        ref={paint.ref(`${key}:play`)}
        className="queue-play"
        src="assets/icons/play-fill.svg"
        alt=""
        {...f(':play')}
      />
    </button>
  );
}

// Loading keeps the list's height: empty rows of the real row anatomy, hidden from assistive technology.
function Placeholder({paint, index}: {paint: Paint; index: number}) {
  const key = `placeholder:${String(index)}`;
  return (
    <button
      ref={paint.ref(key)}
      type="button"
      className="queue-track pv-row pv-btn pv-kit pv-kit-listrow"
      data-kit="listrow"
      data-track-id={key}
      data-placeholder="true"
      aria-hidden="true"
      tabIndex={-1}
      disabled
    >
      <span className="queue-order"></span>
      <img className="queue-cover" alt="" />
      <span className="queue-copy">
        <strong></strong>
        <small></small>
      </span>
      <img className="queue-play" src="assets/icons/play-fill.svg" alt="" />
    </button>
  );
}

// The full player (inside section#music-detail).
export function PlayerDetail({paint, faces, queue}: Drawn & {queue: QueueShape}) {
  const f = (key: string) => props(faces[key]);
  const t = (key: string, fallback: string) => text(faces[key], fallback);
  return (
    <>
      <header className="response-heading">
        <button id="player-back" type="button" aria-label="Tilbage til forrige visning">
          <img src="assets/icons/chevron-left.svg" alt="" />
        </button>
        <div>
          <h1 id="detail-title" ref={paint.ref('detail-title')} tabIndex={-1} {...f('detail-title')}>
            {t('detail-title', 'Afspiller')}
          </h1>
          <p id="detail-status" ref={paint.ref('detail-status')} {...f('detail-status')}>
            {t('detail-status', '')}
          </p>
        </div>
      </header>
      <div className="now-playing-detail" ref={paint.ref('now-playing-detail')} {...f('now-playing-detail')}>
        <img id="detail-cover" ref={paint.ref('detail-cover')} alt="" className="detail-cover" {...f('detail-cover')} />
        <div className="detail-controls">
          <h2 id="detail-track" ref={paint.ref('detail-track')} {...f('detail-track')}>{t('detail-track', '')}</h2>
          <p id="detail-artist" ref={paint.ref('detail-artist')} {...f('detail-artist')}>{t('detail-artist', '')}</p>
          <Progress paint={paint} faces={faces} prefix="detail" />
          <div className="transport">
            <Transport paint={paint} faces={faces} prefix="detail" />
          </div>
          <button
            id="detail-output"
            ref={paint.ref('detail-output')}
            className="detail-output"
            aria-haspopup="dialog"
            {...f('detail-output')}
          >
            <img src="assets/icons/speaker-output.svg" alt="" />
            <span ref={paint.ref('detail-output-room')} {...f('detail-output-room')}>
              {t('detail-output-room', '')}
            </span>
          </button>
          <div className="volume">
            <label htmlFor="detail-volume" className="sr-only">
              Lydstyrke
            </label>
            <input
              id="detail-volume"
              type="range"
              min="0"
              max="100"
              defaultValue="35"
              className="pv-kit pv-kit-slider pv-slider"
              data-kit="slider"
            />
            <output id="detail-volume-value" htmlFor="detail-volume">
              35 %
            </output>
          </div>
        </div>
      </div>
      <section className="detail-queue" aria-labelledby="queue-title">
        <h2 id="queue-title" ref={paint.ref('queue-title')} {...f('queue-title')}>{t('queue-title', 'Kø')}</h2>
        <p id="queue-meta" ref={paint.ref('queue-meta')} {...f('queue-meta')}>{t('queue-meta', '')}</p>
        <div id="queue" ref={paint.ref('queue')} role="group" {...f('queue')}>
          {queue.rows.map(row => (
            <QueueRow key={row.key} paint={paint} faces={faces} row={row} />
          ))}
          {queue.placeholders
            ? [0, 1, 2, 3].map(index => <Placeholder key={index} paint={paint} index={index} />)
            : null}
          {queue.empty ? (
            <p ref={paint.ref('queue-empty')} className="queue-empty" {...f('queue-empty')}>
              {t('queue-empty', '')}
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}

// The three roots on the shell's containers, mounted once per document: the shell (widget-view.js) mounts them
// before it sets up its own listeners and kit classes on these elements; a PlayerView adopts them.
export interface PlayerRoots {
  paint: Paint;
  containers: readonly Element[];
  card: Root;
  empty: Root;
  detail: Root;
  queue: QueueShape;
  draw: () => void;
}

const SELECTORS = ['aside.player', '#player-empty', '#music-detail'] as const;
const mounted = new WeakMap<Document, PlayerRoots>();

export function playerRoots(doc: Document, paint: () => Paint): PlayerRoots {
  const containers = SELECTORS.map(selector => {
    const node = doc.querySelector(selector);
    if (!node) throw Error(`Player is missing ${selector}`);
    return node;
  });
  const existing = mounted.get(doc);
  if (existing?.containers.every((node, index) => node === containers[index])) return existing;
  const [cardNode, emptyNode, detailNode] = containers as [Element, Element, Element];
  for (const node of containers) node.replaceChildren();
  const roots: PlayerRoots = {
    paint: paint(),
    containers,
    card: createRoot(cardNode),
    empty: createRoot(emptyNode),
    detail: createRoot(detailNode),
    queue: {rows: [], placeholders: false, empty: false},
    draw() {
      const faces = roots.paint.view(), queue = roots.queue, drawn = roots.paint;
      flushSync(() => {
        roots.card.render(<PlayerCard paint={drawn} faces={faces} />);
        roots.empty.render(<EmptyCard paint={drawn} faces={faces} />);
        roots.detail.render(<PlayerDetail paint={drawn} faces={faces} queue={queue} />);
      });
      drawn.settle();
    },
  };
  mounted.set(doc, roots);
  roots.draw();
  return roots;
}
