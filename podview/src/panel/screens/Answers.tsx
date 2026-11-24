// Svar on HA: the PodVoice add-on's saved answers through our integration (lib/ha/answers.ts). The answer card is
// the wall page's own <pv-answer> (screens/answers/AnswerWidget.tsx) and the »I dag« / »Tidligere svar« column the
// same rows as svar-today (screens/answers/today.ts). A row opens another saved answer here; nothing is sent. The
// add-on being stopped or busy is said in the wall page's own words, keeps the answers already read, and touches
// nothing else on the panel. Every text below is the wall page's copy (LiveAnswerView history states, svar-today)
// or the integration's (recipe_upload.py »PodVoice svarer ikke lige nu«).
import {useEffect, useRef, useState} from 'react';
import {useAnswers} from '../../lib/ha/answers';
import {panelEndpoints} from '../../lib/ha/timers';
import {transport, useLink, usePanelConfig} from '../../lib/ha/transport';
import '../../screens/answers/AnswerWidget';
import type {AnswerWidget} from '../../screens/answers/AnswerWidget';
import {svarTodayRows} from '../../screens/answers/today';
import type {SvarRow} from '../../screens/answers/today';
import type {Answer} from '../../screens/answers/types';
import {currentScreen, useNav} from '../nav';
import {useRoom} from '../room';
import {icon} from '../ui';

// The PodVoice endpoint of the page's room (its HA device's area), else the first one: the add-on's room id.
export function useAnswerRoom(): string | null {
  const endpoints = panelEndpoints(usePanelConfig());
  const {room} = useRoom();
  const devices = transport.current()?.devices;
  const inRoom = endpoints.find(item => room && devices?.[item.device_id]?.area_id === room.id);
  return (inRoom ?? endpoints[0])?.endpoint ?? null;
}

export interface AnswersState {
  title: string;
  detail: string;
}

const REREAD_AFTER_OPEN_MS = 700;
const UNAVAILABLE = 'PodVoice svarer ikke lige nu – prøv igen om et minut';

// The history states of the wall page (LiveAnswerView.historyPresentation), from this read.
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
  if (failure === 'rejected' || error === 'unknown_room')
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

// The wall page's card element, created outside React's commit (it draws itself synchronously with flushSync) and
// given the chosen answer. React owns only the empty host.
function AnswerHost({answer, connected}: {answer: Answer | null; connected: boolean}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let card = node.querySelector<AnswerWidget>(':scope > pv-answer');
      if (!answer) {
        card?.remove();
        return;
      }
      if (!card) {
        card = document.createElement('pv-answer') as AnswerWidget;
        node.append(card);
      }
      card.update({connected, focus: answer.id}, answer);
    });
    return () => {
      cancelled = true;
    };
  }, [answer, connected]);
  return <div id="answer-host" className="min-w-0 flex-1" ref={host} />;
}

function SvarColumn({rows, onOpen}: {rows: SvarRow[]; onOpen: (row: SvarRow) => void}) {
  return (
    <aside id="svar-today" className="svar-today min-w-0 basis-[34%]" aria-labelledby="svar-today-title">
      <header>
        <h2 id="svar-today-title">{rows.every(row => row.today) ? 'I dag' : 'Tidligere svar'}</h2>
        <span>Nyeste øverst</span>
      </header>
      <div className="svar-today-rows" role="group" aria-labelledby="svar-today-title">
        {rows.map(row => (
          <button
            key={row.id}
            type="button"
            className="svar-today-row"
            data-answer-id={row.id}
            data-domain={row.domain || 'answer'}
            aria-current={row.current ? 'true' : undefined}
            aria-label={`${row.kindLabel} · ${row.title} · ${row.time}`}
            onClick={() => {
              onOpen(row);
            }}
          >
            <span className="svar-today-chip">
              <img className="svar-today-icon" alt="" src={icon(row.icon || 'chat-circle')} />
            </span>
            <strong className="svar-today-title">{row.title}</strong>
            <time>{row.time}</time>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function AnswersScreen() {
  const open = useNav(state => currentScreen(state) === 'answers');
  const link = useLink();
  const room = useAnswerRoom();
  const read = useAnswers(room, link.generation, link.connected, open);
  const {refetch, dataUpdatedAt} = read;
  // Opening Svar re-reads answers older than 10 s (the start's read built the card already), once the slide has
  // settled: a card redrawn mid-slide costs frames.
  useEffect(() => {
    if (!open || !link.connected || Date.now() - dataUpdatedAt <= 10_000) return;
    const handle = window.setTimeout(() => void refetch(), REREAD_AFTER_OPEN_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [open, link.connected, refetch, dataUpdatedAt]);
  // The answers last read stay while a later read fails (kept from the render that saw them).
  const data = read.data;
  const [known, setKnown] = useState<Answer[]>([]);
  if (data?.ok && data.answers !== known) setKnown(data.answers);
  const answers = data?.ok ? data.answers : known;
  const [chosen, setChosen] = useState<string | null>(null);
  const answer = answers.find(item => item.id === chosen) ?? answers[0] ?? null;
  const rows = svarTodayRows([{items: answers}], answers, answer?.id);
  const failure = read.isError ? ((read.error as {outcome?: 'rejected' | 'unknown'}).outcome ?? 'unknown') : null;
  const state = answersState({
    connected: link.connected,
    loading: read.isFetching || read.isPending,
    failure,
    error: data && !data.ok ? data.error : null,
    retained: answers.length > 0,
    empty: data?.ok === true && !answers.length,
  });
  return (
    <section id="answers-view" className="response-widget" aria-labelledby="answers-title">
      <header className="response-heading">
        <div>
          <h1 id="answers-title">Svar</h1>
          {answers.length ? <p>{`${String(answers.length)} svar`}</p> : null}
        </div>
      </header>
      {state ? (
        <div className="screen-explanation" role="status">
          <strong>{state.title}</strong>
          {state.detail ? <p>{state.detail}</p> : null}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-[var(--pv-s3)]" hidden={!answers.length}>
        <AnswerHost answer={answer} connected={link.connected} />
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
