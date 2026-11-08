# PodView — brugerhistorier (acceptgrundlag)

Hver linje er én historie: **Givet** situation → **Når** jeg gør noget → **Så** sker der dette.
Skærmrespons måles fra brugerens tryk; enhedseffekt måles separat fra samme tryk. Eksterne ændringer
måles fra ændringen i kildeappen, ikke først fra modtaget HA-event. Hver historie skal have en automatisk browsertest
(`tests/browser/*_actual_e2e.cjs`), der tjekker præcis historien og tiden.
**Bevis og rester:** Status beskriver netop historiens kontrollerede forløb, ikke blot at en test findes.
"Delvist bevist" angiver den afprøvede handling, overgang og observerede resultat samt det, der mangler.
"Ikke historiebevist — områdetest: X" er kun en testhenvisning; historiens udfald og tidsmål er ikke bevist.
"Ikke dokumenteret" betyder manglende konkret evidens, ikke nødvendigvis en dokumenteret produktfejl.
En historie er først fuldt bevist, når dens aftalte forløb, relevante fejl/recovery og tidsmål er kontrolleret.
Angiv kilde/kandidat og eksisterende test eller artefakt ved nye resultater; navngiv simulerede ejerled.
Browser-, service- og fysisk bevis holdes adskilt. Publicering, installation og testantal er ikke brugeraccept.
Der sættes ikke en confidence-procent på en historie uden et dokumenteret beregningsgrundlag.
Ejeren (produktdesigneren) godkender teksten; agenten skriver testene.
Udvidelsen 7. november samler tidligere brugerfeedback til fælles gennemgang. Nye rækker er krav,
ikke implementerings- eller testresultater. Eksisterende delvise resultater bevares med deres begrænsninger.
F3 og H2–H3 er Claudes eksisterende forslag; konkret søge-/konto-UI skal afklares mod godkendt design.
Daily Mix er valgfri. En historie giver ikke tilladelse til at opfinde nyt layout eller enhedsfunktioner.

## Fælles tilstande og overgangsregler

| Tilstand | Forventet adfærd |
|---|---|
| Første åbning, ingen data | Stabil plads til det godkendte indhold; neutral loading. Ingen opdigtede værdier eller tomme kø-rækker. |
| Kendte data, opdatering i baggrunden | Bevar indhold, covers, scroll, valg og åbne accordions; ingen blink eller midlertidig låsning. |
| Eget tryk afventer svar | Vis valget straks. Skeln brugerens ønskede tilstand fra bekræftet effekt; ingen global ventelås. |
| Bekræftet effekt | Afstem med den autoritative kilde uden at gammelt svar ruller et nyere valg tilbage. |
| Afvist eller fejlet handling | Kort konkret feedback; bevar seneste bekræftede data og mulighed for et nyt relevant tryk. |
| Ukendt udfald / timeout | Ingen automatisk gentagelse. Et nyt eksplicit tryk er en ny handling; almindelig opdatering fortsætter. |
| Forbindelsen mistes | Bevar sidst kendte data med tidspunkt; forbind automatisk igen. Foregiv ikke succes eller gem offline-tryk til senere afvikling. |
| Kilden bekræfter tomt indhold | Vis den relevante tomme tilstand; timeout, manglende felt og transportfejl er ikke en tom liste. |
| Reel manglende adgang eller funktion | Forklar konkret hvorfor netop handlingen er utilgængelig. Baggrundsrefresh er ikke manglende adgang. |
| # | Historie | Bevis og rester |
|---|---|---|
| G1 | Jeg åbner PodView i HA på Mac eller iPad → eksisterende HA-login giver den aftalte betjening uden ekstra skærmregistrering eller manuelt refresh | Ikke dokumenteret |
| G2 | iPad går i dvale, appen sættes i baggrunden eller nettet forsvinder → ved genåbning gendannes forbindelse og aktuelle data automatisk, uden at miste lokale valg | Delvist bevist — recipe: rigtig lokal browser offline→online genforbinder automatisk med nyere HA-ingress-læsning; samme host, opskrift, trin 2/7, ingrediensvalg 1/11, accordion og scroll bevares uden reload, tilmelding eller produktkommandoer. Ægte iPad-dvale/baggrund er ikke prøvet |
| G3 | Jeg bruger »gendan funktioner« → forbindelsen genoprettes uden at nulstille valg, starte musik eller gentage tidligere handlinger | Ikke dokumenteret |
| G4 | Jeg skifter side og vender tilbage under opdatering → indhold og placering bevares; ingen skeleton/empty-state-flash | Ikke dokumenteret |
| G5 | Et ældre svar ankommer efter et nyere svar eller efter skift af konto/output → det overskriver ikke nyere tilstand og sender ingen handling til det gamle mål | Ikke dokumenteret |
| G6 | UI sammenlignes i bibliotek, produkt, Mac og HA-appens iPad-webview → samme godkendte komponenter, layout, fokus, touchmål og tilstande; tastaturfokus bevares | Ikke dokumenteret. Godkendt reference mangler konkret link/revision for fælles bibliotek/produkt på Mac og HA-appens iPad-webview; pixelmatch er åbent. |

Ingen lydprøver mellem 18–08 Europe/Copenhagen; heller ingen installation/genstart, der kan genoptage lyd.
Softwareprøver bruger isolerede adaptere uden fysiske sideeffekter. Efter tilladte lydprøver stoppes testmusikken.


