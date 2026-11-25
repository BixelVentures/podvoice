// Opskrifter on HA (the canvas's A-Opskrifter, Opskrifter-Bog, A-Opskrift and Opskrift-TimerKoerer), composed from the
// kit (src/ui/Recipe.tsx): the PodVoice add-on's recipe catalog (lib/ha/recipes.ts) and the wall's cooking session
// (screens/recipe/session.ts). Both pages take the full width (no player) and scroll as one page.
// - Katalog: the »I gang« band (O4), the categories as a segment with the count and »Udforsk«, and the photo cards
//   in five columns. Udforsk is the same catalogue as a Cover Flow (Katalog | Udforsk, »X af Y«).
// - Opskrift: the hero (»Trin N af M · af <kilde>«, the facts, the portion stepper and the recipe's key), the
//   ingredients as check rows with »N af M fundet frem« (amounts follow the portions, O9) and »Sådan gør du« as
//   steps marked done by a tap (O3); a step that names a time starts a timer on the PodVoice timer bridge with one
//   tap and shows it running. Once the hero scrolls away, a sticky line keeps the step and »Nulstil«.
// A tap on a step or an ingredient of a recipe not yet started starts it. Another recipe in progress is a fixed line
// with »Gå til«; this one then only reads until »Start denne i stedet«. Step, ticks and portions survive navigation
// and reloads (O5); »Afslut opskrift« and »Nulstil opskrift« end the session in the catalogue and on Hjem at once (O7).
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {TRANSITION} from '../../lib/motion/tokens';
import {useRecipes} from '../../lib/ha/recipes';
import type {Recipe} from '../../lib/ha/recipes';
import {useTimerCommands} from '../../lib/ha/timers';
import {useLink} from '../../lib/ha/transport';
import type {Timer} from '../../screens/timer/model';
import {
  catalog, categoriesOf, factsOf, groupsOf, minutesLabel, phaseAt, portionsOf, progressOf, quantityOf,
  rankCategories, recipeCount, recipeId, scaledAmount, stepMinutes,
} from '../../screens/recipe/model';
import {useRecipeSession} from '../../screens/recipe/session';
import {currentScreen, useNav} from '../nav';
import {useStickyHero} from '../sticky';
import {useScreenTitle} from '../titles';
import {Notice, wishNotice} from '../ui';
import {
  Button, Card, CheckRow, cx, CoverFlow, Dialog, PortionStepper, RecipeCard, RecipeHero, RecipeTextKey, ResumeBand,
  ResumeLine, SectionLabel, SectionTitle, Segment, Sheet, SheetBody, SheetChoice, StepRow, StepTimer, StickyLine,
  Widget,
} from '../../ui';
import type {CoverItem, StepState} from '../../ui';
import {useBridgeTimers} from './Timers';

export const LOADING_TEXT = 'Henter opskrifter …';
export const ERROR_TEXT = 'Opskrifterne kunne ikke hentes lige nu. PodVoice svarer ikke; prøv igen om lidt.';
export const EMPTY_TEXT = 'Ingen opskrifter endnu. Del en opskrift fra iPhone med genvejen »Opskrifter til PodView«.';
export const RESET_TEXT = 'Alle ingrediens- og trinafkrydsninger ryddes, og antallet går tilbage til opskriftens. ' +
  'Opskriften bliver liggende i kataloget.';
export const ALL_DONE = 'Alle trin er gjort';
// The categories that stand in the segment beside »Alle«; any others are under »Flere«.
const SEGMENT_CATEGORIES = 5;

