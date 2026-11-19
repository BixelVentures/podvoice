// Svar: the »I dag« / »Tidligere svar« column of the Svar page (#svar-today, lærred »A-SvarKort«), driven by the
// shell (widget-view.js renderSvarToday). Same API as the pre-React svar-today-view.js: render(rows, visible), named
// parts title/list/newer, and open(id) for a row the user picks. React draws the column synchronously (flushSync);
// rows are keyed per answer, so an arriving answer enters with the list motion (ui/list-motion.js, docs/MOTION.md
// P4) and the others make room. An unchanged list draws nothing.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {animateList} from '../../../ui/list-motion.js';
import {svarNewLabel, svarUnseenCount} from './today';
import type {SvarRow} from './today';

export {svarDomain, svarNewLabel, svarTime, svarTodayRows, svarUnseenCount} from './today';
export type {SvarRow} from './today';

interface NewerView {
  hidden: boolean;
  // The label and spoken label it was last given ('' before the first count).
  label: string;
  ariaLabel: string | null;
}

const ICON_STYLE = '--pv-icon-source:url("assets/icons/chevron-up.svg")';
const iconSource = (node: HTMLElement | null) => {
  if (node && node.getAttribute('style') !== ICON_STYLE) node.setAttribute('style', ICON_STYLE);
};

interface ColumnProps {
  heading: string;
  rows: SvarRow[];
  newer: NewerView;
  onNewer: () => void;
  onOpen: (row: SvarRow) => void;
}

function SvarColumn({heading, rows, newer, onNewer, onOpen}: ColumnProps) {
  return (
    <>
      <header>
        <h2 id="svar-today-title">{heading}</h2>
        <span>Nyeste øverst</span>
      </header>
      {/* »1 nyt svar« floats over the list (K-Btn 44, primary, up icon); it never pushes the rows. */}
      <button
        type="button"
        className="svar-today-new pv-kit pv-kit-button pv-btn"
        data-kit="button"
        data-kit-variant="primary"
        data-kit-size={newer.label ? '44' : undefined}
        data-kit-content={newer.label ? 'icon-label' : undefined}
        aria-label={newer.ariaLabel ?? undefined}
        hidden={newer.hidden}
        onClick={onNewer}
      >
        {newer.label && (
          <>
            {/* The K-Btn icon slot (ui/kit.js syncKitButtonContent); its style attribute is written as the kit
                writes it. */}
            <span className="--24 pv-kit pv-kit-icon pv-icon" data-kit="icon" aria-hidden="true" ref={iconSource} />
            <span data-kit-slot="label">{newer.label}</span>
          </>
        )}
      </button>
      <div className="svar-today-rows" role="group" aria-labelledby="svar-today-title">
        {rows.map(row => (
          // One line: the kind's icon in its category chip, the title, the time.
          <button
            key={row.id}
            type="button"
            className="svar-today-row"
            data-answer-id={row.id}
            data-domain={row.domain || 'answer'}
            aria-current={row.current ? 'true' : undefined}
            aria-label={`${row.kindLabel} · ${row.title} · ${row.time}`}
            onClick={() => {
              onOpen(row);
            }}
          >
            <span className="svar-today-chip">
              <img className="svar-today-icon" alt="" src={`assets/icons/${row.icon || 'chat-circle'}.svg`} />
            </span>
            <strong className="svar-today-title">{row.title}</strong>
            <time>{row.time}</time>
          </button>
        ))}
      </div>
    </>
  );
}

export class SvarTodayView {
  root: HTMLElement;
  open: (id: string) => void;
  title!: HTMLElement;
  list!: HTMLElement;
  newer!: HTMLButtonElement;
  rows: SvarRow[] = [];
  seen: Set<string> | null = null;
  signature = '';
  private drawn: SvarRow[] = [];
  private heading = 'I dag';
  private newerView: NewerView = {hidden: true, label: '', ariaLabel: null};
  private readonly reactRoot: Root;

  constructor(root: HTMLElement, open: (id: string) => void) {
    this.root = root;
    this.open = open;
    root.replaceChildren();
    this.reactRoot = createRoot(root);
    this.draw();
    const part = (selector: string) => {
      const node = root.querySelector<HTMLElement>(selector);
      if (!node) throw Error(`Svar column is missing ${selector}`);
      return node;
    };
    this.title = part('h2');
    this.list = part('.svar-today-rows');
    this.newer = part('.svar-today-new') as HTMLButtonElement;
    this.list.addEventListener('scroll', () => {
      this.updateNewer();
    }, {passive: true});
  }

  atTop(): boolean {
    return !(this.list.scrollTop > 8);
  }

  jumpToNewest() {
    const newest = this.rows[0];
    if (!newest) return;
    this.list.scrollTop = 0;
    this.seen = new Set(this.rows.map(row => row.id));
    this.updateNewer();
    if (!newest.current) this.open(newest.id);
  }

  updateNewer() {
    const rows = this.rows;
    this.seen ??= new Set(rows.map(row => row.id));
    const seen = this.seen;
    for (const row of rows) if (row.current) seen.add(row.id);
    if (rows[0]?.current && this.atTop()) for (const row of rows) seen.add(row.id);
    const count = svarUnseenCount(rows, seen);
    const label = svarNewLabel(count);
    const next = {...this.newerView, hidden: !count};
    if (count && next.label !== label) {
      next.label = label;
      next.ariaLabel = `Vis nyeste svar · ${label}`;
    }
    if (next.hidden === this.newerView.hidden && next.label === this.newerView.label) return;
    this.newerView = next;
    this.draw();
  }

  render(rows: SvarRow[], visible: boolean) {
    if (this.root.hidden !== !visible) this.root.hidden = !visible;
    if (!visible) {
      this.seen = null;
      this.rows = [];
      this.signature = '';
      return;
    }
    this.rows = rows;
    const signature = JSON.stringify(rows);
    if (signature === this.signature) {
      this.updateNewer();
      return;
    }
    this.signature = signature;
    this.heading = rows.every(row => row.today) ? 'I dag' : 'Tidligere svar';
    const before = this.drawn.map(row => row.id).join('\n');
    this.drawn = rows;
    // Rows are kept per answer, so an arriving answer enters with the list motion and the others make room.
    if (before === rows.map(row => row.id).join('\n')) this.draw();
    else
      animateList(this.list, () => {
        this.draw();
      });
    this.updateNewer();
  }

  private readonly choose = (row: SvarRow) => {
    if (!row.current) this.open(row.id);
  };

  private readonly toNewest = () => {
    this.jumpToNewest();
  };

  private draw() {
    const props = {heading: this.heading, rows: this.drawn, newer: this.newerView, onNewer: this.toNewest,
      onOpen: this.choose};
    flushSync(() => {
      this.reactRoot.render(<SvarColumn {...props} />);
    });
  }
}
