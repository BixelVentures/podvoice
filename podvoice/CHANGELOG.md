## 2.0.193

- Afspilleren: Et afvist køvalg bliver ikke stående som fejltekst, og køen låses ikke. Den aktuelle højttaler er aldrig låst i vælgeren. Afspil/pause-knappen blinker ikke "arbejder" ved pause.

## 2.0.192

- Musik kan igen startes fra Find musik, køen og højttalervælgeren. PodVoice har ikke længere sin egen kopi af 35 %-reglen og bruger den startlydstyrke, PodConnect angiver (rummets egen lydstyrke, højst 35 %).

## 2.0.191

- Rettelser fra Green-tjekket: Højttalervælgeren låses ikke længere kort under baggrundsopdateringer, så et tryk aldrig går tabt. Find musik er klar i baggrunden uden "Henter forslag", og forslagene er aldrig låste. Forsiden og fanerne blinker ikke. Robot- og vejrsiden er klar, når de åbnes.
- Kræver PodConnect Speakers 0.26.102 og Control 0.10.46.

## 2.0.190

- Musikafspilleren følger nu enkle regler: Afspilleren ejer højttalervalget, og radio og musik spiller altid på den valgte højttaler. At åbne Find musik eller radiosiden ændrer ikke afspilleren. Stoppet radio bliver i afspilleren i 10 min ligesom pauset musik. Højttalervælger, kø og Find musik låses aldrig, og "Højttaleren afviste handlingen" står ikke længere i afspiller eller kø. Pause/afspil, kold start og valg i køen sker roligt uden blink, og spole-slideren føles som lydstyrken.
- PodView føles mere som en app: Robot-, Tesla-, vejr- og opskriftssiderne er klar, når de åbnes, fordi indholdet hentes i baggrunden. Forsidekortene blinker ikke ved opdatering, og skærmen kan ikke længere zoomes, markeres eller trækkes ud ved et uheld.
- Robotten husker igen dine sidste rum og indstillinger, også efter en genstart. En dokket robot logges ikke længere som en fejl.
- Opskrifter fra iPhone: Del → Home Assistant gemmer opskriften og sender "Gemt", "Findes allerede" eller "Ingen opskrift fundet" som besked til telefonen. Den nye opskrift vises med det samme på iPad'en.
- Kræver PodConnect Speakers 0.26.101.

## 2.0.189

- Rettelser efter testen 13. nov. (kræver PodConnect Speakers 0.26.99 og Control 0.10.45, og HA-komponenten 0.1.24):
- Musik: Køen bliver ikke tom og flimrer ikke, når PodConnect er bagud. Afspil-knappens ventering drejer og sidder i midten. Højttalervælgeren og "Flyt" virker igen. Forsiden viser samme kilde i musikkortet og afspilleren. "Din musik", "Hør igen" og "Tid på dagen" i Find musik kan starte igen efter et skift til en anden højttaler.
- Voice PE: Stemmen kan starte musik igen via rummets PodConnect-afspiller. Samtalen lukker pænt efter svaret i stedet for at hænge et minut og blive rød. Ét svarkort pr. spørgsmål, som opdateres i stedet for at blive gentaget, og bedre plads i kortet.
- iPad som vægskærm: PodView kommer selv tilbage i fuld skærm og forbundet efter en Home Assistant-genstart, låst skærm eller netværksudfald, uden at nogen trykker.
- Robot: Knapperne bliver ikke grå, når siden åbnes. Start viser straks "Starter …" og skifter roligt til støvsugning uden hop.
- Tesla: Status står på én linje ("Vækker bilen…"), og bilens eget svar bekræftes ("Klimaet er tændt.") i stedet for "Udfald ukendt". Når Tesla-siden åbnes, hentes en frisk læsning, så ændringer fra Tesla-appen vises.
- Opskrifter fra iPhone: Upload virker hele vejen med tydelige danske svar (Gemt, Findes allerede, Ingen opskrift fundet, Forkert upload-kode), dubletter oprettes ikke, og langsomme sider giver ikke timeout i genvejen.

## 2.0.188