## Afspiller

| # | Historie | Bevis og rester |
|---|---|---|
| A1 | Musik spiller → jeg trykker pause → knappen viser "Fortsæt" < 100 ms, musikken stopper < 1 s, knappen bliver aldrig grå | Delvist bevist — music: ægte browsertryk → knap < 100 ms (målt 7,7–15,8 ms), ingen grå knap under forsinket svar/refresh; fysisk stoptid ikke målt |
| A2 | Musik er sat på pause → jeg trykker afspil → samme som A1 omvendt | Ikke historiebevist — områdetest: music |
| A3 | Musik spiller → jeg trykker næste 3 gange hurtigt → der springes 3 sange frem, skærmen viser den nye sang < 1,5 s efter sidste tryk | Delvist bevist — music: tre hurtige browsertryk giver tre simulerede ejerkommandoer, titel efter sidste tryk 695 ms; fysisk afspilning ikke målt |
| A4 | Jeg trækker i lydstyrken → slideren følger fingeren uden at hoppe tilbage, lyden ændres < 1 s | Ikke historiebevist — områdetest: music |
| A5 | Jeg trækker i tidslinjen → sangen spoler, tiden springer ikke tilbage | Delvist bevist — MUSIC_SEEK_TEST: faktisk browsertræk → Python-broker → simuleret ejer; spoling under afspilning/pause, fastholdt position under refresh og UNKNOWN uden gensendelse. Control 0.10.37 og PodVoice 2.0.144 publiceret, ikke installeret; poll-race mellem tilbud og frisk læsning er rettet med én afgrænset læseafstemning og kausal regression. Rigtig Spotify/fysisk effekt ikke prøvet |
| A6 | Nogen ændrer musikken fra Spotify-appen → skærmen viser det < 1,5 s | Delvist bevist — music_push måler ~30 ms efter HA-hændelse; hele < 1,5 s fra Spotify er ikke bevist med 3 s polling |
| A7 | Netværket falder ud og kommer igen → sidst kendte sang bliver stående, knapperne virker igen uden genindlæsning | Delvist bevist — music: mistet accepteret pause-svar efterfulgt af browser-offline; genforbindelse læser simuleret ejer igen med samme sang/output og faktisk pausetilstand uden gensendelse. Nye eksplicitte fortsæt/pause-tryk efter samme genforbindelse når den simulerede ejer præcis én gang hver uden reload; fysisk effekt ikke prøvet |
| A8 | Jeg starter musik i Spotify på hjemmets højttaler → PodView viser titel, cover og output og kan pause/fortsætte uden først at starte musikken selv | Delvist bevist — music_push: ny browser modtager simuleret ekstern start, viser sang/Køkkenalrum og sender præcis én pause og fortsæt via Python-broker uden lokal start; rigtig Spotify, cover og fysisk effekt ikke prøvet |
| A9 | Jeg trykker pause, fortsæt og pause under et langsomt svar → trykkene håndteres i rækkefølge, sidste intention respekteres, ingen knap låses af polling | Delvist bevist — music: tre browsertryk giver pause/resume/pause hos simuleret ejer, korrekt sidste label, ingen disabled-blink; fysisk lyd ikke prøvet |
| A10 | Musik har spillet i 10 minutter med løbende refresh → pause, næste og lydstyrke virker stadig; ingen udløbet kontroladgang | Delvist bevist — MUSIC_LONG_SESSION: 600 s reel tid, 263 simulerede ejerlæsninger, ingen automatiske effekter; pause/næste/volumen/fortsæt når ejer én gang både efter ventetid og luk/genåbn browser. Rigtig Spotify og fysisk lyd ikke prøvet |
| A11 | En start fejler eller ender ukendt → skærmen hænger ikke permanent på det ønskede nummer og hævder ikke bekræftet afspilning; ny eksplicit handling er mulig | Delvist bevist — collection-selection: direkte UNKNOWN, korreleret UNKNOWN efter accept og svar under disconnect tillader nyt eksplicit valg med ny kandidat/opgave/request; gammel effekt gensendes ikke passivt. Browser med mistet accepteret svar prøvet; fysisk effekt ikke prøvet |
| A12 | Stemme starter musik → PodView viser samme konto/output; jeg vælger i køen og pauser med touch → hele forløbet styrer samme session | Delvist bevist — test_pod_system_music_journey: rigtig ToolRouter-stemmevalghandling og godkendelse → uafhængig afspilningslæsning → HTTP-valg af præcis anden køforekomst → HTTP-endpointet for touch-pause → separat bekræftet observation. Samme konto, target, native rum, HomePod og owner epoch gennem alle tre handlinger; sekvens 1/2/3. Gentagne kø-/pause-request returnerer samme kvittering uden ekstra effekt. HA/PodConnect er stateful inert adapter; fælles native session-incarnation er ikke bevist. Browserbinding har separat evidens; Voice PE, rigtig Spotify og fysisk lyd er ikke prøvet |
| A13 | Pause/fortsæt, næste/forrige og volumenkontrol bruges efter adgangsfornyelse → ingen venten på »observeret musik« før visuel feedback; korrekt effekt følger de respektive tidsmål | Ikke dokumenteret |
| A14 | En musikstart afbrydes midt i klargøring → gammel session ryddes korrekt op, og en senere eksplicit start kan gennemføres uden at genstarte HA | Delvist bevist — PodConnect PR112 officiel HA-framework-CI: samme Control-ejer annullerer præcis det holdte tilbud, afviser gammel commit og accepterer et nyt eksplicit nummer med frisk sekvens/tilbud én gang; identisk kvitteringsopslag gentager ikke commit. PodVoice-cancel og Speakers-terminal/FIFO har separate regressioner; samlet native oprydning og fysisk afspilning er ikke bevist af HA-testens inerte Speakers |

