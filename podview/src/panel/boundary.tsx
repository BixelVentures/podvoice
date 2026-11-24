// Render errors never leave the wall blank (react-error-boundary). Each screen has its own boundary: a screen that
// throws shows a card with »Prøv igen« (a fresh mount of that screen) while the rest of the panel keeps working, and
// it tries again by itself after a growing pause. The root boundary catches what escapes (the frame, the aside) and
// remounts the whole shell the same way. Both reset when their keys change (a new HA link) and report to HA's log.
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {ErrorBoundary} from 'react-error-boundary';
import type {FallbackProps} from 'react-error-boundary';
import {Button} from '../ui';
import type {Report} from './report';
import {errorReport} from './report';

// The pause before a boundary tries again by itself: 1 s, 2 s, 4 s … at most 30 s while it keeps failing. A screen
// starts at 3 s, so a tap on »Prøv igen« is the usual way back.
export const rootRetryDelay = (failures: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
export const screenRetryDelay = (failures: number) => Math.min(30_000, 3000 * 2 ** Math.max(0, failures - 1));
// Up this long without a new failure, the pause starts from the beginning again.
const HEALTHY_MS = 60_000;

interface RetryProps {
  onReport?: (report: Report) => void;
  children: ReactNode;
  resetKeys?: unknown[];
  delay: (failures: number) => number;
  where: (failures: number) => string;
  fallback: (props: FallbackProps) => ReactNode;
}

// Counts the failures in a row, retries after their pause, and forgets them once the children stay up.
function RetryingBoundary({onReport, children, resetKeys, delay, where, fallback}: RetryProps) {
  const failures = useRef(0);
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    if (failed) return;
    const handle = setTimeout(() => {
      failures.current = 0;
    }, HEALTHY_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [failed]);
  return (
    <ErrorBoundary
      resetKeys={resetKeys ?? []}
      onError={(error, info) => {
        failures.current += 1;
        setFailed(failures.current);
        onReport?.(errorReport('boundary', error, `${where(failures.current)}${info.componentStack ?? ''}`));
      }}
      onReset={() => {
        setFailed(0);
      }}
      fallbackRender={props => (
        <AutoRetry delay={delay(Math.max(1, failures.current))} reset={props.resetErrorBoundary}>
          {fallback(props)}
        </AutoRetry>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function AutoRetry({delay, reset, children}: {delay: number; reset: () => void; children: ReactNode}) {
  useEffect(() => {
    const handle = setTimeout(reset, delay);
    return () => {
      clearTimeout(handle);
    };
  }, [delay, reset]);
  return children;
}

export function ScreenBoundary({name, onReport, resetKeys, children}: {
  name: string;
  onReport?: (report: Report) => void;
  resetKeys?: unknown[];
  children: ReactNode;
}) {
  return (
    <RetryingBoundary
      {...(onReport ? {onReport} : {})}
      {...(resetKeys ? {resetKeys} : {})}
      delay={screenRetryDelay}
      where={failures => `screen ${name}${failures > 1 ? ` (failure ${String(failures)})` : ''}`}
      fallback={({resetErrorBoundary}) => (
        <section className="flex flex-1 flex-col items-start gap-pv-s3 rounded-pv-l bg-pv-surface p-pv-s4"
          role="alert" aria-labelledby={`failed-${name}`}>
          <h1 id={`failed-${name}`} className="text-pv-title font-semibold">Skærmen kunne ikke vises</h1>
          <p className="max-w-[60ch] text-pv-body text-pv-ink-3">
            Noget gik galt her. Resten af PodView virker; prøv igen, eller gå tilbage til Hjem.
          </p>
          <Button variant="primary" onPress={resetErrorBoundary}>Prøv igen</Button>
        </section>
      )}
    >
      {children}
    </RetryingBoundary>
  );
}

export function RootBoundary({onReport, children, delay = rootRetryDelay}: {
  onReport?: (report: Report) => void;
  children: ReactNode;
  // Tests shorten the pause.
  delay?: (failures: number) => number;
}) {
  return (
    <RetryingBoundary
      {...(onReport ? {onReport} : {})}
      delay={delay}
      where={failures => `root (failure ${String(failures)})`}
      fallback={({resetErrorBoundary}) => (
        <div className="grid h-full place-content-center justify-items-center gap-pv-s3 bg-pv-bg text-pv-body"
          role="alert">
          <p>PodView genstarter visningen …</p>
          <Button onPress={resetErrorBoundary}>Prøv igen nu</Button>
        </div>
      )}
    >
      {children}
    </RetryingBoundary>
  );
}
