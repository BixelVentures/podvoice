# Hurtig udviklingssløjfe

Målet er praktisk: almindelige kodeiterationer skal typisk give brugbart feedback på
sekunder og som hovedregel være færdige inden for 1–2 minutter. Den fulde releasekontrol
ændres ikke af den hurtige sløjfe.

## Den korte vej

Arbejd fra en lokal mappe uden filsynkronisering, fx `~/Developer/PodVoice`, og hold
mindst cirka 15 % af disken fri. `~/Documents` gav tidligere lange pauser før pytest
overhovedet kunne samle tests; på en frisk lokal clone tog hele testsuiten cirka 35
sekunder.

Brug et Python 3.12-miljø med begge requirements-filer installeret og kør:

```sh
PODVOICE_PYTHON=/sti/til/venv/bin/python ./scripts/dev fast
```

Kommandoen gør fire små ting:

1. stopper hurtigt ved langsom fil-I/O, en optaget gate eller manglende værktøjer;
2. holder Python- og mypy-caches uden for worktreet;
3. kører Ruff på ændrede Python-filer og mypy ved runtimeændringer;
4. kører ændrede tests og direkte modulkontrakter. Ukendt, firmware- eller
   releasepåvirkning falder automatisk tilbage til hele testsuiten.

`PODVOICE_PYTHON`, Ruff og mypy skal komme fra det samme Python 3.12-venv; globale
værktøjer bruges ikke som skjult fallback. Git-base og det ændrede scope fastholdes før
og efter kørslen, så en ændring under testen gør resultatet ugyldigt. Outputtet kaldes
derfor `focused/partial`, også når den konservative fallback kører mange tests.

Kun én lokal gate må køre ad gangen på maskinen. Agenter kan stadig analysere og skrive
parallelt, men de skal ikke starte konkurrerende pytest-, mypy- eller git-gates.

## Før et release-checkpoint

Før tests må kandidaten kun eje ét produktionsdomæne:

```sh
python3 scripts/candidate_scope.py --base <forrige-fysiske-kandidat>
```

Kommandoen fejler, hvis samme delta blander fx rearm, fysisk output/volume, Realtime,
audio-input eller HA-værktøjer, eller hvis produktionskode mangler en ændret regression.
Version, changelog og release-metadata tæller ikke som et selvstændigt produktionsdomæne.
Sammenlign med den umiddelbart forrige fysiske kandidat, ikke en gammel `main`, så hver
installeret kandidat har præcis ét kausalt delta.

Når ændringen er samlet og reviewet:

```sh
PODVOICE_PYTHON=/sti/til/venv/bin/python ./scripts/dev release
```

Den kører fuld Ruff, formatkontrol, mypy, hele pytest-suiten og diff-check af committed,
staged og unstaged diff. Derefter er
GitHub CI på den eksakte commit og den efterfølgende ARM64-imagebuild stadig påkrævet.
Den hurtige kommando er feedback, ikke releasebevis.

CI beholder derfor add-on-builden efter den fulde testgate. At bygge den dyre ARM64-
artifact parallelt med en kandidat, som endnu kan fejle tests, ville kun flytte ventetid
og skabe et artifact uden den krævede softwaregate. Pip- og Docker-lag caches i stedet,
så den samme rækkefølge bliver hurtigere uden at svække exact-commit-evidensen.

## Den korte fysiske canary

Arm én fysisk audio-trace og tal den faste kæde på højst cirka 90 sekunder: direkte
svar → to samme-session-opfølgninger → drej lydstyrken under ét svar → modelsemantisk
lukning → næste wake og frisk session. Hent trace-manifestet og kør:

```sh
python3 scripts/field_canary.py TRACE.json --volume-check pass
```

`pass` er den ene nødvendige menneskelige observation: drejehjulet ændrede den aktive
Nabu-lyd uden at bryde den næste opfølgning. Resten scores maskinelt af det strikte
trace-orakel. `not-run` og `fail` er altid røde. En grøn canary er adgang til den næste
gate, aldrig 10/10 eller releasegodkendelse.

Hvis canary fejler, installeres ingen ny kombinationspatch. Bevar trace, markér den ene
kandidat NO-GO og vælg enten ét nyt delta eller exact rollback til forrige fysiske
kandidat.

## Hvis det igen tager minutter før tests starter

Kør kun preflighten:

```sh
./scripts/dev preflight
```

Flyt worktreet ud af en synkroniseret mappe, frigør disk eller vent på den ene viste
gateejer. Forlæng ikke timeouts som første løsning; collection skal normalt være færdig
inden for 15 sekunder.
