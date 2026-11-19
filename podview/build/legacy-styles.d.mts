import type {Plugin} from 'vite';

export const podviewRoot: string;
export const stylesheetSources: string[];
export function stageStylesPlugin(): Plugin;
export function deliveredStylesheet(): string;
