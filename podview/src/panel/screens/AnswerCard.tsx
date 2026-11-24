// Svar: one answer card, read-only. The content is admitted again here (lib/answers/content.ts), so the card draws only
// the closed shape of its family: four visual families (facts, picture, timeline, diagram), sport results and key
// points, and the six typed forms (concise, choices, comparison, chart, steps, checklist). The anatomy, classes and
// data attributes are the kit's (styles/kit.css), so the stage stylesheet applies unchanged. »Kilder« is a React Aria
// disclosure; nothing on the card sends anything.
import {useState} from 'react';
import type {ReactNode} from 'react';
import {Button, Disclosure, DisclosurePanel, Heading} from 'react-aria-components';
import {isTypedFamily, isVisualFamily, validateTypedAnswerContent, validateVisualContent} from '../../lib/answers/content';
import type {Source, TypedContent, VisualContent} from '../../lib/answers/content';
import {answerDomainIcon} from '../../lib/answers/presentation';
import {weatherFacts} from '../../lib/answers/weather-display';
import type {Answer} from '../../screens/answers/types';
import {icon} from '../ui';

const KIT_ICONS = ['moon', 'cloud-sun', 'timer', 'lightbulb', 'music-note-beamed'];

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

const NUMERIC = /^[-+]?\d[\d.,:\s]*\s*(?:°[CF]?|%|km|m|cm|mm|kg|g|W|kW|kWh|min|t)?$/;

function Rows({items, facts}: {items: {id: string; label: ReactNode; value: ReactNode; detail?: ReactNode}[];
  facts: boolean}) {
  const Label = facts ? 'dt' : 'span';
  const Value = facts ? 'dd' : 'h2';
  const Detail = facts ? 'dd' : 'p';
  const Row = facts ? 'div' : 'li';
  const List = facts ? 'dl' : 'ol';
  return (
    <List className="pv-visual-list">
      {items.map((item, index) => (
        <Row key={item.id} className="pv-visual-item pv-kit pv-kit-listrow" data-kit="listrow"
          data-answer-role={facts && index === 0 ? 'primary' : 'supporting'} data-position={String(index + 1)}
          {...(facts && typeof item.value === 'string' ? {
            'data-value-kind': NUMERIC.test(item.value) ? 'numeric' : 'text',
            'data-value-density': NUMERIC.test(item.value) && item.value.length > 16 ? 'long' : 'short',
          } : {})}>
          <Label className="pv-visual-label" hidden={item.label === null}>{item.label}</Label>
          <Value className="pv-visual-value">{item.value}</Value>
          <Detail className="pv-visual-detail" hidden={item.detail === undefined}>{item.detail}</Detail>
        </Row>
      ))}
    </List>
  );
}

