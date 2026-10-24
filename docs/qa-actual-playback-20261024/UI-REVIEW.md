# Passive media v2 · bounded product/library review

Candidate `/private/tmp/podview-recovery-20261024`. Actual native fixture controls on4188; product iframe remains loaded through observations/outage. No Spotify/HA/provider calls or audio/device effects; no shared viewport resize. Main/frozen packets untouched. Review uses Product Design and Impeccable criteria against the existing canonical Player/Card/Button/Slider/ListRow anatomy.

## First combined pass

At1280: externally observed Svend appears instead of configured Køkken; position1:24/3:20. Native track opens Afspiller. Unavailable from ACTIVE preserves item/position/output marked last known; restored paused restores same Svend/item/position. Output-change observation changes to Frida. Account-only says speaker not confirmed and exposes provider alias as such, not a fabricated room. Confirmed idle clears the old item and displays configured Køkken; current implementation returns to overview from player detail on idle.

At980: restored paused Svend→native detail→actual local SSE closure plus snapshot/music503→automatic recovery retains Afspiller/Back/item/position, without reload/retry. Commands remain disabled throughout because fixture grants no effects. Source state ownership is not established by these no-effect controls; only passive projection/navigation is tested.

Images: `screenshots/media-v2-playing-1280.jpg`, `media-v2-unavailable-1280.jpg`, `media-v2-account-1280.jpg`, `media-v2-idle-1280.jpg`, `media-v2-offline-980.jpg`, `media-v2-stale-detail-980.jpg`.

## Batched findings sent to root

1. Empty header weather: actual img hidden/display:none; text auto-placed in first32px grid track. Width160 available but caption32px yields Ve… even1280. Shared owner needs explicit no-icon text placement; right-slot allocation itself fits.
2. Disabled play-pause native accessible name says Fortsæt during observed playing, while visual Pause is correct. Command availability must not supply the observation's state.
3. At980 cover/button233.85wide×280high, violating square reserved art. Placeholder glyph visibly clipped. Needs shared responsive square geometry without enlarging1280.
4. Stale status #player-state centered intrinsic314.28px box exceeds281.85px player, cropped outside card. maxWidth none means existing overflow hidden/ellipsis does not constrain its own box. Bound existing status owner, preserve accessible full text.

Earlier unavailable1280 screenshot lacked visual cover/title momentarily, but later settled980 DOM opacity1 and actual screenshot show both. Not classified as persistent disappearance. A later spontaneous return to overview was seen between fixture phases after library inspection; exact cause not yet reproduced, so no causal claim. Direct offline recovery did preserve detail.

Library shell loads at/view/library.html, but preview targets /?stage=… while current fixture serves index only/view/: blank preview. Fixture owner notified for QA-only static route fix; no claimed library rendering pass yet. Final confirmation pending root batch build.

## Combined batch confirmation

After root's final build GO, refreshed own fixture once. Native external-playing confirmed actual Svend and correct disabled Pause accessible name.980 cover and button are233.84375×233.84375;1280 cover280×280. Empty header weather text spans128px and renders full80.33px Vejr ukendt, without overlap. Stale status is constrained201.85px at714.15→916, inside player; full status accessible name remains. Direct detail→unavailable→restored paused retained detail/Back and1:24. Actual network off503/SSEclosed→on restored paused/detail automatically with no product reload or Prøv igen. No commands sent.

Final images personally inspected using Product Design hierarchy/spacing/control boundaries and Impeccable craft-floor/retained-state criteria:
- `screenshots/media-v2-final-stale-980.jpg`: corrected square placeholder and bounded stale status, useful retained metadata.
- `screenshots/media-v2-final-output-1280.jpg`: actual Frida output rather than default Køkken; full weather caption; normal280px square cover; disabled command semantics correct.
- `screenshots/media-v2-final-account-1280.jpg`: honest account-only alias and speaker-unconfirmed status. **Remaining concrete visual finding:** authored long provider alias wraps two lines in fixed output-heading anatomy and touches status line. Sent to root for disposition, not silently accepted.

QA-only static route correction by fixture owner enables library's absolute /?stage preview. Actual `/view/library.html#component=player&state=player%3Amusic-paused&view=single&level=screens&recipe=player` and player-active-offline checked via native state selector. Screenshots `media-v2-library-paused.jpg` and `media-v2-library-stale.jpg` show same renderer/kit, real cover, stable progress and separate transport/volume; stale variant disables controls. These are2006px outer-browser screenshots with the library's own scaled1280×800 iframe, not native1280 outer-window proof. Product images above are native fixed1280/980 iframe crops. No browser resizing.

Scope remains local passive observation/layout/navigation. External physical Spotify/Speakers, audible routing, active timer retention, real-account authority and hardware are not certified by these fixtures. No new source edits from QA. A transient initial old/empty projection until next passive poll was observed after reload; subsequent source-change observations settled correctly. Earlier idle deliberately moves focus to overview; broader navigation intent is not silently treated as approved by this review.

## Final long-alias correction confirmed

Root corrected the existing single-line output-room role. Actual final account-only screenshots `media-v2-final-alias-fixed-1280.jpg` and `media-v2-final-alias-fixed-980.jpg` personally inspected: status and alias no longer overlap; both truncate only within their own roles and the native button accessible name retains full source/status. At1280 status y128–148, name y149–175,width238.15; at980 same vertical rows, status width201.85,name145.85. Cover remains square and topbar fits. This closes the concrete long-alias finding in the bounded review, not physical routing acceptance.

Product and library review complete for this requested passive-state batch. No further production edits requested by QA. Own tabs831375166/831375167 closed, own4188 process89100 stopped. Shared Chrome viewport never resized; user HA tab untouched. Root owns combined test/freeze/delivery decisions. Final screenshots supersede earlier finding captures; earlier images remain before evidence.
