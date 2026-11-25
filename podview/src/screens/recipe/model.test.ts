import {describe, expect, it} from 'vitest';
import {readRecipes} from '../../lib/ha/recipes';
import catalogJson from '../../../../podvoice/gatekeeper/podview_recipes.json';
import {
  catalog, factsOf, formatAmount, minutesLabel, nextStep, phaseAt, portionsOf, progressOf, quantityOf, rangeDash,
  rankCategories, recipeCount, scaledAmount, stepMinutes,
} from './model';

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

  it('reads an ingredient\'s amount and unit, and scales it with the portions (O9)', () => {
    const scale = (line: string, factor: number) => {
      const quantity = quantityOf(line);
      return quantity ? `${scaledAmount(quantity, factor)} | ${quantity.text}` : null;
    };
    expect(scale('630 g hvedemel', 1)).toBe('630 g | hvedemel');
    expect(scale('630 g hvedemel', 20 / 15)).toBe('840 g | hvedemel');
    expect(scale('350 ml koldt vand', 20 / 15)).toBe('465 ml | koldt vand');
    expect(scale('2 æg', 1)).toBe('2 | æg');
    // Counted things round to whole numbers or halves (G7 #24): never »2¾ æg«.
    expect(scale('2 æg', 20 / 15)).toBe('2½ | æg');
    expect(scale('3 fed hvidløg', 0.5)).toBe('1½ fed | hvidløg');
    expect(scale('4 stk. løg', 1.3)).toBe('5 | løg');
    expect(scale('1 æg', 0.3)).toBe('½ | æg');
    expect(formatAmount(2.75, '')).toBe('3');
    expect(scale('1½ tsk bagepulver', 2)).toBe('3 tsk | bagepulver');
    expect(scale('½ tsk salt', 1)).toBe('½ tsk | salt');
    expect(scale('4–6 dl hønsebouillon', 0.5)).toBe('2–3 dl | hønsebouillon');
    expect(scale('1 håndfuld frisk persille', 1)).toBe('1 håndfuld | frisk persille');
    expect(scale('Sesamfrø', 1)).toBeNull();
    expect(scale('Fintrevet skal af ½ citron', 1)).toBeNull();
    expect(formatAmount(0.1, 'tsk')).toBe('¼');
    expect(formatAmount(1.25, 'l')).toBe('1,3');
  });

  it('reads the yield the stepper changes, and leaves a range alone', () => {
    const yieldOf = (portions: string) => portionsOf({title: 'x', steps: ['x'], portions, source: {url: 'https://x'}});
    expect(yieldOf('15 stk.')).toEqual({base: 15, unit: 'stk.', step: 5, min: 5, max: 40});
    expect(yieldOf('4 personer')).toEqual({base: 4, unit: 'personer', step: 1, min: 1, max: 16});
    expect(yieldOf('Ca. 15 stk.')?.base).toBe(15);
    expect(yieldOf('8–10 stk.')).toBeNull();
  });

  it('finds the time a step names for its timer (O3)', () => {
    if (!burger) throw new Error('Burgerboller is in the seed');
    expect(burger.steps.map(stepMinutes)).toEqual([6, 30, null, 120, 12]);
    expect(stepMinutes('Bag 25–30 min. ved 180 °C')).toBe(25);
    expect(stepMinutes('Forvarm ovnen til 200 °C varmluft.')).toBeNull();
    expect(minutesLabel(30)).toBe('30 min');
    expect(minutesLabel(120)).toBe('2 t');
    expect(minutesLabel(90)).toBe('1½ t');
  });
});
