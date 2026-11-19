// Opskrifter: the recipe catalogue's data shapes and the pure functions the screen is drawn from (no DOM).

export interface RecipeGroup {
  title: string;
  lines: string[];
}

export interface RecipeSource {
  url?: string;
  uploadedAt?: number;
  files: File[];
  // A source added in this browser view (Indbakke): its id, title and the recipe written from it.
  id?: number;
  title?: string;
  recipe?: Recipe;
}

export interface Recipe {
  title: string;
  categories?: string[];
  steps: string[];
  ingredients?: string[];
  groups?: RecipeGroup[];
  phases?: (string | null | undefined)[];
  portions?: string;
  totalTime?: string;
  baking?: string;
  cookingTime?: string;
  waiting?: string;
  description?: string;
  publisher?: string;
  image?: string;
  images?: string[];
  source?: RecipeSource;
  createdAt?: number;
}

export interface CookingSession {
  steps: Set<string>;
  ingredients: Set<string>;
  ingredientsExpanded?: boolean;
  scroll?: number;
}

export interface CompletedRecipe {
  title: string;
  sourceUrl?: string | undefined;
  completedAt: number;
}

export interface Upload {
  id: string;
  status: string;
  message: string;
  title?: string;
  url?: string;
  updatedAt?: string;
  receivedAt?: string;
}

export interface Shortcut {
  download: string;
  address?: string;
  uploadCode?: string;
  outdated?: unknown;
}

// Opskrifter-Bog cover flow as a pure function of the fractional index p (docs/MOTION.md, Udforsk). At whole p it
// is the canvas: the chosen cover flat, neighbours ±(430+(a−1)·110) px, −260−(a−1)·60 px deep, turned 55° away
// and shaded .18 (an overlay, not a filter). Between whole values every number is continuous; the turn eases in
// with a smoothstep so it does not kink at the centre. Covers past 3.5 are hidden. The title cross-fades through
// 0 at the half-way point; the dots weigh 1−|k−p|. Reduced: the covers stand flat and the photos keep still.
export const EXPLORE_PITCH = 430;
export const EXPLORE_DOTS = 7;
export const EXPLORE_DOT_PITCH = 16;

export type ExploreCover =
  | {visibility: 'hidden'; d: number}
  | {visibility: 'visible'; d: number; z: number; shade: number; transform: string; parallax: string};

export interface ExploreDot {
  k: number;
  transform: string;
  opacity: number;
}

export interface ExploreFrame {
  index: number;
  covers: ExploreCover[];
  textOpacity: number;
  dots: {start: number; items: ExploreDot[]};
}

export function exploreFrame(p: number, count: number, {reduced = false} = {}): ExploreFrame {
  const index = Math.max(0, Math.min(count - 1, Math.round(p)));
  const covers = Array.from({length: count}, (_, k): ExploreCover => {
    const d = k - p;
    const a = Math.abs(d);
    const s = Math.sign(d);
    if (a > 3.5) return {visibility: 'hidden', d};
    const near = a <= 1;
    const ease = a * a * (3 - 2 * a);
    const x = near ? d * EXPLORE_PITCH : s * (EXPLORE_PITCH + (a - 1) * 110);
    const z = reduced ? 0 : near ? -260 * a : -260 - (a - 1) * 60;
    const turn = reduced ? 0 : near ? -s * 55 * ease : -s * 55;
    const shade = near ? 0.18 * a : 0.18;
    return {
      visibility: 'visible',
      d,
      z: 20 - Math.round(a),
      shade: Number(shade.toFixed(4)),
      transform: `translate3d(${String(x)}px,0,${String(z)}px) rotateY(${String(turn)}deg)`,
      parallax: reduced ? 'none' : `translateX(${String(-d * 24)}px)`,
    };
  });
  const textOpacity = Math.abs(2 * (p - Math.floor(p)) - 1);
  const shown = Math.min(EXPLORE_DOTS, count);
  const start = Math.max(0, Math.min(index - 3, count - shown));
  const items = Array.from({length: shown}, (_, o) => {
    const k = start + o;
    const w = Math.max(0, 1 - Math.abs(k - p));
    const edge = (o === 0 && start > 0) || (o === shown - 1 && start + shown < count);
    return {k, w, edge};
  });
  // A wider dot pushes the ones after it: x is the sum of the widths before (8 + 16·w each, 8 apart).
  let x = 0;
  const dots = items.map(({k, w, edge}) => {
    const scale = 1 + 2 * w;
    const at = x;
    x += 8 * scale + 8;
    return {
      k,
      transform: `translateX(${String(at)}px) scale(${String((edge ? 0.6 : 1) * scale)},${String(edge ? 0.6 : 1)})`,
      opacity: Number((0.35 + 0.65 * w).toFixed(4)),
    };
  });
  return {index, covers, textOpacity: Number(textOpacity.toFixed(4)), dots: {start, items: dots}};
}

