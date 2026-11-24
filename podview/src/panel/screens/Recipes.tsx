// Opskrifter on HA: the PodVoice add-on's recipe catalog (lib/ha/recipes.ts) and the wall's cooking session
// (screens/recipe/session.ts), as the old wall page had them: the catalogue as photo cards with the categories on top
// and »N opskrifter«, the recipe in progress as a »Fortsæt« band over it (O4), and the recipe page with the hero
// (»Trin N af M · af <kilde>«), the ingredients and the numbered steps. A started recipe ticks its steps and
// ingredients; its step, ticks and portions survive navigation and reloads (O5); »Afslut opskrift« ends it in the
// catalogue and on Hjem at once (O7). Photos are the sources' own, shown once decoded; nothing waits on them.
// Touch and keyboard are React Aria's (KitButton, Checkbox); motion is motion/react on the kit's tokens.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useMemo} from 'react';
import {CheckboxButton, CheckboxField} from 'react-aria-components';
import {TRANSITION} from '../../lib/motion/tokens';
import {useRecipes} from '../../lib/ha/recipes';
import type {Recipe} from '../../lib/ha/recipes';
import {useLink} from '../../lib/ha/transport';
import {KitButton} from '../../lib/ui/KitButton';
import {
  catalog, categoriesOf, factsOf, groupsOf, phaseAt, progressOf, rankCategories, RECIPE_FILTERS, recipeCount,
  recipeId,
} from '../../screens/recipe/model';
import {useRecipeSession} from '../../screens/recipe/session';
import {useNav} from '../nav';
import {BUTTON, icon, Shortcut} from '../ui';

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
          <progress className="recipe-tile-progress" max={progress.total} value={progress.step - 1} aria-hidden />
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

function Photo({src, className}: {src: string | undefined; className: string}) {
  if (!src) return <span className={`${className} recipe-photo-empty`} aria-hidden />;
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={event => {
        event.currentTarget.dataset.loaded = 'true';
      }}
    />
  );
}

