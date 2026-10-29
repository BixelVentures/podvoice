# Udviklingsflow

Denne side omsætter arbejdskontrakten til den faktiske udviklingssløjfe. Den definerer
hverken ny produktretning eller acceptgate. Den fulde risikokontrol står i
[AGENTKONTRAKT](AGENTKONTRAKT.md); aktuel kandidat- og fysisk status står kun i
[STATUS](STATUS.md).

## Ti korte arbejdsregler

1. Læs STATUS først; ved runtime/lifecycle/lyd ændres læs også INVARIANTER,
   PRODUKTMÅL og ARKITEKTUR.
2. Én teknisk lead ejer beslutningen; afgræns fil- og reviewejere før arbejde.
3. Saml beslægtede rettelser i én kandidat, ét PR-flow og én installation.
4. Kør den kausale regression og relevante adapter tidligt med eksisterende harness.
5. Genbrug beståede checks på uændrede bytes; gentag kun ugyldiggjorte eller endnu
   ikke kørte trin.
6. Brug én vedvarende Python 3.12-venv og eksterne caches i usynkroniseret dev-klon.
7. fast --test er fokuseret feedback, ikke releaseaccept; lifecycle vælges kun, når
   dens manifest dækker hele ændringen.
8. Frys én exact-tree kandidat, kontrollér scope og review berørte ejergrænser.
9. Kør officiel CI én gang på endelig kandidat; lokal release kun ved konkret
   CI-fejl eller nødvendigt offlinearbejde.
10. Hold kilde, CI, providerprøve, publicering, installation og fysisk accept adskilt;
    saml fysiske prøver i én serie.

## Godkendelse til installeret produkt

Ved UI-ændringer følges [AGENTS](../AGENTS.md#godkendt-ui-er-et-leveringskrav).
Før freeze skal den eksisterende feedbackpost forbinde godkendt reference og regler
med kandidatens komponenter og faktiske serviceadgang. Brug samme renderer i bibliotek
og liveprodukt. Før release bruges lokal reference mod lokalt bygget produkt;
kodebinding og genbrugt evidens er nok, hvor render er uændret. Kontrollér kun berørte
tilstande. Efter installation sammenlignes relevant Green-visning med referencen.
Green-/fysisk slutprøve må ikke blive et krav før release. Manglende funktion eller en reduceret
livevisning er en restfejl, ikke en accepteret levering. Genbrug uændret evidens;
reglen tilføjer ingen bred testserie eller selvstændig release.

## Lokale kommandoer

Brug ekstern Python 3.12 fra den faste venv. scripts/dev starter
scripts/dev_cycle.py; ingen ny test-runner eller resultatcache skal etableres.

~~~sh
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev fast --base origin/main --test tests/path/test_file.py::test_case
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev lifecycle --base origin/main
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev release --base origin/main
~~~

--test kan gentages for flere eksisterende pytest-moduler/noder i samme fast-kørsel.
De eksplicit valgte tests køres hver gang; berørte Ruff/format/mypy-stages og pytest
kører parallelt med isolerede stage-caches. Uden --test vælger fast konservativt ud
fra diffet. Hvis ændringen kræver hele testsuiten, opdeler fast/release workerne unit i
otte sekventielle batches og integration i to sekventielle kohorter (den faktiske
ten-cycle SDK-kohorte først, derefter resten); stage-ejerne kører parallelt og fejler
hurtigt. lifecycle er kun den eksisterende mekaniske manifestkontrol, ikke live eval,
release, golden chain eller fysisk evidens.

Lokal release parallelliserer scope, Ruff/format, mypy, unit- og integrationstages;
browser-gate køres kun når scope kræver det. Det slutter med exact-tree/diffkontrol og
er stadig ikke officiel CI eller ARM64 artifact. Kør ikke gates fra Documents,
Desktop, iCloud, OneDrive eller andre synkroniserede worktrees.

## Hvad den officielle CI faktisk gør

.github/workflows/ci.yml starter scopeklassifikation. For en almindelig produktændring
kører pytest unit og rest som separate matrix-cohorts parallelt; browserkontrakt/
Playwright er sin egen job, og PR ARM64 build kører når addon-/workflow-scope rammes.
På main offentliggøres image først efter krævede kontroller, med immutable versionguard.
Ingen af disse checks er fysisk provider- eller puckaccept.

Kun eksplicit tooling-/dokumentationsscope bruger snæver CI: de fem filer i
`TOOLING_FILES`, Markdown i repo-roden eller `docs/`, samt de fire præcise dokumentstier
`podvoice/DOCS.md`, `podvoice/CHANGELOG.md`, `scripts/LIVE_ALPHA_PROBE.md` og
`spikes/README.md`. Her kører Ruff, format og de tre eksisterende testfiler
`test_dev_cycle.py`, `test_ci_scope.py` og `test_release_contract.py`. Escapede
backslashes, traversal, symlinks, manglende filer og ukendte stier får ikke undtagelsen;
manglende diff-base giver fuld scope.

CI's tre scopeoutputs har hver sit formål: `tooling_only` vælger den snævre lint/test-
matrix; `addon_changed` er sand for ændringer i `podvoice/` bortset fra de to
topniveau-dokumenter `DOCS.md` og `CHANGELOG.md`; `pr_addon_changed` er sand ved payload
eller ændring i `.github/workflows/ci.yml`. Derfor giver fx `spikes/README.md` snæver
lint/test-CI uden add-on-imagebuild, mens en ren workflowændring udløser fuld CI og PR-
imagebuild. Ukendt scope eller manglende Git-ancestry lukker aldrig checks ned.

#156's runtimeforenkling er en separat kildeændring med sin egen kandidat og CI-kvittering
i STATUS. #157 er udviklingsflow-/CI-ændringen; de to issues må ikke blandes sammen.
Den skalering, som koden allerede gennemfører, er parallel unit/rest CI og genbrug af
eksisterende stage-caches, ikke at springe tests over.

## Målte CI-kvitteringer og backlog

- #157's tooling-only PR #159 (dev-tools-2026.10.14) er lukket. Den officielle
  [CI-kørsel 38631679611](https://github.com/BixelVentures/podvoice/actions/runs/38631679611)
  blev målt til 38 s samlet: scope 8 s, lint/test 24 s. Det er én konkret docs/devtools-
  kørsel, ikke en garanti for fremtidige CI-kørsler eller produktændringer.
- #157's pytest-split PR #160's [main-CI 38647659658](https://github.com/BixelVentures/podvoice/actions/runs/38647659658)
  målte pytest-kritisk sti fra 555,6 s til 266,4 s med unit/rest-cohorts. Det er
  pytest-kritisk sti, ikke total workflowtid, lokal fast-tid eller Voice PE-svartid.
- Ingen aktive løfter om fast på 8/15 s, lokal release på 45 s eller fuld suite på
  35 s. Ældre tal var miljøbundne. Fremtidig backlog kræver først ny stage-måling;
  den må ikke fremstilles som nuværende ydelse.

Ved fejl eller langsom fase: læs den konkrete stage og årsag. Timeout, sandboxfejl og
flaky test er tooling-/testinformation, ikke produktevidens. Ret workflow-/testens
slutbetingelse ved gentaget procesforsinkelse; patch ikke runtime uden reproduceret
produktårsag. Docs-only og isolerede fixtures bruger relevante fokuserede checks; de
udløser ikke lokal bred releasegate.
