# Music collection source contract candidate · 15 October 2026

Root delegated this isolated source slice. Base is native29
`b150a92925ca482befbc2b287807b4e3e240ae75`; no upstream repository, live provider,
model, grant, account or installed package is modified. Root owns integration,
production admission pins, release and physical acceptance.

## Implemented collection tracks

`GET /view/api/music?kind=top|recent|liked&account=<exact account>` retains the
existing passive response. Only a currently paired request with the existing
`play_track` policy/native room binding receives an additive `candidateSet`:

```json
{
  "schema": "podview.music-search-context.v1",
  "candidateSetId": "opaque 64 hex",
  "sourceKind": "liked",
  "bootId": "current boot",
  "roomId": "exact frame/session room",
  "sessionId": "owning session",
  "turnId": "owning turn",
  "taskId": "owning task",
  "inputRevision": 1,
  "revision": 1,
  "revisionScope": "music_selection or answer_task",
  "configEntryId": "actual source account",
  "source": "spotify_web_api",
  "query": "liked:collection",
  "items": [{"id": "opaque 24 hex occurrence ID", "index": 0}]
}
```

`items[index]` binds an occurrence in this response's `data.tracks`; IDs are
random server-owned lookup keys, not hashes of names/URIs. Repeated tracks retain
distinct occurrence IDs. The candidate set includes the whole existing admitted display sample, not a
complete library or a playlist. The unchanged ToolRouter currently asks for up to
20 collection rows and retains its existing 2 KiB data-result budget; that can
return fewer complete rows than the provider sample. No additional rows or
background reads are invented by this slice. It expires in at most 60
seconds; a later native controls offer is further bounded by its observation.

The existing setup body adds `candidateIds`, a distinct ordered list of one to
three IDs from this exact set. The server creates its normal stable opaque play
options in that order. The browser validates each offered label/artist against
its selected source rows and keeps the original full owner context. It then sends
only task/revision/option/request ID and the confirmed playback volume through
`/view/api/music/selection/actions`. Native Control continues to own target,
start policy, prepare/commit, provider command sequencing and one-use unknowns.
No raw browser URI, row number, label, viewer identity or AI output grants play.

Unpaired reads cannot promote cached observations into command choices. An
admitted fresh read invalidates old pending choices before its first await;
busy-rejected reads do not. Provider owner epoch is read before and after the
source fetch. A read-generation fence prevents an older post-read owner check
from replacing a newer same-collection set. Account/session/native grant/owner
and policy remain checked by the existing setup/action paths. Grant replacement
or revocation before registration cannot mint a candidate set. Old search setup
bodies without `candidateIds` and their original option semantics remain valid.

This is infrastructure for individual collection tracks. It is **not finished
Stemning**, playlist playback, playlist-end autoplay, or UI integration.

## Binding Stemning product contract — separate next slice

The user requires **three actual playlists**, selected for the local time and
mood, plus four unchanged tabs. A track set must never be substituted for a
playlist. Opening the UI or refreshing suggestions never starts or changes music.
A later time bucket does not replace cards under a person's finger. Only the first initial load and explicit “Andre forslag” may choose new cards.
Returning through tabs/scenes, opening an already populated screen, midnight or
a time-bucket crossing preserves the exact same three choices, order and
illustrations. Time influences only the next explicit refresh. A failed refresh
retains the last truthful source state. Expired source/play authority disables
play; a fresh source read may reissue permission only for the exact same observed
playlist IDs/content if still valid. Missing/changed source objects stay disabled;
permission renewal never silently replaces displayed content. Source identity and
visible-set identity are separate. The collection UI can similarly retain its
three tracks while matching those exact objects to a newly verified source set;
only its newly issued opaque occurrence IDs can then enter setup.

Server input must bind:

- One configured IANA timezone from the household/server owner, never browser
  clock or inferred location; derive local date, offset and time bucket on the
  server. Proposed buckets: morning 05–11, daytime 11–17, evening 17–22, night
  22–05. Boundaries are product proposals, not an implemented rule. Preserve the
  displayed set until an explicit presentation opportunity.
- Exact frame/session room plus configured native room/HomePod/engine binding,
  actual account owner epoch, session/task/input revision and a finite expiry.
- A versioned set of locally authored mood/theme IDs, their own descriptive tags
  and fixed Spotify search terms. Examples such as an acoustic warm morning are
  editorial search themes, not claims about a user's listening history.
- A reviewed local illustration manifest. Each card carries
  `illustration={assetId,semanticTags,source,attribution}`. Assets must exist in the
  packaged manifest, match the chosen mood's allowed semantic tags, and be labeled
  as mood illustrations. They must change with the actual mood rather than recycle
  three generic demo images. The now-playing image remains actual album artwork.
  Asset path/HTML/remote URL never comes from a model. No image generation is run
  or implicitly budgeted by this proposal.

