// Native feel: a page's first frame never waits on the network. A source photo is shown only once it has decoded;
// until then the canvas placeholder stands in its place and the photo swaps in quietly. The photos are written to
// the <img> directly (from a layout effect), as before: React never owns their src.
export const placeholder = 'assets/icons/image-square.svg';
const decodedPhotos = new Map<string, HTMLImageElement>(); // kept so the photo stays in the memory cache
const photoLoads = new Map<string, Promise<boolean>>();

export function decodePhoto(src: string): Promise<boolean> {
  if (decodedPhotos.has(src)) return Promise.resolve(true);
  if (typeof globalThis.Image !== 'function') return Promise.resolve(false);
  let load = photoLoads.get(src);
  if (!load) {
    const image = new globalThis.Image();
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.src = src;
    // A test DOM may have no decode(); onload/onerror stand in for it.
    const loaded = typeof (image as {decode?: unknown}).decode === 'function'
      ? image.decode()
      : new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
    load = loaded
      .then(
        () => {
          decodedPhotos.set(src, image);
          return true;
        },
        () => false,
      )
      .finally(() => photoLoads.delete(src));
    photoLoads.set(src, load);
  }
  return load;
}

export function showPhoto(img: HTMLImageElement, src: string | undefined) {
  img.referrerPolicy = 'no-referrer';
  img.dataset.recipePhoto = src ?? '';
  if (src && decodedPhotos.has(src)) {
    delete img.dataset.recipeFallback;
    img.src = src;
    return;
  }
  img.dataset.recipeFallback = '';
  img.src = placeholder;
  if (!src) return;
  void decodePhoto(src).then(ok => {
    if (!ok || img.dataset.recipePhoto !== src) return;
    delete img.dataset.recipeFallback;
    img.src = src;
  });
}

// A photo that fails falls back to the placeholder, once.
const fallbacks = new WeakSet<HTMLImageElement>();
export function fallBackOnError(img: HTMLImageElement, extra?: () => void) {
  if (fallbacks.has(img)) return;
  fallbacks.add(img);
  img.addEventListener(
    'error',
    () => {
      img.dataset.recipeFallback = '';
      extra?.();
      img.src = placeholder;
    },
    {once: true},
  );
}
