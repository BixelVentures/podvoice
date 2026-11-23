# PodView React: how a screen is built

Reference screens: `screens/weather/` (Vejr) and `screens/timer/` (Timer). Every later screen follows them.

## Layers

| Layer | Library | Where |
|---|---|---|
| Server calls, payload validation | TypeScript + zod | `lib/api/` (`schemas.ts`, `paths.ts`, `client.ts`, `timer-actions.ts`) |
| Server data | TanStack Query (cache only, nothing refetches by itself) | `lib/query/` (`client.ts`, `live.ts`) |
| Client state: navigation, command lifecycles, UI-only state | Zustand | `lib/store/`, a screen's own `*-store.ts` |
| Interactive primitives | React Aria Components | in the component |
| Motion | `motion/react` (timings from `ui/motion.js` tokens, docs/MOTION.md) | in the component |
| Styles | Tailwind v4, PodView tokens mapped in `styles/app.css` (`@theme inline`) | in the component |
| Tests | Vitest + Testing Library + MSW (`test/msw.ts`, opt-in per file) | next to the screen |

## Data flow

The SSE snapshot stream (`podvoice-transport.js`, which still owns the connection) hands each admitted snapshot to
the shell, which calls `ingestSnapshot`: it is parsed with zod and written into the query cache. The connection
(`ingestConnection`) and the shell's home read (`ingestWeather`, …) are written the same way. Components read with
hooks (`useSnapshot(select)`, `useConnection(select)`, `useWeatherSource()`); they render the last known value at once
and never fetch on mount. Equal data keeps the same objects (structural sharing), so a heartbeat re-renders nothing.
Time is an external store (`lib/hooks/clock.ts`): read again when data lands and at the moment a model says it will
change (`useRefreshAt`).

Explicit actions go through `currentApi()` (`lib/api/client.ts`), registered by the shell (the transport, which adds
its read generation and diagnostics) or by a test (`fetchApi` against MSW). One tap is one send; an unreadable answer
is UNKNOWN and never resent.

## Contract with the legacy shell (`podview/widget-view.js`) while it still owns navigation

1. The shell mounts a rewritten screen **once** into its container (`mountWeather(el)`, `mountTimer(...)`); React owns
   everything inside. The shell never renders it again, never calls `flushSync`, never writes inside the container.
2. The shell tells React things only by writing data: server data into the query cache (`ingest*`), and the focused
   page into the shell store (`setFocus`, via `syncReact()` after each shell render). React reacts.
3. React asks the shell for things through the ports in `lib/store/shell.ts` (`dispatch` for navigation and
   preview-scene events, `focusHeading`, `loadHome`), registered once by `connectShell`.
4. The shell may still show/hide a screen's container and paint its own surfaces outside it (e.g. the Home weather
   card in `weather-surfaces.js`) until those move too.
5. No `.d.ts` shims for old JS from a rewritten screen: what it needs is ported to TypeScript first.

## Commands (wish → sent → confirmed | unknown)

A screen's explicit actions are a Zustand store of their own (`screens/timer/commands.ts`): one tap is one send
through `currentApi()`, the proof is the next snapshot (the shell calls `reconcile` on each), an accepted action
without proof turns into an honest unknown after its wait, and taps during a command queue instead of locking. The
access a control follows is a pure function of that store and the snapshot (`access.ts`); components re-render from
it. Motion: `lib/motion/value.tsx` (`RollingDigits`, `useProgress`) on the kit's tokens (`lib/motion/tokens.ts`).
Buttons: `lib/ui/KitButton.tsx` (React Aria `useButton` on the kit's native button).

Radio (`screens/radio/`) is the same shape for an owner that is read, not pushed: `source.ts` is one Zustand store
with the admitted radio observation (`lib/api/radio.ts`, re-read after each snapshot and before it expires) and the
command lifecycle (offer → action → confirmed by a newer observation within 8 s, else unknown; queued station, Stop
and volume wishes). The shared right-hand player and the speaker sheet are not React yet: radio paints into them
through the ports the shell registers (`connectRadioPorts`), and the shell redraws them when the store changes.
