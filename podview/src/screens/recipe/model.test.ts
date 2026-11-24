import {describe, expect, it} from 'vitest';
import {readRecipes} from '../../lib/ha/recipes';
import catalogJson from '../../../../podvoice/gatekeeper/podview_recipes.json';
import {catalog, factsOf, nextStep, phaseAt, progressOf, rangeDash, rankCategories, recipeCount} from './model';

const recipes = readRecipes(catalogJson);
const burger = recipes.find(recipe => recipe.title === 'Burgerboller');

describe('Opskrifter model', () => {
  it('reads every recipe of the add-on\'s bundled catalogue and leaves a malformed one out', () => {
    expect(recipes).toHaveLength(8);
    expect(readRecipes([{title: 'Uden trin', steps: [], source: {url: 'https://x.dk'}}, null, catalogJson[0]]))
      .toHaveLength(1);
    // One recipe per source URL.
    expect(readRecipes([catalogJson[0], catalogJson[0]])).toHaveLength(1);
  });

  it('ranks categories by count, then name, and filters the catalogue alphabetically', () => {
    expect(rankCategories(recipes).map(item => item.name)).toEqual([
      'Brød og bagværk', 'Madpakker', 'Aftensmad', 'Morgenmad',
    ]);
    expect(catalog(recipes, 'Madpakker').map(recipe => recipe.title)).toEqual([
      'Hjemmelavede müslibarer', 'Pizzaboller med hytteost', 'Protein bagels med hytteost',
    ]);
    expect(recipeCount(1)).toBe('1 opskrift');
  });

  it('names the step in progress and the phases', () => {
    if (!burger) throw new Error('Burgerboller is in the seed');
    expect(progressOf(burger, []).label).toBe('Trin 1 af 5');
    expect(progressOf(burger, [0, 2]).label).toBe('Trin 2 af 5');
    expect(progressOf(burger, [0, 1, 2, 3, 4]).label).toBe('Alle trin er gjort');
    expect(nextStep(burger, [0])).toBe(1);
    expect(phaseAt(burger, 4)).toBe('Bagning');
    expect(factsOf(burger)[0]).toBe('15 stk.');
    expect(rangeDash('12-15 min.')).toBe('12–15 min.');
  });
});