## Kø

| # | Historie | Bevis og rester |
|---|---|---|
| K1 | Jeg åbner afspilleren → kommende sange vises straks (kendte) og opdateres i baggrunden; aldrig tom liste mens den henter | Delvist bevist — enhedstest: køen hentes ved sangskift på alle sider og vises som klar, når afspilleren åbnes; tid i browser ikke målt; music_selection har separat simuleret køkilde |
| K2 | Sangen skifter → køen rykker op uden at listen blinker | Delvist bevist — QUEUE_PERSISTENCE_TEST: faktisk browser/simuleret ejer; fixture med bevarede opaque forekomst-ID’er flytter rækker frem med samme DOM-række, mindst to synlige kommende rækker i 20 overgangsframes. Native ID-kontinuitet efter valg er kausalt testet og publiceret i Speakers 0.26.68; automatisk Spotify-sangskift og fysisk effekt ikke prøvet |
| K3 | Jeg trykker på en sang i køen → den spiller < 1,5 s | Delvist bevist — music_selection vælger præcis anden forekomst via rigtig Python-broker og simuleret ejer, også efter uvedkommende stemmesnapshot; tidsmål/fysisk effekt ikke målt |
| K4 | Auto-fortsæt spiller videre → vis kommende sange, når kilden leverer dem; opfind ikke fremtidige sange og forveksl ikke manglende kødata med stoppet musik | Ikke dokumenteret |
| K5 | Jeg vælger en kø-række → kun denne række viser spinner; køen forsvinder ikke under start, sangskift eller fejlet opdatering | Delvist bevist — faktisk browser med inert køejer: kun valgt række spinner; kø bevares under POST, sangskift og læsefejl. Tre eksplicitte valg før/efter accept og med nyt metadata-tomt køelement udføres via friske opgaver og præcis forekomst. UNKNOWN afslutter spinner og annullerer ventende valg; et nyt bevidst tryk virker i samme visning med frisk læsning/opgave, også uden nyt poll og uden gensendelse af gamle valg. Native kontinuitetsrettelse er testet/reviewet og publiceret i Speakers 0.26.68 til begge arkitekturer, ikke installeret; fysisk afspilning ikke prøvet |
| K6 | Køen indeholder samme sang flere gange → valg rammer den valgte forekomst; et sent svar fra forrige session erstatter ikke den aktuelle kø | Ikke dokumenteret |
| K7 | Jeg forlader køen og åbner den igen under samme afspilning → kendt kø genbruges og opdateres i baggrunden; refresh, tomt svar og fejl behandles forskelligt | Delvist bevist — QUEUE_PERSISTENCE_TEST: luk/genåbn samme kø bevarer kendte rækker under forsinket læsning; faktisk simuleret 503 bevarer rækker med fejlbesked, autoritativ tom kø viser kun aktuelt nummer og tomtekst. Ingen fysisk prøve |

## Find musik