- PodView føles glattere på iPad og Mac, uden at noget ser anderledes ud: uret, afspilleren og højttalerne opdateres først, når du har løftet fingeren, så nye data ikke giver hak midt i et tryk. Et tryk på et kort skifter side lidt hurtigere, fordi trykmarkeringen og de bløde toninger i kanten af scroll-områderne laver mindre arbejde.

## 2.0.187

- Musik, der er startet uden for PodView (med stemmen, fra Home Assistant eller i Spotify-appen), vises nu i den samme afspiller som musik startet fra PodView, og Pause, Afspil, Næste, Forrige, spoling og lydstyrke virker straks: hvert tryk går direkte til rummets PodConnect-afspiller i Home Assistant, viser sig med det samme og venter sin tur, hvis et andet tryk er i gang. »Højttaleren er ikke bekræftet« og låste knapper forsvinder, og afviser højttaleren et tryk, står det på skærmen uden at blive gentaget. Kræver PodConnect Control med én afspiller pr. rum.

## 2.0.186

- PodView på en Frameo-ramme og andre ældre vægskærme (Chrome under 111) kører i en let tilstand: kortet markeres med det samme, du trykker (ca. 30 ms mod før ca. 1 sekund), og trykket annulleres, hvis du trækker fingeren væk. Scroll kører ca. 50 billeder i sekundet mod før ca. 14, og skift til en anden side tager under et sekund. Swipe-gestusser, bevægelse og skygger er slået fra der, så alt betjenes med knapperne. Home Assistants værktøjslinje blinker ikke længere frem, når du skifter side. iPad, Mac og nyere skærme opfører sig som før.

## 2.0.185

- Ny færdig iPhone-genvej »Opskrifter til PodView«: hent den i Opskrifter → »Tilføj opskrift-genvej til iPhone« (kun for HA-administrator), og indsæt den viste adresse og uploadkode én gang, når iPhonen spørger. Genvejen finder selv opskriftens link i det delte, og PodView siger til, når der findes en ny version af genvejen. Serveren forstår flere slags delinger og giver konkrete fejlbeskeder. Kræver HA-komponent 0.1.23 for versionsbeskeden gennem Home Assistant.

## 2.0.184

- Teslaen giver ærlig besked: ved lavt batteri står der »Lavt batteri (9 %) · Tesla afviser måske klima«, mens bilen vækkes står der »Sendt · vækker bilen…«, og hvis bilen vågner uden at gøre det, står der fx »Bilen tændte ikke klimaet · batteri 9 %« i stedet for »Udfald ukendt«. Afviser Tesla eller Home Assistant kommandoen, vises det med det samme på dansk. Samme for lås, bagagerum og sædevarme.

## 2.0.183

- Et opfølgende spørgsmål til et svarkort (fx »hvem scorede« efter en kamp) tilføjes nu som nyt afsnit på samme kort og kommer i historikken. Før blev det tabt, når modellen udfyldte ukendte felter med tom tekst. Teslaens kommandoer venter op til 45 sekunder, mens HA vækker bilen, i stedet for at vise »Udfald ukendt« efter 8 sekunder. En deling uden opskriftslink logger nu, hvilke felter der kom ind (kun navne og typer).

## 2.0.182

- Frameo-fotorammen (og enhver skærm åbnet over lokal http) kan nu styre musik, robot og timer: PodView brugte en browserfunktion, der kun findes på https, så tryk blev afvist i stilhed og viste »Udfald ukendt«. Ældre browsere (Chrome 107) får farver, flader, højder og ikoner, tryk reagerer 4–6 gange hurtigere, og køen kan rulles. Afspilleren siger »Spiller på Køkkenalrum« eller »Spiller på iPhone« i stedet for »højttaler ikke bekræftet«, en pauset sang eller stoppet station står i 10 minutter (også efter genindlæsning) og derefter »Vælg musik«, og en skærm uden adgang siger »Skærmen har ikke adgang · Tilknyt« i stedet for at gøre ingenting. Stemmen starter musik på rummets højttaler via PodViews egen vej. Op til 8 godkendte skærme pr. rum vises i Home Assistant, parringen logges, og efter en HA-genstart fornyer PodView selv forbindelsen i stedet for at vise 401. HA-komponent 0.1.22 kræves for skærmlisten.

