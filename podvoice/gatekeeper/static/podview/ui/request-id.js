// crypto.randomUUID() exists only in secure contexts (HTTPS/localhost). Wall screens may open Home
// Assistant over plain HTTP, where every action that needs a request id threw. getRandomValues()
// works in both, so a missing randomUUID is supplied from it once, before any action can run.
export function randomUUID(source = globalThis.crypto) {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  if (typeof source?.getRandomValues !== 'function') return undefined;
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function supplyRandomUUID(target = globalThis.crypto) {
  if (!target || typeof target.randomUUID === 'function' || typeof target.getRandomValues !== 'function') return;
  target.randomUUID = () => randomUUID({ getRandomValues: (bytes) => target.getRandomValues(bytes) });
}

supplyRandomUUID();
