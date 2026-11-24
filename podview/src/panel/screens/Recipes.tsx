// Opskrifter on HA: the PodVoice add-on's recipe catalog (lib/ha/recipes.ts) and the wall's cooking session
// (screens/recipe/session.ts), as the old wall page had them: the catalogue as photo cards with the categories on top
// and »N opskrifter«, the recipe in progress as a »Fortsæt« band over it (O4), and the recipe page with the hero
// (»Trin N af M · af <kilde>«), the ingredients and the numbered steps. A started recipe ticks its steps and
// ingredients; its step, ticks and portions survive navigation and reloads (O5); »Afslut opskrift« ends it in the
// catalogue and on Hjem at once (O7). Photos are the sources' own, shown once decoded; nothing waits on them.
// Touch and keyboard are React Aria's (src/ui's Button and Choices, Checkbox); motion is motion/react on PodView's
// tokens: a decoded photo fades in, the hero's actions cross-fade and a done step dims.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {Button as AriaButton, CheckboxButton, CheckboxField} from 'react-aria-components';
import {TRANSITION} from '../../lib/motion/tokens';
import {useRecipes} from '../../lib/ha/recipes';
import type {Recipe} from '../../lib/ha/recipes';
import {useLink} from '../../lib/ha/transport';
import {
  catalog, categoriesOf, factsOf, groupsOf, phaseAt, progressOf, rankCategories, RECIPE_FILTERS, recipeCount,
  recipeId,
} from '../../screens/recipe/model';
import {useRecipeSession} from '../../screens/recipe/session';
import {useNav} from '../nav';
import {Button, Chip, Choices, cx, Icon, pressable} from '../../ui';
import {Shortcut} from '../ui';

export const LOADING_TEXT = 'Henter opskrifter …';
export const ERROR_TEXT = 'Opskrifterne kunne ikke hentes lige nu. PodVoice svarer ikke; prøv igen om lidt.';
export const EMPTY_TEXT = 'Ingen opskrifter endnu. Del en opskrift fra iPhone med genvejen »Opskrifter til PodView«.';

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

// The Home tile: the recipe in progress with its step, else the catalogue's size; hidden while HA has no catalogue.
export function RecipesTile() {
  const {read, recipes, session, active} = useRecipeCatalog();
  const push = useNav(state => state.push);
  const show = useRecipeSession(state => state.show);
  if (!read.data?.ok && !read.isPending) return null;
  const progress = active && session ? progressOf(active, session.steps) : null;
  return (
    <Shortcut
      id="home-recipes"
      screen={active ? 'recipe' : 'recipes'}
      iconName="room-kitchen"
      title={active ? active.title : 'Opskrifter'}
      detail={progress ? progress.label : read.data?.ok ? recipeCount(recipes.length) : ''}
      extra={
        progress ? (
          <progress className="mt-1.5 block h-1 w-full accent-pv-ink" max={progress.total} value={progress.step - 1}
            aria-hidden />
        ) : undefined
      }
      onPress={() => {
        if (active) {
          show(recipeId(active));
          push('recipe');
        } else push('recipes');
      }}
    />
  );
}

// A recipe's photo, from its source: it fades in once decoded, over the recipe colour; none is the colour alone.
function Photo({src, className}: {src: string | undefined; className: string}) {
  const [loaded, setLoaded] = useState(false);
  const reduced = useReducedMotion() ?? false;
  if (!src) return <span className={cx('block bg-pv-recipe', className)} aria-hidden />;
  return (
    <motion.img
      className={cx('bg-pv-recipe object-cover', className)}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      initial={false}
      animate={{opacity: loaded ? 1 : 0}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.fade}
      onLoad={() => {
        setLoaded(true);
      }}
    />
  );
}

// The screens' card and heading.
const SCREEN = 'flex flex-[1_0_auto] flex-col gap-pv-s3 overflow-hidden rounded-pv-l bg-pv-surface px-pv-s3 ' +
  'pt-pv-s3 pb-pv-s4 text-pv-ink';

function Heading({id, title, line}: {id: string; title: string; line: string}) {
  return (
    <header className="pb-pv-s3">
      <h1 id={id} className="mt-0 mb-2.5 text-pv-title leading-[1.08] font-medium tracking-[-0.035em]">{title}</h1>
      <p className="text-pv-meta leading-[19px] text-pv-ink-3">{line}</p>
    </header>
  );
}

