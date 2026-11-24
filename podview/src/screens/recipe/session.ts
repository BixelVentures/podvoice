// The wall's cooking session (one Zustand store): the recipe shown, the one in progress (»Fortsæt«), the steps and
// ingredients ticked in it, and the catalogue's category. It is the wall's own, as on the old wall page, and is kept
// in this browser (zustand's persist middleware, localStorage), so reopening the panel or a reload keeps the recipe,
// its step and its ticks (O5). A session older than 30 days, or for a recipe the catalogue no longer has, is dropped.
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

export const SESSION_MAX_AGE_MS = 30 * 86_400_000;

export interface CookingSession {
  id: string;
  steps: number[];
  ingredients: string[];
  startedAt: number;
}

export interface RecipeState {
  // The recipe the recipe page shows (its source URL).
  open: string | null;
  // The catalogue's category (null = Alle).
  category: string | null;
  // The recipe in progress, if any.
  session: CookingSession | null;
  show: (id: string) => void;
  setCategory: (category: string | null) => void;
  start: (id: string, now: number) => void;
  toggleStep: (step: number) => void;
  toggleIngredient: (line: string) => void;
  finish: () => void;
  // The catalogue was read: a session for a recipe it no longer has, or an old one, ends.
  prune: (ids: ReadonlySet<string>, now: number) => void;
}

const toggle = <T>(list: readonly T[], value: T) =>
  list.includes(value) ? list.filter(item => item !== value) : [...list, value];

// localStorage can throw (private mode, blocked storage): the session then lives for the page only.
const storage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return undefined as unknown as Storage;
  }
});

export const useRecipeSession = create<RecipeState>()(
  persist(
    set => ({
      open: null,
      category: null,
      session: null,
      show: id => {
        set({open: id});
      },
      setCategory: category => {
        set({category});
      },
      start: (id, now) => {
        set(state => (state.session?.id === id ? state : {session: {id, steps: [], ingredients: [], startedAt: now}}));
      },
      toggleStep: step => {
        set(state => (state.session ? {session: {...state.session, steps: toggle(state.session.steps, step)}} : state));
      },
      toggleIngredient: line => {
        set(state =>
          state.session ? {session: {...state.session, ingredients: toggle(state.session.ingredients, line)}} : state,
        );
      },
      finish: () => {
        set({session: null});
      },
      prune: (ids, now) => {
        set(state => {
          const session = state.session;
          if (!session || (ids.has(session.id) && now - session.startedAt <= SESSION_MAX_AGE_MS)) return state;
          return {session: null};
        });
      },
    }),
    {
      name: 'podview.recipe-session.v2',
      storage,
      partialize: state => ({session: state.session, category: state.category}),
    },
  ),
);
