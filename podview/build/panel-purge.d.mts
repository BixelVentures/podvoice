import type {Plugin} from 'vite';

export function purgeCss(css: string, code: string): string;
export function panelPurge(): Plugin;
