# PodVoice Claude-kontrakt

Læs `docs/INVARIANTER.md` i sin helhed før ændringer i arkitektur, Realtime, VAD, lyd,
firmware eller samtalelivscyklus. Filen er autoritativ.

Ingen “færdig”/“testklar”-påstand må baseres på isolerede komponenttests. Enhver fysisk
fejl skal omsættes til en regression med samme eventrækkefølge, og den samlede
half-duplex-kontrakt samt den fysiske Voice PE-gate skal være bevist.

