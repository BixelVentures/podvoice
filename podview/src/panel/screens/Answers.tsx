// Svar on HA: the PodVoice add-on's answers through our integration (lib/ha/answers.ts, pushed over HA's websocket):
// the answer GPT-Live is giving right now, before it is saved, and the saved ones. The answer card is AnswerCard.tsx
// and the »I dag« / »Tidligere svar« column the same rows as
// svar-today (screens/answers/today.ts), with its »↑ 1 nyt svar« key: an answer that arrives while an older one is
// read, or while the list is scrolled away from the top, is counted there, and the key jumps to the newest. Reading
// the newest answer, a new one simply takes its place. A row opens another answer here; nothing is sent. The
// add-on being stopped or busy is said in PodView's own words, keeps the answers already read, and touches
// nothing else on the panel. Every text below is PodView's copy (the answer history states, svar-today)
// or the integration's (recipe_upload.py »PodVoice svarer ikke lige nu«).
import {motion, useReducedMotion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from 'react-aria-components';
import {useAnswers} from '../../lib/ha/answers';
import {panelEndpoints} from '../../lib/ha/timers';
import {useCatalog, useLink, usePanelConfig} from '../../lib/ha/transport';
import {svarNewLabel, svarTodayRows, svarUnseenCount} from '../../screens/answers/today';
import type {SvarRow} from '../../screens/answers/today';
import type {Answer} from '../../screens/answers/types';
import {useRoom} from '../room';
import {AnswerCard, CHIP} from './AnswerCard';
import {TRANSITION} from '../../lib/motion/tokens';
import {cx, Icon, pressable} from '../../ui';

// A row is a motion element so that, when a new answer lands on top, the rows below glide down to their places on the
// smooth spring (layout; the list scrolls, so it measures with layoutScroll). The new row is simply there: a live
// answer that is saved keeps its place and never fades.
const RowButton = motion.create(Button);

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

// The »↑ N nye svar« key (svar-today's): rows that were not on the list when the user last saw its top, or the row
// being read, are counted; the rows seen stay seen.
function useNewer(rows: SvarRow[]) {
  const list = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(rows.map(row => row.id)));
  const [scrolled, setScrolled] = useState(false);
  const reading = rows[0]?.current === true && !scrolled;
  const add = rows.filter(row => !seen.has(row.id) && (reading || row.current)).map(row => row.id);
  if (add.length) setSeen(new Set([...seen, ...add]));
  const count = svarUnseenCount(rows, new Set([...seen, ...add]));
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
    setSeen(new Set(rows.map(row => row.id)));
  };
  return {count, seeAll, list};
}

function SvarColumn({rows, onOpen}: {rows: SvarRow[]; onOpen: (row: SvarRow) => void}) {
  const {count, seeAll, list} = useNewer(rows);
  const reduced = useReducedMotion() ?? false;
  const label = svarNewLabel(count);
  return (
    <aside className="relative min-w-0 shrink-0 basis-[34%]" aria-labelledby="svar-today-title">
      <header className="flex items-center justify-between">
        <h2 id="svar-today-title" className="text-[22px] leading-8 font-extrabold tracking-normal">
          {rows.every(row => row.today) ? 'I dag' : 'Tidligere svar'}
        </h2>
        <span className="text-pv-meta font-semibold text-pv-ink-3">Nyeste øverst</span>
      </header>
      {/* »1 nyt svar« floats over the list (primary, up icon); it never pushes the rows. It enters with a spring
          from just above (standing still under reduced motion) and is gone the moment it is used. */}
      {count ? (
        <motion.div
          className="absolute inset-x-0 top-14 z-3 mx-auto w-fit"
          initial={reduced ? false : {opacity: 0, y: -12, scale: 0.96}}
          animate={{opacity: 1, y: 0, scale: 1}}
          transition={reduced ? TRANSITION.reduced : {...TRANSITION.snappy, opacity: TRANSITION.fade}}
        >
          <Button
            className={cx(pressable, 'flex h-11 min-h-11 items-center gap-pv-s1 rounded-pv-pill bg-pv-dark pr-[18px]',
              'pl-3.5 text-base leading-none font-semibold whitespace-nowrap text-pv-on-dark',
              'shadow-[0_10px_24px_-10px_rgba(23,23,26,.55)]')}
            aria-label={`Vis nyeste svar · ${label}`}
            onPress={() => {
              const newest = rows[0];
              seeAll();
              if (newest && !newest.current) onOpen(newest);
            }}
          >
            <Icon name="chevron-up" className="size-[18px] invert" />
            <span>{label}</span>
          </Button>
        </motion.div>
      ) : null}
      <motion.div className="grid auto-rows-16 gap-pv-s1 overflow-auto" role="group"
        aria-labelledby="svar-today-title" ref={list} layoutScroll>
        {rows.map(row => (
          <RowButton
            key={row.id}
            layout="position"
            className={cx(pressable, 'grid h-16 w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3',
              'overflow-hidden rounded-[18px] px-pv-s2 text-left text-pv-ink',
              row.current ? 'bg-pv-line' : 'bg-pv-surface shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]')}
            data-answer-id={row.id}
            data-live={row.live ? 'true' : undefined}
            {...(row.current ? {'aria-current': 'true' as const} : {})}
            aria-label={`${row.kindLabel} · ${row.title} · ${row.time}`}
            onPress={() => {
              onOpen(row);
            }}
          >
            <span className={cx('grid size-8 place-items-center rounded-pv-pill', CHIP[row.domain] ?? CHIP.answer)}>
              <Icon name={row.icon || 'chat-circle'} className="size-5" />
            </span>
            <strong className="truncate text-[17px] leading-[22px] font-bold">{row.title}</strong>
            <time className="font-pv-mono text-pv-meta font-medium whitespace-nowrap text-pv-ink-3">{row.time}</time>
          </RowButton>
        ))}
      </motion.div>
    </aside>
  );
}

