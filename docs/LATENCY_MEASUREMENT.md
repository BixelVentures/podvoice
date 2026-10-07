# Offline måling af fysisk svartid

`scripts/latency_report.py` læser de gemte `AudioTraceRecorder`-manifests. Scriptet
kalder ingen provider, ændrer ingen indstillinger og afspiller ingen lyd. Det er
regnskab og reviewstøtte; `docs/STATUS.md` ejer fortsat kandidatens faktiske gate-status.

## Før optagelse

Lead skal først have samme artifacts golden chain, 10/10 automatisk og 10/10 ubrudt
fysisk lifecycle samt afklaret diagnose/input/svarfejl. Read-only analyse af gamle
filer er tilladt før denne gate; fysisk hastighedsarbejde og runtimeoptimering er ikke.

Fastlås artifact-kind/hash, version, firmware-build, model, prompt/context-hashes,
kanal/gain, inputrate, rumopsætning og manuskript. Gennemfør 40 enkle ture og mindst
20 værktøjsture; lokal og ekstern værktøjstid er forskellige kohorter. Bevar fejl
og ukendte prøver i nævneren. Følg same-breath, opfølgninger og næste wake.

## Manifests og clocks

Alle dele fra samme `conversation_trace_id` skal med. Partindekser skal være
sammenhængende fra nul, og sidste del skal være `complete`/`saved`. Events har
samtalens fælles host-monotonic `at_ms`; de må ikke rebaseres ved partskift eller
sorteres for at skjule omvendt rækkefølge. Manglende identitet, recording-error,
`incomplete`, tabte kommandoer, rateændring, fremmed clock og trunkering gør prøven
ukendt. Alle sourcefiler hashes, så et senere review ikke kan flyttes til andre bits.

Rapportens opstarts- og lukkedelstræk er observationer, selv når trace er incomplete.
De bliver aldrig automatisk fysisk latencybevis. Socket-/SDK-release, provider-terminal,
fysisk playback-dræn og rearm holdes særskilt; den aftalte 2 s-guard er ikke en frit
fjernelig procesforsinkelse.

## Fysisk meningsfuldt svar

Godkendelige samplekanter er fysisk `speech_stopped`/`user_speech_stopped` med
`source="firmware"`, `playback_started` og samme leases `playback_finished`.
Session, tur, provider-generation og playback-id skal kunne korreleres. En provider-
transskription, `live_input_fragment`, `response_audio_started` eller første start af
en kontinuerlig Live-stream kan ikke erstatte disse kanter.

Den nuværende kontinuerlige Alpha-stream kan derfor mangle de kanter, denne gate
kræver. Markér det ukendt; fremstil ikke Realtime-events eller kunstige sampletider.
Et fysisk instrumenteringsbehov er en separat lead-beslutning før runtimeændring.
På det aktuelt shippede kontinuerlige Alpha-format er den fysiske stopkant og
per-tur-playback-korrelation ikke registreret: værktøjet kan i dag analysere de
eksisterende delstræk, men kan ikke indsamle eller godkende en fysisk 40+20-serie.
De følgende reviewfelter beskriver krav til kommende fysisk dokumenteret måling.

En navngiven reviewer skal lytte til rum-, device- og provider-WAV og attestere:
kendt input er konsistent, svaret er korrekt, og meningsfuld tale begynder ved den
valgte fysiske playback-kant. Earcon, tavshed og generisk preamble tæller ikke. Hvis
tale først begynder senere, er denne kant ugyldig: stop ikke uret tidligere. Værktøjet
validerer filhash/PCM-format og afviser præcis nul-PCM, men hverken energi, RMS eller
en lille ikke-nul sample kan bevise sprog eller mening. Fuld talegennemlytning er
menneskeligt bevis, aldrig en automatisk inference.

## Kørsel og reviewprotokol

```sh
PODVOICE_PYTHON=/private/tmp/podvoice-venv-20261006/bin/python
"$PODVOICE_PYTHON" scripts/latency_report.py /privat/trace-p0000.json /privat/trace-p0001.json \
  --protocol /privat/review.json --output /privat/latency-report.json
```

Protokollen er JSON med `schema: 1`, `script_sha256`, `room_setup_sha256` og `samples`.
Hvert sample indeholder `sample_id`, `trace_id`, `kind` (`simple`, `local_tool`,
`external_tool`), ordnet liste `trace_sha256` og zero-based `speech_stop_index`,
`playback_start_index`, `playback_finish_index` i de sammenføjede events. De tre
lydfiler i `audio_review.room/device/provider` har `path` relativt til protokollen
og `sha256`; reviewet har `reviewer`, `input_consistent`, `correct_answer` og
`meaningful_at_playback_start`. Kun eksakt `true` accepteres for disse attesteringer.