### Source and model boundary

Spotify's current [Search reference](https://developer.spotify.com/documentation/web-api/reference/search)
allows playlist search, and explicitly restricts ingestion of Spotify Content
into AI/ML models. Keep Spotify titles, artists, descriptions, covers, private
libraries, account identifiers and playlist URIs out of the mood model input.
The proposed model selects only locally authored theme IDs and already available
illustration asset IDs using the server time bucket. The server then maps the
chosen owned theme to fixed search terms and reads real playlists from Spotify.
This order avoids sending Spotify source material into the model. No new private
payload is transmitted until the precise allowance is approved.

Necessary additive provider contracts, not implemented in this slice:

1. Account-bound `search_playlists`/`get_playlist` service with bounded source
   sample, canonical playlist ID/URI, actual name/owner, source read time,
   nullable description/image, source snapshot/version where supplied, and exact
   owner rechecks after every await. Do not call a generated name an actual title.
   Existing `SpotifyApi.search` can request playlists, and generic browse exposes
   them; neither is an admitted PodView playlist observation contract today.
2. Server-issued playlist candidates and opaque play-context options tied to that
   exact account/source/session/task/revision, with playlist snapshot refreshed or
   rejected when it changes. No arbitrary browser context URI or supplied URL.
3. A separately admitted `play_context` action on Control, preserving the same
   native room/output/start proof and command/unknown fences as `play_track`.
   Provider send uses the server-held actual playlist URI as `context_uri`.
   Do not create or modify a Spotify playlist to imitate discovery.

### Runtime AI allowance proposal — not activated

Proposed runtime model: `gpt-6-luna`, one call on first initialization or explicit “Andre forslag” for a
Stemning set, maximum 20 calls total in one separately approved 24-hour pilot,
maximum 1,536 input and 192 output tokens per call, maximum USD0.25 total. The
prospective monetary reservation requires verified pricing for the exact model;
if pricing or remaining budget is unavailable, make zero calls. This is a proposal,
not an estimate of cost or a granted allowance. Reserve once before send; do not
refund/retry ambiguous calls, refill on restart, or run background mood polling.
Use a distinct durable allowance path and policy version. The old visual20
`VisualSelector` is unchanged and may only choose show/fact_ids from existing
receipts; it cannot be repurposed for mood generation.

The only model output proposed is a closed record of approved theme ID and three
available illustration IDs. No prose, playlist IDs, actions or HTML. Too few real
playlist results, unavailable matching illustrations, malformed output, stale time
context or missing allowance produces truthful unavailable state, not fake data.

Still required before activation: actual household timezone; room/account/output
mapping and playlist-read admission; reviewed theme/query/illustration manifests;
exact independent model allowance, pricing and approved data payload; Control
play-context contract and paired source/profile review. These are not inferred
from the visual20 pilot or from Spotify browse working.

## Playlist progression and similar music

The user reports native autoplay already works. Preserve this existing owner and
behavior; do not build a second scheduler, local queue continuation or fake radio.
No extra regression trial is needed merely to restate an already accepted
baseline, but a new playlist path cannot claim stronger observed evidence than
the installed/native proof available to the lead.

The user explicitly wants both normal next-track progression and similar music
**after** the playlist ends. [Spotify's support page](https://support.spotify.com/us/article/autoplay/)
describes the latter as Autoplay. [The playback API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)
accepts playlist `context_uri` for Premium accounts but declares no autoplay
parameter. Do not claim that a 204 response proves continuation or room audio.

Local source evidence: native `podconnect/Dockerfile` applies
`patches/autoplay-v0.7.3.patch` to go-librespot. That patch preserves nonempty
playlist context and repairs the autoplay resolver's empty-context seed with the
track that actually played. Its tests cover disabled/repeat/queue boundaries,
missing seed, session separation and no automatic retry of a failed resolve.
This is engine code evidence, not proof of the installed version/config or Spotify's
current station resolver accepting that account. No public Web API autoplay
setter/readiness capability is currently admitted by Control; no provider call
was made in this task.

For any unverified new playlist-context path, acceptance must bind installed
Control/Speakers/git/artifact and native engine ID,
confirm autoplay configuration on that actual engine, then room-record one short
real playlist crossing an ordinary next-track boundary and its final track into
similar music on the selected HomePod. Account/room/context must survive the
transition, manual volume and ordinary pause/resume must remain correct, and
failure/unknown must not cause replay or an invented fallback playlist. Reuse matching existing native acceptance where available. This task verified
source support only and did not reproduce or refute the user-reported existing
autoplay behavior.
