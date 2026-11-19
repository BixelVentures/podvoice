// Opskrifter-Bog: Udforsk shows the same catalogue as a cover flow (P9, docs/MOTION.md §3.10). The chosen photo
// stands flat (720×460); its neighbours turn 55° away. The flow is a native scroll-snap scroller, so iPadOS's own
// momentum and rubber-band move it, and every cover is drawn by its view timeline on the compositor (ui-kit.css,
// exploreKeyframes). No JavaScript runs per frame and React never renders while the flow moves: React draws the
// page once, and the listeners below (attached after that render, as before) only notice when the nearest cover
// changes (title, dots, position) and when the scroll rests (focus, aria, live text). A tap on a neighbour scrolls
// to it; a tap on the chosen photo opens it. Without scroll-driven animations the flow is a flat snap carousel.
import {useLayoutEffect, useRef} from 'react';
import type {CSSProperties} from 'react';
import {DUR, isReduced, SPRING} from '../../../ui/motion.js';
import {springFrames} from '../../../ui/native-motion.js';
import {EXPLORE_DOT_PITCH, EXPLORE_DOTS, EXPLORE_PITCH, exploreFrame} from './model';
import type {Recipe} from './model';
import {Meta, PageHeader} from './parts';
import {RecipePhoto} from './RecipePhoto';
import {ViewSwitch} from './Catalog';

export interface ExploreModel {
  recipes: Recipe[];
  // The badge on the recipe being cooked (»I gang · trin N af M«), by position.
  badges: (string | null)[];
  // The cover chosen last time; the flow opens on it.
  startIndex: number;
  // Without recipes: why the flow is empty.
  empty: string;
}

export interface ExploreActions {
  chooseMode: (mode: string) => void;
  shown: (index: number) => void;
  open: (cover: HTMLElement, recipe: Recipe) => void;
}

interface Handlers {
  activate: (k: number) => void;
  key: (event: KeyboardEvent) => void;
}

