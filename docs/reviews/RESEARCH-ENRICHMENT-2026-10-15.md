# Aktiv kildehentning til PodView · isoleret kildeforslag · 15. oktober 2026

**Gjort:** skrevet en lukket, inaktiv læsekæde fra den eksisterende HA/MCP-ejer til vores native faktakort og tidslinje. **Fundet:** Google-helperens kendte eksempel giver tekst uden dokumenterede links, billeder eller prisloft. **Næste:** uafhængigt review, faktisk Green-helperkontrakt og særskilt aktiveringsramme. Dette er ikke installeret, aktiveret eller browser-/deviceafprøvet.

## Præcis baseline og leverance

Den isolerede kopi er `/private/tmp/podvoice-research-data-next`, oprettet fra lokal26 HEAD `c163cfafe9e26474549accebc3382c94504277b3`. Den eksisterende26-kandidat er ikke redigeret. Ingen version er aftalt. Nye filer:

- `podvoice/gatekeeper/podview_research.py`: `OwnerReadAdapter`, `ResearchBinding`, `ResearchPolicy`, `ResearchOwner` samt kildeekstraktion.
- `podvoice/gatekeeper/static/podview/research-answers.js`: inaktiv parser, som binder data til præcis room/session/epoch/turn/generation/task/input- og answer-revision og bruger den eksisterende native komponentvalidering.
- `tests/unit/test_podview_research.py`: 24 fokuserede regressionscases.
- `tests/podview/research-answers.test.mjs`: 4 native parsercases.
- Isoleret `docs/STATUS.md`: aktiv beslutningspost for dette inaktive kildeforslag.

Efter det uafhængige primitive-GO er faktisk **disabled-default integration** implementeret i den isolerede kandidat: startup/config, eksisterende receipt owner, snapshot/source routes og native parser/source UI. Thin/provider/tool-router/MCP samt eksisterende native/live resultathooks er byteidentiske. Startup har ny Supervisor-only `podview_research_visual_policy` med tom default; kun præcis `completed_receipts_v1` åbner rig **præsentation af allerede completed conversation-toolresultater**. Den godkendte20-kalds faktavælger og dens policy/allowance er uændret; rigere input/purpose kræver særskilt opt-in og approval. Der oprettes ingen anden selector/modelinstans. Baggrundens ResearchOwner/toolfetch er fortsat ikke startup-wired. Der er ingen modelkald, søgekald, installation, publicering eller levende konfigurationsændring i dette arbejde.

## Kilder, som faktisk er læst

