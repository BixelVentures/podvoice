# Audit: PodView-musikoplevelsen og arbejdsmetoden · 7. november 2026

Brugerbestilt audit (Claude). Den er input til lead og ikke en ny autoritet over
STATUS/INVARIANTER/PRODUKTMÅL/ARKITEKTUR. Den beskriver, **hvorfor** play/stop/næste,
kø og højttaleroverdragelse opleves langsomme, blinkende og upålidelige, og hvad der
skal ændres for at få en oplevelse på niveau med Spotify-appen.

Kilder: `BixelVentures/podvoice` @ `56c485cf` og `BixelVentures/podconnect` @ `main`
(7/11 2026). Alle henvisninger er `fil:linje` i de to repos.

---

## 1. Konklusion på én side

Fejlene skyldes ikke primært enkeltbugs i PodView-UI'et. De følger direkte af
**arkitekturen omkring musikkommandoer**, og de vil blive ved, uanset hvor mange
UI-patches, versioner og CI-bindinger der laves:

1. **Tilstanden er to lag polling væk fra kilden.** Spotify Web API pollers hvert 10. s
   af PodConnect (`podconnect/custom_components/podconnect/const.py:30`). PodView
   pollers så PodConnect hvert 1–8 s (`static/podview/live-media-view.js:44`). Den
   egentlige kilde — modtageren (go-librespot), som PodConnect Speakers *allerede*
   lytter på i realtid (`podconnect/podconnect/manager/events.go:502`) — bliver aldrig
   brugt til at opdatere skærmen.
2. **Hver kommando kræver en frisk poll, før næste kommando må sendes.** Efter en
   kommando sætter PodConnect `poll_floor` (`commands.py:1050`), og
   `controls()` returnerer **tom actions-liste**, indtil en ny Spotify-poll er landet
   (`commands.py:319`). PodView deaktiverer knapperne, når en action mangler
   (`player-view.js:23`). Resultat: *tryk → knapper grå → (0,2–10 s) → knapper aktive*.
   Det er præcis "enabled → disabled → enabled".
3. **Kommandoer afvises, hvis Spotify-pollen tikkede imellem.** Next/previous/resume
   kræver, at `poll_sequence` er *nøjagtig* den, PodView så
   (`commands.py:640–653`; kun pause er undtaget). Med 10 s-poll i HA og 1–8 s-poll i
   browseren rammer en del tryk dette vindue og bliver til "stale_observation".
4. **Kun én kommando ad gangen, og UNKNOWN låser.** PodView afviser næste tryk, mens et
   er i gang (`live-control-view.js:295ff`, `intent_pending`), og et uafklaret udfald
   blokerer musikkontrollerne (`musicUnknownBlocks`). To hurtige "næste" er umuligt.
5. **Overtagelse af en højttaler fra en anden konto er ikke bygget.** PodConnects egen
   dokumentation siger det direkte: "my wife is playing, I want to stop it. Can't via
   your own Web API" (`podconnect/docs/MULTI-ACCOUNT.md:77`). Den kontoneutrale
   `/api/release` findes i Speakers-add-on'et, men PodView har ingen vej til den.
6. **Arbejdsmetoden optimerer for bevisførelse, ikke for oplevelsen.** De seneste to
   uger: ~149.000 ændrede linjer i `docs/`, ~34.000 i CI/scope-scripts, men kun ~8.800
   i PodView-kilde og ~18.600 i backend. 66 af 200 commits er "bind/register/admission/
   candidate"-ceremoni. Ingen af reglerne måler responstid eller blink.

**Kort sagt:** Systemet er bygget som en transaktionsmotor med compare-and-swap på
en 10-sekunders observation. En mediespiller skal bygges som *idempotente intents +
push-observation + optimistisk UI*. Det er en designbeslutning, ikke en bug, og den
skal tages eksplicit.

---

## 2. Sådan flyder ét tryk på "Næste" i dag

