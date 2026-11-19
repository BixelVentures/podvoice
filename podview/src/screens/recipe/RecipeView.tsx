// Opskrifter: the controller the pre-React shell (widget-view.js) drives for the recipe screen (#recipe-view). Same
// public API and state as the old recipe-view.js: the constructor (root, back, onCookingChange, {background}),
// catalog(), recipe(), explore(), inbox(), importSource(), openFromCover(), the catalogue reads
// (refreshPublishedCatalog, refreshUploadHistory, refreshShortcut, backgroundCatalogRead, catalogRefresh.now()),
// the cooking session (active, sessions, pendingSession, persisted in localStorage) and the named parts the shell
// uses (title, goBack). The rules are unchanged: the catalogue refreshes itself every 10 s while it is shown, a
// malformed row is skipped, the session is restored only after the catalogue validates it, a recipe is deleted on
// this device only. React renders each page (Catalog, Reading, Explore, Inbox), synchronously (flushSync), so the
// page is current when a call returns, as before. Going to a page draws it anew, as before; a quiet catalogue
// refresh updates the shown page in place, so an unchanged catalogue writes nothing.
import {Fragment} from 'react';
import type {ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {Catalog} from './Catalog';
import type {CatalogActions, CatalogModel, CatalogRow} from './Catalog';
import {Explore} from './Explore';
import {ImportSource, Inbox} from './Inbox';
import type {ImportFields} from './Inbox';
import {
  alphabet,
  categoriesOf,
  collator,
  groupsOf,
  historyDate,
  isNew,
  longDate,
  nextStep,
  rangeDash,
  rankCategories,
  RECIPE_FILTERS,
  recipeCount,
  recipeSignature,
} from './model';
import type {CompletedRecipe, CookingSession, Recipe, RecipeSource, Shortcut, Upload} from './model';
import {decodePhoto, placeholder} from './photo';
import {keepFocusOnClose} from './parts';
import {Reading} from './Reading';
import type {Fact, ReadingActions, ReadingModel} from './Reading';

export {EXPLORE_DOT_PITCH, EXPLORE_DOTS, EXPLORE_PERSPECTIVE, EXPLORE_PITCH, EXPLORE_RANGE} from './model';
export {exploreFrame, exploreKeyframes, RECIPE_FILTERS, rankCategories} from './model';

const deletedKey = 'podview.deleted-recipes';
const historyKey = 'podview.recipe-history';
const sessionKey = 'podview.recipe-session.v1';
const sessionMaxAge = 30 * 86400000;

interface SessionRecord {
  version: number;
  url: string;
  signature: string;
  savedAt: number;
  steps: unknown;
  ingredients: unknown;
  expanded: unknown;
  scroll: number;
}

export interface CatalogRefresh {
  retryUploadHistory: () => void;
  now: () => Promise<void>;
  dispose: () => void;
}

interface HeroMotion {
  hero: (options: {
    source: Element | null;
    target: (() => Element | null) | Element | null;
    present: () => void;
    back?: boolean;
  }) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export class RecipeView {
  root: HTMLElement;
  back: () => void;
  onCookingChange: () => void;
  deleted = new Set<string>();
  saved: Recipe[] = [];
  uploads: Upload[] = [];
  shortcut: Shortcut | null = null;
  sources: RecipeSource[] = [];
  sessions = new Map<Recipe, CookingSession>();
  pendingSession: SessionRecord | null = null;
  history: CompletedRecipe[] = [];
  readonly sessionScroll: () => void;
  suppressPageFocus = false;
  backgroundCatalogRead: Promise<boolean> | null;
  // The recipe being cooked (undefined until one is started or restored).
  active: Recipe | null | undefined;
  // The recipe page on screen, and its heading (the shell focuses it and names the page by it).
  readingRecipe: Recipe | null = null;
  title!: HTMLElement;
  goBack: (() => void) | undefined;
  coverUrl: string | null = null;
  catalogRefresh: CatalogRefresh | null = null;
  catalogEntries: HTMLElement | null = null;
  catalogStatus: string | undefined;
  uploadHistoryStatus: string | undefined;
  publishedCatalogRead: Promise<boolean> | null = null;
  catalogScroll: number | undefined;
  catalogCategory: string | undefined;
  catalogMode: string | undefined;
  exploreIndex: number | undefined;
  uploadHistoryExpanded: boolean | undefined;
  shortcutExpanded: boolean | undefined;
  recipeHistoryExpanded: boolean | undefined;
  private reactRoot: Root | undefined;
  private pageKey = 0;
  private current: (() => ReactNode) | null = null;
  // What the catalogue's upload history and shortcut entry show; they follow the reads at their own pace.
  private uploadsShown: {list: Upload[]; status: string | undefined} = {list: [], status: undefined};
  private shortcutShown: Shortcut | null = null;
  private shortcutPanel: Shortcut | null = null;
  private shortcutGeneration = 0;
  private importFeedback = '';

  constructor(root: HTMLElement, back: () => void, onCookingChange: () => void, {background = false} = {}) {
    this.root = root;
    this.back = back;
    this.onCookingChange = onCookingChange;
    try {
      const deleted: unknown = JSON.parse(localStorage.getItem(deletedKey) ?? 'null');
      if (Array.isArray(deleted)) this.deleted = new Set(deleted as string[]);
    } catch {
      /* The catalog remains usable without storage. */
    }
    try {
      const raw = localStorage.getItem(sessionKey);
      if (raw && raw.length <= 65536) this.pendingSession = JSON.parse(raw) as SessionRecord;
      else if (raw) localStorage.removeItem(sessionKey);
    } catch {
      this.clearSession();
    }
    this.sessionScroll = () => {
      if (this.readingRecipe && this.readingRecipe === this.active) {
        const session = this.sessions.get(this.active);
        if (session) {
          session.scroll = this.root.scrollTop;
          this.persistSession();
        }
      }
    };
    this.root.addEventListener('scroll', this.sessionScroll);
    try {
      const entries: unknown = JSON.parse(localStorage.getItem(historyKey) ?? 'null');
      this.history = Array.isArray(entries)
        ? (entries as unknown[])
            .filter(
              (entry): entry is CompletedRecipe =>
                isRecord(entry) &&
                typeof entry.title === 'string' &&
                typeof entry.completedAt === 'number' &&
                Number.isFinite(new Date(entry.completedAt).getTime()),
            )
            .slice(0, 5)
        : [];
    } catch {
      this.history = [];
    }
    this.suppressPageFocus = background;
    this.catalog(!background);
    this.suppressPageFocus = false;
    // Native feel (13 Nov): the catalogue and its first photos are ready before the page opens, so it
    // never says "Henter opskrifter …" or fills in row by row and image by image.
    this.backgroundCatalogRead = background
      ? this.refreshPublishedCatalog()
          .then(changed => {
            if (changed && this.root.hidden) {
              this.suppressPageFocus = true;
              this.catalog(false);
              this.suppressPageFocus = false;
            }
            return changed;
          })
          .catch(() => false)
      : null;
  }

  // Photos are the sources' own (often full-size) images: fetch and decode the first rows quietly.
  warmImages() {
    void decodePhoto(placeholder);
    for (const recipe of this.saved.slice(0, 12)) {
      if (typeof recipe.image === 'string' && recipe.image) void decodePhoto(recipe.image);
    }
  }

  private draw(page: ReactNode) {
    if (!this.reactRoot) {
      this.root.replaceChildren();
      this.reactRoot = createRoot(this.root);
    }
    const root = this.reactRoot;
    flushSync(() => {
      root.render(<Fragment key={this.pageKey}>{page}</Fragment>);
    });
  }

  // Draw the page on screen again from the current state (React writes only what changed).
  private redraw() {
    if (this.current) this.draw(this.current());
  }

  // Leaving the page on screen. A new page is drawn anew (fresh) unless it is the catalogue refreshing itself.
  private begin(back: () => void, fresh: boolean) {
    this.stopCatalogRefresh();
    this.readingRecipe = null;
    this.goBack = back;
    if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
    this.coverUrl = null;
    delete this.root.dataset.recipeMode;
    delete this.root.dataset.recipePhase;
    if (fresh) this.pageKey++;
  }

  // Show a page: it starts at the top, the shell hears of it and its heading takes the focus.
  private present(page: () => ReactNode) {
    this.current = page;
    this.draw(page());
    const title = this.root.querySelector<HTMLElement>(':scope > header h1');
    if (title) this.title = title;
    this.root.scrollTop = 0;
    if (this.root.parentElement) this.root.parentElement.scrollTop = 0;
    this.onCookingChange();
    if (!this.suppressPageFocus) this.title.focus({preventScroll: true});
  }

  stopCatalogRefresh() {
    this.catalogRefresh?.dispose();
    this.catalogRefresh = null;
  }

  dispose() {
    this.stopCatalogRefresh();
    this.root.removeEventListener('scroll', this.sessionScroll);
  }

  persistSession() {
    const recipe = this.active;
    const session = recipe ? this.sessions.get(recipe) : undefined;
    if (!recipe || !session || typeof recipe.source?.url !== 'string') return;
    try {
      const record = JSON.stringify({
        version: 1,
        url: recipe.source.url,
        signature: recipeSignature(recipe),
        savedAt: Date.now(),
        steps: [...session.steps],
        ingredients: [...session.ingredients],
        expanded: session.ingredientsExpanded ?? true,
        scroll: session.scroll ?? 0,
      });
      if (record.length <= 65536) localStorage.setItem(sessionKey, record);
    } catch {
      /* Cooking remains usable without browser storage. */
    }
  }

  clearSession() {
    this.pendingSession = null;
    try {
      localStorage.removeItem(sessionKey);
    } catch {
      /* No storage access. */
    }
  }

  restoreSession() {
    const record = this.pendingSession;
    if (!record) return;
    this.pendingSession = null;
    try {
      const matches = this.saved.filter(recipe => recipe.source?.url === record.url);
      const recipe = matches.length === 1 ? matches[0] : undefined;
      if (!recipe) throw Error('invalid session');
      const allowed = new Set(
        groupsOf(recipe).flatMap(group => group.lines.map((_, i) => `${group.title}-${String(i)}`)),
      );
      const {steps, ingredients, expanded} = record;
      if (
        record.version !== 1 ||
        recipeSignature(recipe) !== record.signature ||
        !Number.isFinite(record.savedAt) ||
        record.savedAt > Date.now() + 60000 ||
        Date.now() - record.savedAt > sessionMaxAge ||
        typeof expanded !== 'boolean' ||
        !Number.isFinite(record.scroll) ||
        record.scroll < 0 ||
        record.scroll > 1000000 ||
        !Array.isArray(steps) ||
        steps.length > recipe.steps.length ||
        !steps.every(
          id => typeof id === 'string' && /^(0|[1-9][0-9]*)$/.test(id) && Number(id) < recipe.steps.length,
        ) ||
        new Set(steps).size !== steps.length ||
        !Array.isArray(ingredients) ||
        ingredients.length > allowed.size ||
        !ingredients.every(id => typeof id === 'string' && allowed.has(id)) ||
        new Set(ingredients).size !== ingredients.length
      )
        throw Error('invalid session');
      this.sessions.set(recipe, {
        steps: new Set(steps as string[]),
        ingredients: new Set(ingredients as string[]),
        ingredientsExpanded: expanded,
        scroll: record.scroll,
      });
      this.active = recipe;
    } catch {
      this.clearSession();
    }
  }

  async refreshPublishedCatalog(signal?: AbortSignal): Promise<boolean> {
    if (this.publishedCatalogRead) return this.publishedCatalogRead;
    const read = (async () => {
      const before = JSON.stringify(this.saved);
      const status = this.catalogStatus;
      try {
        const response = await fetch(new URL('api/recipes', document.baseURI), {
          cache: 'no-store',
          signal: signal ?? null,
        });
        if (!response.ok) throw new Error('Kataloget kunne ikke hentes');
        const {recipes} = (await response.json()) as {recipes?: unknown};
        if (!Array.isArray(recipes)) throw new Error('Ugyldigt katalog');
        const previous = new Map(this.saved.map(recipe => [recipe.source?.url, recipe]));
        // A malformed row is skipped so the rest of the catalogue still shows (O1).
        const wellFormed = (recipes as unknown[]).filter(
          (recipe): recipe is Recipe & {source: {url: string}} =>
            isRecord(recipe) &&
            typeof recipe.title === 'string' &&
            isRecord(recipe.source) &&
            typeof recipe.source.url === 'string',
        );
        const next = wellFormed
          .filter(recipe => !this.deleted.has(recipe.source.url))
          .map(recipe => {
            const existing = previous.get(recipe.source.url);
            // The open or active recipe keeps its identity even before its session is recorded.
            return existing &&
              (this.sessions.has(existing) || existing === this.active || existing === this.readingRecipe)
              ? existing
              : recipe;
          });
        // An unchanged catalogue keeps its objects: shown rows (and an open recipe) stay the catalogue's own.
        if (JSON.stringify(next) !== before) this.saved = next;
        this.catalogStatus = 'ready';
        this.warmImages();
        this.restoreSession();
      } catch {
        if (signal?.aborted) return false;
        this.catalogStatus = 'unavailable';
      }
      return status !== this.catalogStatus || before !== JSON.stringify(this.saved);
    })();
    this.publishedCatalogRead = read;
    try {
      return await read;
    } finally {
      if (this.publishedCatalogRead === read) this.publishedCatalogRead = null;
    }
  }

  async refreshUploadHistory(signal?: AbortSignal): Promise<boolean> {
    const before = JSON.stringify(this.uploads);
    const status = this.uploadHistoryStatus;
    const time = (upload: Upload) => new Date(upload.updatedAt || upload.receivedAt || NaN).getTime() || 0;
    try {
      const response = await fetch(new URL('api/recipe-upload-history', document.baseURI), {
        cache: 'no-store',
        signal: signal ?? null,
      });
      if (!response.ok) throw new Error('Uploadhistorikken kunne ikke hentes');
      const {uploads} = (await response.json()) as {uploads?: unknown};
      if (!Array.isArray(uploads)) throw new Error('Ugyldig uploadhistorik');
      if (signal?.aborted) return false;
      this.uploads = (uploads as unknown[])
        .filter(
          (upload): upload is Upload =>
            isRecord(upload) &&
            typeof upload.id === 'string' &&
            typeof upload.status === 'string' &&
            typeof upload.message === 'string',
        )
        .sort((a, b) => time(b) - time(a))
        .slice(0, 50);
      this.uploadHistoryStatus = 'ready';
    } catch {
      if (signal?.aborted) return false;
      this.uploadHistoryStatus = 'unavailable';
    }
    return status !== this.uploadHistoryStatus || before !== JSON.stringify(this.uploads);
  }

  async refreshShortcut(signal?: AbortSignal): Promise<boolean> {
    // HA administrators only: the server answers 403 to everyone else and the entry stays hidden.
    const before = JSON.stringify(this.shortcut);
    try {
      const response = await fetch(new URL('api/recipe-shortcut', document.baseURI), {
        cache: 'no-store',
        signal: signal ?? null,
      });
      const shortcut: unknown = response.ok ? await response.json() : null;
      const offered = isRecord(shortcut) && typeof shortcut.download === 'string';
      this.shortcut = offered ? (shortcut as unknown as Shortcut) : null;
    } catch {
      if (signal?.aborted) return false;
    }
    return before !== JSON.stringify(this.shortcut);
  }

  // The upload history and the shortcut entry show the latest reads.
  private renderUploads() {
    this.uploadsShown = {list: this.uploads, status: this.uploadHistoryStatus};
  }

  private renderShortcut() {
    const shortcut = this.shortcut;
    this.shortcutShown = shortcut;
    if (!shortcut) return;
    // A new offer draws the panel anew (its copy buttons and the hidden code start over).
    if (JSON.stringify(shortcut) !== JSON.stringify(this.shortcutPanel)) this.shortcutGeneration++;
    this.shortcutPanel = shortcut;
  }

  // Kept from the DOM renderer: draw the upload history again while the catalogue is shown.
  renderUploadHistory() {
    if (!this.catalogRefresh) return;
    this.renderUploads();
    this.redraw();
  }

  private catalogModel(): CatalogModel {
    // The current cooking task is pinned independently of browsing filters.
    // Only this catalogue's actual session object may own the resume row.
    const active = this.active;
    const activeRecipe = active && this.saved.includes(active) && this.sessions.has(active) ? active : null;
    const category = this.catalogCategory ?? '';
    const recipes = this.saved.filter(
      recipe => recipe !== activeRecipe && (!category || categoriesOf(recipe).includes(category)),
    );
    if (activeRecipe) recipes.unshift(activeRecipe);
    const groups = new Map<string, CatalogRow[]>();
    const seen = new Map<string, number>();
    let shown = 0; // Rows built so far: the first screenful loads eagerly.
    for (const recipe of recipes.sort((a, b) => collator.compare(a.title, b.title))) {
      const initial = (recipe.title[0] ?? '').toLocaleUpperCase('da');
      const letter = recipe === activeRecipe ? 'I gang' : alphabet.includes(initial) ? initial : '#';
      const status =
        rangeDash([recipe.portions, recipe.totalTime || recipe.baking].filter(Boolean).join(' · ')) ||
        'Gemt opskrift';
      const id = recipe.source?.url ?? recipe.title;
      const occurrence = seen.get(id) ?? 0;
      seen.set(id, occurrence + 1);
      let line = isNew(recipe) ? `Ny · ${status}` : status;
      // A-Opskrifter: the band names the current step (»Burgerboller · trin 2 af 5«); the cards show the name.
      if (recipe === activeRecipe) {
        const done = this.sessions.get(recipe)?.steps ?? new Set<string>();
        const next = nextStep(recipe, done);
        const step = next < 0 ? 'alle trin færdige' : `trin ${String(next + 1)} af ${String(recipe.steps.length)}`;
        line = `${recipe.title} · ${step}`;
      }
      const row: CatalogRow = {
        key: `${id}#${String(occurrence)}`,
        recipe,
        resume: recipe === activeRecipe,
        title: recipe.title,
        line,
        // The recipe's own publisher (or the importer's host fallback) as a label on the photo; none, no label.
        publisher: typeof recipe.publisher === 'string' ? recipe.publisher.trim() : '',
        image: recipe.image,
        eager: shown++ < 12,
      };
      const group = groups.get(letter);
      if (group) group.push(row);
      else groups.set(letter, [row]);
    }
    const categories = rankCategories(this.saved);
    const status =
      this.catalogStatus === 'unavailable'
        ? 'Kataloget kunne ikke opdateres. Åbn Opskrifter igen for at prøve igen.'
        : !this.saved.length
          ? this.catalogStatus === 'ready'
            ? 'Der er ingen opskrifter endnu.'
            : 'Henter opskrifter …'
          : '';
    const history = this.history
      .filter(entry =>
        recipes.some(
          recipe => recipe.title === entry.title && (!entry.sourceUrl || entry.sourceUrl === recipe.source?.url),
        ),
      )
      .map(({title, completedAt}, index) => ({key: String(index), title, completedAt}));
    return {
      groups: alphabet.flatMap(letter => {
        const rows = groups.get(letter);
        return rows ? [{letter, rows}] : [];
      }),
      band: groups.get('I gang')?.[0] ?? null,
      groupCount: groups.size,
      letters: alphabet.map(letter => ({letter, present: groups.has(letter)})),
      count: recipeCount(recipes.length),
      status,
      history,
      historyExpanded: this.recipeHistoryExpanded === true,
      uploads: this.uploadsShown.list,
      uploadStatus: this.uploadsShown.status,
      uploadsExpanded: this.uploadHistoryExpanded === true,
      shortcutShown: Boolean(this.shortcutShown),
      shortcutOutdated: Boolean(this.shortcutShown?.outdated),
      shortcut: this.shortcutPanel,
      shortcutGeneration: this.shortcutGeneration,
      shortcutExpanded: this.shortcutExpanded === true,
      categories,
      filters: categories.slice(0, RECIPE_FILTERS).map(entry => entry.name),
      category,
    };
  }

  catalog(refresh = true, {restoreScroll = !this.active} = {}): void {
    // Opskrifter-Bog: Udforsk is a mode of the catalogue; a recipe opened from it returns there.
    if (this.catalogMode === 'explore') {
      this.explore();
      return;
    }
    // A quiet refresh (no focus taken) updates the catalogue on screen in place; otherwise it is drawn anew.
    const fresh = !this.suppressPageFocus;
    this.begin(() => {
      this.catalogScroll = this.catalogEntries?.scrollTop;
      this.back();
    }, fresh);
    const categories = rankCategories(this.saved);
    if (!categories.some(category => category.name === this.catalogCategory)) this.catalogCategory = '';
    this.renderUploads();
    // Without an offer the entry starts empty, as a new catalogue did; an unchanged offer stays as it is.
    if (fresh || !this.shortcut) this.shortcutPanel = null;
    this.renderShortcut();
    const leave = () => {
      this.catalogScroll = this.catalogEntries?.scrollTop;
    };
    const actions: CatalogActions = {
      open: recipe => {
        leave();
        // The catalogue's current object for this recipe: a quiet refresh may have replaced the list.
        this.recipe(this.saved.find(row => row.source?.url === recipe.source?.url) ?? recipe);
      },
      chooseCategory: value => {
        this.catalogCategory = value;
        this.catalogScroll = 0;
        this.renderUploads();
        this.renderShortcut();
        this.redraw();
        if (this.catalogEntries) this.catalogEntries.scrollTop = 0;
      },
      chooseMode: mode => {
        leave();
        this.chooseMode(mode);
      },
      toggleHistory: (expanded, trigger, panel) => {
        keepFocusOnClose(expanded, trigger, panel);
        this.recipeHistoryExpanded = expanded;
        this.redraw();
      },
      toggleUploads: (expanded, trigger, panel) => {
        keepFocusOnClose(expanded, trigger, panel);
        this.uploadHistoryExpanded = expanded;
        this.redraw();
      },
      toggleShortcut: (expanded, trigger, panel) => {
        keepFocusOnClose(expanded, trigger, panel);
        this.shortcutExpanded = expanded;
        this.redraw();
      },
      retryUploads: () => {
        retryUploadHistory();
      },
    };
    this.present(() => <Catalog model={this.catalogModel()} actions={actions} />);
    const layout = this.root.querySelector<HTMLElement>(':scope > [data-recipe-layout=catalog]');
    const entries = layout?.firstElementChild as HTMLElement | null | undefined;
    if (!layout || !entries) return;
    this.catalogEntries = entries;
    entries.scrollTop = restoreScroll ? (this.catalogScroll ?? 0) : 0;
    const part = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`);
    const uploadsPanel = () => part('recipe-upload-history-panel');
    const shortcutPanel = () => part('recipe-shortcut-panel');
    const shortcutUpdate = () => part('recipe-upload-history-panel')?.parentElement?.nextElementSibling ?? null;
    const holdsFocus = (node: Element | null) => node?.contains(document.activeElement) === true;
    // A single bounded refresh loop belongs to this mounted catalog, not the widget host.
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let queued = false;
    let historyPending = false;
    let retryHistory = false;
    let shortcutPending = false;
    // Read through functions: they change while a read is awaited.
    const aborted = () => abort.signal.aborted;
    const retrying = () => retryHistory;
    const retryUploadHistory = () => {
      retryHistory = true;
      void run();
    };
    const active = () => layout.isConnected && !this.root.hidden && !document.hidden;
    const schedule = () => {
      clearTimeout(timer);
      if (active()) timer = setTimeout(() => void run(), 10000);
    };
    const run = async (): Promise<void> => {
      if (abort.signal.aborted || !active()) return;
      if (inFlight) {
        queued = true;
        return;
      }
      clearTimeout(timer);
      inFlight = true;
      const retryRequested = retryHistory;
      retryHistory = false;
      const [historyChanged, changed, shortcutChanged] = await Promise.all([
        this.refreshUploadHistory(abort.signal),
        this.refreshPublishedCatalog(abort.signal),
        this.refreshShortcut(abort.signal),
      ]);
      inFlight = false;
      if (aborted() || !active()) return;
      if (changed) {
        const scroll = entries.scrollTop;
        const rootScroll = this.root.scrollTop;
        const parentScroll = this.root.parentElement?.scrollTop ?? 0;
        const focused = document.activeElement as HTMLElement | null;
        const retainFocus = this.root.contains(focused);
        const focusedId = focused?.id;
        const focusedRecipe = focused?.dataset.recipe;
        const focusedChoice =
          focused instanceof HTMLInputElement && focused.type === 'radio'
            ? {name: focused.name, value: focused.value}
            : null;
        this.suppressPageFocus = true;
        try {
          this.catalog(false);
        } finally {
          this.suppressPageFocus = false;
        }
        if (this.catalogEntries) this.catalogEntries.scrollTop = scroll;
        this.root.scrollTop = rootScroll;
        if (this.root.parentElement) this.root.parentElement.scrollTop = parentScroll;
        if (retainFocus) {
          const restored = focusedChoice
            ? [...this.root.querySelectorAll<HTMLInputElement>('input[type=radio]')].find(
                node => node.name === focusedChoice.name && node.value === focusedChoice.value,
              )
            : focusedId
              ? [...this.root.querySelectorAll<HTMLElement>('[id]')].find(node => node.id === focusedId)
              : focusedRecipe
                ? [...this.root.querySelectorAll<HTMLElement>('[data-recipe]')].find(
                    node => node.dataset.recipe === focusedRecipe,
                  )
                : null;
          const retryFallback =
            focusedId === 'recipe-upload-history-retry' ? part('recipe-upload-history-trigger') : null;
          (restored ?? retryFallback ?? this.catalogEntries)?.focus({preventScroll: true});
        }
        if (retrying()) this.catalogRefresh?.retryUploadHistory();
        return;
      }
      // The trigger is stable. Protect focus only in the panel being replaced.
      historyPending ||= historyChanged || retryRequested;
      const panelFocused = holdsFocus(uploadsPanel());
      shortcutPending ||= shortcutChanged;
      let drawShortcut = false;
      let drawUploads = false;
      if (shortcutPending && !holdsFocus(shortcutPanel()) && !holdsFocus(shortcutUpdate())) {
        this.renderShortcut();
        shortcutPending = false;
        drawShortcut = true;
      }
      if (historyPending && (retryRequested || !panelFocused)) {
        this.renderUploads();
        historyPending = false;
        drawUploads = true;
      }
      if (drawShortcut || drawUploads) this.redraw();
      if (drawUploads && panelFocused) {
        const retry = uploadsPanel()?.querySelector<HTMLElement>('#recipe-upload-history-retry');
        (retry ?? part('recipe-upload-history-trigger'))?.focus({preventScroll: true});
      }
      if (queued) {
        queued = false;
        void run();
      } else schedule();
    };
    const visibility = () => {
      clearTimeout(timer);
      if (active()) void run();
    };
    const observer = new MutationObserver(visibility);
    observer.observe(this.root, {attributes: true, attributeFilter: ['hidden']});
    document.addEventListener('visibilitychange', visibility);
    // now(): a recipe was just saved elsewhere (Del → Home Assistant); refresh this view at once.
    this.catalogRefresh = {
      retryUploadHistory,
      now: () => run(),
      dispose: () => {
        clearTimeout(timer);
        abort.abort();
        observer.disconnect();
        document.removeEventListener('visibilitychange', visibility);
      },
    };
    if (refresh) void run();
    else schedule();
  }

  private chooseMode(mode: string) {
    this.catalogMode = mode;
    if (mode === 'explore') this.explore();
    else this.catalog(false, {restoreScroll: true});
  }

  private readingModel(recipe: Recipe, session: CookingSession): ReadingModel {
    const active = this.active === recipe;
    const current = nextStep(recipe, session.steps);
    const source = recipe.source;
    const origin = recipe.publisher || (source?.url ? new URL(source.url).hostname : '');
    const facts: Fact[] = [];
    for (const [label, value] of [
      ['Kilde', origin],
      ['Udbytte', recipe.portions],
      ['Samlet tid', recipe.totalTime],
      ['Hævning', recipe.waiting],
      ['Bagetid', recipe.baking],
      ['Tilberedningstid', recipe.cookingTime],
    ] as const) {
      if (value) facts.push([label, value]);
    }
    for (const [label, timestamp] of [
      ['Uploadet', source?.uploadedAt],
      ['Tilføjet', recipe.createdAt],
    ] as const) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
      const date = new Date(timestamp);
      facts.push([label, {date, text: longDate.format(date)}]);
    }
    if (source?.url) facts.push(['Original URL', source.url]);
    for (const file of source?.files ?? []) facts.push(['Originalfil', file.name]);
    const completions = this.history
      .filter(entry => entry.title === recipe.title && (!entry.sourceUrl || entry.sourceUrl === source?.url))
      .map(({completedAt}) => ({date: new Date(completedAt), text: historyDate.format(completedAt)}));
    const groups = groupsOf(recipe);
    return {
      recipe,
      subtitle: [
        recipe.portions,
        recipe.totalTime,
        recipe.baking,
        recipe.cookingTime && `${recipe.cookingTime} tilberedning`,
        recipe.waiting,
      ]
        .filter(Boolean)
        .join(' · '),
      active,
      current,
      progress: active
        ? current < 0
          ? 'Alle trin færdige'
          : `Trin ${String(current + 1)} af ${String(recipe.steps.length)}`
        : `${String(recipe.steps.length)} trin`,
      advanceLabel: active ? 'Afslut madlavning' : this.active ? `Fortsæt ${this.active.title}` : 'Start opskrift',
      advanceHidden: active && current >= 0,
      steps: recipe.steps,
      completed: [...session.steps],
      ingredients: [...session.ingredients],
      ingredientsExpanded: session.ingredientsExpanded ?? true,
      groups,
      isNew: isNew(recipe),
      coverUrl: this.coverUrl,
      images: [
        ...(source?.files ?? []),
        ...new Set([recipe.image, ...(recipe.images ?? [])].filter((image): image is string => Boolean(image))),
      ],
      origin,
      facts,
      completions,
    };
  }

  recipe(recipe: Recipe): void {
    const session = this.sessions.get(recipe) ?? {ingredients: new Set<string>(), steps: new Set<string>()};
    this.sessions.set(recipe, session);
    this.begin(() => {
      this.catalog(true, {restoreScroll: true});
    }, true);
    const file = recipe.source?.files[0];
    if (file) this.coverUrl = URL.createObjectURL(file);
    const updateStep = () => {
      this.root.dataset.cooking = String(Boolean(this.active));
      this.redraw();
      this.persistSession();
      this.onCookingChange();
    };
    const actions: ReadingActions = {
      toggleStep: index => {
        if (this.active !== recipe) return;
        const id = String(index);
        if (session.steps.has(id)) session.steps.delete(id);
        else session.steps.add(id);
        updateStep();
      },
      advance: () => {
        if (this.active !== recipe) {
          if (this.active) {
            this.recipe(this.active);
            return;
          }
          this.active = recipe;
          updateStep();
          return;
        }
        if (session.steps.size !== recipe.steps.length) return;
        this.history = [{title: recipe.title, sourceUrl: recipe.source?.url, completedAt: Date.now()}, ...this.history]
          .slice(0, 5);
        try {
          localStorage.setItem(historyKey, JSON.stringify(this.history));
        } catch {
          /* Keep the in-memory history. */
        }
        this.sessions.delete(recipe);
        this.active = null;
        this.clearSession();
        this.root.dataset.cooking = 'false';
        this.catalog();
      },
      reset: () => {
        this.active = null;
        this.sessions.delete(recipe);
        this.clearSession();
        this.root.dataset.cooking = 'false';
        this.catalog();
      },
      toggleIngredient: id => {
        if (session.ingredients.has(id)) session.ingredients.delete(id);
        else session.ingredients.add(id);
        this.redraw();
        this.persistSession();
      },
      toggleIngredients: (expanded, trigger, panel) => {
        keepFocusOnClose(expanded, trigger, panel);
        session.ingredientsExpanded = expanded;
        this.persistSession();
        this.redraw();
      },
      remove: close => this.remove(recipe, close),
    };
    this.present(() => <Reading model={this.readingModel(recipe, session)} actions={actions} />);
    this.readingRecipe = recipe;
    updateStep();
    if (this.active === recipe && session.scroll) this.root.scrollTop = session.scroll;
  }

  // Slet opskrift: gone from the catalogue on this device (a published recipe is remembered as deleted).
  private remove(recipe: Recipe, close: () => void): boolean {
    const url = recipe.source?.url;
    if (url && recipe.source?.recipe !== recipe) {
      const deleted = new Set([...this.deleted, url]);
      try {
        localStorage.setItem(deletedKey, JSON.stringify([...deleted]));
      } catch {
        return false;
      }
      this.deleted = deleted;
    }
    this.saved = this.saved.filter(entry => entry !== recipe);
    this.sessions.delete(recipe);
    if (this.active === recipe) {
      this.active = null;
      this.clearSession();
    }
    this.root.dataset.cooking = String(Boolean(this.active));
    if (recipe.source?.recipe === recipe) {
      this.sources = this.sources.filter(entry => entry !== recipe.source);
    }
    close();
    this.catalog();
    return true;
  }

  // Opskrifter-Bog: Udforsk, the same catalogue as a cover flow (Explore.tsx).
  explore(): void {
    this.begin(() => {
      this.back();
    }, true);
    // Set before the flow is drawn: the flow's measurements depend on it.
    this.root.dataset.recipeMode = 'explore';
    const current = this.active;
    const active = current && this.saved.includes(current) && this.sessions.has(current) ? current : null;
    const recipes = this.saved.filter(recipe => recipe !== active).sort((a, b) => collator.compare(a.title, b.title));
    if (active) recipes.unshift(active);
    const badges = recipes.map(recipe => {
      if (recipe !== active) return null;
      const next = nextStep(recipe, this.sessions.get(recipe)?.steps ?? new Set<string>());
      return next < 0 ? 'I gang' : `I gang · trin ${String(next + 1)} af ${String(recipe.steps.length)}`;
    });
    const model = {
      recipes,
      badges,
      startIndex: this.exploreIndex ?? 0,
      empty:
        this.catalogStatus === 'unavailable'
          ? 'Kataloget kunne ikke opdateres. Åbn Opskrifter igen for at prøve igen.'
          : 'Der er ingen opskrifter endnu.',
    };
    const actions = {
      chooseMode: (mode: string) => {
        this.chooseMode(mode);
      },
      shown: (index: number) => {
        this.exploreIndex = index;
      },
      open: (cover: HTMLElement, recipe: Recipe) => {
        this.openFromCover(cover, this.saved.find(row => row.source?.url === recipe.source?.url) ?? recipe);
      },
    };
    const page = <Explore model={model} actions={actions} root={this.root} />;
    this.present(() => page);
  }

  // P7 (docs/MOTION.md §3.8): the chosen Udforsk cover becomes the recipe's photo, and Tilbage flies it back.
  openFromCover(cover: HTMLElement, recipe: Recipe) {
    const host = this.root.closest<HTMLElement & {motion?: Partial<HeroMotion>}>('pv-widget-host');
    const motion = host?.motion;
    const photo = () => this.root.querySelector('[data-recipe-layout=intro] img:not([hidden])');
    const hero = motion?.hero?.bind(motion);
    if (typeof hero !== 'function') {
      this.recipe(recipe);
      return;
    }
    const open = () => {
      this.recipe(recipe);
      const back = this.goBack;
      const chosen = () =>
        this.catalogMode === 'explore' ? this.root.querySelector('[data-recipe-cover][aria-current=true]') : null;
      this.goBack = () => {
        hero({source: photo(), back: true, present: back ?? (() => undefined), target: chosen});
      };
    };
    hero({source: cover, target: photo, present: open});
  }

  inbox(): void {
    this.begin(() => {
      this.catalog();
    }, true);
    const actions = {
      add: () => {
        this.importSource();
      },
      open: (source: RecipeSource) => {
        if (source.recipe) this.recipe(source.recipe);
      },
      write: (source: RecipeSource) => {
        this.importSource(source);
      },
    };
    this.present(() => <Inbox sources={[...this.sources]} actions={actions} />);
  }

  importSource(source?: RecipeSource): void {
    this.begin(() => {
      this.inbox();
    }, true);
    this.importFeedback = '';
    const submit = (fields: ImportFields) => {
      const problem = this.saveSource(source, fields);
      if (problem === null) {
        this.inbox();
        return;
      }
      this.importFeedback = problem;
      this.redraw();
    };
    this.present(() => <ImportSource source={source ?? null} feedback={this.importFeedback} onSubmit={submit} />);
  }

  // A new source (a link or images) or its recipe text; returns what is missing, or null once it is saved.
  private saveSource(source: RecipeSource | undefined, fields: ImportFields): string | null {
    const lines = (text = '') =>
      text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (source) {
      const title = (fields.title ?? '').trim();
      const ingredients = lines(fields.ingredients);
      const steps = lines(fields.steps);
      if (!title || !ingredients.length || !steps.length) return 'Udfyld titel, ingredienser og fremgangsmåde.';
      source.title = title;
      source.recipe = {title, ingredients, steps, source, createdAt: Date.now()};
      this.saved.push(source.recipe);
      return null;
    }
    const url = (fields.url ?? '').trim();
    const files = fields.files ?? [];
    if (!url && !files.length) return 'Tilføj et link eller mindst ét billede.';
    if (url && !/^https?:\/\//i.test(url)) return 'Brug et link, der starter med https:// eller http://.';
    if (url && this.sources.some(entry => entry.url === url)) return 'Linket ligger allerede i indbakken.';
    if (files.some(file => !file.type.startsWith('image/'))) return 'Vælg filer i et billedformat.';
    this.sources.push({
      id: this.sources.length + 1,
      title: files[0]?.name || new URL(url).hostname,
      url,
      files,
      uploadedAt: Date.now(),
    });
    return null;
  }
}
