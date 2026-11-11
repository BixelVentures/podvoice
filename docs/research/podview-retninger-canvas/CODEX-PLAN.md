# Codex-plan: PodView UI-kit, design system og implementering

Mål: bring PodView-lærredet (claude.ai "PodView Retninger", kopi i denne mappe) ind i produktet
med færrest mulige funktionsfejl. Læs først `AGENTS.md` (proces, review, bevis) og
`MIGRATION-PLAN.md` (sporene). Denne fil er den konkrete arbejdsliste.

## Grundregler for Codex

1. **Ét spor pr. PR.** Tokens, én komponent, eller én funktion. Aldrig blandet.
2. **Rør ikke adfærd i spor A og B.** Ingen ændringer i modeller, kommandoer, transport,
   tekster eller DOM-struktur, der fjerner, flytter eller omdøber handlinger.
3. **Tekster kommer fra produktet.** Ingen ny kopi uden en beslutning (se spor C).
4. **Lærredets `.dc.html` er reference**, ikke kode der kopieres ind. Brug dem til mål, farver,
   tilstande og animationstider.
5. **Hver PR:** `npm test` grøn, visuel diff mod baseline, tjekliste over handlinger på de berørte sider.

## Hvor tingene bor i dag

- Tokens: `podvoice/gatekeeper/static/podview/ui-kit.css` (linje 3–25, `--pv-*`, to lag:
  primitiver som `--pv-tesla`, og semantiske aliaser som `--pv-vehicle-surface`).
- Komponenter: `ui/kit.js` (`applyKitComponent`, `applyKitDialog`), `ui/components.css`,
  `ui/motion.js`, `ui/notification-queue.js`, `ui/pressed-state.js`.
- Views: `*-view.js` (vejr, robot, lys, vehicle, timer, recipe, radio, music-results, player-view).
- Tests: `tests/podview/*.test.mjs` + `npm run check:components`.

## Migreringsmodel: parallel kørsel bag et flag (valgt for færrest funktionsfejl)

1. **Adfærdskontrakt før design.** En test pr. side tager et snapshot af alle handlinger
   (knap → `data-action`/kommando, links, tilstande fra `preview-scenes.js`). Den fejler, hvis en handling
   forsvinder, omdøbes eller sender noget andet. Den skrives i fase 0 og må aldrig ændres i spor A/B.
2. **Nyt UI bag et flag, ikke i stedet for det gamle.** `<html data-ui="v2">` slår det nye kit til;
   al ny CSS er afgrænset under `[data-ui="v2"]`. Det gamle UI virker uændret uden flaget.
   Flaget kan sættes pr. skærm i HA, så Frameo'en kan skiftes frem og tilbage på sekunder.
3. **Markup ændres kun med kroge.** Komponenter får klasser/attributter (`pv-notice`, `pv-btn--fare`),
   men ingen element flyttes eller fjernes, der bærer en handling. Logik i `*-view.js` røres ikke.
4. **Visuel regression på begge flag.** Skærmbilleder pr. tilstand (1280×800) med og uden `v2`;
   v1 må ikke ændre sig med én pixel, v2 sammenlignes med lærredets tavle.
5. **Én komponent ad gangen** (fase 2-rækkefølgen), hver bag samme flag, hver med grøn adfærdskontrakt.
6. **Live-bevis på HA Green** med `v2` på den rigtige Frameo i mindst et døgn pr. fase, før næste fase.
7. **Oprydning sidst:** først når alle sider kører `v2` og er godkendt, fjernes v1-CSS i én separat PR.

Rul tilbage = sluk flaget. Ingen deploy, ingen revert, ingen funktion berørt.

### Den mest skånsomme vej: kun et nyt CSS-lag på produktets eksisterende kit-kroge

Fundet i koden (11. nov.): produktets kit adskiller allerede adfærd fra udseende.
`applyKitComponent` (`ui/kit.js`) sætter `data-kit`, `data-kit-variant`, `data-kit-identity`, `data-tone`,
`aria-*` på elementerne, og `ui-kit.css` styler næsten alt via disse attributter (≈450 forekomster).
Derfor kan det nye UI for **knap, kontakt, kort, hero, chip, række, topbar, dialog** laves som ren CSS:

1. **Cascade layers:** pak nuværende CSS i `@layer pv-v1` uden at ændre en linje; nyt kit i `@layer pv-v2`
   afgrænset af `[data-ui="v2"]`. Senere lag vinder uden specificitetskrig, og v1 er urørt.
2. **Kun attributvælgere:** v2 må kun ramme `[data-kit=…]`, `[data-kit-identity=…]`, `[data-tone=…]`,
   `[aria-*]` og tokens (`--pv-*`). Ingen nye klasser i JS i denne fase, ingen DOM-ændringer.
3. **Tokens først** (farver, skrift, radius) inde i `pv-v2`; alle komponenter følger automatisk.
4. **Tekst/indhold:** kun hvor teksten allerede kommer fra produktet. Ny kopi = spor C (egen beslutning og test).
5. **Det, der ikke kan gøres med CSS alene** (kompakt beskedlinje i hero, »Mere ▾«-ark, handlingsflader,
   rødt topbarmærke, nat-skærm) kræver markup/logik og er derfor spor C: én funktion ad gangen,
   med adfærdskontrakt og eget bevis.
6. **Bevis pr. trin:** adfærdskontrakt grøn, v1-skærmbilleder pixel-identiske, v2 sammenlignet med lærredet,
   live på Frameo/HA Green bag flaget. Tilbagerulning = sluk flaget.

Kilder: GitHub/Primer migrerede styling uden brud via visuel regression, feature flags og et
kompatibilitetslag; cascade layers bruges netop til versioneret, gradvis CSS-migrering.

## Fase 0 · Baseline (ingen ændringer)

- Tag skærmbilleder 1280×800 af alle tilstande, der kan nås lokalt
  (`preview-scenes.js`-scener + HA Green): overblik, hver detalje, hver tilstand.
- Gem dem som reference. Alle senere PR'er sammenlignes med dem.
- Skriv en handlingstjekliste pr. side: hver knap → hvad den sender (fra koden).
- Skriv adfærdskontrakt-testen (se migreringsmodellen) og flaget `data-ui` uden ny CSS.

## Fase 1 · Spor A: tokens (1 PR)

Opdatér kun primitiverne i `ui-kit.css`; aliaserne følger automatisk.

| Primitiv | I dag | Lærred |
|---|---|---|
| `--pv-weather` | #E4EDF2 | #DDE6FB (materiale #1F55F0) |
| `--pv-robot` | #F6E4E6 | #F6D8E1 (materiale #B23A62) |
| `--pv-light` | #F8EFD2 | #FBEBC6 |
| `--pv-tesla` | #E1EFE9 | #D5EADD (grøn #2F7A55) |
| musik (ny) | – | #F6DCCB (koral, valgt 10. nov.) |
| radio (ny) | – | #E6DDF3 |
| opskrift (ny) | – | #F2E4D3 |
| svar (ny) | – | #E9E6F4 |
| timer | `--pv-dark` | #17171A + orange #FF7A5C |
| `--pv-ink-3` (grå etiket) | #6E6A63 | #5F5E5A (AA på farvede flader) |
| typografi | Inter | Schibsted Grotesk + IBM Plex Mono til tal (valgt 11. nov.) |

Tilføj nye tokens: `--pv-fresh-*`, `--pv-notice-{fejl,handling,info}-{bg,fg,icon}`,
`--pv-hero-s:221px`, `--pv-hero-l:458px`, `--pv-hit-min:44px` (i dag 48), animationstider fra
lærredet (ind 280 ms, ud 220 ms, pulsering 2,4 s).

Accept: kun farve/typografi ændret i diff; alle tests grønne; ingen DOM-ændring.

## Fase 2 · Spor B: komponenter (1 PR pr. komponent, i denne rækkefølge)

1. **Knap** (`button`): primær 56, sekundær 44, varianter primær / sekundær / kant / fare
   (fare = hvid flade, rød tekst, 2 px rød kant).