export interface ExploreKeyframe {
  offset: number;
  d: number;
  z: number;
  shade: number;
  transform: string;
  photo: string;
}

// The flow scrolls natively (scroll-snap) and each cover follows its own view timeline (ui-kit.css): the keyframes
// are exploreFrame sampled over d = k − p from +3.5 (offset 0) to −3.5 (offset 100%), every eighth of a cover
// within |d| ≤ 1; beyond it every value is linear in d. The cover already sits d·430px from the centre in the scroll
// layout, so its transform first moves the perspective back to the flow's centre (translateX(−d·430px)
// perspective(1600px)), then applies the canvas position translate3d(x,0,z) and the turn. ui-kit.css carries the
// result; explore.test.js keeps the two identical.
export const EXPLORE_RANGE = 3.5;
export const EXPLORE_PERSPECTIVE = 1600;
export function exploreKeyframes({reduced = false} = {}): ExploreKeyframe[] {
  const ds = [EXPLORE_RANGE, ...Array.from({length: 17}, (_, i) => 1 - i / 8), -EXPLORE_RANGE];
  const round = (n: number) => String(Number(n.toFixed(3)) + 0);
  return ds.map(d => {
    const cover = exploreFrame(-d, 1, {reduced}).covers[0];
    if (cover?.visibility !== 'visible') throw Error('A sampled cover is always visible');
    const match = /translate3d\((.+)px,0,(.+)px\) rotateY\((.+)deg\)/.exec(cover.transform);
    const [x = 0, z = 0, turn = 0] = (match?.slice(1) ?? []).map(Number);
    return {
      offset: Number(round(((EXPLORE_RANGE - d) / (2 * EXPLORE_RANGE)) * 100)),
      d,
      z: 20 - Math.round(Math.abs(d)),
      shade: cover.shade,
      transform:
        `translateX(${round(-d * EXPLORE_PITCH)}px) perspective(${String(EXPLORE_PERSPECTIVE)}px) ` +
        `translate3d(${round(x)}px,0,${round(z)}px) rotateY(${round(turn)}deg)`,
      photo: reduced ? 'none' : `translateX(${round(-d * 24)}px)`,
    };
  });
}

// Number ranges read with an en dash (»12–15 min.«, »kl. 14–15«), as on the canvas; dates stay untouched.
const RANGE = /(?<![\d.,:-])(\d{1,3}(?:[.,]\d+)?) ?- ?(\d{1,3}(?:[.,]\d+)?)(?![\d-])/g;
export const rangeDash = (text: string) => text.replace(RANGE, '$1–$2');

// eslint-disable-next-line @typescript-eslint/no-misused-spread -- single letters, one code unit each
export const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ#'];
export const collator = new Intl.Collator('da');
// The catalogue's filter row holds »Alle« and at most this many categories; the rest are under »Flere«.
export const RECIPE_FILTERS = 6;
export const recipeCount = (count: number) => (count === 1 ? '1 opskrift' : `${String(count)} opskrifter`);
export const categoriesOf = (recipe: Recipe) => (recipe.categories?.length ? recipe.categories : ['Øvrige']);

export interface CategoryCount {
  name: string;
  count: number;
}

// Every category of the catalogue with its number of recipes: most recipes first, ties alphabetically.
export function rankCategories(recipes: Recipe[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    for (const name of new Set(categoriesOf(recipe))) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({name, count}))
    .sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
}

export const groupsOf = (recipe: Recipe): RecipeGroup[] =>
  recipe.groups ?? [{title: 'Råvarer', lines: recipe.ingredients ?? []}];
// The identity of a recipe's cooking state: its steps and ingredient lines.
export const recipeSignature = (recipe: Recipe) =>
  JSON.stringify([recipe.steps, recipe.groups ?? [{title: 'Råvarer', lines: recipe.ingredients}]]);
export const historyDate = new Intl.DateTimeFormat('da-DK', {dateStyle: 'medium', timeStyle: 'short'});
export const longDate = new Intl.DateTimeFormat('da-DK', {dateStyle: 'long'});
const WEEK = 7 * 86400000;
// »Ny« for a week after the recipe was uploaded (or added).
export const isNew = (recipe: Recipe) => {
  const age = Date.now() - (recipe.source?.uploadedAt ?? recipe.createdAt ?? NaN);
  return age >= 0 && age < WEEK;
};
// The first step not yet done, or −1 when every step is.
export const nextStep = (recipe: Recipe, done: Set<string>) => recipe.steps.findIndex((_, i) => !done.has(String(i)));
