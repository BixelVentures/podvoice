// Ro's carousel fed by the shared album (A-FotoRo, decided 11 Nov): 20 s a photo with a 1.2-s crossfade, the newest
// first then the rest at random without repeats; a photo added to the album comes next, a removed one leaves the
// round, the photo on screen stays; the next photo is fetched while this one shows; offline the last photo stays.
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CAROUSEL_MS, carouselOrder, mergeAlbum, PhotoCarousel} from './Rest';
import type {RestPhoto} from './Rest';

const photo = (id: string, at: number, portrait = false): RestPhoto =>
  ({id, src: `/api/podvoice/photos/${id}?authSig=1`, alt: `Billede ${id}`, at, portrait});
const ALBUM = [photo('A-1', 1), photo('A-2', 2), photo('A-3', 3), photo('A-4', 4)];

describe('mergeAlbum', () => {
  it('keeps the photo on screen and puts the new ones next, newest first', () => {
    const order = carouselOrder(ALBUM, () => 0);
    const merged = mergeAlbum(order, 1, [...ALBUM, photo('A-5', 5), photo('A-6', 6)]);
    expect(merged.order[merged.at]?.id).toBe(order[1]?.id);
    expect(merged.order.slice(merged.at + 1, merged.at + 3).map(item => item.id)).toEqual(['A-6', 'A-5']);
    expect(merged.order).toHaveLength(6);
  });

  it('a removed photo leaves the round; removed while on screen, the next takes its place', () => {
    const order = carouselOrder(ALBUM, () => 0);
    const gone = order[1]?.id;
    const merged = mergeAlbum(order, 1, ALBUM.filter(item => item.id !== gone));
    expect(merged.order.map(item => item.id)).not.toContain(gone);
    expect(merged.order[merged.at]?.id).toBe(order[2]?.id);
  });

  it('a fresh URL for the same photo keeps its place; an album with nothing in common starts a new round', () => {
    const order = carouselOrder(ALBUM, () => 0);
    const resigned = ALBUM.map(item => ({...item, src: `${item.src}&again`}));
    const merged = mergeAlbum(order, 2, resigned);
    expect(merged.order.map(item => item.id)).toEqual(order.map(item => item.id));
    expect(merged.order[2]?.src).toContain('&again');
    const own = [{src: 'ambient.webp', alt: 'Bjerglandskab ved en sø'}];
    expect(mergeAlbum(own, 0, ALBUM).order[0]?.id).toBe('A-4');
  });
});

describe('PhotoCarousel', () => {
  const images: {src: string; onerror: (() => void) | null}[] = [];
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    images.length = 0;
    vi.stubGlobal('Image', class {
      decoding = '';
      onerror: (() => void) | null = null;
      set src(value: string) {
        images.push(this);
        Object.defineProperty(this, 'url', {value, configurable: true});
      }
      get src() {
        return (this as unknown as {url?: string}).url ?? '';
      }
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const shown = (container: HTMLElement) => container.querySelector('[data-photo]')?.getAttribute('data-photo');

  it('the newest first, the next fetched ahead, 20 s each, every photo once a round, a new photo comes next', () => {
    const {container, rerender} = render(<PhotoCarousel photos={ALBUM} />);
    expect(shown(container)).toBe('A-4');
    const seen = [shown(container)];
    for (let step = 0; step < 3; step++) {
      const ahead = images.at(-1)?.src;
      act(() => {
        vi.advanceTimersByTime(CAROUSEL_MS);
      });
      // The photo that comes was fetched while the last one showed.
      expect(ahead).toContain(`/${String(shown(container))}?`);
      seen.push(shown(container));
    }
    expect(new Set(seen).size).toBe(4);
    const now = shown(container);
    rerender(<PhotoCarousel photos={[...ALBUM, photo('A-9', 9)]} />);
    expect(shown(container)).toBe(now);
    act(() => {
      vi.advanceTimersByTime(CAROUSEL_MS);
    });
    expect(shown(container)).toBe('A-9');
  });

  it('a portrait stands on its blurred copy from the first paint', () => {
    const {container} = render(<PhotoCarousel photos={[photo('P-1', 1, true)]} />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.querySelector('img[aria-hidden=true]')?.className).toContain('blur-2xl');
  });

  it('offline: a photo that cannot be fetched is skipped and the last one shown stays, with no error', () => {
    const {container} = render(<PhotoCarousel photos={ALBUM} />);
    expect(shown(container)).toBe('A-4');
    // Every next photo fails to fetch (no network): the carousel stays on the one it has.
    for (let step = 0; step < 3; step++) {
      act(() => {
        images.at(-1)?.onerror?.();
      });
    }
    act(() => {
      vi.advanceTimersByTime(CAROUSEL_MS * 3);
    });
    expect(shown(container)).toBe('A-4');
    expect(container.textContent).toBe('');
  });
});
