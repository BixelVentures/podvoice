// The local preview (no PodVoice): Find musik drawn from the preview's own music options. Only the preview's
// copy is shown; a tap is the preview journey's own choice (widget-model.js), never a Spotify start.
import type {ShelvesPage, ShelfItem} from './model';

export interface DemoOption {
  id: string;
  name: string;
  art?: unknown;
}

// A stable 22-character key per option (the page's identity for a tile, never shown or sent).
function key(id: string): string {
  let value = '';
  for (let index = 0; index < id.length; index += 1) value += id.charCodeAt(index).toString(36);
  return value.padEnd(22, '0').slice(0, 22);
}

export function demoShelvesPage(options: DemoOption[], artwork: (value: unknown) => string | null)
  : {page: ShelvesPage; options: Map<string, string>} {
  const map = new Map<string, string>();
  const items: ShelfItem[] = options.map(option => {
    const uri = `spotify:playlist:${key(option.id)}`;
    map.set(uri, option.id);
    const art = typeof option.art === 'string'
      ? artwork(option.art.startsWith('https:') ? option.art : `assets/${option.art}`) : null;
    return {uri, kind: 'playlist', name: option.name, ...(art ? {artwork: art} : {})};
  });
  return {
    options: map,
    page: {bootId: 'preview', roomId: 'preview', account: 'preview', ownerEpoch: null, items, refreshing: false,
      quick: items.slice(0, 6).map((_row, item) => ({item})),
      shelves: items.length ? [{id: 'recent', title: 'Forslag', ai: false, why: null, shape: 'square',
        items: items.map((_row, index) => index)}] : []},
  };
}