| Kilde i lokal26 | Faktisk kontrakt | Konsekvens |
|---|---|---|
| `tools.py`: `_TOOL_CAPABILITY_ROLES` | `google_web_sogning` er web; `HassGetWeather`/`weather_forecast` vejr. `HassMediaSearchAndPlay` kombinerer søgning og afspilning. | Kun de tre præcise læsenavne er tilladt her; search-and-play afvises helt. Rollen alene giver ingen Green- eller budgetaccept. |
| `tools.py`: `_podview_weather_declaration` og `podview_weather_read` | Eksakt `assist`-MCP-ejer, admission/discovery/endpoint; højst ét vejrtool; tomme argumenter skal være gyldige. | Vejr bruger den eksisterende hjemmeejer. Ingen lokations-/entitetsargumenter opfindes. |
| `tools.py`: `dispatch` | Holder `_fetch_lock` over awaited dispatch. | Visuel baggrundslæsning bruger eksisterende native `MCP.call_tool` med execution guard og præcis deklaration frem for at holde stemmens dispatchlås. |
| `mcp_client.py`: `call_tool`, `_rpc` | Eksisterende stateless native HA-transport; current guard før tools/call. `_rpc` bufferer fuldt HTTP-svar. | Samme transport/ejer genbruges.16KiB er loft for **admitteret resultatform**, ikke hard bytegrænse på netværksoverførslen. Et særskilt transport-/helperloft skal være bevist før aktivering. |
| `docs/examples/google_web_sogning.yaml` | `conversation.process` med `conversation.google_ai_search`; output er `response.speech.plain.speech` i `{output: ...}`. Ingen dokumenterede citations-URL'er, billeder eller generation-/søgeprislofter. | Teksten kan kun vises som værktøjets eksterne tekstuddrag. “Google-grounded”, verificeret webkilde eller ægte billedkilde kan ikke påstås. |
| `tools.py`: `_mcp_result_to_contract` | MCP tekst/structuredContent bliver `{ok, summary?, data?}`; HA scripts kan pakke `{success: true, result: ...}`. | Ekstraktoren accepterer netop disse kendte wrappers og eksempel-output. Ukendt rig JSON eller ekstra helperfelter afvises. |
| `podview_receipts.py` i26 | To aktuelle vejrfakta eller skalært webresultat≤80tegn; ingen aktiv kildehentning. | Den oprindelige20-kalds faktavælger udvides ikke lydløst. |
| `thin.py`: `_offer_visual_receipts`, native/live result hooks | Tilbyder først efter vellykket resultatindsendelse; binder owner/session/epoch/turn/generation/task/input-revision og frisk owner predicate. | En senere owner-wiring skal bruge samme autoritative kanter; ikke transcript-keywords eller browserbeskeder. |
| `static/podview/visual-content.js`, `ui/library/visual-components.js` | Egne fact-card/sourced-image/answer-timeline/simple-diagram. Closed shape, read-only; textContent og native komponenter. | Forslaget bruger kun fact-card og answer-timeline. HTML/styles/actions fra kilde eller model kommer ikke i UI. |
| `static/podview/owner-answers.js`, `live-answer-view.js` | Nuværende live-kontrakt accepterer kun fact-card, med eksisterende source-form. | Eksisterende routes/parsers har nu et valgfrit `podview.research.v1` typed union, gated af serverens `researchVisual` capability. Source lookup bruger aktuelt answer revision og exact owner-binding. Tom policy bevarer den gamle fact-card-gren. |

PodConnects aktuelle passive kontrakt leverer recent/top/liked og account-owned playback/queue. Der findes ikke en læst, installeret, deklareret ren track-/mood-søgekontrakt i26. Musik/artwork/ny ren søgeservice ejes af det separate spor; dette forslag accepterer ikke musikkontroller eller generisk web som privat bibliotekssandhed.

## Implementeret kæde og grænser

`ResearchOwner.offer` returnerer straks og foretager ingen synkron tool-send. Kun en fremtidig trusted Thin/owner-kant må konstruere `ResearchBinding` og tilbyde præcise modelvalgte tool/args efter semantic admission. Koden afgør ingen brugerhensigt og opretter ingen anden samtale/model. `offer` starter en separat finite task; tale, mikrofon, resultatsubmit og teardown venter ikke på det visuelle resultat.

Adapteren kopierer den eksakte admitted deklaration og validerer argumenter mod dens faktiske schema. Den holder MCP-ejeridentitet, discovery-objektidentitet, MCP epoch, endpoint, API-id og deklarationsbytes før send og efter svar. Et samme-navn eller samme-indhold erstatningssnapshot tilbagekalder resultater/cache. Google tillader kun `query`≤240tegn; weather kun `{}`. Ingen rediscovery, initialisering, recovery, retry eller mutation af stemmens deklarationer.

Policy er `None` som standard. Der kræves et separat `RequestAllowance` med højst6lifetime-kald. Den eksisterende durable startup allowance kan genbruges med **en anden særskilt fil**, aldrig20-kalds selectorfilen. Kald tælles før send, også ved tabt resultat/fejl. Højst ét kald pr. præcis owner/turn/task/revision; ingen retry.4s source-deadline; cancellation-resistant svar er inert. Kun ét reelt source-read ad gangen; intet nyt read admitted mens et gammelt read ikke er færdigt. Stores kan højst holde6poster. Cache gælder kun præcis ejer/rum/session/turn/generation/task/input/answer-revision/tool/argumenter, højst120s og aldrig efter kildens udløb. Genbrug flytter ingen timestamps/udløb. Close annullerer og tilbagekalder straks.

