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

## Hvis det igen tager minutter før tests starter

Kør kun preflighten:

```sh
./scripts/dev preflight
```

Flyt worktreet ud af en synkroniseret mappe, frigør disk eller vent på den ene viste
gateejer. Forlæng ikke timeouts som første løsning; collection skal normalt være færdig
inden for 15 sekunder.
