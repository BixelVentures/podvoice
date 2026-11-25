// Svar: one answer card (A-SvarKort), read-only towards the house. The content is admitted again here
// (lib/answers/content.ts), so the card draws only the closed shape of its family, each on the kit's own media
// (src/ui/Svar.tsx): facts, result, picture, timeline, diagram and points, choices, comparison, chart, steps,
// checklist and the text answer. Follow-ups of the same voice session stand in the same card, the newest on top.
// The card root carries the answer's identity (data-answer-card, data-answer-id, data-answer-family,
// data-answer-state). »Kilder« folds the sources out; »Se vejret« and »Åbn afspiller« open their screens. The steps
// and the checklist are stepped and ticked on the card itself; nothing on the card sends anything to the house.
import {useState} from 'react';
import type {ReactNode} from 'react';
import {isTypedFamily, isVisualFamily, validateTypedAnswerContent, validateVisualContent} from '../../lib/answers/content';
import type {Source, TypedContent, VisualContent} from '../../lib/answers/content';
import {weatherFacts} from '../../lib/answers/weather-display';
import type {Answer} from '../../screens/answers/types';
import {Notice, SvarAction, SvarCard, SvarChart, SvarChecklist, SvarChoices, SvarComparison, SvarFacts, SvarImage,
  SvarMedia, SvarNodes, SvarScore, SvarSteps, SvarTimeline} from '../../ui';
import {svarClock, svarGlyph, svarKind, svarTitle, svarTone} from './svar-model';

type Admitted = {typed: false; content: VisualContent} | {typed: true; content: TypedContent} | null;

function admit(answer: Answer): Admitted {
  const options = {
    ownerReceiptIds: answer.ownerReceiptIds ?? [],
    allowConversation: answer.provenance?.kind === 'ai_explanation',
  };
  try {
    if (isVisualFamily(answer.kind)) {
      return {typed: false, content: validateVisualContent(answer.kind, answer.content, options)};
    }
    if (isTypedFamily(answer.kind)) {
      return {typed: true, content: validateTypedAnswerContent(answer.kind, answer.content, options)};
    }
  } catch {
    return null;
  }
  return null;
}

// A saved answer never fetches a picture again, except the app's own illustration; a picture that fails keeps its
// caption and credit and says so.
function Picture({picture, historical}: {picture: NonNullable<VisualContent['image']>; historical: boolean}) {
  const [failed, setFailed] = useState(false);
  const shown = !historical || picture.url === 'assets/bicycle-drivetrain-illustration.webp';
  return (
    <>
      {shown && (
        <img src={picture.url} alt={picture.alt} decoding="async" referrerPolicy="no-referrer" width={1000}
          height={600} hidden={failed} onError={() => {
            setFailed(true);
          }} onLoad={event => {
            if (event.currentTarget.naturalWidth > 0) setFailed(false);
          }} />
      )}
      <p className="flex size-full items-center p-6 text-[17px] leading-6 text-pv-ink-2" hidden={shown && !failed}>
        {shown ? 'Billedet kunne ikke indlæses. Forklaring og kilde er bevaret.'
          : 'Billedet hentes ikke igen i historikken. Forklaring og kilde er bevaret.'}
      </p>
    </>
  );
}

const pictureKind = (kind: string | undefined) =>
  kind === 'album_cover' ? 'Omslag' : kind === 'illustration' ? 'Illustration' : 'Foto';

// The result's tag on its disc: the team's own name, its first three letters.
const tag = (name: string) => name.replace(/[^\p{L}]/gu, '').slice(0, 3).toLocaleUpperCase('da-DK');