Vejr genbruger den faktiske lukkede weather-projektion inkl. loss-aware packed forecast. Tidslinjen kopierer højst8fremtidige faktiske forecast-perioder med timestamp, condition og leverede temperatur/nedbør/sandsynlighed/vind-enheder. `continuousCoverage:false`; faktisk kilde- og displaydækning bevares. Ingen low/high, regnvindue, heldagsdækning, ETA eller råd udledes. Et datum uden faktisk værdi forbliver fraværende. Tidslinjens historiske native “planned” status betyder ikke en observeret vejrhændelse; endelig produktkopi skal reviewes som “Prognose” før wiring.

Webeksempel-output kopieres som højst6konsekutive80tegns uddrag af højst1200tegns kildeoutput. Fuld begrænset tekst gemmes i owner source receipt; afkortning annonceres. Resultatet er et eksternt **tekstoutput**, ikke faktaverifikation. `externalSourcesProvided:false`; ingen citations-URL, billedkilde, sang, hjemmetilstand eller tilladelse opfindes. Denne fallback opfylder ikke rig citeret forskning/billeder/diagrammer.

## Hvad mangler før det kan køre?

1. **Baggrundsforsknings-intent.** Den faktiske disabled-default presentation-wiring genbruger allerede vellykkede, provider-submitted værktøjsresultater fra den eksisterende GPT-Live-samtale. Den eksisterende AI har allerede valgt/hentet vejret/web; dette giver reelt aktivt hentet indhold uden gentaget Google-kald. Der er ingen ny semantic producer af `ResearchBinding` eller `request_visual_research` for **yderligere** baggrundshentning. Denne producer/hard helper-budgetkontrakt kræver eget review, hvis der viser sig reelle manglende felter; intet lokalt spørgsmål-/keywordfilter er tilføjet.
2. **Integration-review.** Faktisk receipt/snapshot/source/native UI-wiring er nu implementeret disabled-default. Den bruger eksisterende ingress routes og current-owner closures; forskningsrækken binder sessionEpoch/providerGeneration/current answer revision og kildeudløb. AI vælger kun ID'er fra maksimalt6faktiske kandidater under samme20-request/4KiB/256-token selectorgrænse; owner kopierer kun valgte source-perioder i original kronologi. AI-decline/pending/stale er ikke eksporteret i history/source. Format-admission bevares efter allowance-udtømning, så sidste godkendte kort ikke pludselig invalideres. Source-view viser de faktiske tidslinjefelter eller originalt begrænset weboutput. UI bruger “Prognose”. Endeligt uafhængigt integration-review mangler endnu.
3. **Green faktisk værktøjsdeklaration og resultatform.** Læs uden at udføre søgning: eksponeret `google_web_sogning` navn, inputSchema, script/agent-konfiguration, det faktiske svarformat fra allerede eksisterende logs/receipts, settings/prisgrænser. Repoeksemplet er ikke bevis for Green-konfigurationen.
4. **Rig kildekontrakt.** Helperen skal levere rigtige retrieval-/provider-identiteter, kilde-URL'er og tekst/claim-binding samt særskilt tilladt billedmetadata før sourced-image eller citerede facts må admitted. Ingen foreslået rig schema behandles som eksisterende integration. Forecast/diagramvalg skal bygge på leverede data og egne widgettyper.
5. **Per-helper hårdt forbrug/transportloft.** Gemini-agentens interne tool/model-loop og pris er ukendt. Lokalt antal eller4s timeout kan ikke tilbagekalde et allerede startet HA/providerjob. `bounded_web_helper_verified:true` må kun sættes efter faktisk dokumenteret end-to-end per-call budget og timeout/bytekontrakt. Ingen betalt prøve foretages uden særskilt godkendelse.
6. **Uafhængigt review og normal releasegate.** Source review før wiring/activation; exact composed kandidat og officiel CI før release. Browser på ægte receipts/Green og fysisk Voice PE latency/re-wake er efterfølgende særskilte gates.

## Konkret aktiveringsforslag til senere godkendelse

Dette er et reviewbart scopeforslag, **ikke** en eksisterende Supervisor-setting eller en aktivering:

```json
{
  "scope": "owner_read_visual_research_pilot",
  "max_source_requests_lifetime": 6,
  "max_source_requests_per_bound_turn": 1,
  "source_deadline_seconds": 4,
  "max_admitted_result_bytes": 16384,
  "cache_max_seconds": 120,
  "additional_model_requests": 0,
  "music_or_home_write_actions": 0,
  "weather_tool": "the_single_actually_admitted_HA_owner",
  "web_tool": "google_web_sogning_if_actual_helper_bounds_are_verified",
  "web_proposed_max_cost_per_call_usd": 0.05,
  "web_proposed_max_total_usd": 0.30,
  "rich_citations_and_images": "require_actual_helper_receipt_contract_first"
}
```

Brugerens tidligere20-kalds pilotgodkendelse dækker ikke dette. Weather kan foreslås som særskilt6læsninger/0ekstra modelkald, mens web forbliver afvisende indtil faktisk helper-/priskontrakt er kendt. Hvis helperen ikke kan garantere foreslået$0.05/kald, kan$0.30total ikke garanteres, og web må ikke aktiveres med dette forslag. Ingen ny AI-model eller engine er nødvendig i denne source-del.

## Faktiske kontroller

24pytestcases PASS, herunder faktiske native MCP wrappers, known HA weather fixture, same-name/equal-discovery/schema/epoch/endpoint replacements, alle turn/revisions, cache uden friskhedsforlængelse og in-place schema-revocation,6kalds udtømning, close, cancellation-resistant late reply samt to **backend-payload → faktisk native JavaScript-parser** roundtrips.4Nodecases PASS. Ruff/format og mypy på nyt source-modul PASS; Python compile og ændret JavaScript syntax PASS.

Normal `scripts/dev fast` blev forsøgt og afviste korrekt `/private/tmp` som midlertidig storage. Ovenstående er direkte fokuserede kontroller, **ikke** fast-/releasegate eller fuld CI. Ingen provider, HA tool-call, browserrendering, Green-installation eller fysisk QA er udført her. Uafhængigt primitive-review: GO efter to P2-rettelser (retained expiry metadata samt sand packed forecast coverage). Den efterfølgende faktiske integration har54receipt/native/live/ingresscases PASS samt27primitive/configcases og12Nodecases PASS; Ruff/format og mypy på5berørte servermoduler PASS. Backend→faktisk authenticated ingress→faktisk native ownedAnswers/ownedSource er dækket for weather/web, inklusive cross-room/cross-origin/stale og selector-exhaustion. Tom/ugyldig/ikke-trusted Supervisor-policy er dækket. Ingen betalte tool-/modelkald er udført. Integrationens endelige adversarial review afventer.

## Ændret scope efter primitive-review

Primitive-GO er dokumenteret separat i PodView `docs/reviews/RESEARCH-ENRICHMENT-REVIEW-2026-10-15.md` og dækker ikke automatisk integrationen. Denne senere isolated source diff ændrer `__main__.py`, `config.py`, Supervisor `config.yaml`, `podview_receipts.py`, `podview.py`, `owner-answers.js`, `live-answer-view.js`, `answer-widget.js` og `ui/library/visual-components.js`. Den ændrer **ikke** Thin, OpenAILive, værktøjsdispatch, native MCP, providerbudget, original visual selector eller installerede26-bits. Nyt integreret source-review skal binde disse endelige bytes.

Konkret billigste næste presentation-approval efter review: accepter `completed_receipts_v1` for eksisterende20-kalds selectorloft, uden flere modelrequests og uden ekstra web/Google toolcalls; den eksisterende samtale-AI ejer stadig den faktiske søgning. Dette udvider den tidligere præcise selectorpurpose og må ikke aktiveres stiltiende. Det særskilte6-kalds sourcefetchforslag ovenfor forbliver disabled/unwired, og $0.30 er kun et foreslået helperloft, aldrig en verificeret Gemini-pris. Rig kildecitering/billeder er stadig uafklaret og U16 kan ikke erklæres fuldt fysisk leveret.

Den faktiske eksisterende VisualSelector er desuden afprøvet med MockTransport:6forecast-IDer,≤4KiB request, samme model/256outputtokens/ingen tools, én allowance-reservation og kildekronologi trods omvendt ID-rækkefølge fra model. Den nye case PASS; originalselectorens29regressionscases PASS på uændrede selectorbytes. Ingen rigtig model-HTTP er udført.