| # | Historie | Bevis og rester |
|---|---|---|
| F1 | Jeg åbner Find musik → forslag (Tid på dagen/Vibe/Din musik/Hør igen) vises < 300 ms fra sidst kendte, uden spinner | Ikke historiebevist — områdetest: music_selection |
| F2 | Jeg trykker afspil på et forslag → afspilleren viser valget med det samme og musikken starter < 3 s | Ikke historiebevist — områdetest: music_selection |
| F3 | Jeg søger efter en kunstner, sang eller playliste → resultater vises mens jeg skriver | Ikke dokumenteret (funktion mangler) |
| F4 | Jeg trykker "Andre forslag" → nye forslag uden at siden hopper | Ikke historiebevist — områdetest: music_selection |
| F5 | Første åbning og skift mellem alle fire faner → loading matcher slutlayoutets plads; kendt indhold bliver stående uden hop, komprimerede rækker eller flash | Delvist bevist — music_selection: fem loading-rækker matcher fem første Hør igen-/konto-playlister; faktisk browser måler samme række-/covergeometri. Afbrudt første indlæsning genoptages ved tilbagevenden, kendt anden fane bevares. Enhedstest afviser sent svar fra gammel request. Øvrige faners fulde visuelle accept er åben |
| F6 | Din musik og Hør igen vises → større covers, læsbar tekst, afstande og udvidelse af lister matcher den godkendte lokale visning | Ikke dokumenteret. Godkendt reference mangler konkret link/revision for Din musik/Hør igen med større covers og udvidede lister; pixelmatch er åbent. |
| F7 | Tid på dagen vises morgen, eftermiddag og aften → tidspunktet påvirker hvilke playlister der vælges, også uden AI-valg; ikke blot sorteringen | Delvist bevist — inert integration: kl. 7/14/20 uden AI giver tre forskellige sæt af faktiske kilde-URI’er, ikke kun rækkefølge. Modelkontrakt sender alle døgnperioder; morgen/aften med simuleret AI-valg prøvet. Rigtig AI/Spotify ikke prøvet |
| F8 | Tid på dagen åbnes → hovedkort og to mindre kort har den godkendte komposition; Vibe bevarer godkendt titel-/fanehierarki | Ikke dokumenteret. Godkendt reference mangler konkret link/revision for Tid på dagens tre kort og Vibes hierarki; pixelmatch er åbent. |
| F9 | Et cover opdateres eller fejler → bevar det viste cover; ellers Spotify-cover → grafisk AI-cover inden for eksisterende budget → lokal illustration. Cache må ikke genindføre forkert billedstil | Delvist bevist — faktisk browser/inert katalog: samme afkodede cover og DOM bevares ved manglende/ugyldige billeddata under refresh og udvidelse til syv rækker, uden ny crossfade. Enhedstest afviser genbrug over URI/konto/boot/rum/row removal. AI-budget, ny billedgenerering og gammel billedpolitik-cache er ikke bevist her |
| F10 | Jeg vælger fx Coming Home fra Hør igen → titel/cover vises straks i afspilleren; efter start forbliver betjeningen tilgængelig gennem efterfølgende refresh  | Delvist bevist — MUSIC_RECENT_SESSION_TEST på pakket 2.0.149: Coming Home-titel 11,3 ms og afkodet cover 27,8 ms efter browsertryk, mens startkald holdes og ejerens læsning stadig viser gammelt nummer. Én start; passiv fornyelse efter oprindeligt adgangsudløb sender intet ekstra. Pause/fortsæt/pause håndteres i rækkefølge under forsinkelse; ny browser åbner samme nummer/cover, og fortsæt/volumen virker. Inert PodConnect; rigtig Spotify og fysisk lyd ikke prøvet. |
| F11 | Jeg udvider en liste og skifter faner → godkendt udvidelse/scroll bevares under refresh; kun det valgte emne viser igangværende handling, ikke hele siden | Ikke dokumenteret |
| F12 | Coverkilden eller AI fejler, budgettet er brugt eller cache har gammel billedpolitik → lokal fallback virker uden blankt kort, ekstra ukontrollerede billedkald eller tab af eksisterende cover | Delvist bevist — pakket Chromium/inert katalog: Spotify-503 → cachebillede-503 → synligt afkodet lokal illustration; udfaset billedpolitik og udtømt budget giver lokale billeder, nul generatorkald. Eksisterende cover bevares under refresh/udvidelse. Ét forsøg pr. kilde pr. indlæsning; eksplicit fanegenbesøg kan læse igen. Rigtig billedprovider ikke prøvet |

## Højttaler

| # | Historie | Bevis og rester |
|---|---|---|
| H1 | Jeg vælger en anden højttaler → musikken flytter < 3 s, valget står med det samme | Ikke historiebevist — områdetest: music |
| H2 | Sofie spiller fra sin konto på Køkken → skærmen viser "Spiller fra en anden konto" og tilbyder "Spil her" | Ikke dokumenteret (funktion mangler) |
| H3 | Jeg trykker "Spil her" → min musik spiller på Køkken < 3 s; aldrig uden mit tryk | Ikke dokumenteret (funktion mangler) |
| H4 | Jeg åbner på iPad uden aktiv afspilning → Køkkenalrum er valgt som standard. Aktiv faktisk afspilning på et andet output overtages ikke automatisk | Browser verificeret på den byggede PodView med touch i iPad-størrelse. Ved bekræftet tom afspilning er Køkkenalrum alene valgt. Ved ny åbning med afspilning i Soveværelse er det alene aktuelt output. Nul kommandoer og effekter hos den simulerede ejer. Fysisk iPad er ikke prøvet. |
| H5 | Jeg flytter Køkkenalrum → Svend → Køkkenalrum → musikken og styringen følger hver gang; pause, lydstyrke og kø virker også efter ventetid  | Delvist bevist — MUSIC_OUTPUT_TRANSFER_TEST på pakket 2.0.149: Køkkenalrum → simuleret Soveværelse → Køkkenalrum. Efter passiv læsning og på returen browser-reload rammer volumen og præcist køvalg det aktive native rum/HomePod én gang hver. Tidligere music-prøve dækker pause/fortsæt efter hvert skift. Fysisk Svend, lyd og længere ventetid efter flytning ikke prøvet. |
| H6 | Højttalerdialogen er åben under refresh → listen udløber ikke synligt, valgt output har samme kantmarkering som valgt radiokanal; stabilt navn og layout | Delvist bevist — pakket Chromium/inert ejer: faktisk 30 s listeudløb under holdt refresh bevarer samme rækker, navn, bekræftet outputtekst, kant og geometri før/under/efter. Computed kant/baggrund matcher valgt radiokanal. Ingen kontrol-POST eller native effekt. Frisk afspilning begrunder visningen; listeudløb giver ikke ny handlingsautoritet. Fysisk iPad/højttaler ikke prøvet |
| H7 | Spotify flyttes til Tesla/iPhone og senere tilbage til Køkkenalrum → PodView følger faktisk output, tager ikke kontoen tilbage automatisk og genvinder betjening ved hjemkomst | Delvist bevist — pakket Chromium/PodVoice med inert PodConnect: eksterne Tesla-/iPhone-mål uden hjemmeroute vises gennem efterfølgende læsning; touch på utilgængelige kontroller sender nul forberedelser, POSTs eller effekter. Ekstern hjemkomst sender heller ingen handling; derefter rammer eksplicit pause/fortsæt native-room/42 én gang hver med samme sang. Rigtig Spotify og fysiske enheder ikke prøvet |
| H8 | Flytning afvises eller får ukendt udfald → ønsket højttaler vises ikke som bekræftet output; ingen automatisk gentagelse, og gammel sessions kø/kommandoer flyttes ikke blindt  | Delvist bevist — MUSIC_OUTPUT_TRANSFER_TEST: afvist og UNKNOWN flytning giver præcis ét eksplicit forsøg, ingen simuleret effekt eller passiv gensendelse; ønsket Soveværelse bliver aldrig bekræftet output. Efter UNKNOWN er tidligere kø uden eksekverbare valg. Rigtig service og fysisk højttaler ikke prøvet. |
| H9 | En anden PodView-skærm eller Spotify ændrer afspilningen → Mac og iPad viser samme bekræftede session/output; lokal standardhøjttaler bliver ikke en ny sessionsejer | Ikke dokumenteret |
| H10 | Output er optaget eller kontoen er ukendt → ingen påstand om en bestemt anden konto uden kildegrundlag; ingen automatisk overtagelse ved refresh eller genåbning | Ikke dokumenteret |

