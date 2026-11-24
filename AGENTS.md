# PodVoice / PodView — sådan arbejder du her

Én side. Læs ikke andet end denne fil, issuet og den kode, issuet berører. Acceptkravene pr. feature
står i `docs/BRUGERHISTORIER.md`; et issue henviser til historiens nummer (fx A3).

## Produktet

PodView er en vægskærm oven på Home Assistant (musik, robotstøvsuger, lys, timere, vejr, bil,
svar fra stemmeassistenten): et HA-panel på `/podview`, som PodVoice-integrationen serverer.
PodVoice er Home Assistant-add-on'et med stemmeassistenten og AI'en; dets egen side er indstillingerne. Musik og højttalere ejes af PodConnect (separat repo
`BixelVentures/podconnect`: HA-integrationen "Control" + add-on'et "Speakers").

| Lag | Hvor |
|---|---|
| Skærm (HA-panel) | `podview/src/`: skallen og skærmene i `podview/src/panel/`, HA-data i `podview/src/lib/ha/`. `custom_components/podvoice/frontend/` er det byggede output (rør det aldrig i hånden) |
| PodVoice-server, PodView-API | `podvoice/gatekeeper/podview*.py`, `web.py`, `tools.py` |
| HA-integration (PodVoice) | `custom_components/podvoice/` |
| Musik/højttaler-kommandoer | PodConnect: `custom_components/podconnect/` og `podconnect/manager/` (Go) |
| Tests: skærm | `podview/src/**/*.test.{ts,tsx}` (Vitest + Testing Library), `tests/browser/ha_panel_actual_e2e.cjs` (panelet i WebKit) |
| Tests: server | `tests/unit`, `tests/integration` (pytest), `tests/ha_framework` (rigtig HA) |

## Arbejdsgang for et issue

1. **Formulér brugerresultatet**: "Når jeg trykker X, sker Y inden for Z ms."
2. **Skriv en test, der fejler nu**, i det lag hvor brugeren kan se fejlen. For UX/flow er
   det panelrejsen `tests/browser/ha_panel_actual_e2e.cjs` eller en Vitest-test i `podview/src/`.
3. **Find det led, fejlen opstår i** (skærm → PodVoice → PodConnect Control → Speakers),
   og ret den dér. Kompensér aldrig i skærmen for en fejl i et lag længere nede.
4. **Kør testen og de berørte suiter** (kommandoer nedenfor). Grøn = færdig med koden.
5. **PR**: beskriv hvad brugeren oplever nu, hvilken test der beviser det, og hvad der
   ikke kunne afprøves (fx fysisk lyd). Ingen andre dokumenter.

Når en test fejler af en grund, du ikke forstår: læs testen og koden. Gentag ikke den
samme undersøgelse; skift tilgang eller skriv præcist, hvad du mangler.

## Krav til oplevelsen (gælder alle features)

- Tryk giver synlig reaktion < 100 ms og visning af eget valg < 300 ms. Bekræftet enhedseffekt
  måles separat efter historien; eksterne ændringer måles fra kildeappen (< 1,5 s), ikke fra HA-event.
- Knapper låses aldrig, fordi en kommando er undervejs. Et tryk under en igangværende
  kommando sættes i kø.
- Ingen blink: indhold, der ikke har ændret sig, tegnes ikke om; ingen tomme mellemtilstande.
- Almindelig betjening venter ikke på et nyt poll. Næste/forrige og toggle er ikke idempotente:
  hvert eksplicit tryk er en handling, aldrig automatisk replay. Absolutte værdier (fx lydstyrke)
  afstemmes med seneste brugerønske. Nyt indhold/output bekræftes mod aktuel tilstand.
- Et ukendt udfald vises ærligt og gensendes aldrig automatisk. Reel manglende adgang, offline
  eller aftalte produktregler (fx klima slukket) er noget andet end en midlertidig opdatering.
- Tomme tilstande og fejl forklarer, hvad brugeren kan gøre.

- Ingen lydprøver kl. 18–08 Europe/Copenhagen eller genstarter/installationer, der kan genoptage lyd.
  Dokumentarbejde genoptager ikke produktarbejde. Stop testmusik efter tilladte prøver.

## Regler for koden

- Ny og ændret kode skal kunne læses: almindelig formatering, ingen linjer over 120 tegn.
- Én tilstandsmodel pr. feature på skærmen; ingen nye vagt-tjek-lag ovenpå eksisterende.
- Hemmeligheder, tokens og persondata må aldrig logges.
- PodView er React 19 + TypeScript (strict) på Vite. Ny skærmkode er TSX i `podview/src/`; bevægelse med
  `motion/react` efter `docs/MOTION.md`. En gammel skærm flyttes til React i sin helhed, med sine tests i Vitest.
- Efter enhver ændring i `podview/`: `npm run build` og commit output i `custom_components/podvoice/frontend/`
  (HA har ingen Node). CI fejler, hvis output ikke matcher kilden.

## Det gør du ikke

- Skriver status-, plan-, handover- eller evidensdokumenter.
- Laver versionsbump, release eller installation som en del af et fejlrettelses-issue.
- Tilføjer proces-scripts, "admission", "binding" eller nye CI-gates.
- Ændrer en test, så den passer til fejlen. En test ændres kun, når den ønskede adfærd ændres,
  og det står i PR'en.

## Kommandoer

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r podvoice/requirements.txt -r podvoice/requirements-dev.txt
npm ci                                                             # Node 24 (.nvmrc)

.venv/bin/python -m pytest -n auto tests/unit tests/integration   # server
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy podvoice/gatekeeper
npm test                                     # PodView: panel-build + Vitest
npm run typecheck && npm run lint            # TypeScript og ESLint for podview/
node tests/browser/ha_panel_actual_e2e.cjs   # panelets brugerrejser i WebKit (kør npm run build først)
node scripts/green-check.mjs                 # regressionstjek af /podview på HA Green (læsende; --help)
```

## Udgivelse (kun når det er bestilt)

Bump versionen i `pyproject.toml`, `podvoice/config.yaml`, `podvoice/gatekeeper/__init__.py`
og skriv én linje i `podvoice/CHANGELOG.md`. Merge til `main` → CI tester og publicerer
add-on-imaget. Installation på Home Assistant er et separat, manuelt trin.

## Standardprompt til en feature

I Claude Code: `/feature <navn>` (fx `/feature robot`). Andre agenter (fx Codex): brug teksten i
`.claude/commands/feature.md` og erstat `$ARGUMENTS` med featurens navn.
