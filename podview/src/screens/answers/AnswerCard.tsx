// Svar: the inside of one answer card (<pv-answer>, AnswerWidget.tsx). Same anatomy, classes, kit attributes and
// aria as the pre-React answer-widget.js, so the stage stylesheets and the browser journeys apply unchanged. The kit
// components (pv-concise-answer, pv-choice-list, ... from podview/ui/library) render their own content from the
// `data` the element gives them; the visual component (pv-fact-card, ...) is created here and keyed, so a new answer
// gets a new one. Motion: none of its own (docs/MOTION.md); the Kilder disclosure opens natively.
import {createElement} from 'react';
import type {DetailedHTMLProps, HTMLAttributes} from 'react';

type KitElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-inline-status': KitElement;
      'pv-concise-answer': KitElement;
      'pv-choice-list': KitElement;
      'pv-comparison-table': KitElement;
      'pv-data-chart': KitElement;
      'pv-step-guide': KitElement;
      'pv-checklist': KitElement;
      'pv-follow-up-choices': KitElement;
      'pv-source-list': KitElement;
    }
  }
}

// One element's flags as drawn (the data stays with the element: AnswerWidget gives it natively).
export interface PartView {
  hidden: boolean;
  disabled: boolean;
  inert: boolean;
}

export interface AnswerCardView {
  customize: string | null;
  title: string;
  time: {text: string; hidden: boolean} | null;
  icon: string;
  dismiss: {hidden: boolean; returnLabel: boolean | null};
  meta: {hidden: boolean; text: string};
  back: PartView;
  status: PartView;
  intro: PartView;
  choices: PartView;
  choicesCount: string | null;
  comparison: PartView;
  chart: PartView;
  guide: PartView;
  checklist: PartView;
  retry: PartView;
  retryText: string;
  actions: PartView;
  followups: PartView;
  startGuide: PartView;
  sources: PartView;
  weather: PartView | null;
  weatherText: string;
  visual: {kind: string; key: number} | null;
}

const KIT_BUTTON = 'pv-kit pv-kit-button pv-btn';
// The old renderer set inert only on some parts; the others never carry the attribute.
const inert = (part: PartView) => (part.inert ? true : undefined);

export function AnswerCard({view}: {view: AnswerCardView}) {
  const {dismiss, time, visual} = view;
  return (
    <>
      <header className="response-heading">
        <img className="answer-canvas-icon" src={`assets/icons/${view.icon}.svg`} alt="" />
        <div className="answer-heading-target" data-customize={view.customize ?? undefined}>
          <h1>{view.title}</h1>
          {time && (
            <time className="answer-time" hidden={time.hidden}>
              {time.text}
            </time>
          )}
        </div>
        <button
          className="round dismiss"
          hidden={dismiss.hidden}
          aria-label={dismiss.returnLabel === true ? 'Til overblik' : 'Skjul dette svar'}
          data-return-label={dismiss.returnLabel === null ? undefined : String(dismiss.returnLabel)}
        >
          {dismiss.returnLabel === true ? 'Til overblik' : <img src="assets/icons/chevron-up.svg" alt="" />}
        </button>
      </header>
      <div className="answer-content">
        <div className="answer-scroll" role="region" tabIndex={0} aria-label="Svarindhold" data-response-zone="body">
          {visual && createElement(`pv-${visual.kind}`, {key: visual.key, className: 'answer-visual'})}
          <button
            className={`answer-back text-control ${KIT_BUTTON}`}
            data-kit="button"
            hidden={view.back.hidden}
            disabled={view.back.disabled}
          >
            Tilbage til valgene
          </button>
          <pv-inline-status className="answer-status" hidden={view.status.hidden} inert={inert(view.status)} />
          <pv-concise-answer className="intro" hidden={view.intro.hidden} inert={inert(view.intro)} />
          <pv-choice-list
            className="answer-choices"
            hidden={view.choices.hidden}
            inert={inert(view.choices)}
            data-count={view.choicesCount ?? undefined}
          />
          <pv-comparison-table className="comparison" hidden={view.comparison.hidden} inert={inert(view.comparison)} />
          <pv-data-chart className="chart" hidden={view.chart.hidden} inert={inert(view.chart)} />
          <pv-step-guide className="guide" hidden={view.guide.hidden} inert={inert(view.guide)} />
          <pv-checklist className="checklist" hidden={view.checklist.hidden} inert={inert(view.checklist)} />
        </div>
        <div className="answer-actions" data-response-zone="actions" hidden={view.actions.hidden}
          inert={inert(view.actions)}>
          <pv-follow-up-choices className="followups" hidden={view.followups.hidden} inert={inert(view.followups)} />
          <button className={`start-guide ${KIT_BUTTON}`} data-kit="button" hidden={view.startGuide.hidden}
            disabled={view.startGuide.disabled}>
            Vis trin
          </button>
          <button
            className={`retry-answer text-control ${KIT_BUTTON}`}
            data-kit="button"
            hidden={view.retry.hidden}
            disabled={view.retry.disabled}
            inert={inert(view.retry)}
          >
            {view.retryText}
          </button>
          {view.weather && (
            <button
              className={`open-weather-answer text-control ${KIT_BUTTON}`}
              data-kit="button"
              hidden={view.weather.hidden}
              inert={inert(view.weather)}
            >
              {view.weatherText}
            </button>
          )}
        </div>
        <p className="answer-meta" hidden={view.meta.hidden} data-response-zone="metadata">
          {view.meta.text}
        </p>
        <details className="sources" hidden={view.sources.hidden} data-response-zone="metadata">
          <summary aria-label="Kilder og grundlag" title="Kilder og grundlag">
            Kilder
          </summary>
          <pv-source-list />
        </details>
      </div>
    </>
  );
}