function VisualBody({family, content, answer, compact}: {family: string; content: VisualContent; answer: Answer;
  compact: boolean}) {
  const historical = answer.historical === true;
  if (family === 'fact-card') {
    const facts = weatherFacts({
      live: answer.live === true,
      kind: family,
      presentation: answer.presentation,
      provenance: {kind: answer.provenance?.kind ?? ''},
      receiptId: answer.receiptId,
      ownerReceiptIds: answer.ownerReceiptIds ?? [],
      weatherDisplayFactIds: answer.weatherDisplayFactIds,
      facts: content.facts ?? [],
      sources: content.sources,
    });
    return <SvarFacts facts={facts.map(f => ({id: f.id, label: f.label, value: f.value, detail: f.detail}))} />;
  }
  if (family === 'sourced-image' && content.image) {
    return (
      <SvarImage image={<Picture picture={content.image} historical={historical} />} caption={content.image.caption}
        credit={`${pictureKind(content.image.kind)} · ${content.image.credit}`} />
    );
  }
  if (family === 'simple-diagram') {
    return (
      <SvarNodes nodes={(content.nodes ?? []).map(n => ({id: n.id, label: n.label, detail: n.detail}))}
        {...(content.illustration ? {image: <Picture picture={content.illustration} historical={historical} />}
          : {})} />
    );
  }
  if (family === 'key-points') {
    return <SvarMedia><SvarNodes nodes={(content.points ?? []).map(p => ({id: p.id, label: p.text}))} /></SvarMedia>;
  }
  if (family === 'answer-timeline') {
    const events = content.events ?? [];
    const planned = events.every(event => event.status === 'planned');
    return (
      <SvarMedia>
        {planned ? <p className="mb-4 text-[15px] font-semibold text-pv-ink-3">Planlagt forløb</p> : null}
        <SvarTimeline events={events.map(e => ({id: e.id, label: e.label, detail: e.detail,
          time: planned ? e.time : (
            <>
              {e.time}
              <small className="block font-pv text-[15px] font-normal text-pv-ink-3">
                {e.status === 'planned' ? 'Planlagt' : 'Registreret'}
              </small>
            </>
          )}))} />
      </SvarMedia>
    );
  }
  if (family === 'sport-result' && content.match) {
    const m = content.match;
    const scorers = content.scorers ?? [];
    // Each scorer once with all of their minutes (»Lewandowski 12', 58'«).
    const line = (team: 'home' | 'away') => {
      const names = new Map<string, string[]>();
      for (const r of scorers.filter(s => s.team === team)) {
        names.set(r.name, [...(names.get(r.name) ?? []), ...(r.minute ? [r.minute] : [])]);
      }
      return [...names].map(([name, minutes]) => (minutes.length ? `${name} ${minutes.join(', ')}` : name))
        .join(' · ');
    };
    return (
      <SvarScore compact={compact}
        home={{name: m.home, tag: tag(m.home), score: m.homeScore, scorers: line('home')}}
        away={{name: m.away, tag: tag(m.away), score: m.awayScore, scorers: line('away')}} />
    );
  }
  return null;
}

function TypedBody({family, content, step, checked, onCheck}: {family: string; content: TypedContent; step: number;
  checked: ReadonlySet<string>; onCheck: (id: string) => void}) {
  const items = content.items ?? [];
  if (family === 'choices') {
    return <SvarChoices items={items.map(item => ({id: item.id, title: item.label, detail: item.detail ?? ''}))} />;
  }
  if (family === 'checklist') {
    return (
      <SvarMedia>
        <SvarChecklist items={items.map(item => ({id: item.id, label: item.label, checked: checked.has(item.id)}))}
          onToggle={onCheck} />
      </SvarMedia>
    );
  }
  if (family === 'comparison') {
    return (
      <SvarMedia>
        <SvarComparison columns={content.columns ?? []}
          rows={items.map(row => ({id: row.id, label: row.label, values: row.values ?? []}))} />
      </SvarMedia>
    );
  }
  if (family === 'chart') {
    const unitFor = (value: number) =>
      new Intl.PluralRules('da').select(value) === 'one' ? (content.unitSingular ?? '') : (content.unit ?? '');
    return (
      <SvarMedia>
        <SvarChart unit={content.unit ?? ''} items={items.map(item => {
          const value = item.value ?? 0;
          return {id: item.id, label: item.label, value, text: `${String(value)} ${unitFor(value)}`};
        })} />
      </SvarMedia>
    );
  }
  if (family === 'steps') {
    return <SvarMedia><SvarSteps steps={(content.steps ?? []).map(s => s.text)} index={step} /></SvarMedia>;
  }
  return null;
}

