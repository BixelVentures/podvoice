// Types for the room media observation used by src/.
export interface MediaRoomBinding {
  accountId: string;
  bindingId: string;
  nativeHomepodId: string;
  nativeRoomId: string;
  roomId: string;
  targetId: string;
}
export interface PlaybackRoomBinding {
  bindingId: string;
  accountId: string;
  nativeRoomId: string;
  nativeHomepodId: string | number;
  validUntil: number;
}
export function mediaRoomBinding(snapshot: unknown, account: unknown): MediaRoomBinding | null;
export function roomObservationDisplay(playback: unknown, snapshot: unknown, account?: unknown): boolean;
export function roomObservationCurrent(playback: unknown, snapshot: unknown): boolean;
export function playbackObservationCurrent(playback: unknown, snapshot: unknown): boolean;
export function playbackBinding(playback: unknown, snapshot: unknown, account?: unknown): PlaybackRoomBinding | null;
