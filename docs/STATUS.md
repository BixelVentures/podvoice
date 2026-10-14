# Aktuel status · 15. oktober 2026

**Lead:** root. Nattens softwareleverance er installeret; samlet fysisk prøve afventer
brugeren. Det brede produktmål og epics er ikke fysisk accepteret.

## Installeret baseline · 2.0.27

- HA Green viser **2.0.27 / Kører**. Normal opdatering direkte fra 2.0.25 med
  sikkerhedskopi valgt; én add-on-installation, ingen yderligere Core-genstart.
- Frisk startup kl. **00.38.30 dansk tid** matcher kilde
  `669e739a164849c33905d7948b880270d531c705` og artifact
  `rootfs-v1:c5855fa18a9f01ef9c7dcfbe0498b8cb64c0a95cbf36ff911fea60efb02559fb`.
  Engine GPT-Live; prompt `v18:e7623a95b756c56c4c78256f917a21bb5aac644e3937ee98ed6b3063582708d8`;
  aktuel tool-schema `429315127b519ee4ffff6d2dbb9adb9b5a1cfe10bb0972a6b838be093dfc4888`.
- Voice PE er forbundet, firmwarekontrakt OK og valgt wake-model bekræftet af firmware.
  Firmware: `podvoice_build_113114_livetimeroutput1`, ESPHome 2026.6.2.
  Recovery-ACK uden aktuel token blev korrekt afvist; systemet afventer fysisk wake-bevis.
- Frisk UI viser **v2.0.27 / status live**; Hjemmestyring og PodConnect verificeret.
  ChatGPT står standby/ikke prøvet og Voice PE ikke fysisk verificeret. Dette er
  forbindelses-/konfigurationsbevis, ikke hørt lyd, wake eller lifecycleaccept.
