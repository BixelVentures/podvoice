# PodView — brugerhistorier (acceptgrundlag)

Hver linje er én historie: **Givet** situation → **Når** jeg gør noget → **Så** sker der dette.
Tider er målt fra tryk til korrekt skærm. Hver historie skal have en automatisk browsertest
(`tests/browser/*_actual_e2e.cjs`), der tjekker præcis historien og tiden.
**Dækning:** "område: X" = der findes en browserrejse X for området, men den præcise historie
og tid er endnu ikke kontrolleret. ✅ = historie og tid er kontrolleret i testen. ⬜ = intet.
Ejeren (produktdesigneren) godkender teksten; agenten skriver testene.

## Afspiller

| # | Historie | Test |
|---|---|---|
| A1 | Musik spiller → jeg trykker pause → knappen viser "Fortsæt" < 100 ms, musikken stopper < 1 s, knappen bliver aldrig grå | delvis ✅ music: knap < 500 ms og aldrig grå; stoptid ikke målt |
| A2 | Musik er sat på pause → jeg trykker afspil → samme som A1 omvendt | område: music |
| A3 | Musik spiller → jeg trykker næste 3 gange hurtigt → der springes 3 sange frem, skærmen viser den nye sang < 1,5 s efter sidste tryk | ⬜ |
| A4 | Jeg trækker i lydstyrken → slideren følger fingeren uden at hoppe tilbage, lyden ændres < 1 s | område: music |
| A5 | Jeg trækker i tidslinjen → sangen spoler, tiden springer ikke tilbage | ⬜ |
| A6 | Nogen ændrer musikken fra Spotify-appen → skærmen viser det < 1,5 s | ⬜ (kræver push) |
| A7 | Netværket falder ud og kommer igen → sidst kendte sang bliver stående, knapperne virker igen uden genindlæsning | område: home_events |

## Kø

| # | Historie | Test |
|---|---|---|
| K1 | Jeg åbner afspilleren → kommende sange vises straks (kendte) og opdateres i baggrunden; aldrig tom liste mens den henter | ⬜ |
| K2 | Sangen skifter → køen rykker op uden at listen blinker | ⬜ |
| K3 | Jeg trykker på en sang i køen → den spiller < 1,5 s | område: music |

## Find musik

| # | Historie | Test |
|---|---|---|
| F1 | Jeg åbner Find musik → forslag (Stemning/Humør/For dig/Senest) vises < 300 ms fra sidst kendte, uden spinner | område: music_selection |
| F2 | Jeg trykker afspil på et forslag → afspilleren viser valget med det samme og musikken starter < 3 s | område: music_selection |
| F3 | Jeg søger efter en kunstner, sang eller playliste → resultater vises mens jeg skriver | ⬜ (funktion mangler) |
| F4 | Jeg trykker "Andre forslag" → nye forslag uden at siden hopper | område: music_selection |

## Højttaler

| # | Historie | Test |
|---|---|---|
| H1 | Jeg vælger en anden højttaler → musikken flytter < 3 s, valget står med det samme | område: music |
| H2 | Sofie spiller fra sin konto på Køkken → skærmen viser "Spiller fra en anden konto" og tilbyder "Spil her" | ⬜ (funktion mangler) |
| H3 | Jeg trykker "Spil her" → min musik spiller på Køkken < 3 s; aldrig uden mit tryk | ⬜ (funktion mangler) |

## Radio

| # | Historie | Test |
|---|---|---|
| R1 | Jeg vælger en station → den spiller < 3 s, logo og navn vises med det samme | område: radio |
| R2 | Jeg trykker stop → radioen stopper < 1 s | område: radio |

## Robotstøvsuger

| # | Historie | Test |
|---|---|---|
| S1 | Jeg åbner robotten → status, batteri og igangværende rum vises straks | område: robot |
| S2 | Jeg vælger rum og trykker Start → robotten starter; knappen bliver ikke grå undervejs | område: robot |
| S3 | Robotten kører → jeg trykker pause / fortsæt / til base → det sker < 2 s | område: robot |
| S4 | Jeg lader skærmen stå åben i 10 min → alle knapper virker stadig uden genindlæsning | ⬜ |

## Lys

| # | Historie | Test |
|---|---|---|
| L1 | Jeg trykker på et rum → lyset tænder/slukker, knappen skifter < 100 ms | område: light |
| L2 | Jeg trækker i lysstyrke → lyset følger, slideren hopper ikke | område: light |
| L3 | Lyset ændres fra en kontakt → skærmen viser det < 1,5 s | område: home_events |

## Opskrifter

| # | Historie | Test |
|---|---|---|
| O1 | Jeg åbner opskrifter → kataloget vises straks med billeder | område: recipe |
| O2 | Jeg vælger en opskrift → ingredienser og trin kan læses på afstand; antal personer kan ændres | område: recipe |
| O3 | Jeg følger trin → det aktuelle trin er tydeligt, og jeg kan starte en timer fra trinnet | ⬜ |

## Timere, vejr, bil, svar

| # | Historie | Test |
|---|---|---|
| T1 | Jeg starter en timer → den tæller ned straks; +1/−1 min virker; alarm kan stoppes med ét tryk | område: timer |
| V1 | Vejret vises på forsiden og er højst 30 min gammelt; fejl viser sidst kendte med tidspunkt | område: home_events |
| B1 | Bilens batteri/rækkevidde vises; handlinger kræver bekræftelse | område: vehicle |
| Q1 | Jeg spørger stemmeassistenten → svaret vises som kort på skærmen og kan læses senere i historik | område: answers |
