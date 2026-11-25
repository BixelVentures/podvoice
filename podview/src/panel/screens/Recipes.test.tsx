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

const BURGER = 'https://meyers.dk/opskrifter/burgerboller';
const view = (id: string) => document.getElementById(id) ?? document.body;
const reads = () => fake.calls.filter(call => call.service === 'recipes_snapshot');
const tile = () => screen.findByRole('button', {name: /^Opskrifter.*8 opskrifter/});
const card = (name: RegExp) => within(view('recipes-view')).getByRole('button', {name});
const topbarTitle = () => document.getElementById('header-title')?.textContent;

async function openBurger(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await tile());
  await user.click(card(/^Burgerboller/));
  return view('recipe-view');
}

describe('Opskrifter on HA', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    recipesState.mode = 'ready';
    localStorage.clear();
    useRecipeSession.setState({open: null, category: null, session: null, portions: {}, mode: 'katalog', cover: 0});
  });

  it('O1: the catalogue is read when the page starts and shows at once as photo cards with categories and the count',
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
      // Title, meta (yield and a time) and the source as the photo's badge.
      expect(cards[0]?.getAttribute('aria-label')).toBe('Burgerboller, 15 stk. · 2–3 timer hævning, Meyers');
      const filters = within(catalog).getByRole('radiogroup', {name: 'Kategori'});
      expect(within(filters).getAllByRole('radio').map(chip => chip.textContent)).toEqual([
        'Alle', 'Brød og bagværk', 'Madpakker', 'Aftensmad', 'Morgenmad',
      ]);
      await user.click(within(filters).getByRole('radio', {name: 'Madpakker'}));
      expect(within(catalog).getAllByRole('listitem')).toHaveLength(3);
      expect(within(catalog).getByText('3 opskrifter')).toBeTruthy();
      expect(reads()).toHaveLength(1);
      expect(topbarTitle()).toBe('Opskrifter');
    });

  it('Udforsk: the catalogue as a Cover Flow; a neighbour is chosen, the chosen cover opens, Katalog goes back',
    async () => {
      const user = userEvent.setup();
      mount();
      await user.click(await tile());
      const catalog = view('recipes-view');
      await user.click(within(catalog).getByRole('button', {name: 'Udforsk'}));
      const flow = within(catalog).getByRole('group', {name: 'Udforsk opskrifter'});
      expect(within(catalog).getByText('1 af 8')).toBeTruthy();
      expect(within(flow).getByText('Burgerboller')).toBeTruthy();
      expect(within(flow).getByText('Brød og bagværk')).toBeTruthy();
      // A neighbour is chosen (the flow moves, »X af Y« follows), never opened.
      await user.click(within(flow).getByRole('button', {name: 'Vælg Chokoladegranola', hidden: true}));
      expect(within(catalog).getByText('2 af 8')).toBeTruthy();
      expect(useNav.getState().stack.at(-1)?.screen).toBe('recipes');
      // Arrow keys move it too.
      await user.keyboard('{ArrowRight}');
      expect(within(catalog).getByText('3 af 8')).toBeTruthy();
      await user.keyboard('{ArrowLeft}');
      await user.click(within(flow).getByRole('button', {name: 'Åbn Chokoladegranola'}));
      expect(useNav.getState().stack.at(-1)?.screen).toBe('recipe');
      expect(useRecipeSession.getState().open).toMatch(/granola/);
      act(() => {
        useNav.getState().back();
      });
      // The flow opens on the cover it stood on; Katalog brings the cards back.
      expect(within(catalog).getByText('2 af 8')).toBeTruthy();
      await user.click(within(catalog).getByRole('radio', {name: 'Katalog'}));
      expect(within(catalog).getByRole('list', {name: 'Alle opskrifter'})).toBeTruthy();
    });

  it('O3/O4/O5/O7: steps are marked by a tap, the »I gang« band and Hjem follow, a reload keeps it, Afslut ends it',
    async () => {
      const user = userEvent.setup();
      const first = mount();
      const page = await openBurger(user);
      // The recipe's own title in the topbar and the hero.
      expect(topbarTitle()).toBe('Burgerboller');
      expect(within(page).getByRole('heading', {level: 2, name: 'Burgerboller'})).toBeTruthy();
      expect(within(page).getByText('5 trin · af Meyers')).toBeTruthy();
      expect(within(page).getByRole('button', {name: '630 g hvedemel'})).toBeTruthy();
      expect(within(page).getByText('Æltning')).toBeTruthy();
      await user.click(within(page).getByRole('button', {name: 'Start opskrift'}));
      expect(within(page).getByText('Trin 1 af 5 · af Meyers')).toBeTruthy();
      expect(page.querySelector('[data-step="1"]')?.getAttribute('data-current')).toBe('true');
      // The circle marks it done (✓, struck through); the next step becomes current.
      await user.click(within(page).getByRole('button', {name: 'Markér trin 1 færdigt'}));
      expect(within(page).getByText('Trin 2 af 5 · af Meyers')).toBeTruthy();
      expect(within(page).getByRole('button', {name: 'Trin 1 er færdigt'}).getAttribute('aria-pressed')).toBe('true');
      expect(page.querySelector('li[data-step="2"]')?.getAttribute('data-current')).toBe('true');
      // A second tap brings it back; the words are the same press.
      await user.click(within(page).getByRole('button', {name: 'Trin 1 er færdigt'}));
      expect(within(page).getByText('Trin 1 af 5 · af Meyers')).toBeTruthy();
      await user.click(within(page).getByRole('button', {name: /^Æltning Vælg én metode/}));
      expect(within(page).getByText('Trin 2 af 5 · af Meyers')).toBeTruthy();
      await user.click(within(page).getByRole('button', {name: '630 g hvedemel'}));
      expect(within(page).getByText('1 af 10 fundet frem')).toBeTruthy();
      act(() => {
        useNav.getState().back();
      });
      const catalog = within(view('recipes-view'));
      const band = await catalog.findByRole('button', {name: /^Fortsæt Burgerboller, Trin 2 af 5/});
      expect(band.textContent).toContain('Burgerboller · trin 2 af 5 · hvile og hævning');
      expect(card(/^Burgerboller, i gang/)).toBeTruthy();
      act(() => {
        useNav.getState().home();
      });
      expect(await screen.findByRole('button', {name: /^Opskrift, Burgerboller · Trin 2 af 5/})).toBeTruthy();

      // A reload: the session comes back from this browser's storage (the store is rebuilt from it).
      first.unmount();
      resetNav();
      const stored = localStorage.getItem('podview.recipe-session.v2') ?? '';
      expect(JSON.parse(stored)).toMatchObject({state: {session: {steps: [0], ingredients: ['0:3']}}});
      useRecipeSession.setState({open: null, session: null}, false);
      localStorage.setItem('podview.recipe-session.v2', stored);
      await useRecipeSession.persist.rehydrate();
      mount();
      await user.click(await screen.findByRole('button', {name: /^Opskrift, Burgerboller · Trin 2 af 5/}));
      const again = view('recipe-view');
      expect(within(again).getByRole('button', {name: 'Trin 1 er færdigt'}).getAttribute('aria-pressed'))
        .toBe('true');
      expect(within(again).getByRole('button', {name: '630 g hvedemel'}).getAttribute('aria-pressed')).toBe('true');

      // Every step done: »Afslut opskrift« ends it, in the catalogue and on Hjem.
      for (const step of [2, 3, 4, 5]) {
        await user.click(within(again).getByRole('button', {name: `Markér trin ${String(step)} færdigt`}));
      }
      expect(within(again).getByText('Alle trin er gjort · af Meyers')).toBeTruthy();
      await user.click(within(again).getByRole('button', {name: 'Afslut opskrift'}));
      expect(within(again).getByRole('button', {name: 'Start opskrift'})).toBeTruthy();
      act(() => {
        useNav.getState().home();
      });
      expect(await tile()).toBeTruthy();
    }, 20_000);

  it('a tap on a step of a recipe not started starts it; »Nulstil opskrift« asks first, then ends it', async () => {
    const user = userEvent.setup();
    mount();
    const page = await openBurger(user);
    await user.click(within(page).getByRole('button', {name: 'Markér trin 1 færdigt'}));
    expect(useRecipeSession.getState().session?.id).toBe(BURGER);
    expect(within(page).getByText('Trin 2 af 5 · af Meyers')).toBeTruthy();
    await user.click(within(page).getByRole('button', {name: 'Nulstil opskrift'}));
    const ask = await screen.findByRole('alertdialog', {name: 'Nulstil opskrift?'});
    await user.click(within(ask).getByRole('button', {name: 'Fortsæt madlavning'}));
    expect(useRecipeSession.getState().session?.id).toBe(BURGER);
    await user.click(within(page).getByRole('button', {name: 'Nulstil opskrift'}));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', {name: 'Nulstil'}));
    expect(useRecipeSession.getState().session).toBeNull();
    expect(within(page).getByText('5 trin · af Meyers')).toBeTruthy();
  });

  it('O2/O9: the portions scale every amount, survive navigation, and go with Nulstil', async () => {
    const user = userEvent.setup();
    mount();
    const page = await openBurger(user);
    const portions = within(page).getByRole('group', {name: 'Portioner, stk.'});
    expect(within(portions).getByText('15')).toBeTruthy();
    await user.click(within(portions).getByRole('button', {name: 'Flere stk.'}));
    expect(within(portions).getByText('20')).toBeTruthy();
    expect(within(page).getByRole('button', {name: '840 g hvedemel'})).toBeTruthy();
    expect(within(page).getByRole('button', {name: '465 ml koldt vand'})).toBeTruthy();
    expect(within(page).getByRole('button', {name: '2½ æg'})).toBeTruthy();
    // An ingredient without an amount keeps its line.
    expect(within(page).getByRole('button', {name: 'Sesamfrø'})).toBeTruthy();
    for (let press = 0; press < 3; press++) {
      await user.click(within(portions).getByRole('button', {name: 'Færre stk.'}));
    }
    expect(within(portions).getByText('5')).toBeTruthy();
    expect(within(portions).getByRole('button', {name: 'Færre stk.'}).hasAttribute('disabled')).toBe(true);
    act(() => {
      useNav.getState().back();
    });
    await user.click(card(/^Burgerboller/));
    expect(within(view('recipe-view')).getByRole('button', {name: '210 g hvedemel'})).toBeTruthy();
    // Started and reset: the recipe's own yield again.
    await user.click(within(view('recipe-view')).getByRole('button', {name: 'Start opskrift'}));
    await user.click(within(view('recipe-view')).getByRole('button', {name: 'Nulstil opskrift'}));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', {name: 'Nulstil'}));
    expect(within(view('recipe-view')).getByRole('button', {name: '630 g hvedemel'})).toBeTruthy();
  });

  it('O3: a step that names a time starts a timer on the bridge with one tap and shows it running', async () => {
    const user = userEvent.setup();
    mount();
    const page = await openBurger(user);
    await user.click(within(page).getByRole('button', {name: 'Markér trin 1 færdigt'}));
    // The current step's key is »Start timer · 30 min« (the step says 30–60 min.).
    const key = await within(page).findByRole('button', {name: 'Start timer på 30 min'});
    expect(key.textContent).toBe('Start timer · 30 min');
    await user.click(key);
    await waitFor(() => {
      expect(fake.calls.filter(call => call.service === 'timer_command_v2')).toHaveLength(1);
    });
    expect(fake.calls.find(call => call.service === 'timer_command_v2')?.data).toMatchObject({
      action: 'start', seconds: 1800, name: 'Hvile og hævning', endpoint: 'kokken'});
    expect(await within(page).findByRole('button', {name: /^Timer kører · (30:00|29:59)$/})).toBeTruthy();
    // The topbar shows the same timer.
    expect(screen.getByRole('button', {name: /^Timer (30:00|29:59), Hvile og hævning$/})).toBeTruthy();
    // A tap on the running chip opens Timer.
    await user.click(within(page).getByRole('button', {name: /^Timer kører/}));
    expect(useNav.getState().stack.at(-1)?.screen).toBe('timers');
  });

  it('another recipe in progress is a line with »Gå til«; this one reads until »Start denne i stedet«', async () => {
    const user = userEvent.setup();
    mount();
    const page = await openBurger(user);
    await user.click(within(page).getByRole('button', {name: 'Start opskrift'}));
    act(() => {
      useNav.getState().back();
    });
    await user.click(card(/^Chokoladegranola/));
    expect(within(page).getByText('Burgerboller er i gang · trin 1 af 5')).toBeTruthy();
    // Its steps only read: a tap starts nothing and replaces nothing.
    expect(within(page).queryByRole('button', {name: /^Markér trin/})).toBeNull();
    expect(useRecipeSession.getState().session?.id).toBe(BURGER);
    await user.click(within(page).getByRole('button', {name: 'Gå til Burgerboller'}));
    expect(within(page).getByRole('heading', {level: 2, name: 'Burgerboller'})).toBeTruthy();
    act(() => {
      useNav.getState().back();
    });
    await user.click(card(/^Chokoladegranola/));
    await user.click(within(page).getByRole('button', {name: 'Start denne i stedet'}));
    expect(useRecipeSession.getState().session?.id).toMatch(/granola/);
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
