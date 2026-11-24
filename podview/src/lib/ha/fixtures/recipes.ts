// Fake HA service for Opskrifter (installed by createFakeHass): podvoice.recipes_snapshot answers with the add-on's
// own bundled catalog (podvoice/gatekeeper/podview_recipes.json), so nothing here is invented. `recipesState` lets a
// test or the browser journey switch the add-on's answer.
import type {FakeHass} from '../ha-fixture';
import catalog from '../../../../../podvoice/gatekeeper/podview_recipes.json';

export const RECIPES: unknown[] = catalog;

export const recipesState: {mode: 'ready' | 'empty' | 'unavailable'} = {mode: 'ready'};

export function installRecipesFake(fake: FakeHass): void {
  fake.handle('podvoice.recipes_snapshot', () => {
    if (recipesState.mode === 'unavailable') return {response: {ok: false, error: 'addon_unavailable'}};
    return {response: {ok: true, recipes: recipesState.mode === 'empty' ? [] : RECIPES}};
  });
}
