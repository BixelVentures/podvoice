// Svar on HA (A-SvarKort): the PodVoice add-on's answers through our integration (lib/ha/answers.ts, pushed over HA's
// websocket): the answer GPT-Live is giving right now, before it is saved, and the saved ones. One card per answer
// (AnswerCard.tsx) with its follow-ups in the same card, newest on top; »I dag« stands in the player's column (the
// player steps aside while it shows) with its »↑ 1 nyt svar« key: an answer that arrives while an older one is read,
// or while the list is scrolled away from the top, is counted there, and the key jumps to the newest. Reading the
// newest answer, a new one simply takes its place. While the add-on builds a visual answer the card waits as
// »Svarkort · bygges«. A row opens another answer here; nothing is sent. The voice's own status lives only in the
// Svar key (useSvarPill, from the add-on's sensor.podvoice_voice_phase). The add-on being stopped or busy is said in
// PodView's own words, keeps the answers already read, and touches nothing else on the panel.
import {useEffect, useMemo, useRef, useState} from 'react';
import {create} from 'zustand';
import {useAnswers} from '../../lib/ha/answers';
import {panelEndpoints} from '../../lib/ha/timers';
import {useCatalog, useEntity, useLink, usePanelConfig} from '../../lib/ha/transport';
import {useShown} from '../../lib/motion/shown';
import {svarNewLabel, svarTime, svarUnseenCount} from '../../screens/answers/today';
import type {Answer} from '../../screens/answers/types';
import {Notice, SvarCard, SvarMini, SvarToday} from '../../ui';
import type {SvarPillState, VoicePhase} from '../../ui';
import {useNav} from '../nav';
import {useRoom} from '../room';
import {useWithoutPlayer} from '../Shell';
import {AnswerCard} from './AnswerCard';
import {svarClock, svarGlyph, svarKind, svarPill, svarThreads, svarTitle, svarTone, threadOf,
  voicePhase} from './svar-model';
import type {SvarThread} from './svar-model';

export const VOICE_PHASE_ENTITY = 'sensor.podvoice_voice_phase';

// The PodVoice endpoint of the page's room (its HA device's area), else the first one: the add-on's room id.
export function useAnswerRoom(): string | null {
  const endpoints = panelEndpoints(usePanelConfig());
  const {room} = useRoom();
  const {deviceAreas} = useCatalog();
  const inRoom = endpoints.find(item => room && deviceAreas[item.device_id] === room.id);
  return (inRoom ?? endpoints[0])?.endpoint ?? null;
}

export interface AnswersState {
  title: string;
  detail: string;
}

const UNAVAILABLE = 'PodVoice svarer ikke lige nu – prøv igen om et minut';

// The answer history's states, from this read.
export function answersState({
  connected,
  loading,
  failure,
  error,
  retained,
  empty,
}: {
  connected: boolean;
  loading: boolean;
  // HA itself refused or lost the call: 'rejected' (no such service, no access) or 'unknown'.
  failure: 'rejected' | 'unknown' | null;
  // The integration's answer about the add-on.
  error: string | null;
  retained: boolean;
  empty: boolean;
}): AnswersState | null {
  if (!connected)
    return {
      title: 'Forbindelsen mangler',
      detail: retained ? 'Viser de kendte svar.' : 'Tidligere svar kan ikke hentes lige nu.',
    };
  if (failure === 'rejected' || error === 'unknown_room' || error === 'service_unavailable')
    return {title: 'Tidligere svar er ikke tilgængelige', detail: 'Adgangen til historikken mangler.'};
  if (failure || error) {
    const known = retained
      ? 'De kendte svar er bevaret. Historikken opdateres, når forbindelsen tillader det.'
      : 'Historikken opdateres, når forbindelsen tillader det.';
    return {
      title: 'Tidligere svar kunne ikke hentes',
      detail: error === 'addon_unavailable' ? `${UNAVAILABLE}. ${known}` : known,
    };
  }
  if (loading && !retained) return {title: 'Henter tidligere svar…', detail: ''};
  if (empty)
    return {
      title: 'Ingen visuelle svar endnu',
      detail: 'Når PodVoice viser et visuelt svar, kan du finde det her igen.',
    };
  return null;
}

