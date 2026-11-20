// What a lost or refused connection means for home data. Connection copy describes only admitted screen
// capabilities, never whether the household owns devices. Only explicit setup or a known connection failure
// chooses recovery copy; an empty successful read does not imply missing permissions or configuration.
export type HomeConnectionReason = 'setup' | 'unavailable' | 'denied';

const DETAIL: Record<HomeConnectionReason, string> = {
  setup: 'Tilføj i Home Assistant',
  unavailable: 'Home Assistant svarer ikke lige nu',
  denied: 'PodView har ikke adgang – log ind i Home Assistant',
};

export interface HomeConnectionFacts {
  status?: string | undefined;
  blocked?: boolean | undefined;
  sessionExpired?: boolean | undefined;
  browserOffline?: boolean | undefined;
  reason?: unknown;
}

const known = (value: unknown): value is HomeConnectionReason =>
  value === 'setup' || value === 'unavailable' || value === 'denied';

export function homeConnectionPresentation({
  status,
  blocked = false,
  sessionExpired = false,
  browserOffline = false,
  reason = null,
}: HomeConnectionFacts = {}): {reason: HomeConnectionReason | null; detail: string} {
  const lost = browserOffline || status === 'disconnected' || status === 'offline';
  const cause: HomeConnectionReason | null = known(reason)
    ? reason
    : blocked && !sessionExpired
      ? 'denied'
      : blocked || lost
        ? 'unavailable'
        : null;
  return {reason: cause, detail: cause ? DETAIL[cause] : ''};
}