- [Udgivelse 2.0.27](https://github.com/BixelVentures/podvoice/releases/tag/2.0.27)
  og tag peger præcist på `669e739a`. Publiceret ARM64-digest:
  `sha256:da45e4371ad08a2937e50f1d3d3a0b492c94574bad73d920e04d39eece3fc21a`.
  [Main-CI/publisher 38647659658](https://github.com/BixelVentures/podvoice/actions/runs/38647659658)
  bestod scope, unit, rest, browser og faktisk image-build/publicering.

## Leveret i nat · afgrænset #156 og hurtigere CI

De to dokumenteret ubrugte Config-spejle `engine/live_alpha` er fjernet. Fire pensionerede
classic-moduler (1.584 linjer) udelades fra installationspakken; kilder og historiske
regressioner bevares i repoet. ARM-builden importerede faktisk entrypoint, Thin,
GPT-Live, Talk og de konkrete lazy trace/analyse/eval-moduler fra den pakkede kode.
Gemte settings, migration, reply_streaming og én native/Talk/Thin-ejer er bevaret.

Hele merged PodView 2.0.26 (`7efe8cb`, PR #161) indgår, inklusive Supervisor-only
visual/control-policy og UI-assets. Den anden chats ufærdige musik-/robotarbejde og
20-kaldspilot er ikke aktiveret eller omskrevet af dette forløb. Native timerintegration
0.1.1 / PodConnect Control 0.10.9 og den anden operatørs tidligere Core-genstart er
bevaret. Efter den genstart blev r0 og Talk læst: ok, tomme timer-/alarmkøer og
recent-felt til stede. Friske 27-logs viser timer_status og attention HTTP 200.

Produkt-CI bruger nu to isolerede GitHub-runners til unit og resten af default discovery.
I den sammenlignelige måling faldt pytest-kritisk vej fra 555,6 til 266,4 sekunder;
CI 38643540645 bestod på 299 sekunder. Ingen tests eller produkt-timeouts blev fjernet.
Efter PodView26-rebase var inventory eksakt 5.149 = 3.923 unit + 1.226 rest; recovery
føjede tre browseroprydningsregressioner til. Målingen er én observation, ikke garanti
for senere kø-, runner- eller buildtid. #156's bredere oprydningsmål er fortsat åbne.

## Afsluttet beslutning · browseroprydningens stoplinje

**Observeret:** PR #160 var grøn, men main-CI 38645991683 på `24c7972` fejlede i
settings_dirty-oprydningen: `orphan browser owner is unverifiable; no kill authorized`.
Worker og register bestod, og sidste kontrol fandt ingen levende/ukendt gruppe.
En tidligere identitetsfejl blev bevaret trods senere fravær. Den gamle fejltekst
skelnede ikke forsvundet leder fra ændret ejer; præcis historisk transient er ukendt.

**Kæde og ændring:** registreret launch → UI/SDK-close → presence → frisk identitet →
eventuelt signal → bounded join → endeligt fravær. Kun manglende leder giver nu
MissingBrowserOwner: intet browsersignal, og kun verificeret fravær af alle grupper
kan give PASS. Ændret/genbrugt identitet er fortsat hård fejl selv ved senere fravær;
vedvarende lederløs gruppe, ukendt presence, worker-/register-/cancellation-fejl fejler.
Ingen runtime-, prompt-, lyd-, firmware-, timeout- eller PodView-tuning.

**Faktiske kontroller:** hele eksisterende browser-runner-modul bestod; nye kausale
regressioner dækker forsvundet leder → fravær, vedvarende lederløs og ændret birth →
fravær. Formatter/lint, scope og diffcheck PASS. Uafhængigt adversarial SOURCE review
night27_freeze GO, ingen P0–P2. [PR #162](https://github.com/BixelVentures/podvoice/pull/162)
head `59d59b45` bestod CI 38646973888; merged main `669e739a` har samme tree
`3250d40534784cace9aa5d8e53065b7c7cc12380` og bestod ny CI/publisher 38647659658.
Ingen manuel genkørsel af den fejlede kandidat. Rollback-grænse er toolingdiffet;
installeret 27 arver ingen fysisk accept fra tidligere versioner.

Den fulde før-/efterbeslutning, nabokæde, ikke-mål, source-hashes og tidligere målinger
bevares i [STATUS på releasecommitten](https://github.com/BixelVentures/podvoice/blob/669e739a164849c33905d7948b880270d531c705/docs/STATUS.md).
#157 er afsluttet og udgivet som
[dev-tools-2026.10.14](https://github.com/BixelVentures/podvoice/releases/tag/dev-tools-2026.10.14);
agentindgang og de ti hastighedsregler gælder fortsat. Ældre produktforløb er i
[historisk statusarkiv](archive/STATUS-2026-10-14-pre-157.md).

## Én samlet fysisk prøve · 15. oktober · cirka 5–10 minutter

Før og efter serien bindes version/git/artifact/firmware til baseline ovenfor. Ingen
opdatering mellem punkterne. Begge faktisk valgte HomePods skal være tilgængelige.

1. Start Spotify på mobilen, vælg første HomePod; bekræft rigtig lyd og hurtig start.
2. Under musikken: “Hey Chat, hvad er klokken?” → helt svar → “Og hvilken ugedag
   er det?” → helt svar → “Tak, det var det”. Notér fyld/“Modtaget”, farvel,
   gul/rød ventetid, dæmpning og genoptaget musik.
3. Efter lukning: nyt wake → “Flyt musikken til [andet faktisk tilgængeligt rum]”.
   Bekræft lyd fra målhøjttaleren; afslut samtalen.
4. Nyt wake → “Sæt en timer på 10 sekunder” → afslut → hør alarmen. Sig “Stop”.
   Hvis stop fejler: ét tryk på pucken og registrér voice-Stop som FAIL. Nyt wake
   og et kort spørgsmål beviser, om den kan bruges igen.

Lead korrelerer eksisterende logs. Serien er triage/accept af disse funktioner;
den er ikke 10/10 lifecycle eller fysisk p50-latensmåling.

## Åbent efter softwareleverancen

- **#153:** tidligere streng stilhedsprøve FAIL på ét sekund uidentificeret provider-PCM
  før timerresultatet. Indhold/årsag og fysisk hørbarhed er ukendt. Ingen ny sikker
  årsagsrettelse blev fundet; prompt/lyd blev ikke gættet om. “Alt fyld fjernet” er ikke bevist.
- **#118 / #110:** musikflytning samt timeralarm/Stop/næste wake afventer serien.
- **#124 / #103 / #107:** uafbrudt opfølgning, modelsemantisk lukning, fysisk farvel,
  lukketid og næste wake afventer; frisk golden chain/10+10 og latencygates er ikke bestået.
- **#156:** to oprydningsbidder leveret; fuld refactoring og færre berøringspunkter mangler.
- Fysisk 27-svartid er **umålt**. Changelog27's formulering om uændret fysisk svartid
  er en kildeafgrænsning, ikke en måling; den publicerede release-note gør dette eksplicit.

Næste produktarbejde vælges ud fra den samlede fysiske serie. Ingen epic lukkes på CI alene.
