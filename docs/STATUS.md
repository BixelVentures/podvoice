# Aktuel status · 14. oktober 2026

**Lead:** root. Det brede produktmål er fortsat **PAUSET**. Denne fil viser aktuel baseline
og aktive beslutninger. Ældre forløb er bevaret i det
[historiske statusarkiv](archive/STATUS-2026-10-14-pre-157.md); det er ikke aktuel evidens.

## Installeret baseline

- **HA Green:** PodVoice **2.0.25** er ifølge den aktuelle parent-installationskvittering installeret og Kører. Udgivet main er `ae9df631f90ff9ed0288be824ed957aec95e01f9`; native integration0.1.1 og PodConnectControl0.10.9 er efter Core-genstart verificeret i UI, og begge native timerendpoints var tomme. Det beviser ikke fysisk audio-/handlingsaccept.
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

<!-- historical-candidate-scope-coupling
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


## Aktiv beslutning · PodView26 AI visual value (planned build)

Lead: root; implementation: podvoice_bridge. Actual released base is ae9df631f90ff9ed0288be824ed957aec95e01f9 (2.0.25). Source inspection found the optional Responses selector unused and weather displaySuggested derived from fact count. The causal hypothesis is that wiring an optional, bounded AI selection to the existing completed-tool receipt owner removes local semantic selection without changing the conversation/provider/tool ACK chain. Every existing fact and source remains server-owned; only show/known fact IDs may be selected.

Scope: receipt owner, optional selector/admission, Supervisor-only opt-in configuration and startup wiring. No ThinSession, provider adapter, speech prompt, tools schema, lifecycle, hardware or home mutations. Speech never awaits selection. All cards default to not suggested; late/failed/refused/unknown replies remain invisible. Exact room/owner/session/epoch/turn/provider/task/revision and expiry fences remain authoritative. One optional request at a time, no retries, bounded input/output, persistent finite request budget and diagnostic mutual exclusion. The user explicitly approved the bounded first AI step: GPT-6 Luna, maximum20 prepaid total calls,4096 request bytes,256 output tokens, no retries/refill, using the existing server credential. Supervisor default remains empty; activation is a separate installation step. No paid request was made in implementation/tests.

Planned regression: positive/decline ID selection, invented IDs/URLs/refusal/malformed/oversize outputs, stale turn and cancellation-resistant replies, expiry/close, duplicate receipt, persistent exhausted/malformed budget, diagnostic exclusion and nonblocking voice admission. Existing native/OpenAI tool receipt hooks stay byte-identical. Independent adversarial review and exact final composed source/UI CI precede release. No physical acceptance claim; rollback is 2.0.25 and empty optional policy.

Actual26 preparation: frozen parent UI source captured byte-identically before subsequent work;103 packaged runtime assets, manifest SHA256 `9a0e5fec77c5c8db973c6927331d59b7cdba2ae20684e468c110d5a90db34be3`. All154 packaged Node tests passed. Focused AI/receipt/config/bridge tests, Ruff/format and mypy66 modules passed after bounded review repairs. The prior25 scope profile correctly rejects this narrower follow-on. The separate visual-selection admission profile was independently reviewed, corrected for whole-repository inventory and exact startup/config placement, and applied under existing implementation authorization. All old profile functions remain unchanged;29 new policy cases,2 affected final cases and33 compatibility cases passed. Whole-candidate fresh Ultra review GO binds staged tree e42a9029efe955f48b94f9173808bfd580ce3946. Official CI is not yet completed. Research/tool-search enrichment, new music selection, alias transport, artwork and physical acceptance are not implemented by this slice.


Final source review found one blocker: model decline controlled auto-open but still exported receipts into manual history. The receipt owner now exports only AI-admitted items and refuses source lookup for pending/declined IDs.62 affected receipt/selector/actual ingress and Voice PE/Talk/live hook tests passed, plus Ruff/format/mypy66. The same independent Ultra reviewer confirmed the bounded correction and returned GO for exact staged source tree `e42a9029efe955f48b94f9173808bfd580ce3946`; only this STATUS evidence/binding is added afterward. No additional runtime/UI/source policy change follows that review. The broad old-policy rerun was interrupted after80 passing cases and is explicitly not a full-suite result; official final-head CI remains required. No paid provider request or26 installation occurred during source work.

<!-- candidate-scope-coupling
{
  "version": 2,
  "kind": "podview_visual_selection",
  "base_tip": "ae9df631f90ff9ed0288be824ed957aec95e01f9",
  "merge_base": "ae9df631f90ff9ed0288be824ed957aec95e01f9",
  "domains": [
    "ha_tools",
    "physical_output",
    "realtime_semantics",
    "rearm"
  ],
  "fingerprint": "e2b23d54c180188a951b8df2899d4c0e798f9e4e9213bd433569da7c893f8591",
  "regression_fingerprint": "2210e343d5b47c4efc59d27a4d678949fd39464d98508b94765c8f988144e52d",
  "policy_fingerprint": "e7d62c562c3da994e9e4879ea16be919d4314b793c65b391414b5296d217205b",
  "config_fingerprint": "7ddde9950aa613f689053b4751a35bf0c7b0f8a70df409cc019854c099041ba0",
  "reviewer": "visual26_final_ultra \u2014 independent fresh Ultra whole-candidate review and bounded visual-admission continuation",
  "rationale": "Independent source GO on staged tree e42a9029efe955f48b94f9173808bfd580ce3946 against released ae9df. Only five server files change: startup-only optional selector setup, Supervisor-only empty-default policy, truthful visual capability/awaited receipt cleanup, bounded fixed-model selection and receipt owner admission. ThinSession, provider adapters, provider budget, tool ACK, native/device owners and build/workflows remain byte-identical. The separate admission profile preserves all existing profiles, inventories every repository path, anchors startup/config AST changes and binds source/test/policy/config fingerprints. Frozen parent UI103 assets manifest9a0e5fec77c5c8db973c6927331d59b7cdba2ae20684e468c110d5a90db34be3 passed154 packaged tests. AI selects only known facts; pending/declined/stale sources are not exported. Finite prepaid startup allowance, exact current-owner/revision/source-expiry fences and no-retry behavior are reviewed. This is source admission only; official CI, immutable release/image, installation, provider and physical acceptance remain separate."
}
-->
