// Opskrifter, Katalog: the catalogue page. Same anatomy as before: the scroller (letter groups, the status line,
// Senest gennemført, how to add a recipe, the upload history and the iPhone shortcut), the alphabet index with its
// scrub marker, the »I gang« band and the toolbar (categories, »Flere«, the count and Katalog | Udforsk).
// The controller (RecipeView.tsx) decides what is shown; what depends on layout stays as it was, written after the
// render (a layout effect): which category chips fit beside »Flere«, whether the index is needed, the scrub marker.
import {useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import type {PointerEvent as ReactPointerEvent, ReactNode} from 'react';
import {collator, historyDate, recipeCount} from './model';
import type {CategoryCount, Recipe, Shortcut, Upload} from './model';
import {
  Action,
  ChoiceGroup,
  Dialog,
  Disclosure,
  kit,
  Meta,
  PageHeader,
  ReadOnlyRow,
  setAttr,
  setHidden,
  setText,
  Time,
} from './parts';
import {RecipePhoto} from './RecipePhoto';
import {openModal} from '../../lib/ui/modal';

export interface CatalogRow {
  key: string;
  recipe: Recipe;
  resume: boolean;
  title: string;
  // The resume row: »<title> · trin N af M«; otherwise the status line under the title.
  line: string;
  publisher: string;
  image: string | undefined;
  eager: boolean;
}

export interface CatalogModel {
  groups: {letter: string; rows: CatalogRow[]}[];
  band: CatalogRow | null;
  groupCount: number;
  letters: {letter: string; present: boolean}[];
  count: string;
  status: string;
  history: {key: string; title: string; completedAt: number}[];
  historyExpanded: boolean;
  uploads: Upload[];
  uploadStatus: string | undefined;
  uploadsExpanded: boolean;
  // The shortcut entry: shown while the server offers it; its panel keeps the last offer it showed.
  shortcutShown: boolean;
  shortcutOutdated: boolean;
  shortcut: Shortcut | null;
  shortcutGeneration: number;
  shortcutExpanded: boolean;
  categories: CategoryCount[];
  filters: string[];
  category: string;
}

type Toggle = (expanded: boolean, trigger: HTMLButtonElement, panel: HTMLElement) => void;

export interface CatalogActions {
  open: (recipe: Recipe) => void;
  chooseCategory: (value: string) => void;
  chooseMode: (mode: string) => void;
  toggleHistory: Toggle;
  toggleUploads: Toggle;
  toggleShortcut: Toggle;
  retryUploads: () => void;
}

const UPLOAD_LABELS: Record<string, string> = {
  saved: 'Gemt',
  duplicate: 'Findes allerede',
  received: 'Modtaget',
  importing: 'Henter',
  rejected: 'Afvist',
  failed: 'Mislykkedes',
};
const SHORTCUT_FILE = 'Opskrifter til PodView.shortcut';

function Row({row, onOpen}: {row: CatalogRow; onOpen: (recipe: Recipe) => void}) {
  return (
    <button
      {...kit('listrow', {variant: row.resume ? 'resume' : undefined})}
      type="button"
      data-recipe={row.recipe.title}
      aria-current={row.resume ? 'true' : undefined}
      onClick={() => {
        onOpen(row.recipe);
      }}
    >
      <span>
        {row.resume ? (
          <>
            <small data-kit-text="meta">I gang</small>
            <strong data-kit-text="section-title">{row.line}</strong>
          </>
        ) : (
          <>
            <strong data-kit-text="field-label">{row.title}</strong>
            <small data-kit-text="meta">{row.line}</small>
            {row.publisher ? (
              <small data-kit-text="meta" data-recipe-publisher="">
                {row.publisher}
              </small>
            ) : null}
          </>
        )}
      </span>
      {/* Full-size source photos: decode off the main thread, only near view. The first screenful loads at once:
          the page slides in from off-screen, where a lazy image would pop in mid-motion. */}
      <RecipePhoto src={row.image} decoding="async" loading={row.eager ? 'eager' : 'lazy'} alt="" />
    </button>
  );
}

function UploadRows({uploads, status, onRetry}: {uploads: Upload[]; status: string | undefined; onRetry: () => void}) {
  return (
    <>
      {uploads.map((upload, index) => {
        const timestamp = new Date(upload.updatedAt || upload.receivedAt || NaN);
        const label = UPLOAD_LABELS[upload.status] ?? 'Ukendt status';
        const message = upload.message.trim();
        const same = !message || message.toLocaleLowerCase('da') === label.toLocaleLowerCase('da');
        return (
          <ReadOnlyRow key={`${upload.id}#${String(index)}`}>
            <h3 data-kit-text="field-label">{upload.title || upload.url || 'Opskriftslink'}</h3>
            {Number.isFinite(timestamp.getTime()) ? (
              <Time date={timestamp} text={historyDate.format(timestamp)} />
            ) : null}
            <Meta>{same ? label : `${label} · ${message}`}</Meta>
          </ReadOnlyRow>
        );
      })}
      {status === 'unavailable' ? (
        <>
          <Meta>Uploadhistorikken kunne ikke hentes. De viste oplysninger kan være ældre.</Meta>
          <Action label="Prøv igen" id="recipe-upload-history-retry" onPress={onRetry} />
        </>
      ) : status === 'ready' && !uploads.length ? (
        <Meta>Der er ingen uploads endnu.</Meta>
      ) : null}
    </>
  );
}

function Download({href, label}: {href: string; label: string}) {
  return (
    <a {...kit('button', {variant: 'secondary'})} href={href} download={SHORTCUT_FILE}>
      {label}
    </a>
  );
}

// A value to copy into the iPhone shortcut; a hidden value (the upload code) is shown on »Vis«.
function CopyRow({title, value, shown}: {title: string; value: string; shown?: string}) {
  const [text, setTextShown] = useState(shown ?? value);
  const [label, setLabel] = useState('Kopiér');
  const [revealed, setRevealed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      flushSync(() => {
        setLabel('Kopieret');
      });
    } catch {
      flushSync(() => {
        setTextShown(value);
        setLabel('Markér og kopiér');
      });
    }
  };
  return (
    <ReadOnlyRow>
      <h3 data-kit-text="field-label">{title}</h3>
      <Meta>{text}</Meta>
      <Action label={label} onPress={() => void copy()} />
      {shown === undefined ? null : (
        <Action
          label="Vis"
          hidden={revealed}
          onPress={() => {
            flushSync(() => {
              setTextShown(value);
              setRevealed(true);
            });
          }}
        />
      )}
    </ReadOnlyRow>
  );
}