// The catalogue as the screens need it: the recipes, the one in progress and its progress. The session of a recipe
// the catalogue no longer has ends once the catalogue is read.
export function useRecipeCatalog() {
  const {generation} = useLink();
  const read = useRecipes(generation);
  const data = read.data;
  const recipes = useMemo(() => (data?.ok ? data.recipes : []), [data]);
  const session = useRecipeSession(state => state.session);
  const prune = useRecipeSession(state => state.prune);
  useEffect(() => {
    if (data?.ok) prune(new Set(data.recipes.map(recipeId)), Date.now());
  }, [data, prune]);
  const active = session ? (recipes.find(recipe => recipeId(recipe) === session.id) ?? null) : null;
  return {read, recipes, session, active};
}

const imageOf = (recipe: Recipe) => recipe.image ?? recipe.images?.[0];
const lower = (text: string) => text.charAt(0).toLocaleLowerCase('da-DK') + text.slice(1);

// The phase the step in progress belongs to (the last one starting at or before it).
function phaseOf(recipe: Recipe, step: number): string | null {
  for (let index = step; index >= 0; index--) {
    const phase = phaseAt(recipe, index);
    if (phase) return phase;
  }
  return null;
}

// »Burgerboller · trin 2 af 5 · hvile og hævning«.
function bandTitle(recipe: Recipe, steps: readonly number[]) {
  const progress = progressOf(recipe, steps);
  const phase = progress.label === ALL_DONE ? null : phaseOf(recipe, progress.step - 1);
  return [recipe.title, lower(progress.label), phase ? lower(phase) : null].filter(Boolean).join(' · ');
}

// The Home tile: the recipe in progress with its step, else the catalogue's size; hidden while HA has no catalogue.
export function RecipesTile() {
  const {read, recipes, session, active} = useRecipeCatalog();
  const push = useNav(state => state.push);
  const show = useRecipeSession(state => state.show);
  if (!read.data?.ok && !read.isPending) return null;
  const progress = active && session ? progressOf(active, session.steps) : null;
  const categories = rankCategories(recipes).length;
  const empty = !!read.data?.ok && !recipes.length;
  return (
    <Widget
      id="home-recipes"
      kind="opskrift"
      state={active ? 'igang' : empty ? 'tom' : 'katalog'}
      opens={active ? 'recipe' : 'recipes'}
      tile="recipe"
      {...(active ? {label: 'Opskrift'} : {})}
      prim={active ? active.title : empty ? 'Ingen opskrifter' : read.data?.ok ? recipeCount(recipes.length) : ''}
      ctx={progress ? progress.label : empty ? 'Der er ingen opskrifter endnu.' : categories
        ? `${String(categories)} ${categories === 1 ? 'kategori' : 'kategorier'}` : ''}
      {...(progress ? {steps: {total: progress.total, current: progress.step}, description: progress.label} : {})}
      onPress={() => {
        if (active) {
          show(recipeId(active));
          push('recipe');
        } else push('recipes');
      }}
    />
  );
}

// »Alle« among the categories, and the key that opens the rest.
const ALL = '*';
const MORE = '+';

function useOpenRecipe() {
  const push = useNav(state => state.push);
  const show = useRecipeSession(state => state.show);
  return (recipe: Recipe) => {
    show(recipeId(recipe));
    push('recipe');
  };
}