## 2.0.181

- Vejret vises igen på Home Assistant 2026.11 (HA's nye svarformat fra vejr-scriptet), og regn vises i hele procent. Teslaens kommandoer (Lås, Lås op, klima, temperatur, sædevarme, afrimning) kan sendes, selvom HA endnu ikke kender bilens tilstand efter en genstart, og knappen viser »Sendt · venter på bilen…«, til HA melder den. PodVoice beder desuden HA om at hente bilens status efter en genstart uden at vække den. HA-komponenten er uændret (0.1.21).

## 2.0.180

- Stemmens hjemmestyring, vejret og musikkens højttalerliste virker igen på Home Assistant 2026.11. PodVoice accepterer nu HA's nye MCP-svar uden serverversion og HA's nye værktøjsnavne med kildepræfiks (fx »intent__HassTurnOn«). Kræver fortsat HA-komponent 0.1.21.

## 2.0.179

- PodVoice-komponenten i Home Assistant indlæses igen efter opdatering til HA 2026.11, så Tesla, robot, timere og administratorhandlinger virker i PodView igen (kræver HA-komponent 0.1.21). Den virker fortsat på HA 2026.8–2026.10.

## 2.0.178

- Svarkort kommer nu også, når stemmen selv slår op på nettet (som FC Barcelona-spørgsmålene), selv om søgeresultatet er langt, og vejrkortet vises ved alle vejrspørgsmål. Svarkortet står, mens hun taler, plus 30 sekunder, og rører man det, bliver det stående. Hvert trin skrives i loggen som »podview card stage=…«, så det kan følges på Home Assistant.

## 2.0.177

- Robottens Pause/Fortsæt bliver på sin plads under kommandoen, og knaprækken hopper eller tømmes ikke længere. Vejr, lys, timer, robot og musik siger »Opdateret: 07.04« eller »Ikke opdateret« i stedet for »Sidst kendt«. Afspilning vises hurtigere efter tryk (musik ca. 2,8 s i stedet for 4,5 s i prøven), køen viser ikke allerede spillede sange og henter igen efter autoplay, og radiolydstyrken låser ikke længere slider og Stop. Teslaen viser Låst straks efter HA-skift, »Låst · I dvale siden 09.44« og ladetilstande uden 0 kW (kræver HA-komponent 0.1.20). Fuld skærm genoprettes, når iPad'en vågner, opskriftslinks i delt tekst virker, stemmen forstår PodViews rumnavne, og vejrkortets korte AI-tekst vises igen (vejret regnes som aktuelt i 2 timer efter HA's opdatering, ikke 30 min).

## 2.0.176

- Svar fra en websøgning (fx fodbold) får nu et kort, mens hun taler, uden at talen bliver langsommere. En kamp vises med hold, stilling, målscorere pr. hold og dato, og fakta vises som overskrift med 2–3 nøglepunkter. Kortene gentager aldrig hendes sætninger, og uden grundlag vises intet kort. Vejrkortet viser den dag, der spørges om (fx »i morgen« eller »på fredag«), i stedet for vejret lige nu. En opfølgning bliver et nyt afsnit på samme kort, og historikken viser ét kort pr. emne. Kortet står 60 sekunder efter samtalen, bliver stående, hvis man rører det, og derefter vender skærmen tilbage til den forrige visning. Svar-knappen viser »Voice PE offline« i gråt, når højttaleren mangler forbindelse.

## 2.0.175

- Man kan spole i sangen igen, og »Kør til basen« lige efter Pause afvises ikke længere som optaget. Under rengøring står der fx »Robotten er i Entré« (kun når kortet netop er genindlæst) og »I basen«, når den lader. Teslaen viser »I dvale · 4 t« og »Opdateret: 17.40« i stedet for »Sidst kendt«, og dvalen huskes efter genstart (kræver HA-komponent 0.1.19). Radioteksten nævner ikke længere Home Assistant.

## 2.0.174

- Robottens Pause/Fortsæt gråes ikke under eget tryk og sendes hurtigere, og et afvist eller ubekræftet køvalg viser nu en besked i stedet for blot at forsvinde.

## 2.0.173