```
Browser (PodView)                 PodVoice add-on               HA / PodConnect Control         Speakers add-on / Spotify
─────────────────                 ───────────────               ───────────────────────         ─────────────────────────
poll 1–8 s ──GET snapshot────────► get_room_playback_controls ─► controls(): actions=[] hvis      (cache af sidste
                                                                 poll_seq <= poll_floor           10 s-poll af Web API)
tryk Næste
 ├ afvis hvis anden kommando kører (intent_pending)
 ├ afvis hvis pause/resume ikke matcher polled state
 └ controlIntent ───────────────► control_room_playback ──────► CAS: poll_seq == forventet? ────► prepare → commit
                                                                 ellers stale_observation         (to faser, RPC til
                                                                 sæt poll_floor                   librespot + OwnTone)
                                                                 refresh med 1 s budget
knapper grå (pending + settlement)
poll 1 s i "fastRead"-vindue ◄──── ny observation ◄──────────── kun hvis refresh nåede 1 s;
                                                                 ellers vent på næste 10 s-poll
knapper aktive igen
```

Typisk vej: 2 HTTP-runder fra browser + 2–4 lokale RPC'er + 1–2 Spotify-kald. Værste
normale vej før skærmen er korrekt igen: **~10–18 s**. Start af nyt indhold har
budgetter på 35 s (prepare) + 16 s (start) (`podview_music_control.py:29–30`).

---

## 3. Symptom → rodårsag

| Symptom du oplever | Rodårsag | Evidens |
|---|---|---|
| Knapper blinker aktiv/inaktiv efter tryk | `actions=[]` indtil ny poll efter hver kommando; UI deaktiverer manglende actions | `podconnect/commands.py:319,1050`; `player-view.js:23` |
| Tryk "gør ingenting" eller giver fejl | CAS på `poll_sequence`; poll tikkede imellem; PodView afviser også selv tryk, hvis polled state ikke matcher (fx pause når Sofie allerede pausede) | `podconnect/commands.py:640–653`; `live-control-view.js:295ff` |
| To hurtige "Næste" virker ikke | Én kommando ad gangen i både PodView (`intent_pending`) og PodConnect (`busy`) | `live-control-view.js:295ff`; `commands.py:1056` |
| Skærmen viser gammel sang i lang tid | 10 s Spotify-poll + 1–8 s browser-poll; musik er ikke med i HA-push-abonnementet (kun lys/støvsuger/bil/vejr) | `const.py:30`; `podview.py:1752`; `live-media-view.js:44` |
| Køen kommer sent / forsvinder | Køen hentes først *efter* en playback-observation, kun når fokus er "player" og intet er pending; køtilbuddet udløber og sætter status `stale`, som gentegner listen | `live-media-view.js:279–291`; `live-queue-view.js:19` |
| Kan ikke tage højttaleren tilbage fra Sofie | Hendes session er usynlig for din Web API-konto; start kræver "same_session"-claim; kontoneutral release er ikke eksponeret for PodView | `MULTI-ACCOUNT.md:77`; `manager/room_transport.go:205–206`; `speakers.py:213ff` |
| UNKNOWN efter timeout låser kontrollerne | Invariant "UNKNOWN må ikke automatisk gensendes" anvendes også på idempotente transportkommandoer | `AGENTS.md` (Stoplinje/standard pkt. 2); `musicUnknownBlocks` |

Ingen af disse kan løses alene i PodView-UI'et. 1, 2, 3 og 6 kræver ændring i
PodConnect; 4, 5 og 7 i PodView/PodVoice.

---

## 4. Fund om koden

1. **Håndskrevet kilde er reelt minificeret.** `live-music-selection-view.js` har
   linjer på 7.278 tegn, `speaker-output-view.js` 4.835, `podvoice-transport.js`
   3.753. En 120 KB-fil på 564 linjer kan ikke reviewes meningsfuldt af hverken
   menneske eller agent; diffs bliver uoverskuelige, og fejl gemmer sig. Det er en
   væsentlig grund til, at AI-agenter "kigger på log og build" i stedet for logik:
   logikken er ikke læsbar.
2. **Guard-eksplosion i stedet for én tilstandsmodel.** `generation`,
   `transportGeneration`, `musicGeneration`, `ownerScope`, `presentationKey`,
   `settlementReceipt`, `fastReadUntil` … kontrolleres i hver handler (151 gange
   `generation` i to filer alene). Hver ny race lukkes med endnu en guard, som igen
   kan få UI til at kassere gyldige data. En mediespiller har brug for én reducer:
   `observeret tilstand + afventende intents → visning`.
3. **Ejerskab er spredt over fire led.** Browser, PodVoice, PodConnect Control og
   Speakers validerer alle identitet, frisk­hed og claims hver for sig. "Én
   autoritativ ejer" står i reglerne, men i praksis har hvert led sin egen veto.
