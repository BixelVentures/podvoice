# Fra lærred til produkt uden at bryde validerede funktioner

Status: forslag, 10. nov. 2026. Ingen produktkode er ændret.

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
