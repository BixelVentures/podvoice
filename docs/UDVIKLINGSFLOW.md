# Udviklingsflow

Vælg den korteste kontrol, der faktisk dækker ændringen. Safety, scope, review og fysisk
accept er bindende i [AGENTKONTRAKT](AGENTKONTRAKT.md) og [AGENTS.md](../AGENTS.md).
Denne side vælger rækkefølge, ikke en vej uden om gates.

## Én beslutningsgang

1. **Læs aktuel sandhed:** start med [STATUS](STATUS.md). For runtime, Realtime, VAD,
   audio, firmware, prompt, værktøjskontrakt, lifecycle eller release: læs desuden
   [INVARIANTER](INVARIANTER.md), [PRODUKTMÅL](PRODUKTMÅL.md),
   [ARKITEKTUR](ARKITEKTUR.md) og relevante sektioner i [AGENTKONTRAKT](AGENTKONTRAKT.md).
   Rutine-docs/tooling behøver ikke gennemgå alle produktdokumenter.
2. **Afgræns:** fastlæg lead og filejerskab. Opret STATUS-beslutningspost før risikofyldt
   produktkode. Historiske arkiver er ikke aktuel status.
3. **Fokuseret feedback:** kør relevant eksisterende regression. For kode, fx
   `scripts/dev fast --test tests/path/test_file.py::test_case`; gentag `--test` for flere
   noder i én kørsel. Uden `--test` vælger `fast` konservativt ud fra diffet. Det er
   udviklingsfeedback, ikke kandidataccept. Den valgte pytest udføres hver gang; Ruff og
   mypy bruger deres eksisterende inkrementelle caches. Der indføres intet separat resultatcache.
4. **Lifecycle:** brug `scripts/dev lifecycle` kun når dens mekaniske scope dækker hele diffet.
   Det beviser ikke live provideradfærd eller fysisk accept.
5. **Freeze én samlet kandidat:** kontrollér exact tree/scope én gang mod aktuel main,
   review berørt ejerskab og fasthold PASS for uændrede bytes.
6. **Officiel CI:** kør én gang på exact candidate. Den brede CI dækker relevante statiske
   checks, pytest samt browser/build efter scope. Den snævre docs/devtools-CI kører kun
   `test_dev_cycle`, `test_ci_scope` og `test_release_contract`. Den gælder kun kendt docs- /
   devtools-scope; ukendt, runtime, config, requirements, produkt- og workflowændring bruger
   fuld CI. Docs-only ændringer springer add-on imagebuild over.
7. **Lokal releasegate:** `scripts/dev release` kun ved konkret CI-fejl eller nødvendigt
   offlinearbejde. Isolér fejl; gentag kun ugyldiggjorte trin.
8. **Adskil beviser:** merge, main-CI, publiceret artifact, installation, providerprøve,
   fysisk golden chain og 10/10 lifecycle er forskellige udfald.

## Kommandoer

```sh
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev fast --test tests/path/test_file.py
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev lifecycle --base origin/main
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev release --base origin/main
```

Genbrug én vedvarende Python 3.12-venv og eksterne caches. Lokale gates køres fra den
usynkroniserede dev-klon; Documents/worktrees er redigerings- og handoverflade. Undgå
konkurrerende pytest/mypy/git-gates på samme maskine. Runnerens stage-tider bruges til
lokal tidsdiagnose.

## Tidsforventninger

En manuel cacheprototyp blev kasseret: på en repræsentativ lille `fast --test`-node målte
Ruff/mypy med deres eksisterende caches 0,350/0,351 s; prototypen målte 1,573 s koldt og
1,080 s på varmt cache-hit. Den varme prototype var ca. 0,73 s langsommere, og dens
binding dækkede ikke ekstern konfiguration/Python path. Det er måling af disse runner-stages,
ikke af hele udviklingssløjfen eller CI; ingen ny cachemekanisme shipper.

Der er ingen aktuelle løfter om `fast` på 8/15 sekunder, lokal release på 45 sekunder
eller fuld suite på 35 sekunder. De tal i ældre noter var miljøbundne, ikke aktuelle
målinger. Den seneste tidligere leveringsobservation var cirka syv minutter for hver af
PR- og main-CI med fuld suite. Det er historisk CI-observation, ikke lokalt estimat eller
garanti. Mål konkrete stages før optimering; bevar kausale regressioner, timeout- og
cleanup-ejere samt fysiske gates.

Hvis gates fejler eller tests tager minutter om at starte, læs stage-resultater og isolér
én langsom/ugyldiggjort fase. Timeout, sandboxfejl og flaky adfærd er tooling-/testinfo,
ikke produktevidens. Forlæng ikke timeout eller patch runtime uden reproducerbar årsag.
Firmwaremiljø og package-merge kontrolleres som beskrevet i AGENTKONTRAKT.