## Radio

| # | Historie | Bevis og rester |
|---|---|---|
| R1 | Jeg vælger en station → den spiller < 3 s, logo og navn vises med det samme | Ikke historiebevist — områdetest: radio |
| R2 | Jeg trykker stop → radioen stopper < 1 s | Ikke historiebevist — områdetest: radio |
| R3 | Radio er korrekt konfigureret i HA/PodConnect → kanaler kan vælges; ingen generisk »ikke tilgængelig via HA« ved almindelig opdatering | Delvist bevist — radio: faktisk browser/inert NativeRadio accepterer nyt stationsvalg under holdt svar og udfører P3→P1→P6 med friske tilbud; observeret station forbliver markeret. Native preparing uden tilbud dækkes i enhedstest. Rigtig radio/HA-installation ikke prøvet |
| R4 | Station eller stream fejler → kort konkret fejl på valget; en anden station kan vælges, og musik/radio-skift efterlader ikke låst afspiller | Delvist bevist — radio: faktisk inert afvisning og mistet accepteret svar viser feedback; ny eksplicit station virker i samme visning. UNKNOWN annullerer ventende valg uden gensendelse; ejer-/Spotify-skift dækkes i enhedstest. Baseline radio→Spotify består; fysisk streamfejl ikke prøvet |
| R5 | Jeg vælger P3 og åbner radio igen → faktisk valgt station har den godkendte kantmarkering, navn og logo; refresh ændrer ikke valget | Delvist bevist — radio: pakket browser med inert NativeRadio HTTP bevarer P3 som aria-pressed ved genåbning og samme DOM-knap ved uændret repaint; ingen ny startkommando. Visuelt reference-match og rigtig radiostream ikke prøvet |
| R6 | Radiokonfiguration mangler eller tokens passer ikke sammen → præcis opsætningsfejl; samme radio_transport_token i Speakers og podconnect_radio_token i PodVoice håndteres uden at vise/logge værdien | Ikke dokumenteret |

## Robotstøvsuger

| # | Historie | Bevis og rester |
|---|---|---|
| S1 | Jeg åbner robotten → status, batteri og igangværende rum vises straks | Ikke historiebevist — områdetest: robot |
| S2 | Jeg vælger rum og trykker Start → robotten starter; knappen bliver ikke grå undervejs | Ikke historiebevist — områdetest: robot |
| S3 | Robotten kører → jeg trykker pause / fortsæt / til base → knappen skifter < 300 ms og bliver aldrig grå; robotten følger < 2 s | Delvist bevist — robot_ux: pause/fortsæt < 300 ms, 0 grå, langsom og tavs robot; til base ikke målt |
| S4 | Jeg lader skærmen stå åben i 10 min → alle knapper virker stadig uden genindlæsning | Delvist bevist — robot_ux: pause virker efter serverens tilbud er udløbet; 10 min og Start ikke målt |
| S5 | Jeg skifter rengøringstype → kun toppen ændres; rute og antal gange beholder placering. Typer er Støvsug og vask, Støvsug, Vask; ingen Tilpasset-type eller opdigtede 3 runder | Ikke dokumenteret |
| S6 | Jeg vælger Extreme vand for Støvsug og vask → den eksisterende HA/API-kobling sætter faktisk custom niveau 30; valget overlever opdatering | Ikke dokumenteret |
| S7 | Jeg åbner basefunktioner → godkendt rækkefølge og vask/støv først bevares; vask/stop, tømning og tørring/stop bruger reelle understøttede HA-handlinger | Ikke dokumenteret |
| S8 | Robot/HA bliver midlertidigt utilgængelig → sidst kendte status med tidspunkt og rumvalg bevares; genforbindelse kræver ikke refresh | Ikke dokumenteret |
| S9 | Rent vand mangler → én kompakt besked for samme bekræftede fejl. Vedligeholdelse er neutral, lukket som standard og har korte rækker med detaljer ved behov | Ikke dokumenteret |
| S10 | Jeg skjuler vedligeholdelse i dag → baggrundsopdatering genåbner den ikke; en ny aktuel fejl skjules ikke. Driftstællere omtales som påmindelser, ikke bevis på slitage | Ikke dokumenteret |
| S11 | Robot rengør → vis fremdrift fra tilgængelige reelle data. Et estimat mærkes som estimat; uden grundlag vises ingen opdigtet procent | Ikke dokumenteret |
| S12 | Forside og robotdetaljer opdateres → relevant hovedknap vises stabilt med kendt status; ingen forsinket indflyvning eller flash | Ikke dokumenteret |
| S13 | Jeg ændrer rum, rute, antal gange eller suge-/vandniveau → næste Start bruger netop de valgte værdier og eksisterende HA/API-funktioner; refresh ændrer dem ikke | Ikke dokumenteret |
| S14 | Robotdata mangler kortvarigt → åbne indstillingsfelter, hovedknap og rumvalg beholder layout; opdateringen opfinder ikke en ny rengøring eller afsluttet tur | Delvist bevist — pakket Chromium på samlet 2.0.149-kandidat: en faktisk simuleret 503 under allerede sendt Start bevarer samme opgave, rumvalg og igangværende knap gennem tilbudsudløb. Original kvittering accepteres efter 16,1 s; præcis én inert Start, efterfølgende ejerobservation viser rengøring. Enhedstests bevarer ugyldiggørelse ved boot-, transport-, adgangs- og målskift. Øvrige indstillings- og turtilstande er ikke fuldt bevist |
| S15 | Jeg åbner vedligeholdelsesdetaljer → teknisk fejlkode ligger diskret under detaljer, aldrig som stor normal betjening. »Skjul vedligeholdelse i dag« er en diskret handling, ikke en stor primær knap | Ikke dokumenteret |
| S16 | Jeg håndterer en vedligeholdelsespåmindelse → skjul nulstiller ikke robottenes tællere. En eventuel understøttet nulstilling er separat og sker kun efter brugerhandling | Ikke dokumenteret |

