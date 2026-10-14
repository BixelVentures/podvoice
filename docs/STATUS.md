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
- PR #159 er merged som `4768a3584b0e64e0c57a46163f390b1f39f83372`. Endeligt PR-head `f783aae` bestod CI `38628544699` på 8m52s: lint/test, browser og ARM-build grønne. Main-CI `38629952851` bestod på 9m21s; ingen add-on-version blev genpubliceret.
- Førmåling for en ren STATUS-ændring: CI `38624071975` på `d1bb25c` tog 9m21s; pytest 7m57s. Ny docs-CI `38630020233` bestod: scope 7 s og lint/test 33 s; browser/build/publish blev sprunget over. Det tidligere docs lint/test-job tog 8m36s. Ny samlet tid var 9m38s inklusive ca. 8m58s i kø bag main, så dette beviser mindre aktivt arbejde, ikke kortere wall-clock i denne kørsel.
- **Udgivet:** [dev-tools-2026.10.14](https://github.com/BixelVentures/podvoice/releases/tag/dev-tools-2026.10.14), kildecommit `0787aff94bbdca13e487dde5ceca3616aa924c02`. Issue #157 er lukket. Ingen ny HA-version eller installation indgår.
- Runtime/provider/fysisk gates: ikke ændret eller kørt af docsarbejdet; baselineaccept
  står som ovenfor.


## Aktiv beslutning · PodView2.0.25 / PR158

PodView companion source is independently reviewed against published2.0.24 and preserves its native timer/provider result fixes. Frozen2107 assets:99 files, manifest SHA256 aeb40dd478ee3256da1977d8f92e12437bae5b1b0c0bfe5497aa63ea02069077;138 packaged UI tests passed. Explicitly authorized room-scoped pairing/controls, passive home/media/weather, accepted cleaning/timer histories and source-bound tool-result cards retain existing owners; lights, new-play selection, configured-alias music transport and artwork remain unavailable. No installation or physical acceptance is claimed.

Official CI38626897327 failed release metadata and a synthetic native quiet-clock fixture; browser, ARM64, Ruff/format and mypy passed. The independently reviewed correction changes pyproject version to25 and test clock arithmetic/contiguous sample coverage only;15 release-contract plus3 causal native cases passed. Exact repaired tree7f70826d0e69dec31a4a03b29c9087e37182ccff was published as701571a (same entire tree as approved f081ded). Original failed CI remains failed.

Main subsequently advanced to18b3eb9 via reviewed #157 tooling/docs work. Independent bounded current-main review GO: the staged reconciliation keeps every new-main AGENTS, workflow, CI-scope, release-contract and other non-STATUS path byte-identical to18b3; its only additional paths are this STATUS resolution and [the candidate archive](archive/PODVIEW-2.0.25-CANDIDATE.md). The main historical archive exactly matches prior d1bb25c STATUS (SHA-256 d3817644c0a7e079057bbc5cce37925fa147fe954cfa4cdc6e21e57bda0cd1ad); the candidate archive preserves all165 candidate-added lines, with only its former active scope marker renamed historical. The approved701571a production, config, candidate-scope policy and packaged UI bytes remain unchanged. New `ci_scope.tooling_only` returns false for all99 candidate paths, including runtime/config/scope policy, so the composed PR requires full official CI. The active record below binds current main18b3 and the full effective source/test trees. Prior failed CI remains failed; no release, installation or physical claim follows.

<!-- candidate-scope-coupling
{
  "version": 2,
  "kind": "podview_scoped_companion",
  "base_tip": "18b3eb9d9dcd94266dc13f1775387bb97beafe4f",
  "merge_base": "18b3eb9d9dcd94266dc13f1775387bb97beafe4f",
  "domains": ["ha_tools", "physical_output"],
  "fingerprint": "85893530fa1ad5cff8ade3d29e17be1b64a38b875dfd837d75c4767ddf0c55a1",
  "regression_fingerprint": "9aaec29bd7bfa0d77712238f38555327eca47b46e690207b9fda981b15837d22",
  "policy_fingerprint": "febbac99ad449daf0823cdf2eeee6f881998b6014b8cd2ad332c4da0413cc8a5",
  "config_fingerprint": "bc00286851e6dcab70b12b4e6ceb0bfba871cdf0af097bcd66205c629cc1f38c",
  "reviewer": "composed_final_ultra — independent whole-candidate review plus bounded CI and current-main continuations",
  "rationale": "Whole-candidate high-risk source review against published b9c934 remains valid. The reviewed CI repair changed only 2.0.25 project metadata and native ten-cycle fixture evidence. The new 18b3 main changes docs, agent contract, workflow, CI-scope and release-contract tests, and the staged reconciliation keeps every new-main file except STATUS byte-identical; candidate decisions are preserved in a historical archive. Approved 701571a production, Supervisor config, candidate-scope policy and packaged UI bytes remain unchanged. New CI-scope policy selects full CI for the effective PodView runtime/config/scope diff. Scoped touch mutations retain explicit pairing, server-owned single-use offers and existing HA or PodConnect owners; possible-send failures remain terminal unknown. Native timer history is Core-lifetime only; display receipts cannot alter voice ACK, result, cleanup or rearm. This record is source admission only; official final-head CI, publication, installation and physical PodView gates remain separate."
}
-->
