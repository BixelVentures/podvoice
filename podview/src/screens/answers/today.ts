// Svar: the rows of the Svar page's »Tidligere svar« column (lærred »A-SvarKort«). While an answer is shown, the
// player column lists every saved answer as one compact row, newest first: icon chip · title in one line · time. A
// row opens its answer (with the rest of its round, owner-answers answerThread) through the existing history row,
// so browsing, grouping and follow-ups keep their one owner. The answer being read is the selected row.
import {answerCatalog, answerDomainIcon} from './model';
import type {Answer, AnswerGroup} from './types';

const KIND: Record<string, string> = {
  'sport-result': 'Resultat',
  'fact-card': 'Fakta',
  'key-points': 'Svar',
  'answer-timeline': 'Tidslinje',
};

export interface SvarRow {
  id: string;
  title: string;
  kind: string;
  domain: string;
  icon: string;
  observedAt: number;
  current: boolean;
  live?: boolean;
  kindLabel: string;
  time: string;
  today: boolean;
}

// The answer's category, shown only as the icon chip's tint in the home widgets' colours: weather from the weather
// provenance, music from an album-cover image, every other answer the Svar category.
export function svarDomain(answer: Answer | null | undefined): string {
  if (answer?.provenance?.kind === 'ha_weather' || answer?.weatherPresentation?.kind === 'local-weather')
    return 'weather';
  return answer?.kind === 'sourced-image' && answer.content?.image?.kind === 'album_cover' ? 'music' : 'answer';
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// »19.04« today, »i går 19.04« yesterday, otherwise »12. nov. 19.04«.
export function svarTime(seconds: number, now = new Date()): string {
  const at = new Date(seconds * 1000);
  const clock = at.toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'});
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(at, now)) return clock;
  if (sameDay(at, yesterday)) return `i går ${clock}`;
  return `${at.toLocaleDateString('da-DK', {day: 'numeric', month: 'short'})} ${clock}`;
}

type RowBase = Omit<SvarRow, 'kindLabel' | 'time' | 'today'>;

export function svarTodayRows(groups: readonly AnswerGroup[], answers: readonly Answer[], focus: string | undefined,
  now = new Date()): SvarRow[] {
  const focused = answers.find(answer => answer.id === focus);
  const byReceipt = new Map<string, RowBase>();
  const row = (item: Answer, extra: Partial<RowBase> = {}): RowBase => ({
    id: item.id,
    title: item.title ?? '',
    kind: item.kind,
    domain: svarDomain(item),
    icon: answerDomainIcon(item),
    observedAt: Number.isFinite(item.observedAt) ? item.observedAt ?? 0 : 0,
    current: item.id === focus || (!!item.receiptId && item.receiptId === focused?.receiptId),
    ...extra,
  });
  for (const item of groups.flatMap(group => group.items)) byReceipt.set(item.receiptId || item.id, row(item));
  // A live answer is not history yet; while it is on screen it stands with the rest.
  const live = answers.find(answer => answer.id === focus && !answer.hidden && !answer.historical);
  if (live && !byReceipt.has(live.receiptId || live.id)) {
    const observedAt = Number.isFinite(live.observedAt) ? live.observedAt ?? 0 : now.getTime() / 1000;
    byReceipt.set(live.receiptId || live.id, row(live, {live: true, observedAt}));
  }
  return [...byReceipt.values()].sort((a, b) => b.observedAt - a.observedAt).map(item => ({
    ...item,
    kindLabel: KIND[item.kind] || answerCatalog[item.kind] || 'Visuelt svar',
    time: svarTime(item.observedAt, now),
    today: sameDay(new Date(item.observedAt * 1000), now),
  }));
}

// »↑ 1 nyt svar« (lærred »SvarK-Historik«): answers that arrived while the user reads an older one, or has
// scrolled the list away from the top, are counted here. Only rows that were not on the list before count, so the
// number is real.
export function svarUnseenCount(rows: readonly {id: string; current?: boolean}[], seen: Set<string> | null): number {
  return seen ? rows.filter(row => !row.current && !seen.has(row.id)).length : 0;
}

// The arrow is the K-Btn »up« icon, not text.
export const svarNewLabel = (count: number): string => `${String(count)} ${count === 1 ? 'nyt svar' : 'nye svar'}`;