## Lys

| # | Historie | Bevis og rester |
|---|---|---|
| L1 | Jeg trykker på et rum → lyset tænder/slukker, knappen skifter < 100 ms | Ikke historiebevist — områdetest: light |
| L2 | Jeg trækker i lysstyrke → lyset følger, slideren hopper ikke | Ikke historiebevist — områdetest: light |
| L3 | Lyset ændres fra en kontakt → skærmen viser det < 1,5 s | Ikke historiebevist — områdetest: home_events |

## Opskrifter

| # | Historie | Bevis og rester |
|---|---|---|
| O1 | Jeg åbner opskrifter → kataloget vises straks med billeder | Ikke historiebevist — områdetest: recipe |
| O2 | Jeg vælger en opskrift → ingredienser og trin kan læses på afstand; antal personer kan ændres | Ikke historiebevist — områdetest: recipe |
| O3 | Jeg følger trin → det aktuelle trin er tydeligt, og jeg kan starte en timer fra trinnet | Ikke dokumenteret |
| O4 | Jeg starter burgerboller og går tilbage til kataloget → den godkendte bjælke for igangværende opskrift vises i oversigten; widget bruger sit eget godkendte design, ikke en ny sort bjælke | Ikke dokumenteret. Godkendt reference mangler konkret link/revision for aktiv opskrift i katalog og widgetens særskilte design; pixelmatch er åbent. |
| O5 | Jeg åbner den aktive opskrift fra oversigt/widget eller genåbner appen → samme opskrift, trin og portioner bevares; ingen ny start eller erstatning med forkert »Fortsæt«-flow | Delvist bevist — recipe: aktiv widget åbner nu samme trin direkte; faktisk lokal browser bevarer trin 2/7, ingrediensvalg, lukket accordion og scroll efter reload. Idle/reset går fortsat til katalog; widgetstil uændret. Ændret portionstal er ikke bevist; redigering mangler |
| O6 | Jeg åbner alle undersider og accordions → komponenter, numre, typografi og tilstande matcher godkendt opskrifts-UI; ingen parallel reduceret produktvisning | Delvist bevist — eksempel/live bruger samme RecipeView og registreret kit-komposition. Eksakt godkendt screenshot/kilderevision er ikke angivet i nuværende opskriftsreference; pixelmatch er derfor ikke bevist |
| O7 | Jeg afslutter opskriften → aktiv markering fjernes konsistent fra oversigt og widget; allerede startede timere følger deres aftalte selvstændige adfærd | Delvist bevist — pakket Chromium/recipe-proxy: eksplicit afslutning fjerner aktiv katalogmarkering og gemt session, widget viser Se katalog, afslutning ses i historik. Samme inert-ejede timer fortsætter uden ekstra kommando eller lyd og stopper kun ved senere eksplicit Annuller. Det er observeret eksisterende timeradfærd; endelig produktaftale og visuel reference er fortsat åbne |
| O8 | Jeg uploader via genvejen → gyldig opskrift bliver tilgængelig; ugyldigt input/afvist adgang giver forståelig besked og korrekt afvisningslog uden tokens. Gentaget indsendelse må ikke give skjulte dubletter | Delvist bevist — recipe: faktisk browser med inert importkilde prøver upload → automatisk katalogvisning, dublet → samme kvittering, ugyldig opskrift → afvist, kildefejl → failed og genstart af isoleret server → bevaret katalog. Korreleret journal uden kilde-URL/titel prøvet; rigtig importkilde og iPhone ikke prøvet |
| O9 | Jeg ændrer antal portioner → ingrediensmængder følger med; navigation og accordion-opdateringer ændrer ikke valgt portionstal eller aktuelt trin | Ikke dokumenteret dokumenteret manglende funktion: RecipeView viser portioner som tekst; ændring af portionstal og skalering/persistens er ikke implementeret |
| O10 | Upload fra iPhone-genvejen lykkes/afvises → POST /api/podvoice/recipe-submissions med JSON-url og Bearer-uploadkode giver et forståeligt message-svar. Uploadkode er adskilt fra radiokode og må ikke lækkes i log | Delvist bevist — recipe + HA framework: POST-JSON-url/Bearer giver message-kvittering, manglende token afvises 401, kun submit/status videresendes. Rigtig iPhone-genvej og installation ikke prøvet; ingen fysisk accept hævdes |

