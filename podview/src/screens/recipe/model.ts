// Opskrifter: the pure functions the catalog and the recipe page are drawn from (no DOM), with the old wall page's
// words (podview/src/screens/recipe/model.ts before 2.1.42).
import type {Recipe} from '../../lib/ha/recipes';

export interface RecipeGroup {
  title: string;
  lines: string[];
}

export const collator = new Intl.Collator('da');
export const recipeId = (recipe: Recipe) => recipe.source.url;
export const recipeCount = (count: number) => (count === 1 ? '1 opskrift' : `${String(count)} opskrifter`);
export const categoriesOf = (recipe: Recipe) => (recipe.categories?.length ? recipe.categories : ['Øvrige']);
// The catalogue's filter row holds »Alle« and at most this many categories.
export const RECIPE_FILTERS = 6;

// Number ranges read with an en dash (»12–15 min.«), as on the canvas; dates stay untouched.
const RANGE = /(?<![\d.,:-])(\d{1,3}(?:[.,]\d+)?) ?- ?(\d{1,3}(?:[.,]\d+)?)(?![\d-])/g;
export const rangeDash = (value: string) => value.replace(RANGE, '$1–$2');

// Every category with its number of recipes: most recipes first, ties alphabetically.
export function rankCategories(recipes: readonly Recipe[]): {name: string; count: number}[] {
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    for (const name of new Set(categoriesOf(recipe))) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({name, count}))
    .sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
}

// The catalogue in a category (null = Alle), alphabetically.
export function catalog(recipes: readonly Recipe[], category: string | null): Recipe[] {
  return recipes
    .filter(recipe => category === null || categoriesOf(recipe).includes(category))
    .sort((a, b) => collator.compare(a.title, b.title));
}

export const groupsOf = (recipe: Recipe): RecipeGroup[] =>
  recipe.groups ?? [{title: 'Råvarer', lines: recipe.ingredients ?? []}];

// The recipe's times as one line (»15 stk. · 2–3 timer hævning · 12–15 min. bagetid«).
export function factsOf(recipe: Recipe): string[] {
  return [recipe.portions, recipe.totalTime, recipe.cookingTime, recipe.waiting, recipe.baking]
    .filter((value): value is string => typeof value === 'string')
    .map(rangeDash);
}

// The phase title that starts at a step, if the recipe names its phases.
export const phaseAt = (recipe: Recipe, step: number) => recipe.phases?.[String(step)] ?? null;

// The first step not yet done, or −1 when every step is.
export const nextStep = (recipe: Recipe, done: readonly number[]) =>
  recipe.steps.findIndex((_, index) => !done.includes(index));

// »Trin N af M« for the step in progress (the last one when all are ticked).
export function progressOf(recipe: Recipe, done: readonly number[]): {step: number; total: number; label: string} {
  const total = recipe.steps.length;
  const next = nextStep(recipe, done);
  const step = next === -1 ? total : next + 1;
  return {step, total, label: next === -1 ? 'Alle trin er gjort' : `Trin ${String(step)} af ${String(total)}`};
}

// ---- Portions (O2/O9) and amounts --------------------------------------------------------------------------------

// The fractions the wall writes (»½ tsk«), as values and back.
const FRACTIONS: Record<string, number> = {'¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3};
const FRACTION_SIGNS: [number, string][] = [[0.25, '¼'], [0.5, '½'], [0.75, '¾']];

// One amount at the start of a line: »350«, »1½«, »1 1/2«, »½«, »0,5«, »1/2«.
const AMOUNT = String.raw`(?:\d+(?:[.,]\d+)?(?: ?[¼½¾⅓⅔]| \d\/\d)?|[¼½¾⅓⅔]|\d\/\d)`;
// The units an amount may carry; anything else is part of the ingredient's name (»2 æg«).
const UNITS = ['kg', 'g', 'l', 'dl', 'cl', 'ml', 'tsk', 'spsk', 'stk.', 'stk', 'fed', 'nip', 'håndfuld', 'knsp',
  'bdt', 'ds', 'pk'];
const QUANTITY = new RegExp(
  String.raw`^(ca\. ?)?(${AMOUNT})(?: ?[–-] ?(${AMOUNT}))?(?: (${UNITS.map(unit => unit.replace('.', String.raw`\.`))
    .join('|')}))?(?= |$)`, 'i');

export function amountValue(text: string): number {
  const trimmed = text.trim();
  const sign = Object.keys(FRACTIONS).find(key => trimmed.endsWith(key));
  if (sign) {
    const whole = trimmed.slice(0, -sign.length).trim();
    return (whole ? Number(whole.replace(',', '.')) : 0) + (FRACTIONS[sign] ?? 0);
  }
  const mixed = /^(\d+) (\d)\/(\d)$/.exec(trimmed);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d)\/(\d)$/.exec(trimmed);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(trimmed.replace(',', '.'));
}

