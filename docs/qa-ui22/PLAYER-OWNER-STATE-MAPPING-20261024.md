# Player owner mapping and holistic acceptance scope

Read-only inspection of current recovery candidate,24 October. No new state engine, UI implementation, provider calls or physical acceptance. Existing Player/Card/Button roles remain the proposed presentation owners.

| UI state | Actual current owner/data | Boundary / remaining gap |
|---|---|---|
| Starting | LiveMusicSelectionView.pendingPlayer: explicit selected source item, same feedback scope, pending or accepted-awaitingObservation | Known cover/title can appear with Starter; never playing from acceptance alone. |
| Playing | media-observation admits fresh account/room DTO; livePlayerModel projects state playing | Account-observed is read-only; command grant remains independent. Current target is bound to configured room target, so arbitrary external Spotify output visibility is not established. |
| Paused | Same admitted observation with state paused | Preserve item and observed position; no idle inference. |
| Idle | Native playback no_active_playback requires null item/target | Current livePlayerModel empty also covers absent/unconfirmed observations; UI does not fully distinguish confirmed idle from missing evidence. Needs agreed backend/model contract. |
| Provider unavailable | Read error/unavailable through LiveMediaView, no admitted fresh playback | Current generic error/unconfirmed copy does not identify all provider/route causes. Do not present unavailable as confirmed idle. |
| Transport reconnecting | Transport connection plus LiveMediaView.invalidate; same-owner displayRetained/stale observation | Preserve admissible last known content, disable effects; navigate independently; new scope/revocation may clear inadmissible data. Empty-fixture recovery proved, active-player flow not yet proved here. |
| Route failed | LiveControlView.musicFence/receipts: rejected, unavailable, unknown, accepted | Accepted is not route success; unknown never replays. Distinct downstream route-failure evidence is not yet a first-class proven field in this inspected UI path. |

## Actual output versus next destination

`livePlayerModel.target` comes from admitted playback.target. `configuredLabel` comes from current bound catalogue identity. `selectionDestination` is remembered explicit next-play choice, fenced by account/snapshot/transport context and musicSelection capability. `nextDestinationLabel` is shown only when idle and no selected pending player. A next choice must not relabel the currently observed output. `SpeakerOutputView.observedDestination` matches current binding/catalogue speaker identity; it is not independent acoustic proof. Selection confirmation additionally requires a fresh playing observation after request time, same account/target, matching exact track URI for track/episode, and selected destination match.

## Finite end-to-end visual acceptance journeys, pending backend-model agreement

1. **External Spotify start:** start externally while PodView idle; owner read updates to exact item, state and actual output without a PodView Play action. Open detail and Back during updates. Pause/resume externally retains item/position and changes only observed state. Include another output than configured next: current binding restriction must first be resolved in agreed read contract, not bypassed in UI.
2. **Output change:** retain actual playing output while choosing another next destination; distinguish a choice for NEXT from an admitted move of current playback. For admitted move, show pending using existing feedback; confirm only fresh exact route evidence. Exercise rejected and unknown outcomes without falsely moving label, replaying command, losing track or disabling Back.
3. **PodView selection:** current radio/music remains known while exact chosen Spotify item enters Starter; pending cover/title are selection evidence only. Confirm exact same owner/item/target observation, not unrelated playback. Exercise late old response after a second scope/navigation change. Controls/card geometry remains fixed, content-only transition settles.
4. **Recovery while active:** playing track + open detail + local timer, then transport loss; retain admissible last known content and navigation, block effects. Restore automatically without reload or user retry. Same-owner data resumes; changed boot/account/binding discards only inadmissible data and grants. Confirm timer and player independently; do not infer one from the other.
5. **Provider/route failure with HA connected:** HA navigation continues; unavailable provider is distinct from confirmed idle and route failure. Recover owner reads automatically; never show a success from accepted receipt or configured destination alone.

Each journey needs actual1280/980 product captures before/pending/settled, corresponding canonical library state references, Product Design + Impeccable hierarchy/spacing/contrast/motion inspection, and native action trace. Existing unit tests are causal support; these journeys are not claimed run against providers or hardware. No new busy-text panels or component families proposed.
