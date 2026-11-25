// Svar's screen model (A-SvarKort, 12 Nov: one card per answer, follow-ups in the SAME card with the newest on top).
// Answers of one voice session are one thread: its first answer is the card, the later ones its follow-ups. The card's
// header, tone and title come from the answer's own family, provenance and words; nothing is invented here.
import {answerCatalog, answerDomainIcon} from '../../lib/answers/presentation';
import type {Answer} from '../../screens/answers/types';
import type {GlyphName, SvarPillState, SvarTone, VoicePhase} from '../../ui';

export interface SvarThread {
  id: string;
  main: Answer;
  /** The later answers of the same session, newest first. */
  followUps: Answer[];
  /** The newest answer's time (the thread's place in »I dag«). */
  observedAt: number;
}

const at = (answer: Answer) => (Number.isFinite(answer.observedAt) ? answer.observedAt ?? 0 : 0);

/** Answers (newest first, live ones included) as threads, the newest activity first. */
export function svarThreads(answers: readonly Answer[]): SvarThread[] {
  const groups = new Map<string, Answer[]>();
  for (const answer of answers) {
    const key = answer.sessionId ? `session:${answer.sessionId}` : answer.id;
    groups.set(key, [...(groups.get(key) ?? []), answer]);
  }
  return [...groups.values()].flatMap(items => {
    const [main, ...later] = [...items].sort((a, b) => at(a) - at(b));
    return main ? [{id: main.id, main, followUps: later.reverse(), observedAt: Math.max(...items.map(at))}] : [];
  }).sort((a, b) => b.observedAt - a.observedAt);
}

/** The thread an answer belongs to (a row, a live answer, a follow-up). */
export const threadOf = (threads: readonly SvarThread[], id: string | null | undefined) =>
  threads.find(thread => thread.id === id || thread.followUps.some(item => item.id === id)) ?? null;

export function svarTone(answer: Answer): SvarTone {
  if (answer.provenance?.kind === 'ha_weather' || answer.weatherPresentation?.kind === 'local-weather') return 'vejr';
  if (answer.kind === 'sourced-image' && answer.content?.image?.kind === 'album_cover') return 'musik';
  return 'svar';
}

const FAMILY_GLYPH: Record<string, GlyphName> = {
  'sport-result': 'ball',
  'fact-card': 'info',
  'answer-timeline': 'clock',
  'simple-diagram': 'info',
  'key-points': 'answer',
  concise: 'answer',
  steps: 'check',
  checklist: 'check',
  'sourced-image': 'answer',
};

export function svarGlyph(answer: Answer): GlyphName {
  const tone = svarTone(answer);
  if (tone === 'vejr') return 'rain';
  if (tone === 'musik') return 'music';
  const icon = answerDomainIcon(answer);
  if (icon === 'moon') return 'moon';
  if (icon === 'timer') return 'timer';
  if (icon === 'lightbulb') return 'bulb';
  if (icon === 'music-note-beamed') return 'music';
  return FAMILY_GLYPH[answer.kind] ?? 'info';
}

const KIND: Record<string, string> = {
  'sport-result': 'Resultat',
  'fact-card': 'Fakta',
  'key-points': 'Svar',
  concise: 'Svar',
  'answer-timeline': 'Tidslinje',
};

export function svarKind(answer: Answer): string {
  if (svarTone(answer) === 'vejr') return 'Vejr';
  if (svarTone(answer) === 'musik') return 'Musik';
  const base = KIND[answer.kind] ?? answerCatalog[answer.kind] ?? 'Visuelt svar';
  const match = (answer.content as {match?: {date?: string}} | undefined)?.match;
  return answer.kind === 'sport-result' && match?.date ? `${base} · ${match.date}` : base;
}

/** The card's title is the answer's conclusion; what was asked (its title) stands under it as »…«. */
export function svarTitle(answer: Answer): {title: string; question: string} {
  const summary = (answer.content?.summary ?? '').trim();
  const title = (answer.title ?? '').trim();
  if (answer.kind === 'sport-result' || !summary) return {title: title || summary, question: ''};
  return {title: summary, question: summary === title ? '' : title};
}

export const svarClock = (seconds: number | undefined) =>
  Number.isFinite(seconds)
    ? new Date((seconds ?? 0) * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'})
      .replace(':', '.')
    : '';

// The voice phase the add-on publishes (sensor.podvoice_voice_phase, podvoice/gatekeeper/voice_phase.py).
export type VoicePhaseValue = 'rest' | 'listening' | 'thinking' | 'answering' | 'followup' | 'error' | 'offline';
export const VOICE_PHASES: readonly VoicePhaseValue[] =
  ['rest', 'listening', 'thinking', 'answering', 'followup', 'error', 'offline'];

/** The phase of the panel's room: the sensor's per-room value, else its state; unknown or missing is rest. */
export function voicePhase(entity: {state: string; attributes: Record<string, unknown>} | null,
  room: string | null): VoicePhaseValue {
  if (!entity) return 'rest';
  if (entity.state === 'unavailable') return 'offline';
  const rooms = entity.attributes.rooms;
  const own = room && rooms && typeof rooms === 'object' ? (rooms as Record<string, unknown>)[room] : undefined;
  const value = typeof own === 'string' ? own : entity.state;
  return (VOICE_PHASES as readonly string[]).includes(value) ? value as VoicePhaseValue : 'rest';
}

/** The Svar key's state (Kit-SvarKnap's seven) and its grille from the phase and whether a new answer is unread. */
export function svarPill(phase: VoicePhaseValue, unread: boolean): {state: SvarPillState; voice?: VoicePhase} {
  switch (phase) {
    case 'listening':
      return {state: 'lytter'};
    case 'followup':
      // Waiting for a follow-up is listening; the grille scatters (A-Stemme »chat«: waiting for you).
      return {state: 'lytter', voice: 'chat'};
    case 'thinking':
      return {state: 'taenker'};
    case 'answering':
      return {state: 'svarer'};
    case 'error':
      return {state: 'fejl'};
    case 'offline':
      return {state: 'offline'};
    default:
      return {state: unread ? 'ulaest' : 'hvile'};
  }
}