function ResumeBand({recipe, label}: {recipe: Recipe; label: string}) {
  const push = useNav(state => state.push);
  const show = useRecipeSession(state => state.show);
  return (
    <AriaButton
      id="recipe-resume"
      className={cx(pressable, 'flex min-h-[88px] items-center gap-pv-s3 rounded-pv-l bg-pv-recipe px-pv-s3 py-pv-s2',
        'text-left text-pv-recipe-ink')}
      data-opens="recipe"
      aria-label={`Fortsæt ${recipe.title}, ${label}`}
      onPress={() => {
        show(recipeId(recipe));
        push('recipe');
      }}
    >
      <Photo src={recipe.image ?? recipe.images?.[0]} className="pointer-events-none size-[72px] rounded-pv-s" />
      <span className="flex min-w-0 flex-1 flex-col">
        <small className="text-pv-meta text-pv-recipe-meta">I gang</small>
        <strong className="text-[20px]">{recipe.title}</strong>
        <small className="text-pv-meta text-pv-recipe-meta">{label}</small>
      </span>
      <span className="rounded-pv-pill bg-pv-ink px-pv-s3 py-2.5 font-bold text-pv-surface">Fortsæt</span>
    </AriaButton>
  );
}

// »Alle« among the categories.
const ALL = '*';

