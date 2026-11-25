// The topbar's title per screen when it is the screen's content (Opskrift: the recipe's own title, as on the
// canvas), else the screen's own name (Shell.tsx).
import {useEffect} from 'react';
import {create} from 'zustand';
import type {ScreenId} from './nav';

export const useScreenTitles = create<{titles: Partial<Record<ScreenId, string>>}>(() => ({titles: {}}));

/** The topbar's title while `id` is shown: `title`, else the screen's own name. */
export function useScreenTitle(id: ScreenId, title: string | null) {
  useEffect(() => {
    useScreenTitles.setState(state => ({titles: {...state.titles, [id]: title ?? undefined}}));
    return () => {
      useScreenTitles.setState(state => ({titles: {...state.titles, [id]: undefined}}));
    };
  }, [id, title]);
}

