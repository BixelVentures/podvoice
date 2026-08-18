# PodVoice agentkontrakt

Før enhver ændring i arkitektur, Realtime, VAD, lyd, firmware eller samtalelivscyklus:

1. Læs `docs/INVARIANTER.md` i sin helhed.
2. Bevar én samlet Voice PE half-duplex-livscyklus; optimer aldrig én komponent på
   bekostning af den tværgående kontrakt.
3. En fejl er ikke lukket af en plausibel kodeændring eller grøn komponenttest. Tilføj
   en regression med den observerede fysiske eventrækkefølge og kør den komplette gate.
4. Kald aldrig produktet testklart/færdigt uden de automatiske beviser og en frisk fysisk
   Voice PE-trace, som kræves i `docs/INVARIANTER.md`.

