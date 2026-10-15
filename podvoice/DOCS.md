# PodVoice · installation og daglig brug

PodVoice forbinder en Voice PE med PodConnect, Home Assistant og GPT-Live. Voice PE
ejer wake og fysisk lyd; `VoicePELink` og den fælles `ThinSession` fører samtalen til
`OpenAILiveSession`. Talk i panelet bruger samme samtalemotor med browserens mikrofon
og højttaler. Begge er v2.x full-duplex-samtaler: nyt input kan fortsætte, mens et svar
afspilles. Talk eller sendt lyd alene beviser ikke den fysiske oplevelse på Voice PE.

Aktuel produktstatus, bindende regler og den detaljerede kæde findes i
[STATUS](../docs/STATUS.md), [INVARIANTER](../docs/INVARIANTER.md),
[PRODUKTMÅL](../docs/PRODUKTMÅL.md) og [ARKITEKTUR](../docs/ARKITEKTUR.md).

## Før installation

- Installer PodConnect Speakers, og hav URL/token til Attention API klar. Det ejer
  dæmpning og gendannelse af musik; PodConnect Control/HA ejer musikhandlinger.
- Flash Voice PE med projektets firmware fra `esphome/podvoice.yaml`, og gem dens
  ESPHome API-krypteringsnøgle (Noise PSK). Stock HA Assist må ikke overtage enheden.
- Opret en OpenAI API-nøgle med adgang til GPT-Live, og aktivér Home Assistants
  Model Context Protocol Server. Eksponér kun de enheder og scripts, assistenten må
  bruge, i Home Assistants stemmeassistentindstillinger.

## Start add-onen

1. Tilføj PodVoice-repositoriet i **Indstillinger → Add-ons → Add-on Store →
   Repositories**, og installer add-onen.
2. Gem `openai_api_key` under add-onens **Konfiguration**, og start add-onen. Det er
   OpenAI-nøglen til samtalen.
3. Åbn PodVoice-panelets **Indstillinger**. Indtast Voice PE PSK, Voice PE-adresse og
   tilhørende PodConnect-rum. Kontrollér PodConnect URL/token under **Avanceret**.
4. Vælg **Gem og genstart**. **Gem til senere** skriver indstillingerne uden genstart.
   Kontrollér derefter forbindelse og enhedens wakeword-bekræftelse i panelet.

Panelet har daglige valg for vækkeord, idle-lukning og musikdæmpning samt avancerede
indstillinger for blandt andet mikrofonkanal/gain, maksimal samtaletid og HA/MCP.
Der er ingen daglig provider- eller Realtime-modelvælger. Gemte gamle
`openai_model`, `force_mini`, `live_alpha` og `full_duplex`-felter er
kompatibilitets-/rollbackdata; de aktiverer ikke en alternativ produktionsmotor eller
lukker GPT-Live-input under svar. Ændr ikke lydtuning uden en konkret trace eller
måling.

## Kontrollér funktion

Panelets forside viser forbindelser og kapabiliteter; **Avanceret → Fejlfinding** har
forbindelses-, lydstrøm- og højttalerkontrol. En anmodet testtone eller et grønt
statusfelt beviser ikke, at samtalen høres korrekt i rummet. Hør selv første svar,
tal under et svar, prøv opfølgning, lukning og næste wake. Den gældende fysiske
accept står i [STATUS](../docs/STATUS.md).

Talk-fanen kan tage tekst og, hvor browseren tillader det, mikrofoninput. Browserens
mikrofon kræver en sikker kontekst som HTTPS eller localhost; Home Assistant-paneler
kan desuden begrænse den indlejrede mikrofon. Talk deler Live/Thin-koden, men er ikke
en fysisk Voice PE-prøve.

Hjemmestyring og den aktuelle websøgevej kommer fra HA/MCP; PodVoice opfinder ikke
fakta, når værktøjet mangler eller fejler. Musikstyring og -søgning går gennem
PodConnect Control i HA; PodConnect Speakers bruges til fysisk attention/ducking.
Timeren ejes af HA, ikke af en lokal nedtælling i PodVoice.

Hvis noget fejler, læs panelets konkrete status og add-on-loggen. Ved manglende
Voice PE-forbindelse: kontrollér adresse, PSK og firmware. Ved manglende musikdæmpning:
kontrollér PodConnect URL/token. Ved værktøjsfejl: kontrollér HA/MCP-eksponering.
Bevar event- og lydspor fra den berørte samtale, før indstillinger ændres.
