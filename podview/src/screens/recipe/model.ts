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