4. **Push-infrastrukturen findes allerede, men musik er udeladt.** PodVoice
   abonnerer på HA `state_changed` (`tools.py:446ff`) og har SSE til browseren
   (`podvoice-transport.js`, `endpoint('events')`). PodConnect har HA
   `media_player`-entiteter. Speakers lytter på go-librespots `/events`. Det
   eneste, der mangler, er at forbinde dem for musik.
5. **Tests beviser kontrakter, ikke oplevelse.** 313 UI-testfiler og tusindvis af
   backendtests, men ingen test måler "tid fra tryk til korrekt visning" eller
   "antal disabled-skift pr. tryk". Derfor kan alt være grønt, mens oplevelsen er dårlig.

---

## 5. Fund om arbejdsmetoden

1. **Processen er større end produktet.** `docs/STATUS.md` er 8.280 linjer,
   `docs/UI-DELIVERY-GOAL.md` 3.014. Agentkontrakten kræver, at agenten læser fire
   produktdokumenter + agentkontrakt før runtimearbejde. Det koster det meste af
   kontekstvinduet, før en eneste linje kode er læst.
2. **Reglerne belønner bevis-artefakter.** Exact-tree-binding, kandidatscope,
   admission-registrering og manifest-pins er obligatoriske; oplevelseskvalitet har
   ingen målbar gate. En agent, der følger reglerne korrekt, bruger derfor tiden på
   log, build og installation — det er ikke agentens fejl, det er det, der er bestilt.
3. **Invarianter er formuleret mod "dobbelt effekt" og ignorerer idempotens.**
   "UNKNOWN må ikke automatisk gensendes" og "accepteret er ikke bekræftet effekt" er
   rigtige for *start af ny musik i et andet rum*, men forkerte for pause, resume,
   næste, forrige og lydstyrke, som er sikre at gentage/sende igen. Den manglende
   skelnen er roden til både CAS-designet og UNKNOWN-låsen.
