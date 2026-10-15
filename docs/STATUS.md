# Aktuel status · #156 kildeforenkling · 15. oktober 2026

**Lead:** root. Brugeren bestiller færdiggørelse parallelt med PodView, uden at ændre
versionen til fysisk prøve. Alt herunder er **kildearbejde / ingen ny version aftalt**.
Branch `codex/issue156-simplify` starter fra 2.0.28/main
`e272d1813930b819c019ca48469bf6f796f4fec0`. Ingen merge til main, versionbump,
udgivelse, HA-/Core-ændring, providerkald eller fysisk prøve udføres af #156.

## Fysisk baseline og parallel koordinering

PodView-chatten ejer 2.0.28-installation, den samlede Core-genstart og aktivering.
Denne opgave ændrer hverken deres branch, PodView-flader/policies eller testkandidat.
Sidste egen faktiske HA-aflæsning herfra er 2.0.27/kilde `669e739a`, artifact
`rootfs-v1:c5855fa18a9f01ef9c7dcfbe0498b8cb64c0a95cbf36ff911fea60efb02559fb`,
firmware `podvoice_build_113114_livetimeroutput1`; forbindelser var verificeret, fysisk
wake/lyd/lifecycle var ikke. Nyere installation må kun registreres ved faktisk readback.
Den fulde PodView28-beslutning, coupling og daværende baseline bevares i
[STATUS på 28-kilden](https://github.com/BixelVentures/podvoice/blob/e272d1813930b819c019ca48469bf6f796f4fec0/docs/STATUS.md).
Morgenens samlede prøve af musik, timer/Stop, afslutning og næste wake står i
[det tidligere prøveforløb](https://github.com/BixelVentures/podvoice/blob/30748398ca6a31afe2abcc8fe3aad4d93750ddbb/docs/STATUS.md);
version/git/artifact/firmware skal bindes til den faktisk installerede kandidat før/efter.

## Aktiv beslutning · #156

**Observeret problem og direkte evidens:** import-/kaldestedsreview fandt, at web
indlæste pensioneret console trods fast make_console=None og en UI, der bruger Talk.
timers.py/live_input_policy.py har kun historiske test-imports. Native og Talk gentog
samme Thin-brain-identitet og configmapping; replay start/run gentog samme rene
PCM/rate/hash/scenario/turn/mode-validering. AudioTraceRecorder, AudioAnalysis,
LiveEvalService, voice-eventtyper og openai_realtime har faktiske læsere og bevares.

**Hypotese og berørt kæde:** fælles mekanisk konstruktion og ét rent replay-predikat
skal reducere vedligeholdelsessteder uden ændret accepteret input/output, fejlform,
autoritet eller eventrækkefølge. Kæden er options/settings → native/Talk-konstruktion →
samme GPT-Live/ToolRouter → playback → teardown/rearm/næste wake. Replay er
start-validering → jobkø → ny run-validering → samme budget-/diagnostiklås → driver →
rapport/cleanup. Console skal stadig afvise før legacy-import.

**Invarianter og ikke-mål:** én Thin-ejer, én GPT-Live-produktionsvej, samme callbacks,
leases, settingssnapshot og diagnostiklås; ingen lokal semantik. Ingen ændring af
Thin, provider/Realtime-semantik, prompt, toolschema, VAD, lyd, timeouts, firmware,
PodView-policies eller migration/rollback-data. Ingen masseomsætning af Thin eller nyt
runner-/testframework. Rollback er hele #156-diffet; testkandidatens bits røres ikke.

**Faktisk ændring:**

- `_make_thin_session` samler brain/live_brain-identitet og fælles duck/idle/maksimum/
  promptmapping. Native beholder VoicePELink/Heartbeat/16 kHz/trace/guard/half-duplex;
  Talk beholder BrowserLink/24 kHz/egen hub og ingen rum-attention. En fælles
  sessionsindstilling har nu ét mappingsted frem for to.
- `_valid_replay_evidence` definerer checks én gang; både start og udførelse validerer
  fortsat, i samme rækkefølge og før samme lock-/budget-/providergrænser. En mutation
  af fixture mellem start og jobudførelse afvises af den permanente regression.
- Console importeres først efter eksisterende factory-admission. console.py/timers.py/
  live_input_policy.py (633 linjer) udelades fra image; alle kilder/historiske tests og
  route-fejlkontrakter bevares. Sammen med de fire tidligere udelukkelser er der syv.
- ARKITEKTUR beskriver behold/fjern/flyt og færre berøringspunkter. De autoritative
  dokumenter skelner faktisk GPT-Live fra den beholdte Realtime-diagnostik; den gamle
  tuningsguide er markeret historisk. Ingen fysisk gate eller tærskel bortfalder.

**Faktiske kontroller før freeze:** 19 main/settings-cases, 11 console/package-cases,
256 eval-cases og 9 audio-analysis-web-cases PASS. Fire eksisterende native/Talk-cases
blev derefter styrket med ikke-default duck/idle/maksimum 23/9/7 og bestod igen; de
øvrige resultater genbruges. Mypy69 og ændrede filers Ruff/format PASS. Den første
fælles fast blev stoppet før pytest, fordi en agent stadig formaterede sit draft;
ingen runtime-patch fulgte. Socketcases krævede normal usandboxed loopback; deres
PermissionError var ikke produktevidens. To allerede beståede webcases blev
utilsigtet gentaget sammen med de syv ugyldiggjorte; ingen flere gentagelser følger.

**Uafhængigt adversarial review:** simplify156_imports SOURCE GO på fælles konstruktion
og replay; simplify156_diagnostics SOURCE GO på konstruktion, web og packaging.
Konsolens afvisning/importgrænse, begge adaptere, nuværende input, stale generation,
replay-mutation, lock/budget/job/cleanup og faktisk pakket importsti er gennemgået.
Docs-review fandt P2 i modstridende wire-/providerkrav; efter rettelse ved bindende
afsnit og genindsættelse af den oprindelige sole-State-mic-gate er fundet lukket med
uafhængigt Sol GO. Ingen uløst P0–P2 i selve det bevarende #156-diff.

**Exact-source-binding:** base e272d181; ændrede produktfiler i rækkefølge nedenfor.
Prod-manifest SHA-256: `d8268b3800f87725c753ddcfb70d5bd8e974ff1247a015e4128fde35b432bbd9`.

```text
678af0c37f5103309f02116565b8721ec089d96ce318eebbacee1c9935f82ce4  podvoice/.dockerignore
ab77f51966601e0f0a4079b2c070e1ac23ddfa797a8fa883cb90a3cf417e482f  podvoice/gatekeeper/__main__.py
e5e06a851f18b14d434893271fa80a1c27a512f9c27550a2ba57a69a141c2a59  podvoice/gatekeeper/eval_harness.py
4523f241e408ed224785f5ac5a0352b11a552bc9d7fbc4544d0f2b3f04507510  podvoice/gatekeeper/web.py
```

Sidste scopekontrol: PASS, én unclassified_runtime-domain. PR #165 har offentligt
head `f9a97f6b284892ffccc049dc64a2a9166f8990ef` / tree
`51b6c8b6e0804371b408f48c46bb5495923deb0b`. Første officielle CI
[38696690975](https://github.com/BixelVentures/podvoice/actions/runs/38696690975)
bestod scope, browser og faktisk ARM-build, men fejlede i to forældede testantagelser:
builder-fixturen krævede direkte ThinSession-return i stedet for den nye delegation;
music-scope-fixturen kopierede den nye main-kilde mod sit gamle syntetiske digest.
Dette run bevares som fejlet. Ingen runtime- eller validatorændring følger.

Fixture-opfølgningen følger begge faktiske builderfunktioner og kontrollerer fortsat
fravær af classic-fallback. Den syntetiske music-fixture binder kun sin kopierede
main-kilde til egne bytes via pytest-monkeypatch; de øvrige reviewede digests, negative
mutationer og den rigtige scope-policy bevares. Produktmanifestet ovenfor er uændret.
Kun de to berørte fixturekontroller blev genkørt lokalt: hele music-scope-testfilen
og den ene builder-regression PASS. Ændrede fixtures Ruff/format og sidste scope PASS;
tidligere produktresultater og review genbruges. Uafhængigt fixture-review GO på
begge rettelser; ingen policy- eller produktændring. Den nye
exact-head CI-kvittering registreres i PR #165 og issue #156 uden et nyt docs-commit.
Ingen manuelle CI-genkørsler eller lokal bred releasegate indgår. Dette er fortsat
ikke fysisk testklarhed eller accept.

## Separat kildefund · #164 · ingen version aftalt

Read-only nabokæde bekræfter, at native GPT-Live `_pump_mic` undtager Live fra State-gaten
og kan sende PCM til provideren under ordinær playback. Reply-start anmoder ikke om
capture hold; firmwareinput fortsætter, mens hold i dag kun bruges ved confirmation-
rotation. Tidligere #106 beskrev kontinuerligt Live-input, men den aktuelle kontrakt
kræver lukket native mic fra accepteret tur gennem THINKING/svar/ekkohale. Dette er
kildebevis for en kontrakt-/implementeringsforskel, ikke fysisk bevis for ekko,
selvafbrydelse eller årsag til brugerens LED-/lukkeoplevelser.

[#164](https://github.com/BixelVentures/podvoice/issues/164) ejer afklaring/kausal regression
og eventuel minimal rettelse. #156 ændrer ikke denne adfærd og nedskriver ikke kravet.
Samlet produkt-/fysisk testklarhed og accept er fortsat åbne, uanset grøn refaktorerings-CI.
#153's uidentificerede pre-result-lyd og #118/#110/#103/#124/#107's fysiske krav er også åbne.
