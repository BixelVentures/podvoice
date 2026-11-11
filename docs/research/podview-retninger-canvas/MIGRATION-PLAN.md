# Fra lærred til produkt uden at bryde validerede funktioner

Status: klar til migrering 11. nov. 2026 — start i `HANDOFF.md`. Ingen produktkode er ændret.

## Princip: lag, ikke omskrivning

Redesignet er et **visuelt lag oven på den adfærd, HA Green allerede har godkendt**.
Det betyder:

1. **Adfærd, data og handlinger røres ikke** i første fase. JS-modellerne
   (`robot-observation.js`, `vehicle-view.js`, `timer-model.js`, `recipe-view.js`,
   `light-room-view.js` m.fl.) ejer stadig hvad der vises, hvornår og hvilke kommandoer der sendes.
2. **Det visuelle skiftes via design-tokens og komponent-CSS**, ikke ved at skrive views om.
   Produktet har allerede et kit (`ui/kit.js`, `ui-kit.css`, `applyKitComponent`).
   Lærredets regler oversættes til det kit: farver, typografi, afstande, hero S/L,
   beskedlinje, friskhedsmærke, knap, kontakt, widget-anatomi.
3. **Nye funktioner holdes helt adskilt** fra reskinnet og tages én ad gangen.

## Tre spor, aldrig blandet i samme ændring

| Spor | Hvad | Må ændre | Må ikke ændre |
|---|---|---|---|
| A · Tokens | farver, typografi, radius, afstande | `ui-kit.css` variabler | DOM, JS, tekster |
| B · Komponenter | knap, kontakt, beskedlinje, mærke, widget, hero S/L, afspiller | kit-CSS + `applyKitComponent`-varianter | modeller, kommandoer, data |
| C · Funktioner | alt nyt fra lærredet (se liste) | én funktion pr. ændring | andre funktioner |

Spor A og B er et **reskin**. Spor C er **produktudvikling** og følger den normale
lead/review/bevisproces i AGENTS.md, én funktion ad gangen.

## Rækkefølge

1. **Baseline:** tag skærmbilleder af alle HA Green-tilstande før noget ændres
   (overblik, hver detalje, hver tilstand). De bliver referencen.
2. **Spor A:** tokens. Sammenlign skærmbilleder: kun farve/typografi må være ændret.
3. **Spor B:** én komponent ad gangen (fx beskedlinje), med visuel diff og de
   eksisterende tests grønne. Ingen DOM-ændring, der fjerner eller omdøber handlinger.
4. **Spor C:** funktionerne nedenfor, hver med egen beslutning, egen ændring og eget bevis.

## Spor C · funktioner på lærredet, som ikke findes i HA Green i dag

Skal besluttes og bygges enkeltvis. Indtil da må de ikke komme med i reskinnet.

- Opskrift: timer pr. trin, −/+ antal stk., markér trin færdigt med tryk
- Opskrift: magasin / Cover Flow i Udforsk
- Sticky handlingslinje ved scroll
- Topbar: lille timertæller ved siden af uret
- Timer færdig som fuldskærmsalarm over Foto-Ro (findes som `timer-notice.js`, kun visuelt nyt)
- Vejr: shader pr. vejrtype, vandret scroll af timer
- Tesla: bekræftelsesmodal og "sender…"-feedback for Lås op / Åbn bagagerum
- Robot: "Flere handlinger" (Kør til basen, Tøm støv, Vask/Tør moppe, Find robot) – findes i produktet, mangler kun design
- Skærm og enhed: lysstyrke-slider og automatisk dæmpning (kræver enhedsstyring på Frameo)
- Svar: historik over visuelle svar, færre svarformer
- Find musik: ingen søgning (søgedialogen har ingen kalder i dag)

## Værn mod at ødelægge noget

- Hver ændring i spor A/B skal have: grønne eksisterende tests, visuel diff mod baseline,
  og en tjekliste over handlinger på den side (alle knapper findes stadig og gør det samme).
- Ingen ændring blander spor. En PR er enten tokens, én komponent eller én funktion.
- Lærredets `.dc.html` er reference, ikke kode, der kopieres ind.

