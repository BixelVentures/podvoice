---
description: Gør én PodView-feature fuldt funktionsdygtig (fx /feature robot)
argument-hint: <feature: musik | afspiller | kø | højttaler | radio | robot | lys | opskrifter | timere | vejr | bil | svar>
---

Gør PodView-featuren **$ARGUMENTS** fuldt funktionsdygtig, så den opleves som en Spotify- eller
Apple-app: når man trykker, sker det, uden blink, låste knapper eller ventetid.

Arbejd selvstændigt til alt er grønt. Stop kun for at spørge, hvis en historie strider mod det
godkendte UI, eller hvis rettelsen kræver ny adgang eller en ny Home Assistant-integration.

1. **Læs kun:** `AGENTS.md`, featurens historier i `docs/BRUGERHISTORIER.md` og den kode, featuren
   bruger (skærm i `podvoice/gatekeeper/static/podview/`, server i `podvoice/gatekeeper/`, evt.
   PodConnect). Ingen andre dokumenter.
2. **Mål nuværende tilstand:** kør featurens browserrejse
   (`node tests/browser/podview_actual_journeys.cjs <rejse>`) og tag skærmbilleder af alle tilstande.
3. **Gør hver historie til en test** i browserrejsen, der tjekker præcis historien og tiden
   (tryk → synlig reaktion < 100 ms, korrekt tilstand < 300 ms, ingen `disabled`-blink, ingen tom
   mellemtilstand). Testen skal fejle, hvis historien ikke holder. Tilføj de svære tilfælde: langsom
   kilde, ekstern ændring, netværksudfald, tom data, dobbelttryk, skærmen åben i lang tid.
4. **Ret i det rigtige lag, så tæt på kilden som muligt:** læs tilstand fra Home Assistant-entiteten
   via push (`state_changed`), kald HA-services direkte, vis brugerens tryk med det samme
   (optimistisk) og forson med den observerede tilstand. Fjern mellemlag, tilbud med udløb og
   vagt-tjek, som ikke beskytter brugeren. Idempotente handlinger låser aldrig.
5. **Bevar det godkendte UI:** samme komponenter og layout (`npm run check:components` skal bestå).
   Sammenlign skærmbilleder før/efter; layout ændres kun, hvis en historie kræver det.
6. **Loop:** kør featurens rejse, `npm test` og de berørte pytest-filer. Gentag trin 4–6, til alle
   historier består 3 gange i træk. Kør derefter hele suiten én gang.
7. **Gør koden læsbar**, hvor du har rørt den (almindelig formatering, linjer ≤ 120 tegn,
   én tilstandsmodel for featuren).
8. **Opdatér `docs/BRUGERHISTORIER.md`:** ✅ kun når testen tjekker historien og tiden.
9. **Åbn én PR** med: hvad brugeren oplever nu (punktform), før/efter-skærmbilleder, testresultater,
   og hvad der ikke kunne afprøves uden rigtig Home Assistant eller hardware.
