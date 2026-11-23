// The command lifecycle for HA actions, in one Zustand store. A tap is a wish: the screen shows it at once, the call
// is sent exactly once, and the wish ends when HA shows the effect (the observed entity), when HA refuses it, or as
// an honest »unknown« when neither happens in time. Nothing is ever locked: a new tap on the same control replaces
// the wish (last tap wins) and is sent; an older call's late answer no longer counts. Nothing is resent by itself.
import {create, useStore} from 'zustand';
import type {HassEntityState} from './hass';
import type {CallOutcome, HaTransport} from './transport';
import {transport as appTransport} from './transport';

export type WishPhase = 'sending' | 'awaiting' | 'unknown' | 'rejected';

export interface Wish {
  key: string;
  entityId: string | null;
  // What the control shows while the wish stands (e.g. 'paused', 0.4, true).
  value: unknown;
  phase: WishPhase;
  seq: number;
  reason: string;
}

export interface WishRequest {
  // One control: `${entityId}:${what}` (play state, volume, light power, …).
  key: string;
  entityId: string | null;
  value: unknown;
  // HA shows the effect.
  confirm: (entity: HassEntityState | null) => boolean;
  call: () => Promise<CallOutcome>;
  // The entity as now known: an accepted call whose effect is already shown (play while playing) ends at once.
  observed?: () => HassEntityState | null;
  timeoutMs?: number;
}

export const WISH_TIMEOUT_MS = 6000;
// A refused or unknown wish is shown this long, unless HA shows something new first.
export const NOTICE_MS = 5000;

interface Store {
  wishes: Record<string, Wish | undefined>;
}

export function createCommandStore(source: HaTransport = appTransport) {
  const store = create<Store>(() => ({wishes: {}}));
  const confirms = new Map<string, (entity: HassEntityState | null) => boolean>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let seq = 0;

  const put = (wish: Wish | null, key: string) => {
    store.setState(state => {
      const wishes = Object.fromEntries(Object.entries(state.wishes).filter(([name]) => name !== key));
      if (wish) wishes[key] = wish;
      return {wishes};
    });
  };
  const clearTimer = (key: string) => {
    const timer = timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(key);
  };
  const end = (key: string) => {
    clearTimer(key);
    confirms.delete(key);
    put(null, key);
  };
  const current = (key: string, id: number) => store.getState().wishes[key]?.seq === id;
  const notice = (key: string, id: number, phase: 'unknown' | 'rejected', reason: string) => {
    const wish = store.getState().wishes[key];
    if (wish?.seq !== id) return;
    confirms.delete(key);
    put({...wish, phase, reason}, key);
    clearTimer(key);
    timers.set(
      key,
      setTimeout(() => {
        if (current(key, id)) end(key);
      }, NOTICE_MS),
    );
  };

  const reconcile = (entity: HassEntityState | null, entityId: string) => {
    for (const wish of Object.values(store.getState().wishes)) {
      if (wish?.entityId !== entityId) continue;
      if (wish.phase === 'unknown' || wish.phase === 'rejected') {
        // HA showed something new: the observed truth replaces the notice.
        end(wish.key);
        continue;
      }
      if (confirms.get(wish.key)?.(entity)) end(wish.key);
    }
  };
  const unsubscribe = source.onEntity(reconcile);

  function send(request: WishRequest): number {
    seq += 1;
    const id = seq;
    const {key} = request;
    clearTimer(key);
    confirms.set(key, request.confirm);
    put({key, entityId: request.entityId, value: request.value, phase: 'sending', seq: id, reason: ''}, key);
    timers.set(
      key,
      setTimeout(() => {
        notice(key, id, 'unknown', 'timeout');
      }, request.timeoutMs ?? WISH_TIMEOUT_MS),
    );
    void request.call().then(result => {
      if (!current(key, id)) return;
      if (!result.ok) {
        notice(key, id, result.outcome, result.reason);
        return;
      }
      if (request.observed && request.confirm(request.observed())) {
        end(key);
        return;
      }
      const wish = store.getState().wishes[key];
      if (wish?.phase === 'sending') put({...wish, phase: 'awaiting'}, key);
    });
    return id;
  }

  return {
    store,
    source,
    send,
    // Ends a wish whose proof is not an entity (the timer bridge's next read).
    settle: (key: string, confirmed: boolean) => {
      const wish = store.getState().wishes[key];
      if (!wish) return;
      if (confirmed) end(key);
    },
    reconcile,
    dispose: () => {
      unsubscribe();
      for (const key of [...timers.keys()]) clearTimer(key);
    },
  };
}

export type CommandStore = ReturnType<typeof createCommandStore>;

export const commands = createCommandStore();

export function useWish(key: string): Wish | undefined {
  // useStore, not the store as a function: the React Compiler memoizes plain calls and breaks hook order.
  return useStore(commands.store, state => state.wishes[key]);
}
