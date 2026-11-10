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

## Fase 0 · Baseline (ingen ændringer)

- Tag skærmbilleder 1280×800 af alle tilstande, der kan nås lokalt
  (`preview-scenes.js`-scener + HA Green): overblik, hver detalje, hver tilstand.
- Gem dem som reference. Alle senere PR'er sammenlignes med dem.
- Skriv en handlingstjekliste pr. side: hver knap → hvad den sender (fra koden).

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
| typografi | Inter | Schibsted Grotesk + IBM Plex Mono til tal (kræver font-beslutning) |

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
- Font: Schibsted Grotesk + IBM Plex Mono, eller beholde Inter.
- Hver funktion i fase 4.
- Foto-Ro: iCloud-album som kilde.