function ShortcutPanel({shortcut}: {shortcut: Shortcut}) {
  const address = shortcut.address || new URL('/api/podvoice/recipe-submissions', location.origin).href;
  const href = new URL(shortcut.download, document.baseURI).href;
  return (
    <>
      <Meta>
        {'Del en opskrift fra Safari eller en anden app med genvejen. ' +
          'Når du tilføjer den, spørger iPhone om to ting. Kopiér dem herfra.'}
      </Meta>
      <CopyRow title="1. PodView-adresse" value={address} />
      {shortcut.uploadCode ? (
        <CopyRow title="2. Uploadkode" value={shortcut.uploadCode} shown="Skjult" />
      ) : (
        <Meta>
          {'2. Uploadkode: ikke sat. ' + 'Angiv recipe_upload_token (mindst 32 tegn) i PodVoice-indstillingerne.'}
        </Meta>
      )}
      <Download href={href} label="Hent genvejen" />
    </>
  );
}

// Katalog | Udforsk: one segmented switch with an icon per look, the same in both, so it reads as a change of view.
export function ViewSwitch({mode, onChoose}: {mode: string; onChoose: (mode: string) => void}) {
  return (
    <ChoiceGroup
      id="recipe-mode"
      label="Visning"
      choices={[
        {value: 'catalog', label: 'Katalog'},
        {value: 'explore', label: 'Udforsk'},
      ]}
      value={mode}
      onChoose={value => {
        if (value !== mode) onChoose(value);
      }}
      data-recipe-view-switch=""
      labelData={choice => ({'data-recipe-view': choice.value})}
    />
  );
}

interface FilterParts {
  row: HTMLElement;
  chips: HTMLElement[];
  more: HTMLElement;
}

// The categories that do not stand in the row: those past the six, and those a narrow stage hid.
function restOf(parts: FilterParts, categories: CategoryCount[]) {
  return categories.filter((_, n) => n >= parts.chips.length || parts.chips[n]?.hidden === true);
}

// A narrow stage holds fewer chips: the least used move under »Flere« until the row fits. A category chosen under
// »Flere« is shown on »Flere« itself, so the choice is always in view.
function fit(parts: FilterParts, categories: CategoryCount[], category: string) {
  const {row, chips, more} = parts;
  if (!row.isConnected) return;
  const syncMore = () => {
    const names = restOf(parts, categories).map(entry => entry.name);
    const chosen = names.includes(category);
    setHidden(more, !names.length);
    setText(more, chosen ? category : 'Flere');
    setAttr(more, 'aria-pressed', String(chosen));
  };
  for (const chip of chips) setHidden(chip, false);
  syncMore();
  for (let n = chips.length - 1; n >= 0 && row.scrollWidth > row.clientWidth + 1; n--) {
    const chip = chips[n];
    if (chip) setHidden(chip, true);
    syncMore();
  }
}