// The live answers first (GPT-Live's current turn), then the saved ones; an answer saved meanwhile is shown once.
export function combinedAnswers(saved: readonly Answer[], current: readonly Answer[]): Answer[] {
  const savedReceipts = new Set(saved.map(answer => answer.receiptId).filter(Boolean));
  return [...current.filter(answer => !answer.receiptId || !savedReceipts.has(answer.receiptId)), ...saved];
}

// The answers this panel knows for its room: the newest read, else the last one that succeeded.
function useKnownAnswers() {
  const link = useLink();
  const room = useAnswerRoom();
  const read = useAnswers(room, link.generation, link.connected);
  const data = read.data;
  const fresh = useMemo(() => (data?.ok ? combinedAnswers(data.answers, data.live ?? []) : null), [data]);
  const [known, setKnown] = useState<Answer[]>([]);
  if (fresh && fresh !== known) setKnown(fresh);
  const live = new Set((data?.ok ? (data.live ?? []) : []).map(item => item.id));
  return {link, room, data, answers: fresh ?? known, live, building: data?.ok === true && !!data.building};
}

// When the newest answer the user has seen on Svar was given (Kit-SvarKnap »Nyt svar ulæst«: a red dot until the
// card is seen). The answers already there when the panel starts count as seen; an answer leaving the list never
// makes an older one new.
export const useSvarSeen = create<{seen: number | null}>(() => ({seen: null}));
const newestAt = (answers: readonly Answer[]) =>
  answers.length ? Math.max(...answers.map(answer => (Number.isFinite(answer.observedAt) ? answer.observedAt ?? 0
    : 0))) : null;

/** The Svar key's state: the add-on's voice phase for this room, and whether a newer answer is unread. */
export function useSvarPill(): {state: SvarPillState; voice?: VoicePhase} {
  const {answers, room} = useKnownAnswers();
  const phase = voicePhase(useEntity(VOICE_PHASE_ENTITY), room);
  const {connected} = useLink();
  const newest = newestAt(answers);
  const seen = useSvarSeen(state => state.seen);
  useEffect(() => {
    if (newest !== null && useSvarSeen.getState().seen === null) useSvarSeen.setState({seen: newest});
  }, [newest]);
  return svarPill(phase, newest !== null && seen !== null && newest > seen, connected);
}

// The »↑ N nye svar« key (svar-today's): threads that were not on the list when the user last saw its top, or the
// thread being read, are counted; the ones seen stay seen.
function useNewer(ids: readonly string[], current: string | null) {
  const list = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(ids));
  const [scrolled, setScrolled] = useState(false);
  const reading = ids[0] === current && !scrolled;
  const add = ids.filter(id => !seen.has(id) && (reading || id === current));
  if (add.length) setSeen(new Set([...seen, ...add]));
  const all = new Set([...seen, ...add]);
  const count = svarUnseenCount(ids.map(id => ({id, current: id === current})), all);
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const moved = () => {
      setScrolled(node.scrollTop > 8);
    };
    node.addEventListener('scroll', moved, {passive: true});
    return () => {
      node.removeEventListener('scroll', moved);
    };
  }, []);
  const seeAll = () => {
    if (list.current) list.current.scrollTop = 0;
    setScrolled(false);
    setSeen(new Set(ids));
  };
  return {count, seeAll, list};
}

