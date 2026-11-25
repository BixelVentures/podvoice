// The wall's own screen settings (Skærm og enhed): automatic dimming, on by default. With it on, Ro dims at night
// (21–7, Rest.tsx); off, Ro keeps its day look all night. It is this wall's own choice, kept in its browser
// (zustand's persist, localStorage); blocked storage keeps it for the page only.
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

export interface ScreenSettings {
  autoDim: boolean;
  setAutoDim: (on: boolean) => void;
}

const storage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return undefined as unknown as Storage;
  }
});

export const useScreenSettings = create<ScreenSettings>()(
  persist(
    set => ({
      autoDim: true,
      setAutoDim: autoDim => {
        set({autoDim});
      },
    }),
    {name: 'podview.screen-settings.v1', storage, partialize: state => ({autoDim: state.autoDim})},
  ),
);
