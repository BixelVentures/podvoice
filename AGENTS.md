# PodVoice agentindgang

Denne fil er den korte indgang til aktuel status og arbejdsgang. Risikofyldte ændringer
følger fortsat de fulde sikkerheds-, lifecycle-, review- og beviskrav i
[docs/AGENTKONTRAKT.md](docs/AGENTKONTRAKT.md). Den oprindelige lange indgang findes i
Git-historikken før issue #157. Det historiske statuslog er bevaret i
[docs/archive/STATUS-2026-10-14-pre-157.md](docs/archive/STATUS-2026-10-14-pre-157.md).

## Hvad skal læses?

Til almindelige docs-, tooling- og fixtureopgaver: læs denne fil og
[docs/STATUS.md](docs/STATUS.md); åbn kun de filer, ændringen berører.

Til runtime, Realtime, VAD, audio, firmware, prompt, værktøjskontrakt, lifecycle eller
release: læs alle fire autoritative produktdokumenter i rækkefølge:

1. [docs/STATUS.md](docs/STATUS.md) — aktuel kandidat, evidens og beslutninger.
2. [docs/INVARIANTER.md](docs/INVARIANTER.md) — bindende system- og ejergrænser.
3. [docs/PRODUKTMÅL.md](docs/PRODUKTMÅL.md) — gates og målbar accept.
4. [docs/ARKITEKTUR.md](docs/ARKITEKTUR.md) — den ene produktionsvej.

Læs derefter de relevante sektioner i
[docs/AGENTKONTRAKT.md](docs/AGENTKONTRAKT.md), herunder ændringskontrol,
stoplinje, beviskrav, review, fysisk diagnose og releasegrænser. Planer og handovers er
historisk baggrund, aldrig autoritet over de fire produktfiler.

## Ti regler for levering

1. Saml beslægtede rettelser i én kandidat, ét PR-flow og én installation.
2. Kør kausal regression og berørt adapter under udvikling; gem brede checks til freeze.
3. Genbrug PASS på uændrede bytes; gentag kun ugyldiggjorte og endnu ikke kørte trin.
4. Parallelisér uafhængigt arbejde med én teknisk lead og tydeligt filejerskab.
5. Review berørt ejergrænse, nabotrinnene og relevante races én gang.
6. Genbrug fast Python 3.12-venv, dependencies og eksterne caches.
7. Kør lokale gates fra den vedvarende usynkroniserede dev-klon.
8. Brug eksisterende traces og optagelser før nye provider- eller fysiske prøver.
9. Bevar én branch/PR; push er ikke release eller installation.
10. Saml fysisk afprøvning i én kort serie; rapportér fysisk accept adskilt fra CI og kode.

## Agentvalg

Brug hurtigste tilstrækkeligt kompetente model. Afgrænsede docs-, status-, GitHub- og
fixtureopgaver kan bruge GPT-6-Luna low/medium. Brug GPT-6-Sol til krævende runtime- og
ejeranalyse. Brug Ultra én gang ved freeze til high-risk ejerskab, stale events, side effects
eller artifact-sandhed, ikke som standard i hver iteration. Et påkrævet uafhængigt high-risk
review består.

## Vælg kontrol

De autoritative kommandoer og arbejdsgangen står i [docs/UDVIKLINGSFLOW.md](docs/UDVIKLINGSFLOW.md).

| Ændring | Under arbejdet | Freeze og accept |
|---|---|---|
| Docs-only | Læs STATUS og denne indgang; gennemgå diff/links | Officiel CI på endelig kandidat |
| Isoleret fixture/tooling | Berørte statiske checks og fokuseret test | Genbrug PASS på uændrede checks; officiel CI |
| Produktkode | `scripts/dev fast --test <test-module-or-node>` | Exact-tree/scope, review og officiel CI |
| Lifecycle | `scripts/dev lifecycle`, kun dækkende mekanisk scope | Samlede mål og gates i PRODUKTMÅL |
| Prompt/schema/tool/Realtime | Berørte regressioner og relevant SafeEval/preflight | Uafhængigt adversarial review og officiel CI |
| Firmware/build | Firmwaremiljø- og bootregression | Generated C++ ved bootændring; fysisk evidens separat |
| Konkret CI-fejl/offlinearbejde | Isolér ugyldiggjort årsag | Lokal `scripts/dev release` kun ved behov |

`fast --test` er fokuseret pytest-feedback, ikke releasegate; den valgte pytest køres hver
gang. Ruff og mypy bruger deres eksisterende inkrementelle caches. Tilføj ikke et nyt
resultatcachelag. Gentag `--test` for flere noder i samme kørsel. Coverageprocent erstatter
ikke kausal regression, ejergrænse eller fysisk bevis.

## Stoplinje

Lead ejer den tekniske beslutning og kan stoppe arbejdet. Risikofyldt ændring kræver aktiv
beslutningspost i STATUS før kode, uafhængigt adversarial review før merge/release og
opdaterede faktiske resultater. En plan er ikke et resultat.

Voice PE-firmware ejer fysisk wake/playback/rearm; `VoicePELink` er eneste nativeadapter;
`ThinSession` er samtalemotor; OpenAI Realtime ejer semantik. Talk beviser ikke puckens
fysiske lydvej. Classic og direct PCM er karantæneret legacy. Tests, Talk, CI, transcript
eller korrekt svar alene giver ikke fysisk accept.

## Normal arbejdssekvens

Produktkode: ret den observerede årsag, kør berørt regression/adaptor, få ét fokuseret
review, bind exact tree og kør officiel CI én gang på den frosne kandidat.

Docs-only ændringer og isolerede fixture-rettelser bruger kun relevante statiske eller
fokuserede checks; de udløser ikke lokal bred releasegate.

Før freeze følges ændrede signaturer, callbacks og admission-grænser gennem kaldesteder,
wrappers og fixtures. Ret relaterede stale fixtures i samme ændringssæt.

Testopsætning er et middel til issue-rettelsen. Genbrug eksisterende harness og mindste
adapter; byg ikke et selvstændigt testprodukt.

Ved timeout, sandboxfejl eller flaky test: isolér tooling/testårsag én gang. Gentag kun
den ugyldiggjorte gate; gør ikke runtimepatch ud fra procesforsinkelse.

## Status og handoff

Før pause gemmes konkret arbejde og åbne issues med status **planlagt build**,
**udgivet/afventer test** eller **ingen version aftalt**.

Hvis brugeren beder om at færdiggøre en igangværende afgrænset udgivelse før pause,
færdiggøres den uden at starte nye forbedringsspor.

Lead opdaterer den aktive STATUS-beslutning med faktisk ændring, kontroller, afvigelser,
usikkerhed og fysisk gate-status. Planer må ikke registreres som resultater.

Provider, CI, publicering, installation og fysisk accept rapporteres hver for sig.