- Robotten viser det rigtige rumnavn under rengøring, Start virker efter lang tomgang uden genindlæsning, og valgte rum og indstillinger overlever en genindlæsning.

## 2.0.172

- Hurtige faneskift i Find musik viser ikke længere »Kunne ikke hente forslag«; den nye fane venter på den forrige hentning. Rækker uden cover har igen den dokumenterede afstand om musiksymbolet.

## 2.0.171

- Bevar kvitteringen for en igangværende robotbasehandling, hvis Home Assistant kortvarigt ikke kan læses.

## 2.0.170

- Bevar kendte rækker, mens Spotify gør den næste kø klar, og vælg præcis den forekomst, du trykker på.
- Skjul gamle fremdriftsmålinger fra før robottens aktuelle tur. En ny måling på 0 % vises fortsat.

## 2.0.169

- Hent højttalerlisten, mens Vibe indlæses, lad Din musik vente på samme Vibe-opslag, og skjul robottens tidligere rum under opstart, når Home Assistant har bekræftet, at det stammer fra før turen.

## 2.0.168

- Skjul robottens tidligere rum, når Home Assistant bekræfter, at rumværdien stammer fra før den aktive tur.
- Lad Annuller fortsætte efter en konkurrerende timerlæsning, når samme ejer og adgang er bekræftet.

## 2.0.167

- Vis om radioens Stop ikke blev sendt, blev afvist eller har ukendt udfald. Vis en konkret besked, hvis en valgt playliste ikke kan bekræftes ved fornyelse.

## 2.0.166

- Bevar viste køvalg og valgte musikforslag gennem baggrundsfornyelse, fasthold robotens returbekræftelse under midlertidige læsefejl, og tilføj afgrænset fejldiagnostik for mistet musikbetjening og afviste robottryk.

## 2.0.165

- Bevar betjening og eksplicitte valg under opdateringer på musik, radio, robot, lys og timere; behold korrekte mål ved ventende handlinger og vis resten af opskriftskataloget ved en ugyldig række.

## 2.0.164

- Bevar opskriftskatalogets rulleposition, når du går tilbage fra en opskrift.
- Bevar robotkladden for hver rengøringstype, når panelet fornyes.

## 2.0.163

- Vis grafik fra den eksisterende billedcache eller en lokal illustration, når Spotify-omslaget mangler på en personlig playliste.

## 2.0.162

- Gør den senest valgte playliste tilgængelig igen, når musikkilden har bekræftet, at der ikke længere afspilles.

## 2.0.161

- Vis +1 og −1 på en aktiv timer, når Home Assistant tilbyder justering.
- Bevar robottens åbne bekræftelse ved fornyelse for samme robot og handling.

## 2.0.160

- Forny radiostatus før udløb, bevar senest kendt musik ved et forsinket svar, og vis én Base-handling under robotpause.

## 2.0.159

- Base forbliver tilgængelig, når robotvisningen automatisk gendanner den seneste rengøring.

## 2.0.158

- PodView keeps music choices usable when another screen opens or refreshes its suggestions.

## 2.0.157

- Bevar musikbetjening ved listeudvidelse, forny højttalerdata ved udløb, bevar robottens åbne Base under fornyelse, og vis den faktisk indlæste PodView-version.

## 2.0.156

- Bevar covernes plads ved første indlæsning i Find musik. Tid på dagen bruger samme billedplacering under loading og ved manglende cover.

## 2.0.155

- Bevar opskriftskatalogets scrollposition ved turen via forsiden, også mens nye katalogdata indlæses.

## 2.0.154

- Vis forventet færdigopladning fra Teslas oprindelige ladeobservation; manglende eller for gammel sluttid skjules alene, og blandede HA-/PodVoice-versioner bevarer øvrige bildata.

## 2.0.153

- Bevar robotrum og rengøringsvalg synligt under netudfald; genvalidér betjeningen automatisk uden genindlæsning eller automatisk Start.

- Opdatér opskrifters åbne uploadhistorik uden at miste fokus; Prøv igen genbruger samme læsesløjfe og bevarer den godkendte visning.

## 2.0.152

- Tesla-handlinger viser neutral fremdrift frem til frisk HA-status; uafhængige funktioner forbliver tilgængelige efter kvittering, og samtidige fejl bevares.