function Catalogue({recipes, active}: {recipes: Recipe[]; active: Recipe | null}) {
  const category = useRecipeSession(state => state.category);
  const setCategory = useRecipeSession(state => state.setCategory);
  const setMode = useRecipeSession(state => state.setMode);
  const open = useOpenRecipe();
  const [more, setMore] = useState(false);
  const ranked = rankCategories(recipes);
  // A remembered category the catalogue no longer has shows everything.
  const shown = category !== null && ranked.some(item => item.name === category) ? category : null;
  const first = ranked.slice(0, SEGMENT_CATEGORIES).map(item => item.name);
  // A category chosen under »Flere« takes the segment's last place while it is chosen.
  const inSegment = shown === null || first.includes(shown) ? first : [...first.slice(0, -1), shown];
  const rest = ranked.filter(item => !inSegment.includes(item.name));
  const rows = catalog(recipes, shown);
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        {ranked.length > 1 ? (
          <Segment aria-label="Kategori" value={shown ?? ALL} onChange={value => {
            if (value === MORE) setMore(true);
            else setCategory(value === ALL ? null : value);
          }} options={[{id: ALL, label: 'Alle'}, ...inSegment.map(name => ({id: name, label: name})),
            ...(rest.length ? [{id: MORE, label: 'Flere'}] : [])]} />
        ) : <span />}
        <div className="flex shrink-0 items-center gap-4">
          <span className="text-base text-pv-ink-3">{recipeCount(rows.length)}</span>
          <Button variant="lys" size={44} onPress={() => {
            setMode('udforsk');
          }}>Udforsk</Button>
        </div>
      </div>
      {rows.length ? (
        <ul className="m-0 grid list-none grid-cols-5 gap-4 p-0" aria-label={shown ?? 'Alle opskrifter'}>
          {rows.map((recipe, index) => {
            const current = recipe === active;
            return (
              <li key={recipeId(recipe)} className="min-w-0">
                <RecipeCard title={recipe.title} meta={factsOf(recipe).slice(0, 2).join(' · ')} image={imageOf(recipe)}
                  publisher={recipe.publisher} active={current} eager={index < 10} data-opens="recipe"
                  data-active={current ? 'true' : undefined} onPress={() => {
                    open(recipe);
                  }} />
              </li>
            );
          })}
        </ul>
      ) : null}
      <Sheet isOpen={more} onClose={() => {
        setMore(false);
      }} title="Flere kategorier">
        <SheetBody>
          <SheetChoice aria-label="Flere kategorier" value={shown} items={rest.map(item => ({id: item.name,
            name: item.name, detail: recipeCount(item.count), icon: 'recipe' as const}))} onChange={value => {
            setMore(false);
            setCategory(value);
          }} />
        </SheetBody>
      </Sheet>
    </>
  );
}

function Explore({recipes, active, steps}: {recipes: Recipe[]; active: Recipe | null; steps: readonly number[]}) {
  const cover = useRecipeSession(state => state.cover);
  const setCover = useRecipeSession(state => state.setCover);
  const open = useOpenRecipe();
  const rows = catalog(recipes, null);
  const items: CoverItem[] = rows.map(recipe => ({
    id: recipeId(recipe),
    title: recipe.title,
    kicker: categoriesOf(recipe)[0] ?? '',
    meta: factsOf(recipe).slice(0, 2).join(' · '),
    image: imageOf(recipe),
    badge: recipe === active ? `I gang · ${lower(progressOf(recipe, steps).label)}` : null,
  }));
  return (
    <CoverFlow aria-label="Udforsk opskrifter" items={items} index={Math.max(0, Math.min(rows.length - 1, cover))}
      onIndexChange={setCover} onOpen={item => {
        const recipe = rows.find(row => recipeId(row) === item.id);
        if (recipe) open(recipe);
      }} />
  );
}