function TodayList({threads, current, live, onOpen}: {threads: readonly SvarThread[]; current: string | null;
  live: ReadonlySet<string>; onOpen: (id: string) => void}) {
  const ids = threads.map(thread => thread.id);
  const {count, seeAll, list} = useNewer(ids, current);
  const now = new Date();
  const today = threads.every(thread => new Date(thread.observedAt * 1000).toDateString() === now.toDateString());
  return (
    <SvarToday title={today ? 'I dag' : 'Tidligere svar'} newer={count ? svarNewLabel(count) : null}
      listRef={list} onNewer={() => {
        const newest = threads[0];
        seeAll();
        if (newest && newest.id !== current) onOpen(newest.id);
      }}>
      {threads.map(thread => {
        const {title, question} = svarTitle(thread.main);
        return (
          <SvarMini key={thread.id} id={thread.id} tone={svarTone(thread.main)} icon={svarGlyph(thread.main)}
            kind={svarKind(thread.main)} time={svarTime(thread.observedAt, now)} title={title} question={question}
            current={thread.id === current} name={thread.main.title ?? title}
            live={live.has(thread.main.id) || thread.followUps.some(item => live.has(item.id))}
            onPress={() => {
              onOpen(thread.id);
            }} />
        );
      })}
    </SvarToday>
  );
}

// »Svarkort · bygges«: the question's turn is on its way; the time is when the wait began.
function BuildingCard() {
  const [since] = useState(() => svarClock(Date.now() / 1000));
  return <SvarCard icon="answer" kind="Svarer…" time={since} title="" building />;
}

export function AnswersScreen() {
  const {link, data, answers, live, building, room} = useKnownAnswers();
  const phase = voicePhase(useEntity(VOICE_PHASE_ENTITY), room);
  const push = useNav(state => state.push);
  const threads = useMemo(() => svarThreads(answers), [answers]);
  const [chosen, setChosen] = useState<string | null>(null);
  // A chosen answer no longer on the list (a live one that was replaced) gives way to the newest.
  const picked = threadOf(threads, chosen);
  const thread = picked ?? threads[0] ?? null;
  // While the add-on builds the next visual answer, the card waits for it, unless an older answer is being read.
  const waiting = building && !picked;
  const state = answersState({
    connected: link.connected,
    loading: !data,
    failure: null,
    error: data && !data.ok ? data.error : null,
    retained: answers.length > 0,
    empty: data?.ok === true && !answers.length,
  });
  const listed = threads.length > 0;
  useWithoutPlayer('answers', listed);
  // The newest answer is seen once it is on the card while Svar is shown (the key's red dot goes).
  const shown = useShown();
  const newest = newestAt(answers);
  const onCard = thread?.observedAt === newest ? newest : null;
  useEffect(() => {
    if (shown && onCard !== null && onCard > (useSvarSeen.getState().seen ?? -1)) useSvarSeen.setState({seen: onCard});
  }, [shown, onCard]);
  return (
    <section id="answers-view" data-screen-body="answers" className="flex min-h-0 flex-[1_1_0px] gap-4"
      aria-labelledby="answers-title">
      {/* The topbar's title is the screen's title (docs/PODVIEW-PARITY.md, decision 2): no page card of its own. */}
      <header className="sr-only">
        <h1 id="answers-title">Svar</h1>
        {answers.length ? <p>{`${String(answers.length)} svar`}</p> : null}
      </header>
      {!listed ? (
        <SvarCard className="h-[458px] w-full bg-pv-surface" icon="answer" kind="Tidligere svar" time=""
          title={state?.title ?? 'Ingen visuelle svar endnu'} building={waiting}>
          {state?.detail ? <p className="max-w-[520px] text-[17px] leading-6 text-pv-ink-3" role="status">
            {state.detail}</p> : null}
        </SvarCard>
      ) : waiting ? (
        <BuildingCard />
      ) : thread ? (
        <AnswerCard key={thread.id} answer={thread.main} followUps={thread.followUps} connected={link.connected}
          failed={phase === 'error' && thread.id === threads[0]?.id}
          note={state ? <Notice compact level={link.connected ? 'fejl' : 'info'} title={state.title} /> : null}
          onOpen={screen => {
            push(screen);
          }} />
      ) : null}
      {listed ? (
        <TodayList threads={threads} current={waiting ? null : thread?.id ?? null} live={live} onOpen={id => {
          setChosen(id);
        }} />
      ) : null}
    </section>
  );
}
