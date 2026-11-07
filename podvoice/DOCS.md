# PodVoice · installation og daglig brug

PodVoice forbinder en Voice PE med PodConnect, Home Assistant og GPT-Live. Voice PE
ejer wake og fysisk lyd; `VoicePELink` og den fælles `ThinSession` fører samtalen til
`OpenAILiveSession`. Talk i panelet bruger samme samtalemotor med browserens mikrofon
og højttaler. Begge er v2.x full-duplex-samtaler: nyt input kan fortsætte, mens et svar
afspilles. Talk eller sendt lyd alene beviser ikke den fysiske oplevelse på Voice PE.

Udviklingsarbejdet følger `AGENTS.md` i repositoriet.

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

## Rollback af add-onen

**Supervisor-rollback med pre-update-backup** er den understøttede vej tilbage til
en tidligere PodVoice-version. Før opdatering: slå backup til i PodVoice-add-onens
opdateringsdialog, og kontrollér under **Indstillinger → System → Backups**, at
backupen er oprettet. Notér dato og PodVoice-version i backupdetaljerne. Home Assistant
opretter her en backup af add-onen og dens data; den automatiske backup pr. add-on
erstattes ved næste tilsvarende opdatering, mens manuelle backups bevares.

Ved rollback: åbn den matchende pre-update-backup under **Indstillinger → System →
Backups**, vælg gendannelse af **PodVoice-add-onen alene**, og kontrollér bagefter den
installerede version og panelets indstillinger. Gendan ikke Home Assistant Core eller
andre apps for at rulle PodVoice tilbage. Supervisor-backuppen omfatter app-version og
app-data; PodVoice læser add-onens options fra `/data/options.json`, mens panelets
indstillinger ligger separat i `/data/podvoice.json`.

`/data/podvoice.json.bak` er kun den forrige panelindstillingsfil; den gendanner hverken
Supervisor-options eller app-version. Ændr ikke image-tags eller container manuelt.
Hvis der ikke findes en matchende pre-update-backup, så stop og få en versionsspecifik
gendannelsesplan, før der ændres på installationen. Se Home Assistants dokumentation om
[backup før add-on-opdatering](https://www.home-assistant.io/blog/2025/02/05/release-20252/)
og [gendannelse af backups](https://www.home-assistant.io/common-tasks/general/).

## Kontrollér funktion

Panelets forside viser forbindelser og kapabiliteter; **Avanceret → Fejlfinding** har
forbindelses-, lydstrøm- og højttalerkontrol. En anmodet testtone eller et grønt
statusfelt beviser ikke, at samtalen høres korrekt i rummet. Hør selv første svar,
tal under et svar, prøv opfølgning, lukning og næste wake.

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

## HA-owned timers

Copy this repository's `custom_components/podvoice` directory into Home Assistant's
`config/custom_components/podvoice`. Add the endpoints to `configuration.yaml`, then
restart Home Assistant. Use the exact room key from PodVoice Settings and the Voice PE's
verified MAC address from its device information; the example MAC below is a placeholder.
The browser endpoint uses `talk` for both endpoint and identity.

```yaml
podvoice:
  endpoints:
    - endpoint: kitchen
      name: Kitchen Voice PE
      kind: voice_pe
      identity: "02:00:00:00:00:01" # Replace with your verified device MAC.
    - endpoint: talk
      name: Talk
      kind: talk
      identity: talk
```

The bridge registers its own timer endpoints and uses HA's native intent timer manager.
It does not change the ESPHome device or start stock Assist. The add-on uses its existing
authenticated HA connection; no new credential or public endpoint is needed. Timer tools
appear only after the bridge, endpoint identity and connected adapter agree.

Ask to start, list or cancel a named timer. Each timer has its own ID, including timers
with the same name. An expiry waits for the current reply/conversation to finish, then
plays a brief alarm and returns to normal wake. Ask about or cancel the finished timer
on the next wake. An add-on restart leaves HA countdowns intact; **a Home Assistant Core
restart clears native timers**. Ambiguous starts are never retried automatically. An
interrupted alarm stays recorded until actual stop is confirmed; a different Talk tab
cannot claim that the original tab stopped. Normal integration unload is refused while timers or
unacknowledged expiry receipts remain, so the sole HA expiry handler is not discarded.

Endpoint configuration is imported once into the PodVoice HA integration entry. Editing
YAML alone does not replace that entry. To change endpoints, finish/cancel and acknowledge
its timers first, remove the integration entry, update YAML, then restart HA to import it
again. Core restart clears native timers. The native bridge has been checked against
Home Assistant Core 2026.8.2.