export function RecipesScreen() {
  const {read, recipes, session, active} = useRecipeCatalog();
  const category = useRecipeSession(state => state.category);
  const setCategory = useRecipeSession(state => state.setCategory);
  const show = useRecipeSession(state => state.show);
  const push = useNav(state => state.push);
  const filters = rankCategories(recipes).slice(0, RECIPE_FILTERS);
  // A remembered category the catalogue no longer has shows everything.
  const shown = category !== null && filters.some(item => item.name === category) ? category : null;
  const rows = catalog(recipes, shown);
  const data = read.data;
  return (
    <section id="recipes-view" className={SCREEN} aria-labelledby="recipes-title">
      <Heading id="recipes-title" title="Opskrifter"
        line={data?.ok ? recipeCount(recipes.length) : read.isPending ? LOADING_TEXT : 'Ikke tilgængelige'} />
      {data && !data.ok ? (
        <div className="flex items-center gap-pv-s3 text-pv-ink-2" role="status">
          <p>{ERROR_TEXT}</p>
          <Button
            onPress={() => {
              void read.refetch();
            }}
          >
            Prøv igen
          </Button>
        </div>
      ) : null}
      {data?.ok && !recipes.length ? (
        <p className="max-w-[36ch] text-pv-body leading-normal text-pv-ink-3">{EMPTY_TEXT}</p>
      ) : null}
      {active && session ? <ResumeBand recipe={active} label={progressOf(active, session.steps).label} /> : null}
      {filters.length > 1 ? (
        <Choices
          aria-label="Kategori"
          value={shown ?? ALL}
          onChange={value => {
            setCategory(value === ALL ? null : value);
          }}
        >
          {[{name: ALL, count: recipes.length}, ...filters].map(item => (
            <Chip key={item.name} id={item.name}>
              {item.name === ALL ? 'Alle' : item.name}
            </Chip>
          ))}
        </Choices>
      ) : null}
      {rows.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-pv-s2 gap-y-pv-s3"
          aria-label={shown ?? 'Alle opskrifter'}>
          {rows.map(recipe => {
            const current = recipeId(recipe) === session?.id;
            return (
              <li key={recipeId(recipe)}>
                <AriaButton
                  className={cx(pressable, 'flex w-full flex-col gap-1 text-left text-pv-ink')}
                  data-opens="recipe"
                  data-active={current ? 'true' : undefined}
                  onPress={() => {
                    show(recipeId(recipe));
                    push('recipe');
                  }}
                >
                  <Photo src={recipe.image ?? recipe.images?.[0]}
                    className={cx('pointer-events-none aspect-[4/3] h-auto w-full rounded-[16px]',
                      current && 'outline-3 outline-offset-2 outline-pv-recipe-ring')} />
                  <strong className="text-[17px] leading-[1.25] font-bold">{recipe.title}</strong>
                  <small className="text-pv-meta text-pv-ink-2">
                    {[recipe.publisher, factsOf(recipe)[0]].filter(Boolean).join(' · ')}
                  </small>
                </AriaButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

const SUBTITLE = 'mt-pv-s2 mb-pv-s1 text-pv-label font-semibold text-pv-ink-2';
const SECTION_TITLE = 'mb-pv-s2 text-[22px] leading-[1.2] font-semibold tracking-[-0.4px]';
// A tick: the box (or a step's number) and its line, as tall as a finger.
const CHECK = 'group flex min-h-pv-hit cursor-pointer items-start gap-pv-s2 outline-none ' +
  'data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-4 data-[focus-visible]:outline-pv-ink';

function Ingredients({recipe, ticking}: {recipe: Recipe; ticking: boolean}) {
  const ticked = useRecipeSession(state => state.session?.ingredients) ?? [];
  const toggle = useRecipeSession(state => state.toggleIngredient);
  return (
    <section aria-labelledby="recipe-ingredients-title">
      <h2 id="recipe-ingredients-title" className={SECTION_TITLE}>Ingredienser</h2>
      {groupsOf(recipe).map((group, index) => (
        <div key={`${group.title}-${String(index)}`}>
          {groupsOf(recipe).length > 1 ? <h3 className={SUBTITLE}>{group.title}</h3> : null}
          <ul className="flex flex-col gap-pv-s1">
            {group.lines.map((line, row) => {
              const key = `${String(index)}:${String(row)}`;
              return (
                <li key={key}>
                  {ticking ? (
                    <CheckboxField
                      isSelected={ticked.includes(key)}
                      onChange={() => {
                        toggle(key);
                      }}
                    >
                      <CheckboxButton className={CHECK}>
                        <span className="size-6 flex-none rounded-[7px] border-2 border-pv-ink-2
                          group-data-[selected]:border-pv-recipe-ink group-data-[selected]:bg-pv-recipe-ink"
                          aria-hidden />
                        <span className="group-data-[selected]:text-pv-ink-2 group-data-[selected]:line-through">
                          {line}
                        </span>
                      </CheckboxButton>
                    </CheckboxField>
                  ) : (
                    line
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Steps({recipe, ticking}: {recipe: Recipe; ticking: boolean}) {
  const done = useRecipeSession(state => state.session?.steps) ?? [];
  const toggle = useRecipeSession(state => state.toggleStep);
  const reduced = useReducedMotion() ?? false;
  const current = ticking ? recipe.steps.findIndex((_, index) => !done.includes(index)) : -1;
  return (
    <section aria-labelledby="recipe-steps-title">
      <h2 id="recipe-steps-title" className={SECTION_TITLE}>Fremgangsmåde</h2>
      <ol className="flex flex-col gap-pv-s1">
        {recipe.steps.map((step, index) => {
          const phase = phaseAt(recipe, index);
          const finished = ticking && done.includes(index);
          const number = cx('grid size-10 flex-none place-items-center rounded-full bg-pv-recipe-ink/18',
            'font-extrabold text-pv-recipe-ink',
            index === current && 'bg-pv-recipe-now text-pv-surface',
            finished && 'bg-pv-recipe-ink text-pv-surface');
          return (
            <li
              key={index}
              data-step={index + 1}
              data-current={index === current ? 'true' : undefined}
              data-done={finished ? 'true' : undefined}
            >
              {phase ? <h3 className={SUBTITLE}>{phase}</h3> : null}
              <motion.div
                className="flex items-start gap-pv-s3"
                animate={{opacity: finished ? 0.55 : 1}}
                transition={reduced ? TRANSITION.reduced : TRANSITION.fade}
              >
                {ticking ? (
                  <CheckboxField
                    isSelected={finished}
                    aria-label={`Trin ${String(index + 1)}`}
                    onChange={() => {
                      toggle(index);
                    }}
                  >
                    <CheckboxButton className={CHECK}>
                      {/* The tick replaces the number with a small pop (snappy); the number comes back the same way. */}
                      <span className={cx(number, 'relative')} aria-hidden>
                        <AnimatePresence initial={false} mode="popLayout">
                          <motion.span
                            key={finished ? 'done' : 'todo'}
                            initial={{opacity: 0, scale: 0.6}}
                            animate={{opacity: 1, scale: 1}}
                            exit={{opacity: 0, scale: 0.6}}
                            transition={{...TRANSITION.snappy, opacity: TRANSITION.fade}}
                          >
                            {finished ? '✓' : index + 1}
                          </motion.span>
                        </AnimatePresence>
                      </span>
                    </CheckboxButton>
                  </CheckboxField>
                ) : (
                  <span className={number} aria-hidden>
                    {index + 1}
                  </span>
                )}
                <p className="mt-1.5 text-[19px] leading-[1.45]">{step}</p>
              </motion.div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function RecipeScreen() {
  const {read, recipes, session, active} = useRecipeCatalog();
  const open = useRecipeSession(state => state.open);
  const start = useRecipeSession(state => state.start);
  const finish = useRecipeSession(state => state.finish);
  const show = useRecipeSession(state => state.show);
  const back = useNav(state => state.back);
  const reduced = useReducedMotion() ?? false;
  const recipe = recipes.find(item => recipeId(item) === open) ?? null;
  if (!recipe) {
    return (
      <section id="recipe-view" className={SCREEN} aria-labelledby="recipe-title">
        <Heading id="recipe-title" title="Opskrift"
          line={read.isPending ? LOADING_TEXT : 'Opskriften findes ikke i kataloget længere.'} />
        {read.isPending ? null : (
          <Button
            className="self-start"
            onPress={() => {
              back();
            }}
          >
            Til kataloget
          </Button>
        )}
      </section>
    );
  }
  const id = recipeId(recipe);
  const cooking = session?.id === id;
  const progress = cooking ? progressOf(recipe, session.steps) : null;
  const facts = factsOf(recipe);
  const byline = [progress?.label, recipe.publisher ? `af ${recipe.publisher}` : null].filter(Boolean).join(' · ');
  return (
    <section id="recipe-view" className={SCREEN} aria-labelledby="recipe-title">
      <article className="grid min-h-[200px] grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-pv-s4 rounded-pv-l
        bg-pv-recipe p-pv-s3 text-pv-recipe-ink" aria-labelledby="recipe-title">
        <Photo src={recipe.image ?? recipe.images?.[0]}
          className="size-full max-h-[280px] min-h-[200px] rounded-[16px]" />
        <div className="flex min-w-0 flex-col gap-pv-s1">
          <small className="text-pv-meta text-pv-recipe-meta">{categoriesOf(recipe).join(' · ')}</small>
          <h1 id="recipe-title"
            className="my-0 text-[30px] leading-[1.15] font-semibold tracking-[-0.03em] wrap-anywhere">
            {recipe.title}
          </h1>
          {/* The hero's lines keep the spacing they had as paragraphs (one line height around them). */}
          {byline ? <p className="my-[15px] text-pv-meta text-pv-recipe-meta">{byline}</p> : null}
          {facts.length ? <p className="my-4">{facts.join(' · ')}</p> : null}
          {recipe.description ? <p>{recipe.description}</p> : null}
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={cooking ? 'cooking' : active ? 'other' : 'idle'}
              className="mt-auto flex flex-wrap gap-pv-s1 pt-pv-s2"
              role="group"
              aria-label="Opskriften"
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              transition={reduced ? TRANSITION.reduced : TRANSITION.fade}
            >
              {cooking ? (
                <Button
                  variant="quiet"
                  onPress={() => {
                    finish();
                  }}
                >
                  <Icon name="check2" />
                  <span>Afslut opskrift</span>
                </Button>
              ) : active ? (
                <>
                  <Button
                    variant="primary"
                    onPress={() => {
                      show(recipeId(active));
                    }}
                  >
                    <span className="truncate">{`Fortsæt ${active.title}`}</span>
                  </Button>
                  <Button
                    onPress={() => {
                      start(id, Date.now());
                    }}
                  >
                    <span className="truncate">Start denne i stedet</span>
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  onPress={() => {
                    start(id, Date.now());
                  }}
                >
                  <Icon name="play-fill" className="invert" />
                  <span>Start opskrift</span>
                </Button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </article>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-pv-s4">
        <Ingredients recipe={recipe} ticking={cooking} />
        <Steps recipe={recipe} ticking={cooking} />
      </div>
    </section>
  );
}