export interface Quantity {
  /** »Ca. « when the recipe says so. */
  about: boolean;
  from: number;
  to: number | null;
  unit: string;
  /** The ingredient without its amount (»koldt vand«). */
  text: string;
}

// The amount and unit an ingredient line starts with, or null (»Sesamfrø«, »Fintrevet skal af ½ citron«).
export function quantityOf(line: string): Quantity | null {
  const match = QUANTITY.exec(line.trim());
  if (!match) return null;
  const from = amountValue(match[2] ?? '');
  const to = match[3] ? amountValue(match[3]) : null;
  if (!Number.isFinite(from) || (to !== null && !Number.isFinite(to))) return null;
  const text = line.trim().slice(match[0].length).trim();
  if (!text) return null;
  return {about: !!match[1], from, to, unit: match[4]?.toLowerCase() ?? '', text};
}

// Grams and millilitres read as whole numbers (to 5 from 100, as the canvas rounds); a litre or kilo with one
// decimal; everything counted (æg, tsk, dl, stk.) to the nearest quarter, written with ¼ ½ ¾.
const WHOLE = new Set(['g', 'ml', 'cl']);
const DECIMAL = new Set(['kg', 'l']);
export function formatAmount(value: number, unit: string): string {
  if (WHOLE.has(unit)) return String(value >= 100 ? Math.round(value / 5) * 5 : Math.max(1, Math.round(value)));
  if (DECIMAL.has(unit)) return (Math.round(value * 10) / 10).toLocaleString('da-DK');
  const quarters = Math.max(1, Math.round(value * 4));
  const whole = Math.floor(quarters / 4);
  const sign = FRACTION_SIGNS.find(([part]) => part === (quarters % 4) / 4)?.[1] ?? '';
  return `${whole ? String(whole) : ''}${sign}` || '¼';
}

// An ingredient's amount column at `factor` times the recipe (»350 ml«, »2«, »4–6 dl«), or null without one.
export function scaledAmount(quantity: Quantity, factor: number): string {
  const one = (value: number) => formatAmount(value * factor, quantity.unit);
  const amount = quantity.to === null ? one(quantity.from) : `${one(quantity.from)}–${one(quantity.to)}`;
  const unit = quantity.unit === 'stk' || quantity.unit === 'stk.' ? '' : quantity.unit;
  return `${quantity.about ? 'ca. ' : ''}${amount}${unit ? ` ${unit}` : ''}`;
}

export interface Portions {
  base: number;
  /** The word after the number (»stk.«, »personer«, »bagels«). */
  unit: string;
  step: number;
  min: number;
  max: number;
}

// The recipe's yield as a number the stepper can change (»15 stk.«, »4 personer«, »Ca. 15 stk.«); a range
// (»8–10 stk.«) or no number is not scaled.
export function portionsOf(recipe: Recipe): Portions | null {
  const match = /^(?:ca\.\s*)?(\d{1,3})\s+(\S.*)$/i.exec(recipe.portions?.trim() ?? '');
  if (!match || /^[–-]/.test(match[2] ?? '')) return null;
  const base = Number(match[1]);
  if (!base) return null;
  const step = base >= 10 ? 5 : 1;
  return {base, unit: match[2] ?? '', step, min: step, max: Math.max(base, Math.min(40, base * 4))};
}

// ---- Step timers (O3) --------------------------------------------------------------------------------------------

// The first duration a step names (»hvile 30–60 min.« → 30 min, »ca. 2–3 timer« → 2 t): a range starts at its
// shorter end, as the canvas's step timers do. None when the step names no time.
const DURATION = /(\d{1,3}(?:[.,]\d)?)(?:\s?[–-]\s?\d{1,3}(?:[.,]\d)?)?\s?(min\b|minutter|timer|time\b|t\b)/i;
export function stepMinutes(step: string): number | null {
  const match = DURATION.exec(step);
  if (!match) return null;
  const value = Number((match[1] ?? '').replace(',', '.'));
  const minutes = /^min/i.test(match[2] ?? '') ? value : value * 60;
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60 ? Math.round(minutes) : null;
}

// »30 min«, »2 t«, »1½ t«.
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  return `${formatAmount(minutes / 60, 't')} t`;
}