## 2.0.151

- Keep robot cleaning choices during temporary loss of current water status and require a fresh observation before Start.

## 2.0.150

- Restore approved music discovery and stable controls across refresh, expiry and room changes; preserve robot drafts and feedback, correct weather freshness and answer history, explain radio configuration errors, and restore balanced Tesla confirmation controls.

## 2.0.149

- Preserve admitted robot Start receipts through transient stale observations and keep confirmed speaker rows stable during roster refresh. Extend external-output, cancelled-start and recipe-completion software evidence.

## 2.0.148

- Open authorized weather details after an initial source failure, recover in place, and preserve explicit access denial. Verify decoded local cover fallback without image generation.

## 2.0.147

- Keep station choices usable during radio transitions, recover interrupted Find Music tabs, preserve loading geometry and same-item covers, and retain historical answer reading position when new answers arrive.

## 2.0.146

- Keep the newest scoped HA Tesla status per field with its real observation time, preserve omitted known fields, and require corroborated current trunk direction before offering or sending a command. Requires HA component 0.1.17 for trunk controls; opening PodView does not wake the car.

## 2.0.145

- Keep explicit queue choices through in-flight commands and refresh, including fresh surviving rows when newly exposed metadata is missing. Exact occurrence continuity is supplied by Speakers 0.26.68; no URI/index guessing or replay after unknown outcomes. A new deliberate choice can recover in the same view without waiting for a poll or reloading.
- Open the existing active recipe directly from its home widget without changing its visual layout.

## 2.0.144

- Seek on the existing player timeline while playing or paused, retain the chosen position during refresh, and keep each seek bound to the current track and output. Requires PodConnect Control 0.10.37; older Control keeps existing controls.

## 2.0.143

- Music controls never grey out while a command settles: pause/play flips at once, a tap during a running command is queued, and an unknown outcome no longer locks the controls. Requires PodConnect Control 0.10.35.
- Simpler development process and CI; public README.

## 2.0.142

- Show the selected song or playlist immediately and retain its cover while the player waits for the matching playback observation.

## 2.0.141

- Distinguish an unavailable queue read, an invalid response and the first failed comparison in rejected queue selection receipts. Keep existing checks and playback behavior.

## 2.0.140

- Keep an admitted floor selector reachable when the active robot map has no configured HA areas, including a single offered alternate.
- Retain the existing Rooms and Cleaning options composition for partial setups, with explicit owner-admitted settings and honest absent room/Start capabilities.
- Show the verified current floor without inventing a current-floor action; preserve expiry, offline, pending and unknown-outcome guards.
- Keep missing-cover music-note artwork neutral instead of tinting the whole player gray; retain real cover and radio palette behavior.
- Record the short UX request delivery agreement. Actual robot, music and device acceptance remain separately open.

## 2.0.139

- Preserve the confirmed speaker destination across healthy, semantically unchanged service discovery, including idle, while retaining exact current owner checks for every executable read and action.
- Keep existing UNKNOWN fences and reject old offers and real owner or contract changes; remembered destination never grants playback authority.
- Record bounded queue request/receipt outcomes, execution stage and possible-send status in the existing owner log without playback content or credentials.
- Preserve the approved UI and native companion 0.1.16. The original unobserved queue receipt and actual device acceptance remain separately tracked.

## 2.0.138

- Keep native content execution identities separate from speaker alias identities when selecting music and confirming output changes.
- Confirm the captured destination alias and registry before publishing the new room, preserving native command, account, route and freshness guards.
- Prevent a valid output change from being rejected solely because its independent content and alias identities differ; retain uncertainty fences for actual owner changes.
- Preserve the approved UI and native companion 0.1.16. Intermittent playback-read and actual device acceptance remain separately tracked.

## 2.0.137

- Keep the configured speaker available as a return destination after moving an existing session to another native output on the same Spotify Connect device.
- Preserve existing destination permissions, fresh actual-output checks, native MOVE receipts and the approved speaker-picker UI.
- Native companion remains 0.1.16; unrelated music-read, queue and device acceptance remain separately tracked.

## 2.0.136