export function Explore({model, actions, root}: {model: ExploreModel; actions: ExploreActions; root: HTMLElement}) {
  const {recipes, badges} = model;
  const flowRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<HTMLSpanElement>(null);
  const handlers = useRef<Handlers | null>(null);
  const dotCount = Math.min(EXPLORE_DOTS, recipes.length);

  useLayoutEffect(() => {
    const flow = flowRef.current;
    const info = infoRef.current;
    const dots = dotsRef.current;
    const position = positionRef.current;
    if (!flow || !info || !dots || !position) return;
    // One snap slot per cover: the slot is the view-timeline subject, the cover inside it is what moves.
    const slots = [...flow.children] as HTMLElement[];
    const covers = slots.map(slot => slot.firstElementChild as HTMLElement);
    // Seven dots in a fixed pool, drawn for the nearest cover only; CSS moves them between two such states.
    const dotPool = [...dots.children] as HTMLElement[];
    const [category, title, details] = [...info.children] as HTMLElement[];
    if (!category || !title || !details) return;
    let shown = -1;
    let rested = -1;
    let windowStart = -1;
    let target: number | null = null;
    let restTimer: ReturnType<typeof setTimeout> | null = null;
    let textMotion: Animation | null = null;
    let frame = 0;
    let check = 0;
    const reduced = () => isReduced(root);
    // Where the engine has scroll timelines the text follows the finger (ui-kit.css, pv-explore-title); otherwise
    // the new text comes in softly from the side it is scrolled from, interrupted by the next change.
    const css = (globalThis as {CSS?: {supports?: (property: string, value: string) => boolean}}).CSS;
    let scrollDriven = css?.supports?.('animation-timeline', 'view()') === true;
    // The snap pitch is the slot width (430, or the wider flat slot without scroll-driven animations).
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an unmeasured slot (0) uses the pitch
    const pitch = () => slots[0]?.offsetWidth || EXPLORE_PITCH;
    const nearest = () => Math.max(0, Math.min(recipes.length - 1, Math.round(flow.scrollLeft / pitch())));
    // The covers follow their view timelines only if the engine really runs them. At rest the chosen cover stands
    // flat in the centre and its neighbour is turned; otherwise the flow becomes the flat snap carousel for good.
    const timelineRuns = (k: number) => {
      // Judged only where the flow stands exactly on a cover.
      if (Math.abs(flow.scrollLeft - k * pitch()) > 1 || typeof DOMMatrix !== 'function') return true;
      const at = (n: number) => {
        const cover = covers[n];
        return new DOMMatrix(cover ? getComputedStyle(cover).transform : 'none');
      };
      const chosen = at(k);
      const neighbour = covers[k + 1] ? k + 1 : covers[k - 1] ? k - 1 : -1;
      if (Math.abs(chosen.m41) > 4 || Math.abs(chosen.m13) > 0.02) return false;
      return reduced() || neighbour < 0 || Math.abs(at(neighbour).m13) > 0.3;
    };
    const flatten = (k: number) => {
      scrollDriven = false;
      flow.dataset.recipeExploreFlat = info.dataset.recipeExploreFlat = '';
      flow.scrollLeft = k * pitch();
    };
    const show = (i: number) => {
      if (i === shown) return;
      if (shown >= 0 && !scrollDriven && typeof info.animate === 'function') {
        const from = reduced() ? {opacity: 0} : {opacity: 0, translate: `${String(Math.sign(i - shown) * 16)}px 0`};
        textMotion?.cancel();
        textMotion = info.animate([from, {opacity: 1, translate: '0 0'}], {
          duration: reduced() ? DUR.reduced : DUR.base,
          easing: 'cubic-bezier(.2,0,0,1)',
        });
      }
      shown = i;
      actions.shown(i);
      const recipe = recipes[i];
      if (!recipe) return;
      category.textContent = (recipe.categories ?? [])[0] ?? '';
      title.textContent = recipe.title;
      details.textContent = [recipe.portions, recipe.totalTime || recipe.baking].filter(Boolean).join(' · ');
      position.textContent = `${String(i + 1)} af ${String(recipes.length)}`;
      const next = exploreFrame(i, recipes.length, {reduced: reduced()});
      if (next.dots.start !== windowStart) {
        const step = windowStart < 0 ? 0 : next.dots.start - windowStart;
        windowStart = next.dots.start;
        if (step && !reduced() && typeof dots.animate === 'function') {
          const {keyframes, duration} = springFrames(SPRING.quick, p => ({
            transform: `translateX(${String(Math.round(step * EXPLORE_DOT_PITCH * (1 - p) * 100) / 100)}px)`,
          }));
          dots.animate(keyframes, {duration});
        }
      }
      next.dots.items.forEach((dot, o) => {
        const node = dotPool[o];
        if (!node) return;
        node.style.transform = dot.transform;
        node.style.opacity = String(dot.opacity);
      });
    };
    // Focus, aria and the live text follow the cover the scroll rests on. They are written only once the flow has
    // been still for a moment after scrollend (a snap can still be settling), never while it moves.
    const rest = (judge = true) => {
      restTimer = null;
      const k = nearest();
      if (judge && scrollDriven && !timelineRuns(k)) flatten(k);
      show(k);
      if (target === k) target = null;
      if (k === rested) return;
      rested = k;
      covers.forEach((cover, n) => {
        cover.tabIndex = n === k ? 0 : -1;
        if (n !== k) {
          cover.removeAttribute('aria-current');
          cover.setAttribute('aria-hidden', 'true');
        } else {
          cover.setAttribute('aria-current', 'true');
          cover.removeAttribute('aria-hidden');
        }
      });
      info.setAttribute('aria-live', 'polite');
      title.replaceChildren(document.createTextNode(recipes[k]?.title ?? ''));
    };
    const settle = () => {
      if (restTimer) clearTimeout(restTimer);
      restTimer = setTimeout(rest, 120);
    };
    const scrolled = () => {
      if (info.getAttribute('aria-live') !== 'off') info.setAttribute('aria-live', 'off');
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          show(nearest());
        });
      }
      // scrollend where the engine has it; otherwise the scroll rests 150 ms after its last event.
      if (restTimer) clearTimeout(restTimer);
      restTimer = 'onscrollend' in flow ? null : setTimeout(rest, 150);
    };
    flow.addEventListener('scroll', scrolled, {passive: true});
    flow.addEventListener('scrollend', settle);
    const go = (k: number) => {
      target = Math.max(0, Math.min(recipes.length - 1, k));
      flow.scrollTo({left: target * pitch(), behavior: reduced() ? 'auto' : 'smooth'});
    };
    handlers.current = {
      activate: k => {
        const cover = covers[k];
        const recipe = recipes[k];
        if (!cover || !recipe) return;
        if (k !== nearest()) go(k);
        else actions.open(cover, recipe);
      },
      key: event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        go((target ?? nearest()) + (event.key === 'ArrowRight' ? 1 : -1));
      },
    };
    // Open on the cover chosen last time. The one layout read here happens before anything is drawn.
    flow.scrollLeft = Math.min(recipes.length - 1, model.startIndex) * pitch();
    rest(false);
    // The first check waits for the timelines' first frames.
    check = requestAnimationFrame(() => {
      check = requestAnimationFrame(() => {
        if (scrollDriven && restTimer === null && !timelineRuns(nearest())) flatten(nearest());
      });
    });
    return () => {
      flow.removeEventListener('scroll', scrolled);
      flow.removeEventListener('scrollend', settle);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(check);
      if (restTimer) clearTimeout(restTimer);
      handlers.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page is drawn once per visit (a new key)
  }, []);

  return (
    <>
      <PageHeader title="Opskrifter" subtitle="" />
      <header data-recipe-layout="toolbar">
        {/* The switch stands where it stands in the catalogue: the right end of the toolbar. */}
        <div>
          <span data-kit-text="meta" data-recipe-explore-position="" ref={positionRef} />
          <ViewSwitch mode="explore" onChoose={actions.chooseMode} />
        </div>
      </header>
      {recipes.length ? (
        <>
          {/* The 36px back-edge zone stays with the back gesture: an overlay beside the scroller (never a sticky child
              in it), so a pan cannot start there. */}
          <div data-recipe-explore-edge="" aria-hidden="true" />
          <div
            data-recipe-layout="explore"
            data-pv-gesture-owner=""
            aria-roledescription="karrusel"
            tabIndex={0}
            ref={flowRef}
            onKeyDown={event => handlers.current?.key(event.nativeEvent)}
          >
            {recipes.map((recipe, k) => (
              <div key={k} data-recipe-explore-slot="">
                {/* A cover is a link-like element, not a button: a pan that starts on it gets no press feedback, so
                    nothing but its view timeline ever animates it while the flow moves. */}
                <div
                  role="link"
                  data-recipe-cover={recipe.title}
                  aria-label={recipe.title}
                  onClick={() => handlers.current?.activate(k)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    handlers.current?.activate(k);
                  }}
                >
                  <RecipePhoto src={recipe.image} alt="" decoding="async" />
                  {badges[k] ? <span data-recipe-explore-badge="">{badges[k]}</span> : null}
                </div>
              </div>
            ))}
          </div>
          {/* The title fades through 0 at every crossing: one iteration of its scroll-driven fade per cover step. */}
          <div
            data-recipe-layout="explore-info"
            style={{'--pv-explore-steps': String(Math.max(1, recipes.length - 1))} as CSSProperties}
            aria-live="polite"
            ref={infoRef}
          >
            <span />
            <span data-recipe-explore-title="" />
            <span />
          </div>
          <div
            data-recipe-explore-dots=""
            aria-hidden="true"
            style={{width: `${String(dotCount * EXPLORE_DOT_PITCH + 8)}px`}}
            ref={dotsRef}
          >
            {Array.from({length: dotCount}, (_, n) => (
              <i key={n} />
            ))}
          </div>
        </>
      ) : (
        <Meta>{model.empty}</Meta>
      )}
    </>
  );
}