function ResumeBand({recipe, label}: {recipe: Recipe; label: string}) {
  const push = useNav(state => state.push);
  const show = useRecipeSession(state => state.show);
  return (
    <KitButton
      id="recipe-resume"
      className="recipe-resume"
      data-opens="recipe"
      aria-label={`Fortsæt ${recipe.title}, ${label}`}
      onPress={() => {
        show(recipeId(recipe));
        push('recipe');
      }}
    >
      <Photo src={recipe.image ?? recipe.images?.[0]} className="recipe-resume-photo" />
      <span>
        <small>I gang</small>
        <strong>{recipe.title}</strong>
        <small>{label}</small>
      </span>
      <span className="recipe-resume-pill">Fortsæt</span>
    </KitButton>
  );
}

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
    <section id="recipes-view" className="response-widget" aria-labelledby="recipes-title">
      <header className="response-heading">
        <div>
          <h1 id="recipes-title">Opskrifter</h1>
          <p>{data?.ok ? recipeCount(recipes.length) : read.isPending ? LOADING_TEXT : 'Ikke tilgængelige'}</p>
        </div>
      </header>
      {data && !data.ok ? (
        <div className="recipe-notice" role="status">
          <p>{ERROR_TEXT}</p>
          <KitButton
            className={BUTTON}
            data-kit="button"
            data-kit-variant="secondary"
            onPress={() => {
              void read.refetch();
            }}
          >
            Prøv igen
          </KitButton>
        </div>
      ) : null}
      {data?.ok && !recipes.length ? <p className="screen-explanation">{EMPTY_TEXT}</p> : null}
      {active && session ? <ResumeBand recipe={active} label={progressOf(active, session.steps).label} /> : null}
      {filters.length > 1 ? (
        <div className="pv-panel-chips recipe-filters" role="radiogroup" aria-label="Kategori">
          {[{name: 'Alle', count: recipes.length}, ...filters].map(item => {
            const value = item.name === 'Alle' ? null : item.name;
            return (
              <KitButton
                key={item.name}
                role="radio"
                aria-checked={value === shown}
                className="pv-panel-chip"
                onPress={() => {
                  setCategory(value);
                }}
              >
                {item.name}
              </KitButton>
            );
          })}
        </div>
      ) : null}
      {rows.length ? (
        <ul className="recipe-grid" aria-label={shown ?? 'Alle opskrifter'}>
          {rows.map(recipe => (
            <li key={recipeId(recipe)}>
              <KitButton
                className="recipe-card"
                data-opens="recipe"
                data-active={recipeId(recipe) === session?.id ? 'true' : undefined}
                onPress={() => {
                  show(recipeId(recipe));
                  push('recipe');
                }}
              >
                <Photo src={recipe.image ?? recipe.images?.[0]} className="recipe-card-photo" />
                <strong>{recipe.title}</strong>
                <small>{[recipe.publisher, factsOf(recipe)[0]].filter(Boolean).join(' · ')}</small>
              </KitButton>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Ingredients({recipe, ticking}: {recipe: Recipe; ticking: boolean}) {
  const ticked = useRecipeSession(state => state.session?.ingredients) ?? [];
  const toggle = useRecipeSession(state => state.toggleIngredient);
  return (
    <section className="recipe-ingredients" aria-labelledby="recipe-ingredients-title">
      <h2 id="recipe-ingredients-title">Ingredienser</h2>
      {groupsOf(recipe).map((group, index) => (
        <div key={`${group.title}-${String(index)}`} className="recipe-group">
          {groupsOf(recipe).length > 1 ? <h3>{group.title}</h3> : null}
          <ul>
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
                      <CheckboxButton className="recipe-check">
                        <span className="recipe-box" aria-hidden />
                        <span>{line}</span>
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
    <section className="recipe-steps" aria-labelledby="recipe-steps-title">
      <h2 id="recipe-steps-title">Fremgangsmåde</h2>
      <ol>
        {recipe.steps.map((step, index) => {
          const phase = phaseAt(recipe, index);
          const finished = ticking && done.includes(index);
          return (
            <li
              key={index}
              data-step={index + 1}
              data-current={index === current ? 'true' : undefined}
              data-done={finished ? 'true' : undefined}
            >
              {phase ? <h3>{phase}</h3> : null}
              <motion.div
                className="recipe-step"
                animate={{opacity: finished ? 0.55 : 1}}
                transition={reduced ? TRANSITION.reduced : TRANSITION.quick}
              >
                {ticking ? (
                  <CheckboxField
                    isSelected={finished}
                    aria-label={`Trin ${String(index + 1)}`}
                    onChange={() => {
                      toggle(index);
                    }}
                  >
                    <CheckboxButton className="recipe-check recipe-step-check">
                      <span className="recipe-number" aria-hidden>
                        {finished ? '✓' : index + 1}
                      </span>
                    </CheckboxButton>
                  </CheckboxField>
                ) : (
                  <span className="recipe-number" aria-hidden>
                    {index + 1}
                  </span>
                )}
                <p>{step}</p>
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
      <section id="recipe-view" className="response-widget" aria-labelledby="recipe-title">
        <header className="response-heading">
          <div>
            <h1 id="recipe-title">Opskrift</h1>
            <p>{read.isPending ? LOADING_TEXT : 'Opskriften findes ikke i kataloget længere.'}</p>
          </div>
        </header>
        {read.isPending ? null : (
          <KitButton
            className={BUTTON}
            data-kit="button"
            data-kit-variant="secondary"
            onPress={() => {
              back();
            }}
          >
            Til kataloget
          </KitButton>
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
    <section id="recipe-view" className="response-widget" aria-labelledby="recipe-title">
      <article className="recipe-hero" aria-labelledby="recipe-title">
        <Photo src={recipe.image ?? recipe.images?.[0]} className="recipe-hero-photo" />
        <div className="recipe-hero-copy">
          <small>{categoriesOf(recipe).join(' · ')}</small>
          <h1 id="recipe-title">{recipe.title}</h1>
          {byline ? <p className="recipe-byline">{byline}</p> : null}
          {facts.length ? <p className="pv-meta">{facts.join(' · ')}</p> : null}
          {recipe.description ? <p className="recipe-description">{recipe.description}</p> : null}
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={cooking ? 'cooking' : active ? 'other' : 'idle'}
              className="pv-actions recipe-actions"
              role="group"
              aria-label="Opskriften"
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              transition={reduced ? TRANSITION.reduced : TRANSITION.quick}
            >
              {cooking ? (
                <KitButton
                  className={`${BUTTON} stop`}
                  data-kit="button"
                  data-kit-shape="pill"
                  data-kit-variant="quiet"
                  onPress={() => {
                    finish();
                  }}
                >
                  <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src={icon('check2')} alt="" />
                  <span>Afslut opskrift</span>
                </KitButton>
              ) : active ? (
                <>
                  <KitButton
                    className={BUTTON}
                    data-kit="button"
                    data-kit-shape="pill"
                    data-kit-variant="primary"
                    onPress={() => {
                      show(recipeId(active));
                    }}
                  >
                    <span>{`Fortsæt ${active.title}`}</span>
                  </KitButton>
                  <KitButton
                    className={BUTTON}
                    data-kit="button"
                    data-kit-shape="pill"
                    data-kit-variant="secondary"
                    onPress={() => {
                      start(id, Date.now());
                    }}
                  >
                    <span>Start denne i stedet</span>
                  </KitButton>
                </>
              ) : (
                <KitButton
                  className={BUTTON}
                  data-kit="button"
                  data-kit-shape="pill"
                  data-kit-variant="primary"
                  onPress={() => {
                    start(id, Date.now());
                  }}
                >
                  <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src={icon('play-fill')} alt="" />
                  <span>Start opskrift</span>
                </KitButton>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </article>
      <div className="recipe-body">
        <Ingredients recipe={recipe} ticking={cooking} />
        <Steps recipe={recipe} ticking={cooking} />
      </div>
    </section>
  );
}