- Import valid recipe microdata when a source has no usable recipe JSON-LD, through the existing importer and storage flow.
- Preserve JSON-LD priority, source validation, rejection history and the approved recipe UI.
- Native music-read diagnosis and physical iPhone/device acceptance remain open.

## 2.0.135

- Adjust active and paused timers through the same native Home Assistant timer owner, with revision checks and no automatic effect replay.
- Preserve the original timer and signed adjustments in the existing journal; cancellation cannot resurrect an earlier pending adjustment.
- Native timer adjustment requires Home Assistant component 0.1.16 loaded and its v2 capability discovered; existing basic controls remain available with older components.
- Keep connection feedback in the existing header and screen settings without covering weather or action feedback; preserve Retry focus and geometry.
- Keep the Ro player clear of the active timer/robot rail on portrait displays.
- Native music-read diagnosis and physical acceptance remain open.

## 2.0.134

- Retain dated weather facts through bounded source failures and reload, and clear expired current facts consistently across detail, Home and photo views.
- Preserve original retrieval timestamps and existing authorization checks; cached weather does not grant action rights.
- Synchronize canonical UI sources safely before asset generation and include the existing weather/slow-start journeys in the browser check.
- Native music-read diagnosis and physical acceptance remain open.

## 2.0.133

- Preserve pending music choices and current controls while playback and queue observations settle; keep refresh feedback local to the affected action.
- Restore the approved ongoing-recipe row across category changes and hydrate the existing recipe widget without changing its design.
- Keep an admitted robot start alive through slow settings, preserve exact-once dispatch, and align the approved busy-state layout.
- Restore missing fog and severe-weather icons and add content-free playback adapter failure categories.
- Underlying native music-read failures and physical acceptance remain open; no automatic replay is introduced.

## 2.0.132

- Improve the approved touch music cards and preserve a single text layer during recommendation refresh.
- Restore local cooking progress, checked ingredients and disclosure state after reload.
- Preserve unsent robot room selections across expired setup cleanup and avoid shortening unrelated controls for unused base actions.

## 2.0.131

- Preserve a pending music choice through ordinary Home Assistant snapshot updates; require fresh validated playback authority before starting.
- Show a readable, scoped failure when an explicit playlist choice receives read-only recommendations.
- Correlate renewal response and rejection through the existing bounded diagnostics and Home Assistant logs without retrying commands.

## 2.0.130

- Preserve bounded action diagnostics under polling pressure and trace music selection through the existing native receipt.
- Retain existing touch controls and the approved component library; add cold-start and natural night-entry browser coverage.

## 2.0.129

- Update Home Assistant observations through the existing live connection while preserving touch navigation, focus and content.
- Preserve unsent robot room selections and independent cleaning-mode choices through expired offers and reopening.
- Revalidate active robot settings against their relevant dependencies and observe accepted changes in the open detail.
- Keep light and vehicle observations current across commands, in-flight reads and unrelated voice activity.
- Correlate control and recipe outcomes through existing diagnostics without giving telemetry command authority.
- Keep the existing Home Assistant entry and canonical UI components.

## 2.0.128

- Renew robot controls earlier and preserve eligible room selections on reopening.
- Record bounded server stage and rejection reasons when robot control renewal cannot be restored.
- Import supported recipe links automatically and retain upload status/history (HA companion 0.1.15).
- Keep Find musik loading rows aligned with their loaded layout and admit verified Spotify playlist cover hosts.
- Keep the first connection render safe before radio observations arrive.

## 2.0.127

- Preserve independently observed Tesla state and timestamps across partial Home Assistant updates (HA component 0.1.14).

## 2.0.126

- Restore the approved recipe and Find musik layouts, illustration assets, disclosures and cooking steps.
- Apply the agreed climate dependency to Tesla seat heating and defrost at display, prepare and send.
- Read newer cabin temperature from the configured Home Assistant sensor without waking the vehicle (HA component 0.1.13).

## 2.0.125

- Preserve robot control settings across renewal when a time setting is present.

## 2.0.124

- Accept private recipe links and return review decisions to the iPhone shortcut.

## 2.0.123

- Support a dedicated PodConnect transport credential for radio.

Older entries are in the Git history.