## Nye funktioner · design færdigt, tests efter UI-redesign

Hver funktion tages først, når spor A og B (reskin) er landet og grønne. Én funktion pr. ændring,
med egen beslutning. Designet ligger på lærredet (tavlenavn i parentes).

### 1. Sticky handlingslinje (Robot-Sticky, Robot-Sticky-Rengoer)
- Linjen glider ind (240 ms) præcis når heroen er rullet ud, og ud igen når den kommer tilbage.
- Viser samme status og samme primære handling som heroen; handlingen sender præcis samme kommando.
- Afspilleren står fast; linjen ligger under topbaren uden afrunding foroven; skyggen klippes ikke.
- Kun på sider med primær handling i heroen (Robot, Timer, Tesla). Ikke på Vejr.

### 2. Cover Flow i Opskrifter · Udforsk (Opskrifter-Bog)
- Swipe og pile skifter opskrift; tryk på en nabo vælger den; tryk på midten åbner opskriften.
- Titel, kategori og meta står på faste linjer under billedet (ingen hop ved skift).
- Billeder fra `recipe.image`; opskrift uden billede får produktets pladsholder.
- Igangværende opskrift har mærket "I gang · trin X af Y".

### 3. Markér trin færdigt (A-Opskrift)
- Tryk på trinnets cirkel markerer det færdigt (✓), og næste trin bliver aktivt.
- Tryk på et færdigt trin gør det aktivt igen.
- Trinstatus gemmes i opskriftens session og ryddes af "Nulstil opskrift" (produktets eksisterende dialog).
- Trykfladen er 44×44.

### 4. Lås op / Lås bilen på Tesla (Tesla-Handling-*)
- Knappen følger bilens tilstand: Ulåst → "Lås bilen", Låst → "Lås op"; bagagerum åbent → "Luk bagagerum".
- Lås op kræver bekræftelse ("Lås bilen op?"); Lås bilen gør ikke.
- Mens kommandoen sendes: knappen viser "Låser op…" / "Låser…", er låst mod dobbelttryk, og beskedlinjen viser "Anmodning modtaget.".
- Bekræftet: grøn "✓ Ulåst"/"✓ Låst" i 3 s. Ukendt udfald: fejl-beskedlinje "Udfald ukendt · kontrollér bilen." og knappen frigives.
- Alle tekster findes allerede i `vehicle-view.js`.

### 5. Timer fra opskriftstrin (A-Opskrift, Opskrift-TimerKoerer)
- "Start timer · 30 min" starter en almindelig timer navngivet efter trinnet.
- Knappen bliver "Timer kører · mm:ss"; timeren vises som chip i topbaren på alle andre sider,
  i timer-widgetten og i Foto-Ros aktivitetsplads.
- Når tiden er gået: fuldskærmsalarm (Timer-Alarm, produktets `timer-notice.js`).

### 6. Antal stk. med −/+ (A-Opskrift)
- −/+ skalerer alle ingrediensmængder; ændrede mængder markeres i rav.
- Valgt antal bevares i sessionen og nulstilles af "Nulstil opskrift".
- Kun for opskrifter, hvor udbyttet er et tal (fx "15 stk.").

### Øvrige forslag på lærredet, der ikke findes i dag
- Skærm og enhed: lysstyrke-slider og automatisk dæmpning (kræver enhedsstyring på Frameo).
- Vejr: materiale pr. vejrtype og vandret scroll af timer.
- Svar: fire former og historik "Alle svar".
- Afspiller: lyd fra/til på højttalerikonet.
- Tom afspiller med forslag (Tid på dagen) og Hør igen; følger fanernes regler, skjuler forslag når stemningsforslag ikke er tilgængelige.
- Foto-Ro: billeder fra delt iCloud-album (afventer link).
- Nat-skærm (Foto-Nat): sort, ur + vejr i dæmpet rød, kun kørende timer; tidsrum og lysstyrke kræver enhedsstyring.
- Robot sticky: primær + »Mere ▾« som ark fra linjen (Robot-Sticky-Mere).
