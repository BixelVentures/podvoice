// Render errors never leave the wall blank. Each screen has its own boundary: a screen that throws shows a card with
// »Prøv igen« (a fresh mount of that screen) while the rest of the panel keeps working. The root boundary catches
// what escapes (the frame, the aside): it remounts the whole shell by itself after a short, growing pause, and offers
// the same button at once. Both report to HA's log (report.ts).
import {Component} from 'react';
import type {ErrorInfo, ReactNode} from 'react';
import {KitButton} from '../lib/ui/KitButton';
import type {Report} from './report';
import {errorReport} from './report';
import {BUTTON} from './ui';

interface BoundaryProps {
  name: string;
  onReport?: (report: Report) => void;
  children: ReactNode;
}

interface BoundaryState {
  error: boolean;
  attempt: number;
}

export class ScreenBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = {error: false, attempt: 0};

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return {error: true};
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onReport?.(errorReport('boundary', error, `screen ${this.props.name}${info.componentStack ?? ''}`));
  }

  retry = () => {
    this.setState(state => ({error: false, attempt: state.attempt + 1}));
  };

  override render() {
    if (this.state.error) {
      return (
        <section className="response-widget pv-panel-failed" role="alert" aria-labelledby={`failed-${this.props.name}`}>
          <h1 id={`failed-${this.props.name}`}>Skærmen kunne ikke vises</h1>
          <p className="screen-explanation">
            Noget gik galt her. Resten af PodView virker; prøv igen, eller gå tilbage til Hjem.
          </p>
          <KitButton className={BUTTON} data-kit="button" data-kit-variant="primary" data-kit-size="56"
            onPress={this.retry}>
            Prøv igen
          </KitButton>
        </section>
      );
    }
    return <ScreenAttempt key={this.state.attempt}>{this.props.children}</ScreenAttempt>;
  }
}

// A keyed wrapper, so »Prøv igen« mounts the screen afresh instead of reusing its broken state.
function ScreenAttempt({children}: {children: ReactNode}) {
  return children;
}

// The pause before the root remounts the shell by itself: 1 s, 2 s, 4 s … at most 30 s while it keeps failing.
export const rootRetryDelay = (failures: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));

interface RootProps {
  onReport?: (report: Report) => void;
  children: ReactNode;
  // Tests shorten the pause.
  delay?: (failures: number) => number;
}

interface RootState {
  error: boolean;
  attempt: number;
  failures: number;
}

export class RootBoundary extends Component<RootProps, RootState> {
  override state: RootState = {error: false, attempt: 0, failures: 0};
  #timer: ReturnType<typeof setTimeout> | undefined;
  #healthy: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): Partial<RootState> {
    return {error: true};
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const failures = this.state.failures + 1;
    const where = `root (failure ${String(failures)})${info.componentStack ?? ''}`;
    this.props.onReport?.(errorReport('boundary', error, where));
    this.setState({failures});
    clearTimeout(this.#timer);
    clearTimeout(this.#healthy);
    this.#timer = setTimeout(this.remount, (this.props.delay ?? rootRetryDelay)(failures));
  }

  override componentWillUnmount() {
    clearTimeout(this.#timer);
    clearTimeout(this.#healthy);
  }

  remount = () => {
    clearTimeout(this.#timer);
    this.setState(state => ({error: false, attempt: state.attempt + 1}));
    // A shell that stays up for a minute starts the pause from the beginning again.
    clearTimeout(this.#healthy);
    this.#healthy = setTimeout(() => {
      this.setState({failures: 0});
    }, 60_000);
  };

  override render() {
    if (this.state.error) {
      return (
        <div className="pv-panel-recovering" role="alert">
          <p>PodView genstarter visningen …</p>
          <KitButton className={BUTTON} data-kit="button" data-kit-variant="secondary" data-kit-size="56"
            onPress={this.remount}>
            Prøv igen nu
          </KitButton>
        </div>
      );
    }
    return <ScreenAttempt key={this.state.attempt}>{this.props.children}</ScreenAttempt>;
  }
}
