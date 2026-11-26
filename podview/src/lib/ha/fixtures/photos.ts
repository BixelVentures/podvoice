// Ro's shared album as the PodVoice integration answers it (installed by createFakeHass): `podvoice.photos` lists
// the cached photos newest first with signed URLs to /api/podvoice/photos/<id>, and `podvoice.photos_refresh` reads
// the album at once (»Hent nu«). `photoAlbum` is the lever: `configured: false` is no link set, `add()` is a photo
// added to the album, `error` the last poll's error code.
import type {FakeHass} from '../ha-fixture';

export interface FakePhoto {
  id: string;
  width: number;
  height: number;
  added: number;
}

const START = Date.parse('2026-11-20T10:00:00+01:00');

export const photoAlbum = {
  configured: true,
  album: 'HA podview',
  error: null as string | null,
  syncedAt: Date.parse('2026-11-19T16:15:00+01:00'),
  photos: [] as FakePhoto[],
  reset() {
    this.configured = true;
    this.album = 'HA podview';
    this.error = null;
    this.syncedAt = Date.parse('2026-11-19T16:15:00+01:00');
    this.photos = Array.from({length: 4}, (_, index) => ({
      id: `A-${String(index + 1)}`,
      width: index === 1 ? 1536 : 2048,
      height: index === 1 ? 2048 : 1536,
      added: START + index * 3_600_000,
    }));
  },
  add(id: string, portrait = false) {
    const newest = Math.max(START, ...this.photos.map(photo => photo.added));
    this.photos.push({id, width: portrait ? 1536 : 2048, height: portrait ? 2048 : 1536, added: newest + 60_000});
  },
};
photoAlbum.reset();

let signature = 0;
export function albumAnswer() {
  if (!photoAlbum.configured) {
    return {ok: true, configured: false, album: '', count: 0, last_sync: null, last_error: null, photos: []};
  }
  signature += 1;
  const photos = [...photoAlbum.photos].sort((a, b) => b.added - a.added).map(photo => ({
    id: photo.id,
    url: `/api/podvoice/photos/${photo.id}?v=1&authSig=fake${String(signature)}`,
    width: photo.width,
    height: photo.height,
    created: new Date(photo.added - 86_400_000).toISOString(),
    added: new Date(photo.added).toISOString(),
    portrait: photo.height > photo.width,
    version: '1',
  }));
  return {ok: true, configured: true, album: photoAlbum.album, count: photos.length,
    last_sync: new Date(photoAlbum.syncedAt).toISOString(), last_error: photoAlbum.error, photos};
}

export function installPhotosFake(fake: FakeHass): void {
  fake.handle('podvoice.photos', () => ({response: albumAnswer()}));
  fake.handle('podvoice.photos_refresh', () => {
    photoAlbum.syncedAt = Date.now();
    photoAlbum.error = null;
    return {response: albumAnswer()};
  });
}
