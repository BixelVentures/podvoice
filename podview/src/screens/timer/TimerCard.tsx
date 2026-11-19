// Timer card (lærred »A-Timer«): the Home overview bar and the timer page's detail card share it. Same anatomy,
// classes, kit attributes and aria as the pre-React renderer, so the stage CSS and the browser journeys apply
// unchanged. The ring and the digits are drawn by the motion primitives (docs/MOTION.md §3.6) on the elements
// React renders: showProgress writes --progress/data-pv-progress on the article, showValue the count's digits.
import {useCallback, useLayoutEffect, useRef} from 'react';
import type {CSSProperties, MouseEvent} from 'react';
import {showProgress, showValue} from '../../../ui/motion.js';
import type {CardState} from './model';

// K-Btn icon slot (ui/kit.js syncKitButtonContent): a kit Icon and a label span inside the Button.
export function KitButtonContent({label, icon}: {label: string; icon: string | null}) {
  const style = icon ? ({'--pv-icon-source': `url("${icon}")`} as CSSProperties) : undefined;
  return (
    <>
      <span
        className="--24 pv-kit pv-kit-icon pv-icon"
        data-kit="icon"
        aria-hidden="true"
        hidden={!icon}
        style={style}
      />
      <span data-kit-slot="label">{label}</span>
    </>
  );
}

export interface CardHandlers {
  register: (key: string, node: HTMLElement | null) => void;
  open: () => void;
  timerAction: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  finish: (id: string) => void;
  restart: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}

const BUTTON = 'pv-kit pv-kit-button pv-btn';

function Instrument({card, count}: {card: CardState; count: (node: HTMLSpanElement | null) => void}) {
  const detail = card.slot === 'detail';
  const total = card.content.total;
  return (
    <span className="timer-instrument" aria-hidden="true" data-long={card.content.long}>
      <svg viewBox="0 0 120 120" className="pv-illu">
        <circle className="timer-track" cx="60" cy="60" r="54" />
        <circle className="timer-progress" cx="60" cy="60" r="54" pathLength={100} />
      </svg>
      {detail ? (
        <>
          <span className="timer-count" ref={count} />
          <span className="timer-total" hidden={!total}>
            {total}
          </span>
        </>
      ) : (
        <img className="timer-icon" src="assets/icons/timer.svg" alt="" />
      )}
    </span>
  );
}

export function TimerCard({card, motion, handlers}: {card: CardState; motion: unknown; handlers: CardHandlers}) {
  const {content, actions, restart, id, key} = card;
  const detail = card.slot === 'detail';
  const article = useRef<HTMLElement | null>(null);
  const countNode = useRef<HTMLSpanElement | null>(null);
  const {register} = handlers;
  const attach = useCallback(
    (node: HTMLElement | null) => {
      article.current = node;
      register(key, node);
    },
    [register, key],
  );
  const count = useCallback((node: HTMLSpanElement | null) => {
    countNode.current = node;
  }, []);
  // P5 progress and digits: written after every commit; both write nothing when the value is unchanged.
  useLayoutEffect(() => {
    showProgress(article.current, '--progress', content.progress, content.progressSource);
    showValue(motion, countNode.current, content.time, {still: 2});
  });
  const copy = (
    <span className="timer-copy" data-state-label={content.stateLabel} data-state-repeat={content.repeat}>
      {detail ? null : <span className="timer-count" ref={count} />}
      <strong hidden={!content.kicker}>{content.kicker}</strong>
      <span className="timer-state" hidden={!content.state}>
        {content.state}
      </span>
    </span>
  );
  const onTimerAction = (event: MouseEvent<HTMLButtonElement>) => {
    handlers.timerAction(id, event);
  };
  const onFinish = () => {
    handlers.finish(id);
  };
  return (
    <article
      ref={attach}
      className="timer-panel pv-hero pv-kit pv-kit-hero"
      data-kit-tone="dark"
      data-kit="hero"
      data-kit-identity="neutral"
      hidden={card.hidden}
      data-timer-id={content.timerId}
      data-status={content.status}
      data-stale={content.stale}
      data-progress-known={content.progressKnown}
      aria-busy={card.busy}
    >
      {detail ? (
        <>
          <div className="timer-open" role="group" aria-label={content.openLabel}>
            <Instrument card={card} count={count} />
            {copy}
          </div>
          {/* Read-only content precedes the actions; native tab order matches the controls on the right. */}
          <div className="timer-actions" role="group" aria-label="Betjen timer" hidden={actions.hidden}>
            <button
              type="button"
              data-timer-action="toggle"
              className={BUTTON}
              data-kit="button"
              data-kit-variant="primary"
              data-kit-size="56"
              data-kit-content="icon-label"
              hidden={actions.toggle.hidden}
              disabled={actions.toggle.disabled}
              onClick={onTimerAction}
            >
              <KitButtonContent
                label={actions.toggle.label}
                icon={actions.toggle.label === 'Fortsæt' ? 'assets/icons/play-fill.svg' : null}
              />
            </button>
            <button
              type="button"
              className={`timer-adjust ${BUTTON}`}
              data-timer-action="adjust"
              data-delta-seconds="60"
              aria-label="1 minut mere"
              data-kit="button"
              data-kit-variant="icon"
              data-feedback="progress"
              aria-busy={actions.plus.loading}
              hidden={actions.plus.hidden}
              disabled={actions.plus.disabled}
              onClick={onTimerAction}
            >
              +1 min
            </button>
            <button
              type="button"
              className={`timer-adjust ${BUTTON}`}
              data-timer-action="adjust"
              data-delta-seconds="-60"
              aria-label="1 minut mindre"
              data-kit="button"
              data-kit-variant="icon"
              data-feedback="progress"
              aria-busy={actions.minus.loading}
              hidden={actions.minus.hidden}
              disabled={actions.minus.disabled}
              onClick={onTimerAction}
            >
              −1 min
            </button>
          </div>
          {/* K-Btn: »Stop alarm« is the alarm variant with the stop glyph. */}
          <button
            className={`timer-finish ${BUTTON}`}
            data-kit="button"
            data-kit-variant={content.ringing ? 'alarm' : 'secondary'}
            data-kit-size="56"
            data-kit-content="icon-label"
            aria-label={content.finishAria}
            disabled={card.finishDisabled}
            onClick={onFinish}
          >
            <KitButtonContent
              label={content.finishLabel}
              icon={content.ringing ? 'assets/icons/stop-fill.svg' : null}
            />
          </button>
          <button
            type="button"
            className={`timer-restart ${BUTTON}`}
            data-kit="button"
            data-kit-variant="secondary"
            data-kit-size="56"
            data-kit-content="icon-label"
            hidden={restart.hidden}
            disabled={restart.disabled}
            onClick={event => {
              handlers.restart(id, event);
            }}
          >
            <KitButtonContent label={restart.label} icon={restart.label ? 'assets/icons/arrow-refresh.svg' : null} />
          </button>
        </>
      ) : (
        <>
          <Instrument card={card} count={count} />
          {copy}
          <button
            type="button"
            className={`timer-finish ${BUTTON}`}
            data-kit="button"
            data-kit-variant="secondary"
            aria-label={content.finishAria}
            disabled={card.finishDisabled}
            onClick={onFinish}
          >
            {content.finishLabel}
          </button>
          <button
            type="button"
            className={`timer-open ${BUTTON}`}
            data-kit="button"
            aria-label={content.openLabel}
            onClick={handlers.open}
          >
            <img className="timer-chevron" src="assets/icons/chevron-right.svg" alt="" />
          </button>
        </>
      )}
    </article>
  );
}