export function RecipesScreen() {
  const {read, recipes, session, active} = useRecipeCatalog();
  const mode = useRecipeSession(state => state.mode);
  const setMode = useRecipeSession(state => state.setMode);
  const cover = useRecipeSession(state => state.cover);
  const open = useOpenRecipe();
  const reduced = useReducedMotion() ?? false;
  const data = read.data;
  const exploring = mode === 'udforsk' && recipes.length > 0;
  const steps = session?.steps ?? [];
  return (
    <section id="recipes-view" className={cx('flex flex-[1_0_auto] flex-col pb-2 font-pv text-pv-ink',
      exploring ? 'gap-3' : 'gap-5')} aria-label="Opskrifter">
      {active && !exploring ? (
        <ResumeBand id="recipe-resume" data-opens="recipe" title={bandTitle(active, steps)} image={imageOf(active)}
          action="Fortsæt madlavning" aria-label={`Fortsæt ${active.title}, ${progressOf(active, steps).label}`}
          onPress={() => {
            open(active);
          }} />
      ) : null}
      {exploring ? (
        <div className="flex h-[52px] items-center justify-between">
          <Segment aria-label="Visning" value="udforsk" onChange={value => {
            setMode(value);
          }} options={[{id: 'katalog' as const, label: 'Katalog'}, {id: 'udforsk' as const, label: 'Udforsk'}]} />
          <span className="text-base font-medium text-pv-ink-3" aria-live="polite">
            {`${String(Math.min(recipes.length, cover + 1))} af ${String(recipes.length)}`}</span>
        </div>
      ) : null}
      {data && !data.ok ? (
        <div className="flex items-center gap-4 text-[17px] text-pv-ink-2" role="status">
          <p className="m-0">{ERROR_TEXT}</p>
          <Button variant="sekundaer" size={44} onPress={() => {
            void read.refetch();
          }}>Prøv igen</Button>
        </div>
      ) : null}
      {!data && read.isPending ? <p className="m-0 text-[17px] text-pv-ink-3" role="status">{LOADING_TEXT}</p> : null}
      {data?.ok && !recipes.length ? (
        <p className="m-0 max-w-[36ch] text-[17px] leading-normal text-pv-ink-3">{EMPTY_TEXT}</p>
      ) : null}
      {recipes.length ? (
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={exploring ? 'udforsk' : 'katalog'} className="flex flex-col gap-5"
            initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
            transition={reduced ? TRANSITION.reduced : TRANSITION.fade}>
            {exploring ? <Explore recipes={recipes} active={active} steps={steps} />
              : <Catalogue recipes={recipes} active={active} />}
          </motion.div>
        </AnimatePresence>
      ) : null}
    </section>
  );
}

// ---- One recipe -----------------------------------------------------------------------------------------------------