## Timere, vejr, bil, svar

| # | Historie | Bevis og rester |
|---|---|---|
| T1 | Jeg starter en timer → den tæller ned straks; +1/−1 min virker; alarm kan stoppes med ét tryk | Ikke historiebevist — områdetest: timer |
| V1 | Vejret vises på forsiden og er højst 30 min gammelt; fejl viser sidst kendte med tidspunkt | Ikke historiebevist — områdetest: home_events |
| B1 | Bilens batteri/rækkevidde vises; handlinger følger de godkendte bekræftelsesregler | Ikke historiebevist — områdetest: vehicle |
| Q1 | Jeg spørger stemmeassistenten → svaret vises som kort på skærmen og kan læses senere i historik | Ikke historiebevist — områdetest: answers |
| T2 | Jeg navigerer væk, genåbner eller mister netværket → timerens slutpunkt bevares; ingen ny timer eller dobbelt alarm fra refresh | Softwareprøve: pakket Chromium med inert HA-timerejer bevarer ID og ejerens faste slutpunkt gennem reload/offline→online. Udløb offline giver én alarmvisning og én kvittering; ingen ny start eller browserlyd. Fysisk HA/iPad/lyd ikke prøvet. |
| V2 | Prognosen mangler eller har ukendt vejrikon → neutral fallback i samme ikonplads; dato, temperaturer og søjlekolonner forskydes ikke | Delvist bevist — WEATHER_RETENTION_TEST: faktisk pakket browser ved 1280×800 og 768×1024, inert HA Assist/WS; kendt/manglende/ukendt ikon giver cloud/dash/dash, fem uændrede kolonner, samme temperaturer/bjælke. Kildeevent genopretter ikon på samme DOM-noder uden forskydning. Ingen fysisk iPad-prøve |
| V3 | Vejrkilden fejler ved åbning → vis reelle sidst kendte værdier og tidspunkt; uden historik vises ærlig tom tilstand. For gamle data mærkes, aldrig som friske | Delvist bevist — pakket Chromium/inert HA: første kildefejl uden historik åbner ærlig tom detalje ved touch; næste normale ejerpoll genopretter samme visning. Med historik bevares oprindeligt tidspunkt under fejl/reload, og udløb fjerner for gamle værdier. Frataget læseadgang vinder over cache. Rigtig vejrservice/fysisk iPad ikke prøvet |
| B2 | Tesla-data ændres i HA → PodView viser de nyeste relevante entitetsværdier og deres faktiske opdateringstid; ingen ældre samlet cache overskriver friskere felter | Delvist bevist — kausale ejerregressioner: nyere scoped HA-lås/bagagerum/klima vinder pr. felt; uændret genudsendelse fornyer ikke observationstid. Ændring under ventende cachelæsning prøvet; fysisk Tesla ikke prøvet |
| B3 | Bilen sover → bevar hver kendt status med tidspunkt; dvale angives kun med kildegrundlag. Åbning af PodView vækker ikke bilen eller starter ekstra polling | Ikke dokumenteret |
| B4 | Bilen vågner eller en handling udføres → nye HA-observationer opdaterer status; accepteret kommando er ikke bevis for åbent bagagerum eller tændt klima | Ikke dokumenteret |
| B5 | Bagagerumsstatus er kendt → handling og bekræftelse siger entydigt Åbn eller Luk. Ukendt status gættes ikke; følg HA-kilden og vis konkret begrænsning | Ikke dokumenteret |
| B6 | Klima er slukket → temperaturbetjening, sædevarme og afrimning er utilgængelige som aftalt; ved bekræftet tændt klima aktiveres understøttede funktioner. Ingen ekstra modsatrettede knapper | Delvist bevist — vehicle: faktisk touch i pakket browser mod inert HA; OFF låser sædevalg, temperatur og afrimning med nul POST/effekter, ON åbner tilbudte sæde-/afrimningsbekræftelser, annullering udfører intet, OFF låser igen og power er tilgængelig. Ukendt/stale og ON→OFF før send dækkes af komponent/backend-tests. Ingen bilprøve |
| B7 | Bilen lader ikke → rent batteri/rækkevidde-kort uden 0 kW. Når den lader → det godkendte ladekort med reelle ladedata | Ikke dokumenteret |
| B8 | Adgangs- og klimakort vises på Mac/iPad → samme godkendte layout og betjening; fejl i hentning af funktioner genoprettes automatisk uden ekstra registrering | Ikke dokumenteret. Godkendt reference mangler konkret link/revision for Tesla-adgang/klima på Mac og iPad; pixelmatch er åbent. |
| Q2 | Jeg åbner tidligere svar og modtager et nyt → historikken bevares, og opdatering flytter ikke utilsigtet mit læsepunkt | Delvist bevist — answers: rigtig pakket browser med inert svarkilde bevarer historik, synlig DOM, tastaturfokus og scroll 122→122 ved nyt svar. Ny kvittering indlæses; historiklæsning afbrydes ikke. Enhedstest viser normal automatisk præsentation efter historik forlades. Ingen mikrofon/providerprøve |
| B9 | Afrimningsstatus mangler → ingen to modsatrettede afrimningsknapper; behold godkendt enkelt betjening med ærlig status. Ukendt er ikke automatisk Slukket | Ikke dokumenteret |
| B10 | Jeg åbner Tesla-handlingens bekræftelse → korte præcise tekster og knaplayout matcher godkendt dialog; ingen ekstra accordion med dubletter af hovedknapper | Ikke dokumenteret. Godkendt reference mangler konkret link/revision for Tesla-bekræftelsesdialog og fravær af dubletbetjening; pixelmatch er åbent. |
| B11 | HA viser frisk lås-, bagagerums- eller klimastatus → PodView viser samme kildeværdi; et manglende felt erstatter ikke øvrige kendte data eller fortolkes som Åbent | Delvist bevist — ejerregressioner + lokal HTTP: manglende/null/ugyldig rt bliver ikke Åbent; kendte søskendefelter bevares med originale tider. Bagagerumstilbud og sidste afsendelse kræver matchende lokal HA-kilde; gyldig 12 timer gammel rå status bevarer betjening og mærkes stale med oprindeligt tidspunkt; gammel komponent uden kontrakt afviser handling. Ingen fysisk bilprøve |
| V4 | Jeg går fra forsiden til vejrdetaljer → temperatur, tilstand og tidspunkt er konsistente; manglende ikon påvirker hverken temperaturspænd eller søjlens bredde | Delvist bevist — WEATHER_RETENTION_TEST: overblik/detalje har samme temperatur og hentetid; manglende/ukendt ikon og efterfølgende HA-event ændrer ikke temperaturspænd eller bjælkens geometri ved begge browserbredder. Rigtig vejrtjeneste/fysisk skærm ikke prøvet |

