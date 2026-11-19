// Find musik (concept B, »Hylder«): six quick picks, then horizontal cover shelves that interleave the household's
// own library with a few AI shelves. One long page that scrolls vertically; each shelf is a native horizontal
// scroll-snap container (iPadOS's own momentum; no JavaScript per frame, docs/MOTION.md). Covers fade in once
// decoded, so nothing pops in half-drawn; the first twelve load eagerly. React draws only from the model: an
// unchanged model draws nothing, and a tap goes to the controller, which owns the start.
import {memo} from 'react';
import type {SyntheticEvent} from 'react';
import {aiBadge, tileSubtitle} from './model';
import type {QuickPick, Shelf, ShelfItem} from './model';
import './find-musik.css';

export interface FindMusikModel {
  items: ShelfItem[];
  quick: QuickPick[];
  shelves: Shelf[];
  // Copy for an empty page (no shelves at all); null while the first read may still bring shelves.
  empty: string | null;
  // A short, self-clearing message about one tap (never a lasting text).
  toast: string | null;
  toastKey: number;
  now: number;
}

export interface FindMusikActions {
  choose: (row: ShelfItem) => void;
}

const EAGER = 12;
const decoded = new Set<string>();

// The cover is shown only when its pixels are decoded; a known image is shown at once on a later draw.
function reveal(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  const url = image.currentSrc || image.src;
  const show = () => {
    decoded.add(url);
    if (image.isConnected && image.getAttribute('src') === url) image.dataset.ready = '';
  };
  void (typeof image.decode === 'function' ? image.decode().then(show, show) : Promise.resolve().then(show));
}

function Cover({row, eager}: {row: ShelfItem; eager: boolean}) {
  return (
    <span className="find-art" aria-hidden="true">
      {row.artwork ? (
        <img
          key={row.artwork}
          src={row.artwork}
          alt=""
          draggable={false}
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
          onLoad={reveal}
          {...(decoded.has(row.artwork) ? {'data-ready': ''} : {})}
        />
      ) : null}
    </span>
  );
}

const QuickTile = memo(function QuickTile({row, ai, eager, choose}: {row: ShelfItem; ai: string | undefined;
  eager: boolean; choose: (row: ShelfItem) => void}) {
  return (
    <button type="button" className="find-quick-tile" data-uri={row.uri} onClick={() => { choose(row); }}>
      <Cover row={row} eager={eager} />
      <span className="find-quick-copy">
        <strong>{row.name}</strong>
        {ai ? <small className="find-ai-line">{aiBadge(ai)}</small> : null}
      </span>
    </button>
  );
});

const Tile = memo(function Tile({row, subtitle, round, eager, choose}: {row: ShelfItem; subtitle: string;
  round: boolean; eager: boolean; choose: (row: ShelfItem) => void}) {
  return (
    <button type="button" className="find-tile" data-uri={row.uri} data-shape={round ? 'round' : 'square'}
      onClick={() => { choose(row); }}>
      <Cover row={row} eager={eager} />
      <strong>{row.name}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </button>
  );
});

function ShelfView({shelf, items, now, eagerFrom, choose}: {shelf: Shelf; items: ShelfItem[]; now: number;
  eagerFrom: number; choose: (row: ShelfItem) => void}) {
  const heading = `find-shelf-${shelf.id}`;
  return (
    <section className="find-shelf" data-shelf={shelf.id} aria-labelledby={heading}>
      <header className="find-shelf-head">
        <div className="find-shelf-title">
          <h2 id={heading}>{shelf.title}</h2>
          {shelf.ai ? <span className="find-ai-badge">AI-valgt</span> : null}
        </div>
        {shelf.why ? <p className="find-why">{shelf.why}</p> : null}
      </header>
      <div className="find-shelf-row" role="list" aria-label={shelf.title}>
        {shelf.items.map((index, position) => {
          const row = items[index];
          return row ? (
            <div role="listitem" key={row.uri} className="find-slot">
              <Tile row={row} subtitle={tileSubtitle(row, shelf, now)} round={shelf.shape === 'round'}
                eager={eagerFrom + position < EAGER} choose={choose} />
            </div>
          ) : null;
        })}
      </div>
    </section>
  );
}

export function FindMusik({model, actions}: {model: FindMusikModel; actions: FindMusikActions}) {
  const {items, quick, shelves} = model;
  // Where each shelf starts in reading order: the first twelve covers load eagerly.
  const starts: number[] = [];
  let next = quick.length;
  for (const shelf of shelves) {
    starts.push(next);
    next += shelf.items.length;
  }
  return (
    <div className="find-musik">
      {quick.length ? (
        <div className="find-quick" role="list" aria-label="Hurtige valg">
          {quick.map(pick => {
            const row = items[pick.item];
            return row ? (
              <div role="listitem" key={row.uri} className="find-slot">
                <QuickTile row={row} ai={pick.ai} eager choose={actions.choose} />
              </div>
            ) : null;
          })}
        </div>
      ) : null}
      {shelves.map((shelf, index) => (
        <ShelfView key={shelf.id} shelf={shelf} items={items} now={model.now} eagerFrom={starts[index] ?? 0}
          choose={actions.choose} />
      ))}
      {!shelves.length && !quick.length && model.empty ? <p className="find-empty">{model.empty}</p> : null}
      <p className="find-toast" role="status" aria-live="polite" hidden={!model.toast} key={model.toastKey}>
        {model.toast ?? ''}
      </p>
    </div>
  );
}