function filterParts(toolbar: HTMLElement | null): FilterParts | null {
  const row = toolbar?.querySelector<HTMLElement>('#recipe-category-0')?.closest<HTMLElement>('.pv-kit-choice-options');
  const more = row?.querySelector<HTMLElement>(':scope > [data-recipe-more]');
  if (!row || !more) return null;
  return {row, more, chips: [...row.querySelectorAll<HTMLElement>(':scope > label')].slice(1)};
}

export function Catalog({model, actions}: {model: CatalogModel; actions: CatalogActions}) {
  const entries = useRef<HTMLDivElement>(null);
  const index = useRef<HTMLElement>(null);
  const marker = useRef<HTMLOutputElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  // The list »Flere« opened with, as it was then.
  const [sheetCategories, setSheetCategories] = useState<(CategoryCount & {pressed: boolean})[]>([]);
  const latest = useRef({categories: model.categories, category: model.category, groups: model.groupCount});
  const {categories, category, groupCount} = model;
  const fitKey = JSON.stringify([categories, category]);

  // The index is needed only for at least two groups that do not fit on the page.
  const updateIndex = () => {
    const list = entries.current;
    if (!list || !index.current) return;
    setHidden(index.current, latest.current.groups < 2 || list.scrollHeight <= list.clientHeight);
  };
  const fitFilters = () => {
    const parts = filterParts(toolbar.current);
    if (parts) fit(parts, latest.current.categories, latest.current.category);
  };
  useLayoutEffect(() => {
    latest.current = {categories, category, groups: groupCount};
    updateIndex();
  });
  // Refit when the categories or the choice change.
  useLayoutEffect(fitFilters, [fitKey]);
  useLayoutEffect(() => {
    const list = entries.current;
    const bar = toolbar.current;
    if (!list || !bar) return;
    const observer = new ResizeObserver(() => {
      updateIndex();
      fitFilters();
    });
    observer.observe(list);
    observer.observe(bar);
    return () => {
      observer.disconnect();
    };
    // One observer for the mounted catalogue.
  }, []);

  const jump = (letter: string) => {
    const list = entries.current;
    const group = [...(list?.querySelectorAll(':scope > section') ?? [])].find(
      section => section.querySelector(':scope > h3')?.textContent === letter,
    );
    if (list && group) list.scrollTop += group.getBoundingClientRect().top - list.getBoundingClientRect().top;
  };
  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    const buttons = [...(index.current?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])];
    const available = buttons.filter(button => !button.hidden);
    const button = available.find(item => event.clientY < item.getBoundingClientRect().bottom) ?? available.at(-1);
    const output = marker.current;
    if (!button || !output) return;
    output.value = button.textContent;
    output.style.top = `${String(button.offsetTop)}px`;
    output.hidden = false;
    jump(button.textContent);
  };
  const openSheet = () => {
    const parts = filterParts(toolbar.current);
    if (!parts) return;
    const rest = restOf(parts, categories)
      .sort((a, b) => collator.compare(a.name, b.name))
      .map(entry => ({...entry, pressed: entry.name === category}));
    flushSync(() => {
      setSheetCategories(rest);
    });
    if (sheet.current) openModal(sheet.current);
  };

  const shortcut = model.shortcut;
  const choices = [{value: '', label: 'Alle'}, ...model.filters.map(name => ({value: name, label: name}))];
  let filters: ReactNode = null;
  if (categories.length) {
    filters = (
      <>
        <ChoiceGroup
          id="recipe-category"
          label="Kategori"
          choices={choices}
          value={category}
          onChoose={actions.chooseCategory}
          after={
            <button
              {...kit('chip')}
              type="button"
              data-recipe-more=""
              aria-haspopup="dialog"
              onClick={openSheet}
            />
          }
        />
        <Dialog data-recipe-layout="categories" aria-labelledby="recipe-categories-title" ref={sheet}>
          <header className="pv-dialog-header">
            <h2 id="recipe-categories-title">Flere kategorier</h2>
            <button
              {...kit('button', {variant: 'icon', label: 'Luk', after: 'pv-dialog-close'})}
              type="button"
              onClick={() => sheet.current?.close()}
            >
              <img {...kit('icon')} src="assets/icons/x-lg.svg" alt="" />
            </button>
          </header>
          <div className="pv-dialog-content">
            {sheetCategories.map(entry => (
              <button
                key={entry.name}
                {...kit('listrow')}
                type="button"
                data-recipe-category={entry.name}
                aria-pressed={String(entry.pressed) as 'true' | 'false'}
                onClick={() => {
                  sheet.current?.close();
                  actions.chooseCategory(entry.name);
                }}
              >
                <strong data-kit-text="field-label">{entry.name}</strong>
                <small data-kit-text="meta">{recipeCount(entry.count)}</small>
              </button>
            ))}
          </div>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Opskrifter" subtitle="" />
      <div data-recipe-layout="catalog">
        {/* The scroller stays the catalogue's first child; CSS orders the band and toolbar over it. */}
        <div tabIndex={0} ref={entries}>
          {model.groups.map(group => (
            <section key={group.letter}>
              <h3 data-kit-text="group-title">{group.letter}</h3>
              {group.rows.map(row => (
                <Row key={row.key} row={row} onOpen={actions.open} />
              ))}
            </section>
          ))}
          {model.status ? <Meta>{model.status}</Meta> : null}
          {model.history.length ? (
            <Disclosure
              id="recipe-history"
              title="Senest gennemført"
              expanded={model.historyExpanded}
              onToggle={actions.toggleHistory}
            >
              {model.history.map(entry => (
                <ReadOnlyRow key={entry.key}>
                  <span data-kit-text="body">{entry.title}</span>
                  <Time date={new Date(entry.completedAt)} text={historyDate.format(entry.completedAt)} />
                </ReadOnlyRow>
              ))}
            </Disclosure>
          ) : null}
          {/* The everyday way to add a recipe; the upload-code shortcut stays as a fallback below. */}
          <Meta id="recipe-add-help">Tilføj opskrift: Del → Home Assistant fra Safari eller Chrome på iPhone.</Meta>
          <Disclosure
            id="recipe-upload-history"
            title="Uploadhistorik"
            description={
              model.uploadStatus === 'unavailable'
                ? 'Kunne ikke opdateres'
                : model.uploads.length
                  ? `${String(model.uploads.length)} seneste uploads`
                  : ''
            }
            expanded={model.uploadsExpanded}
            onToggle={actions.toggleUploads}
          >
            <UploadRows uploads={model.uploads} status={model.uploadStatus} onRetry={actions.retryUploads} />
          </Disclosure>
          <div {...kit('listrow', {variant: 'read-only'})} hidden={!model.shortcutOutdated}>
            {shortcut ? (
              <>
                <h3 data-kit-text="field-label">Ny version af genvejen</h3>
                <Meta>En iPhone brugte en ældre genvej. Hent den nye, og erstat den gamle.</Meta>
                <Download href={new URL(shortcut.download, document.baseURI).href} label="Hent ny version" />
              </>
            ) : null}
          </div>
          <Disclosure
            id="recipe-shortcut"
            title="Tilføj opskrift-genvej til iPhone"
            description={shortcut?.outdated ? 'Ny version af genvejen' : ''}
            expanded={model.shortcutExpanded}
            onToggle={actions.toggleShortcut}
            hidden={!model.shortcutShown}
          >
            {shortcut ? <ShortcutPanel key={model.shortcutGeneration} shortcut={shortcut} /> : null}
          </Disclosure>
        </div>
        <nav
          aria-label="Alfabetisk indeks"
          ref={index}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            scrub(event);
          }}
          onPointerMove={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event);
          }}
          onLostPointerCapture={() => {
            if (marker.current) marker.current.hidden = true;
          }}
        >
          {model.letters.map(({letter, present}) => (
            <button
              key={letter}
              type="button"
              className="text-control"
              hidden={!present}
              onClick={() => {
                jump(letter);
              }}
            >
              {letter}
            </button>
          ))}
          <output {...kit('card')} hidden aria-hidden="true" ref={marker} />
        </nav>
        {/* The band stands over the toolbar (A-Opskrifter): the current cooking task, pinned past every filter. */}
        <aside data-recipe-layout="band">
          {model.band ? (
            <section>
              <Row row={model.band} onOpen={actions.open} />
            </section>
          ) : null}
        </aside>
        {/* A-Opskrifter: the toolbar holds the categories, the count and the Katalog | Udforsk switch only. */}
        <header data-recipe-layout="toolbar" ref={toolbar}>
          {filters}
          <div>
            <span data-kit-text="meta" data-recipe-count="">
              {model.count}
            </span>
            <ViewSwitch mode="catalog" onChoose={actions.chooseMode} />
          </div>
        </header>
      </div>
    </>
  );
}
