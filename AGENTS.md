# PodVoice / PodView — sådan arbejder du her

Én side. Læs ikke andet end denne fil, issuet og den kode, issuet berører. Acceptkravene pr. feature
står i `docs/BRUGERHISTORIER.md`; et issue henviser til historiens nummer (fx A3).

## Produktet

PodView er en vægskærm oven på Home Assistant (musik, robotstøvsuger, lys, opskrifter,
timere, vejr, bil, svar fra stemmeassistenten). PodVoice er Home Assistant-add-on'et, der
serverer PodView og taler med HA. Musik og højttalere ejes af PodConnect (separat repo
`BixelVentures/podconnect`: HA-integrationen "Control" + add-on'et "Speakers").

| Lag | Hvor |
|---|---|
| Skærm (browser) | `podvoice/gatekeeper/static/podview/*.js` |
| PodVoice-server, PodView-API | `podvoice/gatekeeper/podview*.py`, `web.py`, `tools.py` |
| HA-integration (PodVoice) | `custom_components/podvoice/` |
| Musik/højttaler-kommandoer | PodConnect: `custom_components/podconnect/` og `podconnect/manager/` (Go) |
| Tests: skærm | `tests/podview/*.test.mjs` (node), `tests/browser/*_actual_e2e.cjs` (rigtig browser) |
| Tests: server | `tests/unit`, `tests/integration` (pytest), `tests/ha_framework` (rigtig HA) |

## Arbejdsgang for et issue

1. **Formulér brugerresultatet**: "Når jeg trykker X, sker Y inden for Z ms."
2. **Skriv en test, der fejler nu**, i det lag hvor brugeren kan se fejlen. For UX/flow er
   det en browserrejse i `tests/browser/*_actual_e2e.cjs` eller en PodView-test.
3. **Find det led, fejlen opstår i** (skærm → PodVoice → PodConnect Control → Speakers),
   og ret den dér. Kompensér aldrig i skærmen for en fejl i et lag længere nede.
4. **Kør testen og de berørte suiter** (kommandoer nedenfor). Grøn = færdig med koden.
5. **PR**: beskriv hvad brugeren oplever nu, hvilken test der beviser det, og hvad der
   ikke kunne afprøves (fx fysisk lyd). Ingen andre dokumenter.

Når en test fejler af en grund, du ikke forstår: læs testen og koden. Gentag ikke den
samme undersøgelse; skift tilgang eller skriv præcist, hvad du mangler.

## Krav til oplevelsen (gælder alle features)

- Tryk giver synlig reaktion med det samme; korrekt tilstand < 300 ms ved egen handling,
  < 1,5 s når noget ændres udefra (fx en anden app).
- Knapper låses aldrig, fordi en kommando er undervejs. Et tryk under en igangværende
  kommando sættes i kø.
- Ingen blink: indhold, der ikke har ændret sig, tegnes ikke om; ingen tomme mellemtilstande.
- Pause, afspil, næste, forrige, spol, lydstyrke, lys til/fra, robot pause/retur er
  *idempotente*: de må sendes igen og kræver ikke frisk observation. Kun handlinger, der
  starter nyt indhold eller flytter noget til et andet rum, bekræftes mod aktuel tilstand.
- Et ukendt udfald vises ærligt, men gensendes aldrig automatisk og låser intet.
- Tomme tilstande og fejl forklarer, hvad brugeren kan gøre.

## Regler for koden

- Ny og ændret kode skal kunne læses: almindelig formatering, ingen linjer over 120 tegn.
- Én tilstandsmodel pr. feature på skærmen; ingen nye vagt-tjek-lag ovenpå eksisterende.
- Hemmeligheder, tokens og persondata må aldrig logges.
- PodView-assets: efter ændring i `static/podview/*.js|css` kør `npm run build:assets`,
  kopiér ændrede `podview.bundle.js`, `library.bundle.js`, `podview.css` fra `dist/`
  tilbage og opdatér `asset-manifest.json` (sha256). `npm test` fortæller, hvis du glemmer det.

## Det gør du ikke

- Skriver status-, plan-, handover- eller evidensdokumenter.
- Laver versionsbump, release eller installation som en del af et fejlrettelses-issue.
- Tilføjer proces-scripts, "admission", "binding" eller nye CI-gates.
- Ændrer en test, så den passer til fejlen. En test ændres kun, når den ønskede adfærd ændres,
  og det står i PR'en.

## Kommandoer

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r podvoice/requirements.txt -r podvoice/requirements-dev.txt
npm ci

.venv/bin/python -m pytest -n auto tests/unit tests/integration   # server
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy podvoice/gatekeeper
npm test                                                           # PodView (bygger først)
node tests/browser/podview_actual_journeys.cjs                     # brugerrejser i rigtig browser
npm run dev -- --host 127.0.0.1 --port 4173                        # PodView-preview med testdata
```

## Udgivelse (kun når det er bestilt)

Bump versionen i `pyproject.toml`, `podvoice/config.yaml`, `podvoice/gatekeeper/__init__.py`
og skriv én linje i `podvoice/CHANGELOG.md`. Merge til `main` → CI tester og publicerer
add-on-imaget. Installation på Home Assistant er et separat, manuelt trin.

## Standardprompt til en feature

I Claude Code: `/feature <navn>` (fx `/feature robot`). Andre agenter (fx Codex): brug teksten i
`.claude/commands/feature.md` og erstat `$ARGUMENTS` med featurens navn.