const isRunning = (timer: Timer) => timer.status === 'running' || timer.status === 'paused';
const clock = (seconds: number) => `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;

// The name a step's timer gets on the bridge: the step's phase, else the recipe and the step.
export function stepTimerName(recipe: Recipe, step: number) {
  return (phaseAt(recipe, step) ?? `${recipe.title}, trin ${String(step + 1)}`).slice(0, 120);
}

function useStepTimers(recipe: Recipe) {
  const {endpoint, read, timers, startWish} = useBridgeTimers();
  const send = useTimerCommands();
  const push = useNav(state => state.push);
  const status = read.data?.status;
  const epoch = status?.ok ? status.epoch : null;
  return {
    available: !!endpoint && !!epoch,
    notice: wishNotice(startWish),
    running: (step: number) =>
      timers.find(timer => isRunning(timer) && timer.name === stepTimerName(recipe, step)) ?? null,
    start: (step: number, minutes: number) => {
      if (endpoint && epoch) {
        send(endpoint.endpoint, epoch, {action: 'start', seconds: minutes * 60, name: stepTimerName(recipe, step)});
      }
    },
    open: () => {
      push('timers');
    },
  };
}

function Ingredients({recipe, factor, scaled, interactive, onTouch}: {recipe: Recipe; factor: number;
  scaled: boolean; interactive: boolean; onTouch: () => void}) {
  const id = recipeId(recipe);
  const ticked = useRecipeSession(state => (state.session?.id === id ? state.session.ingredients : null)) ?? [];
  const toggle = useRecipeSession(state => state.toggleIngredient);
  const groups = groupsOf(recipe);
  const total = groups.reduce((sum, group) => sum + group.lines.length, 0);
  return (
    <Card tone="kit" inset="none" className="flex flex-col gap-1.5 p-6" aria-labelledby="recipe-ingredients-title">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id="recipe-ingredients-title">Ingredienser</SectionTitle>
        <span className="text-[15px] text-pv-ink-3" role="status">
          {`${String(ticked.length)} af ${String(total)} fundet frem`}</span>
      </div>
      {groups.map((group, index) => (
        <div key={`${group.title}-${String(index)}`} className="flex flex-col" role="group"
          aria-label={groups.length > 1 ? group.title : 'Ingredienser'}>
          {groups.length > 1 ? <SectionLabel className="mt-2.5 mb-1">{group.title}</SectionLabel> : null}
          {group.lines.map((line, row) => {
            const key = `${String(index)}:${String(row)}`;
            const quantity = quantityOf(line);
            return (
              <CheckRow key={key} amount={quantity ? scaledAmount(quantity, factor) : null}
                text={quantity ? quantity.text : line} scaled={scaled} isSelected={ticked.includes(key)}
                isDisabled={!interactive} onChange={() => {
                  onTouch();
                  toggle(key);
                }} />
            );
          })}
        </div>
      ))}
    </Card>
  );
}

function Steps({recipe, cooking, interactive, onTouch}: {recipe: Recipe; cooking: boolean; interactive: boolean;
  onTouch: () => void}) {
  const id = recipeId(recipe);
  const done = useRecipeSession(state => (state.session?.id === id ? state.session.steps : null)) ?? [];
  const toggle = useRecipeSession(state => state.toggleStep);
  const timers = useStepTimers(recipe);
  const current = cooking ? recipe.steps.findIndex((_, index) => !done.includes(index)) : -1;
  return (
    <Card tone="kit" inset="none" className="flex flex-col gap-2.5 p-6" aria-labelledby="recipe-steps-title">
      <SectionTitle id="recipe-steps-title">Sådan gør du</SectionTitle>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {recipe.steps.map((step, index) => {
          const state: StepState = done.includes(index) ? 'done' : index === current ? 'current' : 'todo';
          const minutes = stepMinutes(step);
          const live = timers.running(index);
          const left = live ? live.remaining : 0;
          return (
            <li key={index} data-step={index + 1} data-current={state === 'current' ? 'true' : undefined}
              data-done={state === 'done' ? 'true' : undefined}>
              <StepRow number={index + 1} heading={phaseAt(recipe, index)} text={step} state={state}
                isInteractive={interactive} onToggle={() => {
                  onTouch();
                  toggle(index);
                }}
                timer={minutes && timers.available && (state !== 'done' || live) ? (
                  <StepTimer duration={minutesLabel(minutes)} current={state === 'current'}
                    running={live ? {count: clock(left), left: live.duration ? left / live.duration : 1} : null}
                    onStart={() => {
                      timers.start(index, minutes);
                    }} onOpen={timers.open} />
                ) : null} />
            </li>
          );
        })}
      </ol>
      <Notice text={timers.notice} />
    </Card>
  );
}

export function RecipeScreen() {
  const {read, recipes, session, active} = useRecipeCatalog();
  const openId = useRecipeSession(state => state.open);
  const start = useRecipeSession(state => state.start);
  const finish = useRecipeSession(state => state.finish);
  const chosen = useRecipeSession(state => (openId ? state.portions[openId] : undefined));
  const setPortions = useRecipeSession(state => state.setPortions);
  const open = useOpenRecipe();
  const back = useNav(state => state.back);
  const [asking, setAsking] = useState(false);
  const recipe = recipes.find(item => recipeId(item) === openId) ?? null;
  const {heroRef, past, main} = useStickyHero();
  // The line belongs to the recipe page: never over another screen while this one stays mounted.
  const shown = useNav(currentScreen) === 'recipe';
  useScreenTitle('recipe', recipe?.title ?? null);
  if (!recipe) {
    return (
      <section id="recipe-view" className="flex flex-col items-start gap-4 font-pv" aria-label="Opskrift">
        <p className="m-0 text-[17px] text-pv-ink-3" role="status">
          {read.isPending ? LOADING_TEXT : 'Opskriften findes ikke i kataloget længere.'}</p>
        {read.isPending ? null : (
          <Button variant="sekundaer" size={44} onPress={() => {
            back();
          }}>Til kataloget</Button>
        )}
      </section>
    );
  }
  const id = recipeId(recipe);
  const cooking = session?.id === id;
  const other = !cooking && active ? active : null;
  const progress = progressOf(recipe, cooking ? session.steps : []);
  const allDone = cooking && progress.label === ALL_DONE;
  const portions = portionsOf(recipe);
  const count = portions ? (chosen ?? portions.base) : null;
  const factor = portions && count ? count / portions.base : 1;
  const by = recipe.publisher ? `af ${recipe.publisher}` : null;
  const label = [cooking ? progress.label : `${String(recipe.steps.length)} trin`, by].filter(Boolean).join(' · ');
  // The yield is the stepper's when it has one; the facts line keeps the times and the description.
  const facts = [...factsOf(recipe).filter(fact => !portions || fact !== factsOf(recipe)[0]),
    ...(recipe.description ? [recipe.description] : [])].join(' · ');
  // A recipe not started starts with its first tick; another one in progress keeps this one read-only.
  const interactive = !other;
  const touch = () => {
    if (!cooking) start(id);
  };
  const reset = (
    <RecipeTextKey id="recipe-reset" onPress={() => {
      setAsking(true);
    }}>Nulstil opskrift</RecipeTextKey>
  );
  const finishKey = (size: 44 | 56) => (
    <Button variant="primaer" size={size} onPress={() => {
      finish();
    }}>Afslut opskrift</Button>
  );
  const keys = cooking ? (allDone ? <>{finishKey(56)}{reset}</> : reset) : other ? (
    <Button variant="kant" size={56} onPress={() => {
      start(id);
    }}>Start denne i stedet</Button>
  ) : (
    <Button variant="primaer" size={56} icon="play" onPress={() => {
      start(id);
    }}>Start opskrift</Button>
  );
  return (
    <section id="recipe-view" className="flex flex-[1_0_auto] flex-col gap-4 pb-8 font-pv text-pv-ink"
      aria-labelledby="recipe-hero-title">
      {main ? createPortal(
        <div className="pointer-events-none absolute top-0 left-0 z-[3] w-full">
          <StickyLine isShown={past && shown} surface="recipe" dot="recipe" label={`${recipe.title}, opskriften`}
            className="pointer-events-auto" title={recipe.title}
            sub={[cooking ? progress.label : null, portions && count ? `${String(count)} ${portions.unit}` : null]
              .filter(Boolean).join(' · ')}
            primary={cooking ? (allDone ? finishKey(44) : reset) : null} />
        </div>, main) : null}
      {other && session ? (
        <ResumeLine text={`${other.title} er i gang · ${lower(progressOf(other, session.steps).label)}`}
          action="Gå til" aria-label={`Gå til ${other.title}`} onPress={() => {
            open(other);
          }} />
      ) : null}
      <div ref={heroRef}>
        <RecipeHero id="recipe-hero" title={recipe.title} label={label} facts={facts} image={imageOf(recipe)}
          keys={keys}>
          {portions && count ? (
            <PortionStepper value={count} unit={portions.unit} min={portions.min} max={portions.max}
              step={portions.step} onChange={value => {
                setPortions(id, value);
              }} />
          ) : null}
        </RecipeHero>
      </div>
      <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-4">
        <Ingredients recipe={recipe} factor={factor} scaled={!!portions && count !== portions.base}
          interactive={interactive} onTouch={touch} />
        <Steps recipe={recipe} cooking={cooking} interactive={interactive} onTouch={touch} />
      </div>
      <Dialog isOpen={asking} title="Nulstil opskrift?" description={RESET_TEXT} cancelLabel="Fortsæt madlavning"
        confirmLabel="Nulstil" confirmVariant="fare" onCancel={() => {
          setAsking(false);
        }} onConfirm={() => {
          setAsking(false);
          finish();
        }} />
    </section>
  );
}