function SourceList({sources}: {sources: readonly Source[]}) {
  return (
    <ul className="mt-4 grid max-h-40 flex-none gap-2 overflow-auto" aria-label="Kilder og grundlag">
      {sources.map(source => (
        <li key={source.id} className="text-[15px] leading-5 text-pv-ink-2">
          {'url' in source ? (
            <a className="font-semibold underline underline-offset-4" href={source.url} target="_blank"
              rel="noopener noreferrer">{source.label}</a>
          ) : <span className="font-semibold">{source.label}</span>}
          <span className="text-pv-ink-3">
            {` · ${'url' in source ? source.scope
              : source.scope === 'conversation_answer' ? 'AI-forklaring' : 'Modtaget værktøjsresultat'}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

// What the card says about its own state, as a K-Notice (the voice's status lives in the Svar key; these are the
// card's own facts: cut off, offline, failed).
function stateNotice(state: string, failed: boolean): ReactNode {
  if (failed) return <Notice compact level="fejl" title="Svaret kom ikke frem" text="Prøv igen." />;
  if (state === 'offline') return <Notice compact level="info" title="Offline" text="seneste svar er bevaret." />;
  if (state === 'interrupted') {
    return <Notice compact level="handling" title="Svaret blev afbrudt" text="Indholdet er bevaret." />;
  }
  if (state === 'error') {
    return <Notice compact level="fejl" title="Grundlaget kunne ikke opdateres" text="Tidligere indhold er bevaret." />;
  }
  return null;
}

export interface AnswerCardProps {
  answer: Answer;
  /** The later answers of the same session, newest first. */
  followUps?: readonly Answer[];
  connected: boolean;
  /** The voice's last answer did not arrive (the add-on's phase is error) and this is the newest card. */
  failed?: boolean;
  /** »Se vejret« / »Åbn afspiller«. */
  onOpen?: (screen: 'weather' | 'music') => void;
  /** What the screen says about the history (the add-on stopped, the link lost), over the card's own state. */
  note?: ReactNode;
}

export function AnswerCard({answer, followUps = [], connected, failed = false, onOpen, note}: AnswerCardProps) {
  const admitted = admit(answer);
  const historical = answer.historical === true;
  const state = historical ? 'ready' : connected ? (answer.readStatus ?? answer.status ?? 'ready') : 'offline';
  const [sources, setSources] = useState(false);
  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(
    (admitted?.typed ? admitted.content.items ?? [] : []).filter(item => item.checked).map(item => item.id)));
  const tone = svarTone(answer);
  const {title, question} = svarTitle(answer);
  const steps = admitted?.typed && answer.kind === 'steps' ? admitted.content.steps ?? [] : [];
  const follow = followUps.map(item => ({id: item.id, question: item.title ?? '', time: svarClock(item.observedAt),
    answer: (item.content?.summary ?? '').trim() || (item.title ?? '')}));
  const actions = [
    ...(steps.length > 1 ? [
      <SvarAction key="prev" label="Forrige trin" onPress={() => {
        setStep(at => Math.max(0, at - 1));
      }} />,
      <SvarAction key="next" label="Næste trin" variant="primaer" onPress={() => {
        setStep(at => Math.min(steps.length - 1, at + 1));
      }} />,
    ] : []),
    ...(tone === 'vejr' && onOpen ? [<SvarAction key="weather" label="Se vejret" variant="primaer" onPress={() => {
      onOpen('weather');
    }} />] : []),
    ...(tone === 'musik' && onOpen ? [<SvarAction key="music" label="Åbn afspiller" variant="primaer"
      onPress={() => {
        onOpen('music');
      }} />] : []),
    ...(admitted && !historical && admitted.content.sources.length ? [
      <SvarAction key="sources" label={sources ? 'Skjul kilder' : 'Kilder'} expanded={sources} onPress={() => {
        setSources(open => !open);
      }} />,
    ] : []),
  ];
  return (
    <SvarCard tone={tone} icon={svarGlyph(answer)} kind={svarKind(answer)} time={svarClock(answer.observedAt)}
      title={title} question={question} long={answer.kind === 'concise'} followUps={follow}
      notice={note ?? stateNotice(state, failed)} data-answer-id={answer.id} data-answer-family={answer.kind}
      data-answer-state={state} actions={actions.length ? actions : undefined}>
      {!admitted ? (
        <p className="text-[17px] leading-6 text-pv-ink-2" role="status">Visningen kunne ikke læses.</p>
      ) : admitted.typed ? (
        <TypedBody family={answer.kind} content={admitted.content} step={step} checked={checked} onCheck={id => {
          setChecked(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }} />
      ) : (
        <VisualBody family={answer.kind} content={admitted.content} answer={answer} compact={follow.length > 0} />
      )}
      {sources && admitted ? <SourceList sources={admitted.content.sources} /> : null}
    </SvarCard>
  );
}