2. **Kontakt** (`toggle`): 56×34 synlig, 44+ trykflade.
3. **Beskedlinje** (ny, ud fra `notification-queue.js`): tre niveauer, livscyklus fra K-Kit
   (ind 280, ud 220, fejl/handling kan ikke lukkes, info kan lukkes, ✓ forsvinder efter 3 s, én ad gangen).
   **Hybridregel: beskeden står der, hvor årsagen er, og den flytter aldrig noget under fingeren.**
   - Tilstandsproblem (fx robotfejl, bagagerum åbent, vejr offline): kompakt linje (40 px) inde i heroen, i stedet for underlinjen. Intet layoutskift.
   - Feedback på en handling: i kontrollen selv (handlingsflade/knap: sender → ✓ / ukendt).
   - Info, som brugeren selv har udløst og kan lukke: må skubbe indhold.
   - Hændelse fra et andet domæne: rødt mærke i topbaren ved uret; tryk går til domænet.
   - Intet flytter sig inden for 500 ms efter et tryk. Overblikket viser en farvet prik.
   - Robot-hero: højst to knapper (primær tilstandshandling + "Mere ▾"); Mere samler transport øverst og Basen nedenfor. Sticky-linjen får de samme to.
4. **Friskhedsmærke**: kun når data er over 30 min ("Opdateret 11.02"); ordet "Sidst kendt" udgår.
5. **Widget-anatomi**: faste linjer (primær 20/800 én linje, kontekst 15 én linje, 18 px stribe),
   advarsel som farvet prik, nederste overbliksrække hvid (forslag A).
6. **Hero S/L**: 221 og 458, handlinger nederst til højre i S.
7. **Domænematerialer**: prikfelter pr. domæne inkl. orange timer og orange kabine ved varme.
8. **Afspiller**: fast til højre, lyd fra/til som 44×44 trykflade, luft under lydstyrke.
9. **Valgt-tilstand**: hvid flade + 2 px mørk kant (rum, kø-række).

Accept pr. komponent: komponent-test i `tests/podview`, visuel diff kun på komponenten,
handlingstjeklisten uændret.

## Fase 3 · Sider (1 PR pr. side, kun layout via komponenterne)

Overblik → Foto-Ro → Vejr → Robot → Lys → Tesla → Find musik → Radio → Opskrifter → Timer → Svar.
Hver side følger sin tavle på lærredet. Ingen nye funktioner her.

## Fase 4 · Spor C: nye funktioner (1 beslutning + 1 PR hver)

Testkravene står i `MIGRATION-PLAN.md` under "Nye funktioner · design færdigt, tests efter
UI-redesign". Rækkefølge med lavest risiko først:

1. Markér trin færdigt (lokal tilstand, ingen kommandoer).
2. Timer fra opskriftstrin + timer-chip i topbaren (genbruger eksisterende timer).
3. Fuldskærmsalarm (visuel ændring af `timer-notice.js`).
4. Cover Flow i Opskrifter · Udforsk.
5. Sticky handlingslinje.
6. Lås op / Lås bilen-flow på Tesla (eneste med kommando-risiko: kræver ekstra review).
7. −/+ antal stk.
8. Vejrmateriale pr. vejrtype, svar i fire former + historik, skærmindstillinger.

## Værn

- Fejler en test eller ændrer en handling sig, rulles PR'en tilbage, ikke lappet.
- En PR, der rører både `*-view.js`-logik og CSS, afvises i spor A/B.
- Hver side-PR får et skærmbillede pr. tilstand ved siden af lærredets tavle i PR-beskrivelsen.
- Ingen push til `main` uden den normale udgivelsesproces (CHANGELOG-post, version).

## Åbne beslutninger før start

- ~~Musikfarve~~ besluttet: koral #F6DCCB.
- ~~Font~~ besluttet 11. nov.: Schibsted Grotesk + IBM Plex Mono til tal.
- Fase 4 starter med »Markér trin færdigt« (besluttet 11. nov.); de øvrige besluttes én ad gangen.
- Nat-skærm: fast 21–7 (besluttet 11. nov.); kræver lysstyrkestyring på Frameo.
- Timer-widget: »Senest brugt« står i 6 timer efter sidste timer, derefter kun »Start en timer« (besluttet 11. nov.).
- Foto-Ro: kilde er det delte iCloud-album (link modtaget 11. nov., står i HA-konfigurationen, ikke i koden). Karrusel-regler (besluttet 11. nov.): 20 s pr. billede, blød overtoning 1,2 s (ingen glid/zoom);
  tilfældig rækkefølge uden gentagelse før alle er vist, nye billeder først; ur, vejr og kort står fast;
  stående billeder på sløret udgave af sig selv (ingen beskæring); 21–7 tager nat-skærmen over;
  mangler album/net, vises senest viste billede uden fejlbesked.
