# Aktuel status · 14. oktober 2026

**Lead:** root. Det brede produktmål er fortsat **PAUSET**. Denne fil viser aktuel baseline
og aktive beslutninger. Ældre forløb er bevaret i det
[historiske statusarkiv](archive/STATUS-2026-10-14-pre-157.md); det er ikke aktuel evidens.

## Installeret baseline

- **HA Green:** PodVoice **2.0.24** med GPT-Live kører. Opstarten matcher udgivet main
  `b9c934edc1530a7750db370fe3b58dbb576c86f6`.
- **Udgivelse:** PR #155 er merged; PR-CI `38618596539` og main-CI `38619741156` var grønne.
  Det er en testudgivelse, ikke produkt- eller lifecycleaccept.
- **Kendt fejl:** streng stilhedsprøve fejler stadig på ét sekund uidentificeret lyd før
  timerresultatet. Issue #153 står åbent; fuldt fjernet fyld eller hurtigere lukning er
  ikke bevist.
- **Fysisk accept:** timeralarm/stop, Voice PE-musikflytning, modelafslutning/næste wake,
  latency og stabilitet afventer én samlet prøve. Åbne installerede/afventende issues:
  #153, #118, #110, #103, #124 og #107. Aktuel baseline har ikke bevist ny golden chain
  eller 10/10 fysisk lifecycle.

## Aktiv beslutning · #157 udviklingsflow og agentdokumentation

**Lead:** root. **Scope:** fuld issue #157 på dokumentation, CI-scope og relevante
runner-/scope-regressioner; ingen runtimeændring eller produktversion. Baseline var
`d1bb25c`.

**Observeret problem:** agent/statusdokumenter er vokset, udviklingsflowet har forældede
tidsmål, og tooling-only CI udførte unødigt fuld suite. Tidligere fuld PR-CI tog 416 s og
main-CI 423 s. En manuel cacheprototype på én repræsentativ lille `run_fast`-node gav
Ruff/mypy eksisterende-cachetider på 0,350/0,351 s; prototypen gav 1,573 s koldt og
1,080 s varmt, altså ca. 0,73 s dårligere varm stage, samt utilstrækkelig binding til ekstern
konfiguration/Python path. Det er stage-måling, ikke end-to-end CI-tid; cacheforslaget er
kasseret; begge runnerfiler er uændrede mod baseline.

**Beslutning:** forkort AGENTS.md til opgavebaseret læsevalg, ti leveringsregler,
modelrouting og kontroltabel. Rutine-docs/tooling læser AGENTS og STATUS; runtime og
højrisiko læser alle fire autoritative produktdokumenter samt relevante agentkrav.
`docs/AGENTKONTRAKT.md` beholder de detaljerede bindende risikokrav, men fjerner
indgangsdubletter, gentagne standardkommandoer og urealistiske historiske tidsmål.
STATUS er forkortet; tidligere payload er arkiveret byteidentisk. CI begrænser kun kendt
docs/devtools-scope til `test_dev_cycle`, `test_ci_scope` og `test_release_contract`; ukendt,
runtime, config, requirements, produkt og `.github/workflows` forbliver fuld CI. Fire
prose-snapshot-testcases erstattes af én faktisk intern agentlink-test; release-immutability-
og runtime-guards beholdes. Cacheprototypen er kasseret; `fast --test` kører pytest hver gang
og bruger kun eksisterende Ruff/mypy incremental caches. Ingen runtime-, review- eller fysisk
acceptkrav svækkes.

**Faktiske resultater:**

- AGENTS.md før/efter: 358 → 106 linjer.
- STATUS.md før/efter: 18.571 → 56 linjer.
- Historisk STATUS-fil SHA-256: `d3817644c0a7e079057bbc5cce37925fa147fe954cfa4cdc6e21e57bda0cd1ad`.
- Aktuel AGENTKONTRAKT SHA-256 efter de-duplicering: `bc9f7929f00000b5712a425ad73551785daf5e87f0747c94f20ddbc621defa3e`. Oprindelig AGENTS-tekst kan genskabes fra baseline `d1bb25c` i Git-historikken.
- Historisk STATUS matcher SHA-256 og byteantal; lokale Markdown-links, formatter/lint og scopekontrol PASS. Den detaljerede kontrakt er redigeret for navigation/duplicering; ingen exact-copy-claim.
- Målrettet lokal regression fandt ét manglende agentlink; det blev rettet, og kun den fejlede node blev gentaget (PASS, fast 0,8 s). Øvrige testresultater blev bevaret.
- Uafhængigt source review: GO. Cache- og shell-wrapper-findings er løst; ingen ny manuel cache leveres.
- PR #159 er merged som `4768a3584b0e64e0c57a46163f390b1f39f83372`. Endeligt PR-head `f783aae` bestod CI `38628544699` på 8m52s: lint/test, browser og ARM-build grønne. Automatisk main-CI afventer ved denne dokumentationskvittering.
- Førmåling for en ren STATUS-ændring: CI `38624071975` på `d1bb25c` tog 9m21s; pytest 7m57s. Denne rene docs-kvittering afprøver automatisk den nye smalle vej med de tre eksisterende tooling-moduler; resultat og faktisk eftertid registreres i issue #157 og udviklingsudgivelsen.
- Udgivelseskanal: `dev-tools-2026.10.14`, efter grøn main og docs-CI. Ingen ny HA-version eller installation indgår.
- Runtime/provider/fysisk gates: ikke ændret eller kørt af docsarbejdet; baselineaccept
  står som ovenfor.