function Picture({picture, historical}: {picture: NonNullable<VisualContent['image']>; historical: boolean}) {
  // A saved answer never fetches a picture again, except the app's own illustration; a picture that fails keeps its
  // caption and credit and says so.
  const [failed, setFailed] = useState(false);
  const shown = !historical || picture.url === 'assets/bicycle-drivetrain-illustration.webp';
  const kind = picture.kind === 'album_cover' ? 'Omslag' : picture.kind === 'illustration' ? 'Illustration' : 'Foto';
  return (
    <figure className="pv-answer-image">
      {shown && (
        <img src={picture.url} alt={picture.alt} decoding="async" referrerPolicy="no-referrer" width={1000}
          height={600} hidden={failed} onError={() => {
            setFailed(true);
          }} onLoad={event => {
            if (event.currentTarget.naturalWidth > 0) setFailed(false);
          }} />
      )}
      <p className="pv-image-fallback" hidden={shown && !failed}>
        {shown ? 'Billedet kunne ikke indlæses. Forklaring og kilde er bevaret.'
          : 'Billedet hentes ikke igen i historikken. Forklaring og kilde er bevaret.'}
      </p>
      <figcaption>
        <p>{picture.caption}</p>
        <span className="pv-image-credit">{`${kind} · ${picture.credit}`}</span>
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
    return <Rows facts items={facts.map(f => ({id: f.id, label: f.label, value: f.value, detail: f.detail}))} />;
  }
  if (family === 'sourced-image' && content.image) return <Picture picture={content.image} historical={historical} />;
  if (family === 'simple-diagram') {
    return (
      <>
        {content.illustration && <Picture picture={content.illustration} historical={historical} />}
        <Rows facts={false} items={(content.nodes ?? []).map((n, i) =>
          ({id: n.id, label: String(i + 1).padStart(2, '0'), value: n.label, detail: n.detail}))} />
      </>
    );
  }
  if (family === 'answer-timeline') {
    const events = content.events ?? [];
    const planned = events.every(event => event.status === 'planned');
    return (
      <>
        <p className="pv-timeline-context" hidden={!planned}>Planlagt forløb</p>
        <Rows facts={false} items={events.map(e => ({
          id: e.id,
          label: planned ? e.time : `${e.time}\n${e.status === 'planned' ? 'Planlagt' : 'Registreret'}`,
          value: e.label,
          detail: e.detail,
        }))} />
      </>
    );
  }
  if (family === 'key-points') {
    return <Rows facts={false} items={(content.points ?? []).map((p, i) =>
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
        <div className="pv-sport-score" role="group"
          aria-label={known ? `${m.home} ${String(m.homeScore)}, ${m.away} ${String(m.awayScore)}`
            : `${m.home} mod ${m.away}`}>
          <span className="pv-sport-team">{m.home}</span>
          <span className="pv-sport-result">{known ? `${String(m.homeScore)}–${String(m.awayScore)}` : 'mod'}</span>
          <span className="pv-sport-team">{m.away}</span>
        </div>
        <p className="pv-sport-date">{m.competition ? `${m.date} · ${m.competition}` : m.date}</p>
        {teams.length > 0 && <Rows facts={false} items={teams} />}
      </>
    );
  }
  return null;
}

function TypedBody({family, content}: {family: string; content: TypedContent}) {
  const items = content.items ?? [];
  if (family === 'choices' || family === 'checklist') {
    const Tag = family === 'choices' ? 'pv-choice-list' : 'pv-checklist';
    return (
      <Tag className={`pv-component ${family === 'choices' ? 'answer-choices' : 'checklist'}`} data-read-only="true"
        data-count={String(items.length)}>
        <div className="pv-content">
          <div className="pv-list" role="list">
            {items.map(item => (
              <div key={item.id} className="pv-readonly-row" role="listitem"
                data-checked={String(family === 'checklist' && item.checked === true)}>
                <strong>{item.label}</strong>
                <span className="pv-meta">
                  {family === 'checklist' ? (item.checked ? 'Markeret' : 'Ikke markeret') : (item.detail ?? '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Tag>
    );
  }
  if (family === 'comparison') {
    const columns = [{id: 'label', label: 'Valg'}, ...(content.columns ?? [])];
    return (
      <pv-comparison-table className="pv-component comparison">
        <div className="pv-content">
          <section className="pv-table pv-comparison">
            <div className="pv-comparison-head">
              <div>{columns.map(column => <span key={column.id}>{column.label}</span>)}</div>
            </div>
            <div className="pv-comparison-tiles">
              {items.map(row => (
                <article key={row.id} className="pv-comparison-tile pv-kit pv-kit-tile" data-kit="tile"
                  data-selected="false">
                  {[row.label, ...(row.values ?? [])].map((value, i) => (
                    <div key={columns[i]?.id ?? i} data-label={columns[i]?.label}
                      data-value-kind={i > 0 && /^[-+]?\d[\d.,\s]*\s*(?:%|km|m|cm|mm|kg|g|min|t|typer?|°[CF]?)?$/
                        .test(value) ? 'numeric' : 'text'}>
                      {value}
                    </div>
                  ))}
                </article>
              ))}
            </div>
          </section>
        </div>
      </pv-comparison-table>
    );
  }
  if (family === 'chart') {
    const values = items.map(item => item.value ?? 0);
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(minimum < 0 ? 0 : 1, ...values);
    const unitFor = (value: number) =>
      new Intl.PluralRules('da').select(value) === 'one' ? (content.unitSingular ?? '') : (content.unit ?? '');
    return (
      <pv-data-chart className="pv-component chart">
        <div className="pv-content">
          <div className="pv-list">
            {items.map(item => {
              const value = item.value ?? 0;
              const text = `${String(value)} ${unitFor(value)}`;
              return (
                <div key={item.id} className="pv-chart-row">
                  <span>{item.label}</span>
                  <meter min={minimum} max={maximum} value={value} aria-label={`${item.label}: ${text}`} />
                  <output>{text}</output>
                </div>
              );
            })}
          </div>
        </div>
      </pv-data-chart>
    );
  }
  if (family === 'steps') {
    return (
      <pv-step-guide className="pv-component guide">
        <div className="pv-content">
          <ol className="pv-step-outline">
            {(content.steps ?? []).map(step => <li key={step.id}>{step.text}</li>)}
          </ol>
        </div>
      </pv-step-guide>
    );
  }
  return null;
}

function Sources({sources, historical}: {sources: readonly Source[]; historical: boolean}) {
  if (historical || !sources.length) return null;
  return (
    <Disclosure className="sources pv-visual-sources" data-response-zone="metadata">
      <Heading level={3} className="pv-sources-heading">
        <Button slot="trigger" aria-label="Kilder og grundlag">Kilder</Button>
      </Heading>
      <DisclosurePanel className="pv-visual-source-panel">
        <ul>
          {sources.map(source => (
            <li key={source.id}>
              {'url' in source ? (
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
              ) : (
                <span>{source.label}</span>
              )}
              <p>
                {'url' in source ? source.scope
                  : source.scope === 'conversation_answer' ? 'AI-forklaring' : 'Modtaget værktøjsresultat'}
              </p>
            </li>
          ))}
        </ul>
      </DisclosurePanel>
    </Disclosure>
  );
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  error: 'Grundlaget kunne ikke opdateres. Tidligere indhold er bevaret.',
  offline: 'Offline · seneste svar er bevaret.',
  interrupted: 'Svaret blev afbrudt. Indholdet er bevaret.',
  empty: 'Der er ikke noget at vise endnu.',
};

export function AnswerCard({answer, connected}: {answer: Answer; connected: boolean}) {
  const admitted = admit(answer);
  const historical = answer.historical === true;
  const state = historical ? 'ready' : connected ? (answer.readStatus ?? answer.status ?? 'ready') : 'offline';
  const summary = admitted?.content.summary ?? '';
  const domain = answer.provenance?.kind === 'ha_weather' ? 'weather' : 'answer';
  const iconName = answerDomainIcon(answer);
  const time = clock(answer.observedAt);
  const meta = metaText(answer);
  const status = STATUS_TEXT[state];
  const count = admitted && !admitted.typed
    ? (admitted.content.facts ?? admitted.content.events ?? admitted.content.nodes ?? []).length : 0;
  return (
    <pv-answer className="answer-widget response-widget pv-kit pv-kit-card pv-card" data-kit="card"
      data-kit-identity={domain === 'weather' ? 'weather' : 'neutral'} data-kit-variant="response-canvas"
      data-answer-id={answer.id} data-answer-family={answer.kind} data-answer-domain={domain}
      data-answer-icon={iconName} data-answer-state={state}
      data-conclusion-density={summary.length > 100 ? 'prose' : 'brief'}>
      <header className="response-heading">
        <img className="answer-canvas-icon" src={icon(iconName)} alt="" />
        <div className="answer-heading-target">
          <h1>{answer.title ?? ''}</h1>
          {time && <time className="answer-time">{time}</time>}
        </div>
      </header>
      <div className="answer-content">
        <div className="answer-scroll" role="region" tabIndex={0} aria-label="Svarindhold" data-response-zone="body">
          {status && <p className="answer-status pv-state-note" role="status">{status}</p>}
          {!admitted ? (
            <p className="answer-status pv-state-note" role="status">Visningen kunne ikke læses.</p>
          ) : admitted.typed ? (
            <>
              <p className="intro pv-visual-summary" hidden={summary.trim() === (answer.title ?? '').trim()}>
                {summary}
              </p>
              <TypedBody family={answer.kind} content={admitted.content} />
            </>
          ) : (
            <div className={`pv-component pv-visual answer-visual pv-${answer.kind}`} data-component={answer.kind}
              data-state={state} data-count={String(count)}
              data-illustrated={String(!!(admitted.content.image ?? admitted.content.illustration))}>
              <div className="pv-visual-body" data-response-zone="body">
                <div className="pv-visual-lead">
                  <img className="pv-answer-domain-icon pv-kit pv-kit-icon" data-kit="icon" alt=""
                    src={icon(KIT_ICONS.includes(iconName) ? iconName : 'chat-circle')} />
                  <p className="pv-visual-summary" data-response-zone="conclusion"
                    hidden={summary.trim() === (answer.title ?? '').trim()}>
                    {summary}
                  </p>
                </div>
                <VisualBody family={answer.kind} content={admitted.content} answer={answer} />
              </div>
            </div>
          )}
        </div>
        {meta && <p className="answer-meta" data-response-zone="metadata">{meta}</p>}
        {admitted && <Sources sources={admitted.content.sources} historical={historical} />}
      </div>
    </pv-answer>
  );
}