// The live answers first (GPT-Live's current turn), then the saved ones; an answer saved meanwhile is shown once.
export function combinedAnswers(saved: readonly Answer[], current: readonly Answer[]): Answer[] {
  const savedReceipts = new Set(saved.map(answer => answer.receiptId).filter(Boolean));
  return [...current.filter(answer => !answer.receiptId || !savedReceipts.has(answer.receiptId)), ...saved];
}

export function AnswersScreen() {
  const link = useLink();
  const room = useAnswerRoom();
  const read = useAnswers(room, link.generation, link.connected);
  // The answers last read stay while a later read fails (kept from the render that saw them).
  const data = read.data;
  const [known, setKnown] = useState<Answer[]>([]);
  const fresh = useMemo(() => (data?.ok ? combinedAnswers(data.answers, data.live ?? []) : null), [data]);
  if (fresh && fresh !== known) setKnown(fresh);
  const answers = fresh ?? known;
  const [chosen, setChosen] = useState<string | null>(null);
  // A chosen answer no longer on the list (a live one that was replaced) gives way to the newest.
  const answer = answers.find(item => item.id === chosen) ?? answers[0] ?? null;
  const live = new Set((data?.ok ? (data.live ?? []) : []).map(item => item.id));
  const rows = svarTodayRows([{items: answers}], answers, answer?.id).map(row =>
    live.has(row.id) ? {...row, live: true} : row,
  );
  const state = answersState({
    connected: link.connected,
    loading: !data,
    failure: null,
    error: data && !data.ok ? data.error : null,
    retained: answers.length > 0,
    empty: data?.ok === true && !answers.length,
  });
  return (
    <section
      id="answers-view"
      className="flex flex-[1_0_auto] flex-col overflow-hidden rounded-pv-l bg-pv-surface p-pv-s3"
      aria-labelledby="answers-title"
    >
      {/* The topbar's title is the screen's title (docs/PODVIEW-PARITY.md, decision 2): no page card of its own. */}
      <header className="sr-only">
        <h1 id="answers-title" className="mt-0 mb-2.5 text-pv-title leading-[1.08] font-medium tracking-[-0.035em]">
          Svar
        </h1>
        {answers.length ? (
          <p className="text-pv-meta leading-[19px] text-pv-ink-3">{`${String(answers.length)} svar`}</p>
        ) : null}
      </header>
      {state ? (
        <div className="max-w-[36ch] text-pv-body leading-normal text-pv-ink-3" role="status">
          <strong className="block font-bold">{state.title}</strong>
          {state.detail ? <p className="my-[1em]">{state.detail}</p> : null}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-pv-s3" hidden={!answers.length}>
        <div className="min-w-0 flex-1">
          {answer && <AnswerCard key={answer.id} answer={answer} connected={link.connected} />}
        </div>
        <SvarColumn
          rows={rows}
          onOpen={row => {
            setChosen(row.id);
          }}
        />
      </div>
    </section>
  );
}