Device/provider-filens resolved path skal være recorderens faktiske `stages.*.file`
under det tilsvarende originalmanifest-parent. Reviewet har `part_index`,
`start_sample` og `end_sample`; samplerate og WAV-frameantal skal matche manifestet,
og delens `stage_sample_offsets` plus `end_sample` skal være stopkantens tilsvarende
device/provider-offset. Det valgte interval skal indeholde faktisk ikke-nul PCM.
En anden WAV med et ellers korrekt hash og true-flag er utilstrækkelig. Dette binder
fil/rate/offset til recorderens source; det er ikke en signerede byte-attestation fra
firmware. Lead kontrollerer altid recorder/artifact-provenance særskilt.

Rumlyd har sin egen sampleclock. `audio_review.room_clock_alignment` refererer med
`path`/`sha256` til en særskilt reviewed JSON-receipt: `schema: 1`,
`clock: "host_monotonic_at_ms"`, samme `reviewer`, ordnet `trace_sha256`,
`room_sha256`, målt `room_sample_zero_at_ms` og kendt ikke-negativ `uncertainty_ms`.
Samplet har `room_speech_stop_sample` og `room_meaningful_start_sample`; disse bounds
skal ligge i den faktiske rum-WAV og mappe til de valgte tracekanter inden for den
observerede uncertainty. En ukendt offset/clock kræver ukendt måling, ikke en antagelse.
Begge kanters usikkerhed indgår konservativt i `latency_upper_bound_ms`; bindende
p50/p90-mål bedømmes mod dette øvre tal, så usikkerhed ikke skjules ved målets grænse.

Et værktøjssample har desuden `tool_spans` med `start_index`/`finish_index` for native
`provider_live_tool_result` (`dispatch/started` → `dispatch_returned/returned`).
`call_id`, session, generation og tur skal matche de fysiske kanter, og hele spandet
skal ligge mellem taleslut og det meningsfulde svar. Rapporten udleder selv alle
faktiske dispatch-/returnkanter og kræver, at `tool_spans` dækker dem præcist.
Udeladte, manglende, fejlede, duplikerede, genbrugte eller stale kald afvises;
forsinkede events kan ikke flyttes til en anden tur/generation. Samtidige forskellige
værktøjskald tælles som union af ventetiden, én gang. Rapporten viser ventetid og resten
af kæden særskilt; resten indeholder stadig provider-, input- og devicearbejde og må
ikke kaldes ren PodVoice-kodeoverhead.

Rapporten gemmes med mode 0600 og indeholder identitet, source-hashes, delstræk,
p50/p90/p95, gyldige/fejlede/ukendte antal og konkrete afvisningsårsager. Den kopierer
ingen transcript, rå eventindhold eller lyd. Output må ikke overskrive evidence.
Exit 2 betyder manglende/ukendt/afvist målegrundlag; exit 0 betyder alene
`eligible_for_lead_review`, aldrig fysisk lifecycle- eller produkt-GO.
Recorderens artifactfelt mærkes eksplicit som recorded metadata, og rapporten binder
selve reporterværktøjets SHA. Faktisk installeret OCI/rootfs-/firmware-identitet skal
stadig kontrolleres med kandidatens uafhængige installationsreceipt.

Percentiler bruger lineær interpolation ved index `(n-1)*q`. Bindende mål er simple
p50 ≤ 1200 ms/p90 ≤ 1800 ms og lokale tools p50 ≤ 1500 ms/p90 ≤ 2500 ms. P95 er
deskriptiv og har ingen ny opdigtet acceptgrænse. Eksterne værktøjer har særskilt
ventetid, ikke samme numeriske lokale-tool-mål. Ingen fejl/ukendt prøve må ignoreres
for at opnå et grønt resultat.

## Direkte GPT-Live-reference

Ingen betalt reference køres af dette værktøj. Lead skal først fastlægge en separat,
bounded, sideeffektfri plan med samme model/voice/indstillinger, input og semantiske
opgaver samt samme provider-/budgetisolation som øvrig live-diagnose. Værktøjsdata
skal være sammenlignelige og sideeffektfrie. Raw providerlyd har sin egen clock og er
aldrig bevis for fysisk Voice PE-lyd. Beskriv forskellen i måleflade før en differens.
Direkte GPT-Live +150 ms p50/+250 ms p95 er en nordstjerne, ikke en alternativ GO-gate.
Indtil faktisk måling står rapportens `provider_comparison` som `not_run`.
