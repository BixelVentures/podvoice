// Whether the screen a component sits in is the one shown. The shell's screen stack keeps Hjem, the current and the
// previous screen mounted (panel/Shell.tsx); a screen that waits out of sight provides `false`, and its ambient loops
// (a breathing material, a pulse, weather art) stand still until it is shown again. Outside the stack (overlays,
// tests) everything is shown.
import {createContext, useContext} from 'react';

export const Shown = createContext(true);

export const useShown = () => useContext(Shown);
