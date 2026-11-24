import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {recipesState} from '../../lib/ha/fixtures/recipes';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {useRecipeSession} from '../../screens/recipe/session';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {ERROR_TEXT} from './Recipes';

let fake: FakeHass;

function mount() {
  let own: FakeHass | null = null;
  own = createFakeHass({
    confirmMs: 30,
    onChange: hass => {
      if (!own || fake !== own) return;
      act(() => {
        transport.setHass(hass);
      });
    },
  });
  fake = own;
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

const view = (id: string) => document.getElementById(id) ?? document.body;
const reads = () => fake.calls.filter(call => call.service === 'recipes_snapshot');
const tile = () => screen.findByRole('button', {name: /^Opskrifter.*8 opskrifter/});

describe('Opskrifter on HA', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    recipesState.mode = 'ready';
    localStorage.clear();
    useRecipeSession.setState({open: null, category: null, session: null});
  });

  it('O1: the catalogue is read when the page starts and shows at once as cards with categories and the count',
    async () => {
      const user = userEvent.setup();
      mount();
      await user.click(await tile());
      const catalog = view('recipes-view');
      // The Home tile's read is the screen's: the first frame is the catalogue, never »Henter«.
      expect(within(catalog).queryByText(/Henter/)).toBeNull();
      expect(within(catalog).getByText('8 opskrifter')).toBeTruthy();
      const cards = within(within(catalog).getByRole('list', {name: 'Alle opskrifter'})).getAllByRole('button');
      expect(cards).toHaveLength(8);
      expect(cards[0]?.textContent).toMatch(/^Burgerboller/);
      const filters = within(catalog).getByRole('radiogroup', {name: 'Kategori'});
      expect(within(filters).getAllByRole('radio').map(chip => chip.textContent)).toEqual([
        'Alle', 'Brød og bagværk', 'Madpakker', 'Aftensmad', 'Morgenmad',
      ]);
      await user.click(within(filters).getByRole('radio', {name: 'Madpakker'}));
      expect(within(catalog).getAllByRole('listitem')).toHaveLength(3);
      expect(reads()).toHaveLength(1);
    });

  it('O4/O5/O7: start, tick a step, the »Fortsæt« band and Hjem follow; it survives a reload; Afslut ends it',
    async () => {
      const user = userEvent.setup();
      const first = mount();
      await user.click(await tile());
      await user.click(within(view('recipes-view')).getByRole('button', {name: /^Burgerboller/}));
      const page = view('recipe-view');
      expect(within(page).getByRole('heading', {level: 1, name: 'Burgerboller'})).toBeTruthy();
      expect(within(page).getByText('630 g hvedemel')).toBeTruthy();
      expect(within(page).getByText('Æltning')).toBeTruthy();
      expect(within(page).queryByRole('checkbox')).toBeNull();
      await user.click(within(page).getByRole('button', {name: 'Start opskrift'}));
      expect(within(page).getByText('Trin 1 af 5 · af Meyers')).toBeTruthy();
      await user.click(within(page).getByRole('checkbox', {name: 'Trin 1'}));
      expect(within(page).getByText('Trin 2 af 5 · af Meyers')).toBeTruthy();
      await user.click(within(page).getByRole('checkbox', {name: '630 g hvedemel'}));
      act(() => {
        useNav.getState().back();
      });
      const catalog = within(view('recipes-view'));
      expect(await catalog.findByRole('button', {name: /^Fortsæt Burgerboller, Trin 2 af 5/})).toBeTruthy();
      act(() => {
        useNav.getState().home();
      });
      expect(await screen.findByRole('button', {name: /^Burgerboller.*Trin 2 af 5/})).toBeTruthy();

      // A reload: the session comes back from this browser's storage (the store is rebuilt from it).
      first.unmount();
      resetNav();
      const stored = localStorage.getItem('podview.recipe-session.v2') ?? '';
      expect(JSON.parse(stored)).toMatchObject({state: {session: {steps: [0], ingredients: ['0:3']}}});
      useRecipeSession.setState({open: null, session: null}, false);
      localStorage.setItem('podview.recipe-session.v2', stored);
      await useRecipeSession.persist.rehydrate();
      mount();
      await user.click(await screen.findByRole('button', {name: /^Burgerboller.*Trin 2 af 5/}));
      const again = view('recipe-view');
      expect(within(again).getByRole('checkbox', {name: 'Trin 1'})).toHaveProperty('checked', true);
      expect(within(again).getByRole('checkbox', {name: '630 g hvedemel'})).toHaveProperty('checked', true);

      await user.click(within(again).getByRole('button', {name: 'Afslut opskrift'}));
      expect(within(again).getByRole('button', {name: 'Start opskrift'})).toBeTruthy();
      act(() => {
        useNav.getState().home();
      });
      expect(await tile()).toBeTruthy();
    });

  it('another recipe in progress is offered as »Fortsæt«, never replaced without asking', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await tile());
    await user.click(within(view('recipes-view')).getByRole('button', {name: /^Burgerboller/}));
    await user.click(within(view('recipe-view')).getByRole('button', {name: 'Start opskrift'}));
    act(() => {
      useNav.getState().back();
    });
    await user.click(within(view('recipes-view')).getByRole('button', {name: /^Chokoladegranola/}));
    const page = view('recipe-view');
    expect(within(page).getByRole('button', {name: 'Fortsæt Burgerboller'})).toBeTruthy();
    expect(useRecipeSession.getState().session?.id).toBe('https://meyers.dk/opskrifter/burgerboller');
    await user.click(within(page).getByRole('button', {name: 'Fortsæt Burgerboller'}));
    expect(within(page).getByRole('heading', {level: 1, name: 'Burgerboller'})).toBeTruthy();
  });

  it('an unavailable add-on says so with a way forward; Prøv igen reads once more', async () => {
    recipesState.mode = 'unavailable';
    const user = userEvent.setup();
    mount();
    await waitFor(() => {
      expect(reads()).toHaveLength(1);
    });
    act(() => {
      useNav.getState().push('recipes');
    });
    const catalog = view('recipes-view');
    expect(await within(catalog).findByText(ERROR_TEXT)).toBeTruthy();
    recipesState.mode = 'ready';
    await user.click(within(catalog).getByRole('button', {name: 'Prøv igen'}));
    expect(await within(catalog).findByText('8 opskrifter')).toBeTruthy();
  });
});
