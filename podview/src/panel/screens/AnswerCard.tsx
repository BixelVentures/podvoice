// Svar: one answer card, read-only. The content is admitted again here (lib/answers/content.ts), so the card draws only
// the closed shape of its family: four visual families (facts, picture, timeline, diagram), sport results and key
// points, and the six typed forms (concise, choices, comparison, chart, steps, checklist), each as plain lists, a
// description list or a figure styled with PodView's tokens. The card root carries the answer's identity
// (data-answer-card, data-answer-id, data-answer-family, data-answer-state). »Kilder« is src/ui's Disclosure; nothing
// on the card sends anything.
import {useId, useState} from 'react';
import type {ReactNode} from 'react';
import {isTypedFamily, isVisualFamily, validateTypedAnswerContent, validateVisualContent} from '../../lib/answers/content';
import type {Source, TypedContent, VisualContent} from '../../lib/answers/content';
import {answerDomainIcon} from '../../lib/answers/presentation';
import {weatherFacts} from '../../lib/answers/weather-display';
import {svarDomain} from '../../screens/answers/today';
import type {Answer} from '../../screens/answers/types';
import {cx, Disclosure, Icon} from '../../ui';

const clock = (seconds: number | undefined) =>
  Number.isFinite(seconds)
    ? new Date((seconds ?? 0) * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'}).replace(':', '.')
    : '';

function metaText(answer: Answer): string {
  const ai = answer.provenance?.kind === 'ai_explanation';
  if (answer.historical !== true) return ai ? 'AI-forklaring' : '';
  const stamp = Number.isFinite(answer.observedAt)
    ? new Date((answer.observedAt ?? 0) * 1000).toLocaleString('da-DK', {dateStyle: 'short', timeStyle: 'short'})
    : '';
  return ['Tidligere svar', stamp, ai ? 'AI-forklaring' : ''].filter(Boolean).join(' · ');
}

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

// The chip behind an answer's icon, in the Home widgets' colours (svarDomain): the card's and its row's.
export const CHIP: Readonly<Record<string, string>> = {
  weather: 'bg-pv-weather',
  music: 'bg-pv-music',
  answer: 'bg-pv-answer',
};

const NUMERIC = /^[-+]?\d[\d.,:\s]*\s*(?:°[CF]?|%|km|m|cm|mm|kg|g|W|kW|kWh|min|t)?$/;

// The shared parts of the card's blocks.
const TILE = 'rounded-pv-s border border-pv-line bg-pv-surface-2';
const LABEL = 'text-pv-label font-semibold wrap-anywhere';
const DETAIL = 'max-w-[54ch] text-pv-body opacity-80 wrap-anywhere';
// The answer's conclusion in one big line (or a few), the card's headline.
const CONCLUSION = 'mt-2 -mb-1 pb-1 text-[44px] leading-[48px] font-extrabold tracking-[-0.03em] wrap-anywhere';

interface Row {
  id: string;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
}

// A fact card's facts: the first, when it is a number, is the dark headline tile across the card; the rest sit two
// by two. A long number wraps at the value size.
function Facts({items}: {items: Row[]}) {
  return (
    <dl className="grid grid-cols-2 gap-pv-s2">
      {items.map((item, index) => {
        const text = typeof item.value === 'string' ? item.value : '';
        const numeric = NUMERIC.test(text);
        const long = numeric && text.length > 16;
        const headline = index === 0 && numeric;
        return (
          <div key={item.id} data-answer-role={index === 0 ? 'primary' : 'supporting'}
            className={cx('flex min-h-16 min-w-0 flex-col items-start gap-pv-s1 p-pv-s3 text-pv-body', TILE,
              index === 0 && 'col-span-full',
              headline && 'min-h-[240px] justify-center border-0 bg-pv-dark p-pv-s4 text-pv-on-dark')}>
            <dt className={LABEL}>{item.label}</dt>
            <dd className={cx('max-w-full',
              long ? 'text-pv-value font-medium wrap-anywhere'
                : headline ? 'text-pv-hero font-medium tracking-[-0.02em]'
                  : numeric ? 'text-pv-value font-medium whitespace-nowrap'
                    : 'text-pv-title font-semibold tracking-[-0.02em] wrap-break-word')}>
              {item.value}
            </dd>
            {item.detail === undefined ? null : <dd className={DETAIL}>{item.detail}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

// Numbered points, a diagram's parts and a match's scorers: tiles side by side, as many as fit.
function Tiles({items, numbered}: {items: Row[]; numbered: boolean}) {
  return (
    <ol className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-pv-s2">
      {items.map(item => (
        <li key={item.id} className={cx('flex min-w-0 flex-col items-start gap-pv-s1 p-pv-s3 text-pv-body', TILE)}>
          {numbered ? <span className={LABEL}>{item.label}</span> : null}
          <h2 className="max-w-full text-pv-label font-semibold tracking-[-0.025em] wrap-break-word">{item.value}</h2>
          {item.detail === undefined ? null : <p className={DETAIL}>{item.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

// A timeline: one band, the time (and whether it was planned or registered) beside each event.
function Timeline({items}: {items: Row[]}) {
  return (
    <ol className="grid overflow-hidden rounded-pv-s border border-pv-line">
      {items.map(item => (
        <li key={item.id} className="grid min-h-24 grid-cols-[104px_minmax(0,1fr)] items-start gap-x-pv-s3 gap-y-pv-s1
          border-b border-pv-line bg-pv-surface-2 px-pv-s3 py-pv-s2 text-pv-body last:border-b-0">
          <span className="row-span-2 text-pv-title font-semibold wrap-anywhere">{item.label}</span>
          <h2 className="max-w-full text-pv-label font-semibold tracking-[-0.025em] wrap-break-word">{item.value}</h2>
          {item.detail === undefined ? null : <p className={DETAIL}>{item.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

function Picture({picture, historical}: {picture: NonNullable<VisualContent['image']>; historical: boolean}) {
  // A saved answer never fetches a picture again, except the app's own illustration; a picture that fails keeps its
  // caption and credit and says so.
  const [failed, setFailed] = useState(false);
  const shown = !historical || picture.url === 'assets/bicycle-drivetrain-illustration.webp';
  const kind = picture.kind === 'album_cover' ? 'Omslag' : picture.kind === 'illustration' ? 'Illustration' : 'Foto';
  return (
    <figure className="flex flex-col gap-pv-s2 rounded-pv-s bg-pv-surface-2 p-pv-s2">
      {shown && (
        <img className="h-auto max-h-80 w-full rounded-pv-s object-contain" src={picture.url} alt={picture.alt}
          decoding="async" referrerPolicy="no-referrer" width={1000} height={600} hidden={failed} onError={() => {
            setFailed(true);
          }} onLoad={event => {
            if (event.currentTarget.naturalWidth > 0) setFailed(false);
          }} />
      )}
      <p className="flex min-h-[180px] items-center rounded-pv-s bg-pv-surface-2 p-pv-s3 text-pv-body"
        hidden={shown && !failed}>
        {shown ? 'Billedet kunne ikke indlæses. Forklaring og kilde er bevaret.'
          : 'Billedet hentes ikke igen i historikken. Forklaring og kilde er bevaret.'}
      </p>
      <figcaption className="pt-pv-s2 text-pv-meta leading-[1.45] text-pv-ink-3 wrap-anywhere">
        <p className="mb-pv-s1 text-pv-body">{picture.caption}</p>
        <span>{`${kind} · ${picture.credit}`}</span>
      </figcaption>
    </figure>
  );
}

function VisualBody({family, content, answer}: {family: string; content: VisualContent; answer: Answer}) {
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
    return <Facts items={facts.map(f => ({id: f.id, label: f.label, value: f.value, detail: f.detail}))} />;
  }
  if (family === 'sourced-image' && content.image) return <Picture picture={content.image} historical={historical} />;
  if (family === 'simple-diagram') {
    return (
      <>
        {content.illustration && <Picture picture={content.illustration} historical={historical} />}
        <Tiles numbered={false} items={(content.nodes ?? []).map((n, i) =>
          ({id: n.id, label: String(i + 1).padStart(2, '0'), value: n.label, detail: n.detail}))} />
      </>
    );
  }
  if (family === 'answer-timeline') {
    const events = content.events ?? [];
    const planned = events.every(event => event.status === 'planned');
    return (
      <>
        {planned ? <p className="text-pv-meta text-pv-ink-3">Planlagt forløb</p> : null}
        <Timeline items={events.map(e => ({
          id: e.id,
          label: planned ? e.time : (
            <>
              {e.time}
              <small className="block text-pv-meta font-normal text-pv-ink-3">
                {e.status === 'planned' ? 'Planlagt' : 'Registreret'}
              </small>
            </>
          ),
          value: e.label,
          detail: e.detail,
        }))} />
      </>
    );
  }
  if (family === 'key-points') {
    return <Tiles numbered items={(content.points ?? []).map((p, i) =>
      ({id: p.id, label: String(i + 1).padStart(2, '0'), value: p.text}))} />;
  }
  if (family === 'sport-result' && content.match) {
    const m = content.match;
    const known = m.homeScore !== null;
    const scorers = content.scorers ?? [];
    // One line per team, each scorer once with all of their minutes (»Lewandowski 12', 58'«).
    const teams = (['home', 'away'] as const).map(team => {
      const names = new Map<string, string[]>();
      for (const r of scorers.filter(s => s.team === team)) {
        names.set(r.name, [...(names.get(r.name) ?? []), ...(r.minute ? [r.minute] : [])]);
      }
      const text = [...names].map(([name, minutes]) => (minutes.length ? `${name} ${minutes.join(', ')}` : name))
        .join(' · ');
      return {id: team, label: m[team], value: text};
    }).filter(row => row.value);
    return (
      <>
        <div className="flex flex-wrap items-baseline gap-x-pv-s2 text-pv-label font-semibold" role="group"
          aria-label={known ? `${m.home} ${String(m.homeScore)}, ${m.away} ${String(m.awayScore)}`
            : `${m.home} mod ${m.away}`}>
          <span>{m.home}</span>
          <span className="text-pv-value font-medium tabular-nums">
            {known ? `${String(m.homeScore)}–${String(m.awayScore)}` : 'mod'}
          </span>
          <span>{m.away}</span>
        </div>
        <p className="text-pv-meta text-pv-ink-3">{m.competition ? `${m.date} · ${m.competition}` : m.date}</p>
        {teams.length > 0 && <Tiles numbered items={teams} />}
      </>
    );
  }
  return null;
}

const NUMBER = /^[-+]?\d[\d.,\s]*\s*(?:%|km|m|cm|mm|kg|g|min|t|typer?|°[CF]?)?$/;

function TypedBody({family, content}: {family: string; content: TypedContent}) {
  const items = content.items ?? [];
  if (family === 'choices') {
    return (
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-pv-s2">
        {items.map(item => (
          <li key={item.id} className={cx('flex min-w-0 flex-col items-start gap-pv-s2 p-pv-s3 wrap-anywhere', TILE)}>
            <strong className={LABEL}>{item.label}</strong>
            <span className="mt-pv-s1 text-pv-body leading-[1.4] text-pv-ink-3">{item.detail ?? ''}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (family === 'checklist') {
    return (
      <ul className="overflow-hidden rounded-pv-s border border-pv-line">
        {items.map(item => (
          <li key={item.id} data-checked={String(item.checked === true)}
            className="flex min-h-20 items-center gap-pv-s2 border-b border-pv-line bg-pv-surface-2 px-pv-s3 py-pv-s2
              text-pv-label font-semibold wrap-anywhere last:border-b-0">
            <strong>{item.label}</strong>
            <span className="ml-auto text-pv-meta font-normal text-pv-ink-3">
              {item.checked ? 'Markeret' : 'Ikke markeret'}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (family === 'comparison') {
    const columns = content.columns ?? [];
    return (
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-pv-s2">
        {items.map(row => (
          <li key={row.id} className="flex min-w-0 flex-col gap-pv-s3 rounded-pv-l border border-pv-line
            bg-pv-surface-2 p-pv-s3">
            <h2 className={cx(LABEL, 'tracking-normal')}>{row.label}</h2>
            <dl className="flex flex-col gap-pv-s3">
              {(row.values ?? []).map((value, i) => (
                <div key={columns[i]?.id ?? i}>
                  <dt className="mb-pv-s1 text-pv-meta text-pv-ink-3">{columns[i]?.label}</dt>
                  <dd className={NUMBER.test(value) ? 'text-pv-value font-medium' : LABEL}>{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    );
  }
  if (family === 'chart') {
    const values = items.map(item => item.value ?? 0);
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(minimum < 0 ? 0 : 1, ...values);
    const unitFor = (value: number) =>
      new Intl.PluralRules('da').select(value) === 'one' ? (content.unitSingular ?? '') : (content.unit ?? '');
    return (
      <ul className="grid gap-pv-s4 rounded-pv-s bg-pv-surface-2 p-pv-s3">
        {items.map(item => {
          const value = item.value ?? 0;
          const text = `${String(value)} ${unitFor(value)}`;
          return (
            <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-pv-s2">
              <span className={LABEL}>{item.label}</span>
              <output className="text-right text-pv-value font-medium text-pv-ink-3">{text}</output>
              <meter min={minimum} max={maximum} value={value} aria-label={`${item.label}: ${text}`}
                className="col-span-full block h-pv-s2 w-full rounded-pv-pill
                  [&::-moz-meter-bar]:rounded-pv-pill [&::-moz-meter-bar]:bg-pv-ink
                  [&::-webkit-meter-bar]:h-pv-s2 [&::-webkit-meter-bar]:rounded-pv-pill
                  [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-pv-line [&::-webkit-meter-bar]:bg-none
                  [&::-webkit-meter-optimum-value]:rounded-pv-pill [&::-webkit-meter-optimum-value]:bg-pv-ink
                  [&::-webkit-meter-optimum-value]:bg-none" />
            </li>
          );
        })}
      </ul>
    );
  }
  if (family === 'steps') {
    return (
      <ol className="grid list-decimal gap-pv-s3 rounded-pv-s bg-pv-surface-2 py-pv-s3 pr-pv-s3 pl-pv-s5
        text-pv-title font-semibold">
        {(content.steps ?? []).map(step => <li key={step.id} className="pl-pv-s1">{step.text}</li>)}
      </ol>
    );
  }
  return null;
}

function Sources({sources, historical}: {sources: readonly Source[]; historical: boolean}) {
  if (historical || !sources.length) return null;
  return (
    <Disclosure title="Kilder" label="Kilder og grundlag" className="border-t border-pv-line">
      <ul className="grid gap-pv-s2 pb-pv-s2">
        {sources.map(source => (
          <li key={source.id} className="text-pv-body">
            {'url' in source ? (
              <a className="underline underline-offset-4" href={source.url} target="_blank" rel="noopener noreferrer">
                {source.label}
              </a>
            ) : (
              <span>{source.label}</span>
            )}
            <p className="text-pv-meta text-pv-ink-3">
              {'url' in source ? source.scope
                : source.scope === 'conversation_answer' ? 'AI-forklaring' : 'Modtaget værktøjsresultat'}
            </p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  error: 'Grundlaget kunne ikke opdateres. Tidligere indhold er bevaret.',
  offline: 'Offline · seneste svar er bevaret.',
  interrupted: 'Svaret blev afbrudt. Indholdet er bevaret.',
  empty: 'Der er ikke noget at vise endnu.',
};

// The corner's dot pattern, fading out towards the card (the Svar canvas' signature).
const DOTS = [
  'pointer-events-none absolute top-0 right-0 h-[120px] w-[280px] bg-pv-ink opacity-18',
  '[mask-image:url(/assets/svar/corner-dots.svg),radial-gradient(120%_100%_at_100%_0,#000_35%,transparent_80%)]',
  '[mask-size:280px_120px,auto] [mask-repeat:no-repeat] [mask-composite:intersect]',
].join(' ');

export function AnswerCard({answer, connected}: {answer: Answer; connected: boolean}) {
  const titleId = useId();
  const admitted = admit(answer);
  const historical = answer.historical === true;
  const state = historical ? 'ready' : connected ? (answer.readStatus ?? answer.status ?? 'ready') : 'offline';
  const summary = admitted?.content.summary ?? '';
  const hideSummary = summary.trim() === (answer.title ?? '').trim();
  const time = clock(answer.observedAt);
  const meta = metaText(answer);
  const status = STATUS_TEXT[state];
  return (
    <article className="relative flex flex-col gap-pv-s3 overflow-hidden rounded-[24px] bg-pv-surface p-pv-s4
      text-pv-ink shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]" aria-labelledby={titleId} data-answer-card=""
      data-answer-id={answer.id} data-answer-family={answer.kind} data-answer-state={state}>
      <span className={DOTS} aria-hidden="true" />
      <header className="relative flex h-8 items-center gap-pv-s1">
        <Icon name={answerDomainIcon(answer)}
          className={cx('size-8 rounded-pv-pill p-1.5', CHIP[svarDomain(answer)] ?? CHIP.answer)} />
        <div className="flex min-w-0 flex-auto items-center gap-pv-s1">
          <h1 id={titleId} className="my-0 min-w-0 truncate text-pv-meta font-semibold tracking-normal text-pv-ink-2">
            {answer.title ?? ''}
          </h1>
          {time && <time className="flex-none font-pv-mono text-pv-meta font-medium text-pv-ink-3">{time}</time>}
        </div>
      </header>
      <div className="flex flex-col gap-pv-s3">
        <div className="flex flex-col gap-pv-s3 overscroll-contain outline-none focus-visible:outline-2
          focus-visible:outline-offset-4 focus-visible:outline-pv-ink" role="region" tabIndex={0}
          aria-label="Svarindhold">
          {status && <p className="text-pv-meta leading-[21px]" role="status">{status}</p>}
          {!admitted ? (
            <p className="text-pv-meta leading-[21px]" role="status">Visningen kunne ikke læses.</p>
          ) : (
            <>
              {hideSummary ? null : <p className={CONCLUSION}>{summary}</p>}
              {admitted.typed ? <TypedBody family={answer.kind} content={admitted.content} />
                : <VisualBody family={answer.kind} content={admitted.content} answer={answer} />}
            </>
          )}
        </div>
        {meta && <p className="text-pv-meta leading-[1.45] text-pv-ink-3 wrap-anywhere">{meta}</p>}
        {admitted && <Sources sources={admitted.content.sources} historical={historical} />}
      </div>
    </article>
  );
}