## Samlede forløb og svære tilfælde

Kør de relevante historier som sammenhængende forløb, ikke kun som isolerede første tryk:

- Musik: stemme eller Spotify-start → korrekt titel/output → køvalg → pause/fortsæt → 10 min refresh → stadig kontrol.
- Output: Køkkenalrum → andet rum → tilbage → Spotify på iPhone/bil → tilbage → stadig kontrol og korrekt kø.
- HA-app: første åbning → navigation → dvale → genåbning → netudfald → automatisk recovery på Mac og iPad.
- Robot: vælg rum/type/vand/rute → start → pause/fortsæt/base → statusopdatering → bevar relevante valg.
- Opskrift: widget → katalog → start → trin/timer → tilbage til katalog → genåbning → afslutning.
- Tesla: kendt HA-status → dvale → egne handlinger eller ekstern ændring → frisk HA-status og korrekte klimaregler.

For berørte historier dækkes langsomt svar, afvisning, timeout med ukendt udfald, tabt svar,
dobbelte/ombyttede events, hurtige brugertryk, delvise data og reelt tomt resultat. Et sent svar
må ikke genoplive en gammel sang, højttaler, opskrift eller valgt tilstand. Næste/forrige tæller
hvert eksplicit tryk; slideropdateringer skal ende på brugerens seneste værdi uden tilbagespring.

## Åbne produktdetaljer til gennemgangen

- Ved visuelle krav angives eksisterende godkendt screenshot/visning og revision i historiens egen række,
  samt hvilke skærme og tilstande referencen dækker. Agenten genfinder først eksisterende godkendelser.
  Et fejlrapport-screenshot er ikke automatisk en godkendt reference. Manglende reference står åbent;
  den må hverken erstattes af et nyt design eller ophæve brugerens allerede kendte adfærdsregler.
- Tesla-betjening når bilen er væk hjemmefra blev spurgt til, men hjemmestedslåsning er ikke besluttet her.
- Kilden og den præcise præsentation af robotfremdrift skal afklares; procent må ikke opfindes.
- Nye søge-/konto-overtagelsesflader (F3, H2–H3) samt eksisterende timers adfærd ved opskriftsafslutning
  afklares før nyt UI implementeres. De er ikke stiltiende godkendt af denne dokumentopdatering.

Tests beviser kun det, de måler: fixture/browser, rigtig HA/service og fysisk effekt angives særskilt.
Ved UI-sammenligning dækkes hele vejen fra widget til undersider, dialoger og accordions samt loading,
valgt, igangværende, fejlet og tom tilstand. Samme kanoniske komponent bruges i eksempel og produkt;
korrekt komponentnavn alene beviser ikke korrekt layout. Et dokumenteret fokusomrids fjernes ikke for
at få et screenshot til at ligne referencebilledet.

En historie med delvis dækning bliver ikke fuldt bevist på baggrund af en grøn områdesuite eller en release.