4. **Rettelser lappes i det led, agenten har foran sig.** PodView-agenter retter
   PodView, selv når årsagen er i PodConnect (fx #142 "keep the selected music
   visible through playback handoff" kompenserer for observations-latens i UI).
5. **Statusposter skrives som tætte bevislister uden mellemrum** (fx
   `STATUS.md:7651`), som hverken du eller en ny agent kan bruge til at forstå, hvad
   der faktisk er galt.

---

## 6. Målarkitektur ("2026-værdig")

**Princip:** Den enhed, der spiller lyden, er sandheden om, hvad der spiller. Kommandoer
er intents. Skærmen viser intentionen med det samme og forsoner med sandheden, når den
kommer — typisk inden for 300 ms.

1. **Observation via push fra modtageren.** Speakers-manageren videresender
   go-librespot-events (play/pause/track/seek/volume/session-ejer) til PodConnect
   Control, som opdaterer sin coordinator med det samme (`async_set_updated_data`)
   og skriver `media_player`-entiteten. Spotify Web API-pollen bliver en *backup*
   (fx 10 s når inaktiv, 2–3 s når en kommando lige er sendt), ikke den primære kilde.
2. **PodVoice abonnerer på musik som på lys.** PodConnect-`media_player`-entiteten
   tilføjes `home_event_interests()` (`podview.py:1750`), så `state_changed`
   udløser én læsning og et SSE-push til browseren. Browser-pollen falder bort,
   bortset fra genforbindelse.
3. **Transportkommandoer er idempotente intents uden CAS.** `pause`, `resume`,
   `next`, `previous`, `seek`, `volume` valideres kun mod *rum + modtager + konto*,
   ikke mod `poll_sequence`. `poll_floor`-låsen fjernes for disse. Kommandoer
   køes (seneste vinder for volume/seek; next/previous akkumuleres).
   Compare-and-swap bevares kun for **start af nyt indhold** og **flytning mellem rum**.
4. **Optimistisk UI med forsoning.** Tryk på pause viser pause med det samme; knapper
   deaktiveres aldrig pga. en afventende kommando. Kommer der ikke en bekræftende
   observation inden for fx 3 s, rulles visningen tilbage med en diskret besked.
   UNKNOWN for idempotente kommandoer låser intet; næste tryk er bare en ny intent.
5. **Kø: stale-while-revalidate.** Vis senest kendte kø med det samme, hent ny i
   baggrunden ved trackskift (push-event), og gentegn kun ændrede rækker. Ingen
   udløbstimer, der sætter listen i "stale"-tilstand på skærmen.
6. **Overtagelse som eksplicit, ærlig handling.** Når rummet spiller fra en anden
   konto, viser PodView "Spiller fra en anden konto" og tilbyder "Spil her i stedet".
   Handlingen er: Speakers `/api/release` (kontoneutral, findes allerede) → start med
   din konto. Ingen tavs overtagelse; altid ét tryk.

---

## 7. Rettelsesplan i rækkefølge

Hver fase er én kandidat med én leverance. Acceptkriterierne er **målbare på
oplevelsen** og køres i rigtig browser mod rigtig HA før fysisk test.

| # | Fase | Repo | Accept (målt) |
|---|---|---|---|
| 1 | Fjern `poll_floor`/CAS for idempotente transportkommandoer; tillad kø af kommandoer | podconnect | 5× "Næste" på 2 s giver 5 skift; 0 `stale_observation`/`awaiting_observation` i log for pause/resume/next/previous/volume |
| 2 | Speakers → Control push af go-librespot-events; coordinator opdateres straks | podconnect | Ændring fra Spotify-appen ses i HA-entiteten < 1 s (p95) |
| 3 | Musik med i `home_event_interests`; SSE-push til PodView; browser-poll fjernes | podvoice | Tryk → korrekt visning < 300 ms (p95) ved egen kommando; < 1,5 s ved ekstern ændring |
| 4 | PodView-musik som én reducer med optimistisk visning; ingen disabled pga. pending | podvoice (UI) | 0 disabled-skift pr. tryk (målt i Playwright med MutationObserver); ingen DOM-genopbygning af afspilleren ved samme sang |
| 5 | Kø: stale-while-revalidate, keyed rækker, prefetch ved trackskift | podvoice (UI) | Kø synlig < 200 ms ved åbning når kendt; ingen tom/"stale"-tilstand ved udløb |
| 6 | "Spil her i stedet" via kontoneutral release | podconnect + podvoice | Sofie spiller på Køkken → du trykker → din musik spiller < 3 s; aldrig uden eksplicit tryk |
| 7 | Gør kilden læsbar: formatér PodView-JS (Prettier/biome), ingen linjer > 120 tegn | podvoice | Kun formatering, AST-ækvivalent; gør alle senere reviews mulige |

Fase 7 kan med fordel køres **først**, som en ren formateringscommit, fordi den gør
fase 4–5 reviewbare.

---

## 8. Sådan bestiller du arbejdet hos en agent

Brug denne skabelon i stedet for "fiks musikken":

> **Resultat:** Når jeg trykker Næste i PodView, skifter sangen og skærmen viser den
> nye sang inden for 300 ms, uden at nogen knap bliver grå.
> **Hvor årsagen er:** `podconnect/commands.py` `poll_floor` + CAS (se
> `docs/AUDIT-PODVIEW-MUSIK-2026-11-07.md` §3). Ret i PodConnect, ikke ved at
> kompensere i PodView.
> **Bevis:** Playwright-test mod fixture-HA, der måler tid fra klik til ny titel og
> tæller `disabled`-mutationer. Vis tallene før og efter.
> **Ikke:** versionsbump, admission-binding, STATUS-opdatering eller installation, før
> testen viser målet nået.

Anbefalede ændringer til agentreglerne (kræver din beslutning):

1. Tilføj i `docs/INVARIANTER.md`: *Idempotente transportkommandoer (pause, resume,
   next, previous, seek, volume) må sendes uden frisk observation og må gentages;
   UNKNOWN-fencen gælder kun start af nyt indhold og rumflytning.*
2. Tilføj i `docs/PRODUKTMÅL.md` en oplevelsesgate: p95 tryk→visning < 300 ms,
   0 disabled-blink pr. tryk, kø < 200 ms når kendt.
3. Begræns obligatorisk læsning for UI-arbejde til `AGENTS.md` + den relevante del af
   denne audit; STATUS læses kun for aktuel kandidat.
4. Kræv, at en agent navngiver *hvilket led* (browser, PodVoice, Control, Speakers)
   årsagen ligger i, før den skriver kode, og retter dér.
