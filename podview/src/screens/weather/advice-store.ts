// The passive AI weather advice: one lazy request per server-admitted source binding (boot, room, weather key).
// The request is paid, so it is sent once per binding and never replayed, not on navigation and not on return.
// Its completion is read only through the shell's home projection, polled once a second (at most 8 times, 10 s)
// while the server says »pending«. Leaving the page aborts local work: a late answer is ignored, and the next visit
// reads home instead of posting again. The page drives it (useWeatherModel → reconcile); this store owns it.
import {create} from 'zustand';
import {currentApi} from '../../lib/api/client';
import {useShell} from '../../lib/store/shell';
import {weatherPassiveAdvice} from './observation.ts';
import type {WeatherAdviceCapability, WeatherObservation, WeatherPassiveAdvice} from './observation.ts';

const POLL_MS = 1000;
const POLLS = 8;
const PENDING_MS = 10000;
const ATTEMPTS = 32;
const FAILED = ['error', 'unavailable'];

export interface AdviceContext {
  cap: WeatherAdviceCapability;
  // JSON of [bootId, roomId, weatherKey]: the binding.
  key: string;
  // JSON of the observation without its advice fields: a changed source cannot take an old receipt.
  source: string;
  weather: WeatherObservation;
  voiceCurrent: boolean;
}

interface Attempt {
  until: number;
  source: string;
  deadline: number;
  polls: number;
  status: string;
  advice: WeatherPassiveAdvice | null;
  refreshNeeded: boolean;
}

interface AdviceState {
  attempts: ReadonlyMap<string, Attempt>;
  active: {key: string; source: string} | null;
  generation: number;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface PassiveAdvice {
  context: WeatherAdviceCapability;
  advice?: WeatherPassiveAdvice | null;
  status: string | null;
}

const INITIAL: AdviceState = {attempts: new Map(), active: null, generation: 0, controller: null, timer: null};
export const useWeatherAdvice = create<AdviceState>(() => INITIAL);

const get = useWeatherAdvice.getState;
const set = useWeatherAdvice.setState;

function patch(key: string, change: Partial<Attempt>) {
  const attempts = new Map(get().attempts);
  const entry = attempts.get(key);
  if (!entry) return;
  attempts.set(key, {...entry, ...change});
  set({attempts});
}

function put(key: string, entry: Attempt) {
  set({attempts: new Map(get().attempts).set(key, entry)});
}

// Ends local work for the binding on screen: an in-flight request is aborted and its answer ignored.
export function invalidateAdvice() {
  const {active, controller, timer, attempts} = get();
  if (!active && !controller && !timer) return;
  const entry = active ? attempts.get(active.key) : undefined;
  if (active && entry?.status === 'sending') patch(active.key, {status: 'unavailable', refreshNeeded: true});
  controller?.abort();
  if (timer) globalThis.clearTimeout(timer);
  set({generation: get().generation + 1, controller: null, timer: null, active: null});
}

function current(context: AdviceContext, generation: number) {
  const {active} = get();
  return generation === get().generation && active?.key === context.key && active.source === context.source;
}

async function request(context: AdviceContext, now: () => number) {
  const generation = get().generation;
  const controller = new AbortController();
  set({controller});
  try {
    const value = await currentApi().weatherAdvice(context.cap, {signal: controller.signal});
    if (!current(context, generation)) return;
    const advice = weatherPassiveAdvice(value, context.weather, now(), context.cap, {allowUnadmitted: true});
    patch(context.key, {advice, status: advice?.status ?? 'unavailable'});
  } catch (error) {
    if (!current(context, generation)) return;
    patch(context.key, {status: 'unavailable'});
    const code = (error as {code?: unknown} | null)?.code;
    if (code === 'stale_weather_binding' || code === 'read_access_denied') useShell.getState().loadHome();
  } finally {
    if (get().controller === controller) set({controller: null});
  }
}

function poll(context: AdviceContext) {
  if (get().timer) return;
  const generation = get().generation;
  const timer = globalThis.setTimeout(() => {
    set({timer: null});
    if (!current(context, generation)) return;
    const entry = get().attempts.get(context.key);
    if (entry) patch(context.key, {polls: entry.polls + 1});
    useShell.getState().loadHome();
  }, POLL_MS);
  set({timer});
}

// What the page shows for the binding (pure: reads the store).
export function adviceProjection(context: AdviceContext | null, now: number, state = get()): PassiveAdvice | null {
  if (!context) return null;
  const cap = context.cap;
  if (cap.availability !== 'available') return {context: cap, status: 'unavailable'};
  const projected = weatherPassiveAdvice(context.weather.passiveAdvice, context.weather, now, cap);
  const entry = state.attempts.get(context.key);
  if (entry && entry.source !== context.source) return {context: cap, status: 'unavailable'};
  if (projected && entry?.advice?.requestId && projected.requestId !== entry.advice.requestId)
    return {context: cap, status: 'unavailable'};
  const failed = FAILED.includes(cap.status);
  const advice = failed ? null : (projected ?? entry?.advice ?? null);
  const fallback = cap.status === 'pending' ? 'pending' : entry?.status === 'sending' ? 'requesting' : entry?.status;
  const status = failed
    ? cap.status
    : cap.status === 'ready' && advice?.status !== 'ready'
      ? 'unavailable'
      : (advice?.status ?? fallback ?? null);
  if (status === 'pending' && entry && (now >= entry.deadline || entry.polls >= POLLS))
    return {context: cap, status: 'unavailable'};
  return {context: cap, advice, status};
}

// Starts what the binding on screen needs: the one request, or a home read while the server reports pending.
export function reconcileAdvice(context: AdviceContext | null, now: () => number = Date.now) {
  if (context?.cap.availability !== 'available') {
    invalidateAdvice();
    return;
  }
  const {active} = get();
  if (active?.key !== context.key || active.source !== context.source) {
    invalidateAdvice();
    set({active: {key: context.key, source: context.source}});
  }
  const time = now();
  const live = new Map([...get().attempts].filter(([, entry]) => entry.until > time));
  if (live.size !== get().attempts.size) set({attempts: live});
  const cap = context.cap;
  let entry = get().attempts.get(context.key);
  if (!entry && !context.voiceCurrent && cap.status === 'idle' && get().attempts.size < ATTEMPTS) {
    entry = {until: (cap.validUntil ?? 0) * 1000, source: context.source, deadline: time + PENDING_MS, polls: 0,
      status: 'sending', advice: null, refreshNeeded: false};
    put(context.key, entry);
    void request(context, now);
  }
  const status = adviceProjection(context, time)?.status;
  if (status !== 'pending' && get().timer) {
    globalThis.clearTimeout(get().timer ?? undefined);
    set({timer: null});
  }
  // An answer lost when the page was left: read home once instead of asking again.
  if (entry?.refreshNeeded) {
    patch(context.key, {refreshNeeded: false});
    poll(context);
  }
  if (status === 'pending') {
    if (!entry) put(context.key, {until: (cap.validUntil ?? 0) * 1000, source: context.source, deadline: time + PENDING_MS,
      polls: 0, status: 'pending', advice: null, refreshNeeded: false});
    poll(context);
  }
}

export function resetWeatherAdvice() {
  invalidateAdvice();
  set(INITIAL);
}
