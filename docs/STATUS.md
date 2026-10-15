# Aktiv leadbeslutning · 2.0.32 · sidste konkrete PodView-mangler

Lead: root. Status: **planlagt build; ikke udgivet eller testklar**. v2.X har reserveret32. Basen er faktisk publiceret31, commit `729668ffa45067bfb75fd6928ccac9f9beaf5576`, tree `93491e271a0eaaa7065acc1a72d1d957720c40db`; alle656 kildeblobs er sammenholdt med GitHubs træ og kopieret uændret til denne isolerede kandidat. Nedenstående31-admission er historisk og giver ingen32-GO.

Direkte evidens: Green31 kører med korrekt startupgit/rootfs, HA/MCP og Voice PE-forbindelse. PodView-indgangen virker. Vejr viser faktiske timer/dage, afrunding og Met.no; bylabel er særskilt ændret til brugeroplyst Mårslet, ikke automatisk geokodet. Første musikåbning viser dog deaktiveret Stemning trods cold-setup ready: read-kapabiliteten er koblet til en skrivegrant, som mangler sammen med verificeret native Spotify-ID. Kildeaudit fandt desuden12s browserdeadline mod40s mooddeadline samt manglende særskilt første visual-selection-feedback. Der er ikke målt faktisk model-/rumlatens.

Afgrænset årsagshypotese og plan:

- Bevar normal tale/ThinSession, audio, lifecycle, firmware, provider-/værktøjsschema, autoplay, rum- og startvolumenejere. Kun PodView-læsning/visuel feedback berøres.
- Samordn mood totaldeadline under browserens deadline og giv modelstreamen en faktisk totaldeadline. Bevar TaskGroup-cleanup, busy-fence, ingen retry/refund og eksisterende kort ved fejl. Kandidaten har separat scoped Sol-review; dette er ikke en fysisk hastighedsmåling.
- Adskil autentificeret read-only mood-preview fra skriveautoritet. Preview må ikke indeholde task/options/candidateSet eller opgraderes til afspilning i browseren. Bevar præcis konto, boot/session/generation, observeret owner-epoch, kildeudløb og den allerede godkendte20/dag200/måned-kvote. Eksisterende play-/setup-/action-guards skal forblive uændrede. Navigation bevarer samme kort; kun første musikåbning eller Andre forslag kan vælge nye.
- Vis kun faktisk aktuelt selector-arbejde som et bundet, endeligt pendingfelt. Genbrug eksisterende VoiceSurface-tekst uden ny geometri; lytter/taler er fortsat den faktiske samtalefase. Pending må ikke ændre svarrevision/indhold eller overleve fejl, cancel, owner-/inputskift eller lukning.

Kæde og regressioner: autentificeret frame → eksakt musik-readkonto/owner eller completed visual tool-receipt → eksisterende formålsbudget/selector → kildebunden rendering; afvis stale/krydsede svar efter alle awaits. Ingen ny samtale- eller hjemmehandling. Test read-only uden cookie og nul playmyndighed, ejer-/kontoskift, kortbevaring, timeout med joinede børn, bounded partial-body-cleanup, visual pending→ready/failure/cancel/close samt gamle snapshots uden det nye felt. Adversarial review udføres af anden Sol; brugeren har fravalgt Ultra. Fokuserede checks køres fra usynkroniseret mirror; endelig sammensat admission/CI/publication/install og faktisk Green-prøve resterer.

Separat løbende visual-kvote er stadig ubesvaret og må ikke integreres/aktiveres. Gamle finite20 må ikke nulstilles. Robot-only policy er forberedt med verificeret vacuum og uden musik; faktisk grant/betjening er særskilt. Live-køhop mangler native forekomst-/revisionskontrakt og må ikke erstattes med ny URI-afspilning. Låst UI, Humør-afklaringen og det eksplicit senere skærm-/lysspor bevares.

Rollbackgrænse: hele32-deltaet til immutable31; ingen ændring af31-kilde eller Green under arbejdet. Kvotefiler/engangsreceipts må ikke rulles tilbage for at genvinde kald. De tre isolerede kandidatspor flettes kun som præcise diffs efter review; ny eksakt32-admission og metadata kræves før udgivelse. Ingen samlet færdigmelding eller faktisk AI-/fysisk accept følger af denne beslutning.

---

# Exact32 independent source review (unreviewed placeholder; rejects)

<!-- podview32-admission
{
  "version": 7,
  "kind": "podview32_preview_deadline_feedback",
  "base_tip": "729668ffa45067bfb75fd6928ccac9f9beaf5576",
  "merge_base": "729668ffa45067bfb75fd6928ccac9f9beaf5576",
  "domains": [
    "physical_output"
  ],
  "fingerprint": "b476b1536036bb01dfbf0853f9f11ffae246f00f2cb098021b123d4ffd3a793e",
  "regression_fingerprint": "b6f9feeb5ef5a3fc71e50ac10ef469d6b3ceb6bbcfc76431006754d1058043c8",
  "runtime_fingerprint": "9946831c405a7fc38a51d11d25384f3d5b404775c42a18ad407bb137fd7c00c6",
  "config_fingerprint": "68f5feb69cd3bb7935a7c194ca850e903ee8ddb84fa45975e13cdffafc47a05e",
  "policy_fingerprint": "3db262ab92a0dd8c13cb99eb3de64bc6d01a38e52a566bd76ff39d51283e351c",
  "tooling_fingerprint": "520034bd80f3986c44f3f630b9eb317b47223923cb952666b62f07662b830084",
  "manifest_fingerprint": "e3d0b4744fcfa31ec0fe4fc42b5cf6d1cee49ffbd3e8e0f56acd1c8a9691e639",
  "reviewer": "Independent GPT-6 Sol /root/timer_robot_acceptance_sol; exact32 final source review",
  "rationale": "Independent exact combined32 source/admission GO, 15 October 2026. Review SHA256 d8ee61c6c9ff8d5fe2b7bc0d566304d1a3dcc79665ae1231cc15629894f104df. Causal preview/pending and strict closure verified; CI, installation and Green acceptance remain separate."
}
-->

---

# Exact31 independent source review (historisk baseline)

<!-- podview31-admission
{
  "version": 6,
  "kind": "podview31_mood_playlist_ui",
  "base_tip": "0e56c593c6ce9a3e1666b5fd535d3424cc691b9c",
  "merge_base": "0e56c593c6ce9a3e1666b5fd535d3424cc691b9c",
  "domains": [
    "ha_tools",
    "physical_output",
    "realtime_semantics"
  ],
  "fingerprint": "a6f8158ed06811228c63ccec62953f6631726a6943b2c3e6f55a8bdb9ec1e88a",
  "regression_fingerprint": "bbed80f9e9ce1bd804a817927f0206a5742f6027fb28bcb4c5b870603367aa4d",
  "runtime_fingerprint": "3cae433dd5bdf13e63f1f94008d9a14115bc5812aff37396b8095b638d3b11d1",
  "config_fingerprint": "f90690b3174c5b96ca0c9931d85e6a55b3ac4a109358238bbc9dd9976efb277f",
  "policy_fingerprint": "ff7c810ba97be9f01f849ea48b39d08576611a1df473898f4d46446cd03adda3",
  "tooling_fingerprint": "520034bd80f3986c44f3f630b9eb317b47223923cb952666b62f07662b830084",
  "manifest_fingerprint": "881cfac0f8189a44bf62d4dd975dced09b120a1684452acb1535ce4c5c1fa665",
  "reviewer": "Independent GPT-6 Sol /root/ongoing_operator_review_sol; test-only CI repair report SHA256 c8ec610a33c60bff5911f672f386831c0d1fd904a469ade58e68dabe0ee76c14; runtime source GO retained",
  "rationale": "Only the formatting-sensitive startup test changes: execute the shipped assignment for failed/successful setup and assert zero/one exact factory calls. Independent negative mutations prove missing guard and wrong arguments fail. Runtime, config, tooling and assets unchanged; six pin maps and actual staged domains close exactly."
}
-->

# Cold setup implementeret · kildekandidat / ikke installeret

Ny Supervisor-ejet podview_mood_setup_policy er optionalstr/defaulttom. Kun eksplicit cold pre-selector wrapper med canonical settingsparent og præcis20/200godkendelse kan klargøre ledger. Request binder godkendelse, quota-fingerprint, operatørnonce og eventuelt faktisk finitehash; receipt binder også fuld policy. Pending fsynces før reviewedprovisionkernel, complete genåbner kun eksisterende ledger; tab/korruption/ændring/optionclear kan ikke refille eller omgå consumedstate. Generisk ready/rejected-log uden raw config. Den faktiske gamle proces skal observeres stoppet af v2; wrapperen påstår ikke at verificere det. Ingen generisk API, exec eller automatisk ongoingbootstrap. Ny kilde afventer visual_chain_review_sol scoped review og finalepins/CI. Runbook opdateret til faktisk tilgængelig Supervisortransport; ingen CLI/private-dataadgang eller Green/providerhandling udført her.

---

# Aktiv leadbeslutning · kold engangsprovisionering ·15. oktober2026

Faktisk operatørkontrol fandt ingen eksisterende transport til at køre CLI-scriptet i appens private /data. Dette er en konkret leveringsmangel; CLI-review er ikke aktivering. Lead autoriserer planlagt minimal, særskilt eksplicit og default-off pre-runtime-provisionering inde i den nye31-proces, før nogen mood-selector/ledger-ejer konstrueres. Supervisor-installationen skal først have stoppet den tidligere proces. Ingen generisk shell/exec/fil-API, ingen automatisk provisionering alene fordi ongoing-policy er udfyldt.

Engangsanmodningen skal binde eksakt godkendelsesreference og policyfingerprint; kun canonical mood-ledger ved den faktiske settings-path, aldrig en browservalgt sti. Reviewet budgetkernes open-only-adfærd og visual20 forbliver uændrede. Frisk tom tilstand må kun oprettes ved særskilt operatørtilvalg; eksisterende finite-ledger kræver eksakt hash og fuld prepaid-carry. Et varigt engangsreceipt skal forhindre gentagen bootstrap ved genstart eller mistet ledger; ubestemt/partial state afvises uden sletning/nulstilling. Log kun ufølsomt udfald. Separat adversarial review, kausale tests og faktisk Green-readback kræves før aktiveringsclaim. Dette er planlagt build, ikke gennemført provisionering.

---

# Aktiv31-beslutning · løbende Stemning ·15. oktober2026

Direkte menneskelig godkendelse `call_995d972f52084767a6f728e3706488da`: løbende20 modelkald pr. dag/200 pr. kalendermåned, Europe/Copenhagen, indtil deaktivering; ingen carry/refund/retry. Samme Luna,4KiB/128 outputtokens, eksisterende providerkoordinator og canonical mood-ledger. Separat reviewed ongoing-mode er integreret som eksplicit opt-in; finite-policy virker fortsat, ingen automatisk migration/provisionering, ingen ændring af visual-budget. Initial musiksession/eksplicit Andre forslag kan vælge3temaer; navigation/baggrund må ikke rotere kort.

Planlagt build: crash-safe reservation før HTTP, off-loop diskvent, ownercheck efter await, persistent kalender/high-water og afvisning af policy-/ur-/filfejl. Budgetkernen genbruger reviewede bytes fra a2296540-patch; nyt offline operatørscript/runbook kræver særskilt review. Installationsansvarlig skal faktisk observere stoppet proces før bootstrap/migration; --owner-stopped er kun en operatørerklæring, aldrig teknisk bevis. Eksakt v1-hash og hele prepaid-tallet bæres med. Ingen faktisk ledger, provider, installation eller aktivering udført her. Se [operatørvejledning](MOOD-ONGOING-OPERATOR.md). Faktisk kontrol i unik SHA-verificeret /private/tmp-mirror:74 fokuserede syntetiske mood/ongoing/operatørtests PASS, ruff PASS og mypy på4 ændrede kildemoduler PASS. Første sandboxkørsel af loopbacktests afvistes på lokal socketbinding; samme tests bestod med godkendt lokal loopback. Slut-scope/review/officiel CI og installationsevidens resterer.

---

# Aktiv31-latensbeslutning · Stemning · 15. oktober2026

Lead root har autoriseret tre parallelle, uafhængige playlist_search-læsninger inden for eksisterende fælles deadline. Bevar model-/readantal, fast temarækkefølge, ét samlet kandidatsæt, konto/epoch/grant/session-fences og native playback. TaskGroup skal afslutte alle børn ved fejl/annullering før busy-fence frigives; ingen retries, timeoutændring eller ongoing-budget. Planlagt build: barrieretest for alle tre samtidige reads, owner/session-skift og cleanup før publicering. Kildechecks er ikke faktisk latens- eller Green-bevis; uafhængigt review/freeze kræves.

---

# Active31 weather decision ·15 October2026

Observed Green cause: actual deployed weather_forecast HA script defaults forecast_type=daily on {}; result.location is hardcoded hjemmet, source is Home Assistant / Met.no. Its explicitly declared optional forecast_type selector supports daily/hourly; actual HAentity supports both and attribution confirms only Met.no. Hypothesis: same admitted current MCP declaration, only if its actual JSON schema explicitly declares/validates forecast_type, can supply separate daily and hourly projections without a second weather owner or fabricated periods. Preserve legacy one{} read otherwise.

Authorized implementation: same-owner bounded daily+optionalhourly read, atmostonecall each/noretries, existing source freshness/projection, independently timestamped auxiliaryhourly; exact source/location/units join, dailyretained onauxfailure, wholecall invalid afterownerreplacement. Retained renderer may show actual daily ranges+next12hourly and source-bound nextperiod guidance; noforecastinference/cityhardcode/geocode/newgrant/AIactivation. Root explicitweatherUI fixes: roundeddisplay rawprecisionretained, fixed actualprovider-only footer noHA/Omfoldout. live-home-view timeridentity may bindauxiliaryhourlyadviceexpiry tosamecurrentowner.

Checks required: declared vs undeclared argument schema, malformed/foreign/stale auxiliary, changed owner during eitherawait, finite shareddeadline, dailyretention/no partialauthority/retry, rendererretention/adviceexpiry; syntax/npmtests plusfocusedruntime/type/lint inuniqueverifiedtmpmirror. Independent31review/finalinventory/officialCI/Greenactualhourlyproof required. Rollback: revertthis31candidateweatherdeltaonly; no30Greenruntime rewrite. Current31pins are provisional untilthisweather/routingfreeze.

---

# Aktiv beslutning · 2.0.31 · Stemning-playlister og aktuelle PodView-assets · 15. oktober 2026

Lead: root. Status: **planlagt build / ikke testklar**. Denne særskilte kandidat starter ved faktisk merged30 `0e56c593c6ce9a3e1666b5fd535d3424cc691b9c`, tree `a6ef597698c86e963145c0832bfce75a746a43a8`; nedenstående 30-beslutning og dens coupling/review er historisk baseline, ikke admission eller GO for31. Ændrede runtime-, config-, regression- og UI-bytes ugyldiggør de tilsvarende gamle scopefingeraftryk. En ny præcis31-profil, uafhængigt review og officiel slut-CI kræves før merge/release. Ingen providerkald, grants, betalt aktivering, installation eller fysisk prøve følger af denne kildeintegration.


Ny direkte Green30-evidens ugyldiggør routingfreeze: autentificeret browser åbner ydre `/23375871_podvoice/view`, men iframe bliver i PodVoice-home og sidebaren bliver synlig, også efter reload. Årsagsfund før patch: Core2026.8.2 pinner officiel frontend20260729.7, hvis `ha-panel-app` altid anvender `computeRouteTail`; dedikeret apppanel kan derfor sende hele `/view` i `route.prefix` og tom `route.path`. De gamle tests opfandt kun `route.path=/view`. Hypotese: binding af den samlede officielle `prefix+path` til præcis den aktuelle same-origin parentroute retter bootstrap/kiosk uden en privat ingresstoken-genvej. Plan: faktisk DOM/messageform fra den eksisterende autentificerede browser, regressionsfixture af den pinned frontendkontrakt, samme root-/viewhelper, strikt origin/source/parentpath, BFCache/pagehide og ingen navigation af fremmed panel.31-admission skal genpinnes efter denne afgrænsede routingrettelse; før30-kandidaten ændres ikke.


Routingrettelse i31: samme eksisterende `ingress-kiosk.js` ejer nu rootbridge og PodView. RootHTML indlæser modulet relativt gennem samme autentificerede ingress, og begge retninger kræver trusted parent/origin, officiel `route.prefix+route.path` lig præcis nuværende parentpathname og den allerede bundne appbase. Ingen ingresstoken udledes til en offentlig eller permanent URL. Legacy direct iframe, modificerede klik, pagehide/BFCache og fremmed/stale route er dækket. Aktuel Green30-DOM fra v2: outer home→`/23375871_podvoice/view`, iframe beholder rootside og relativ `view/`-anchor; ingen navigationfejl. Faktisk postMessage-payload er **ukendt**. Bugårsagen er derfor en kildeunderbygget inference mod den direkte DOMfejl, ikke en observeret messagecapture. Core2026.8.2s officielle frontendpin er20260729.7; de to pinned TS-kilder og hash er bevaret i den ydre checkkvittering. Root308/308 og faktiske packagedrouting9/9 bestod efter rettelsen; syntaks/diff-check bestod. Routing/HTML/manifestfingeraftryk er nye og skal genpinnes efter rootens igangværende vejrsvarrettelser. Uafhængigt review og reel Green31-route/kiosk/reloadaccept mangler; ingen routing-releaseGO påstås.


Ny afgrænset visualbeslutning fra root: brugerens GO omfatter faktisk AI-færdiggørelse; aktivering holdes separat. Ændring før kode: før kun faktisk completed call-ID/query ind i den eksisterende finite20-selector, aldrig seneste transcript eller en ny model/search. Det eksisterende weboutput må kun deles ved hele korte tekstgrænser; ingen genererede faktaværdier/citater/billeder. Lange tvetydige afsnit kræver konkret helperkontraktforslag og må ikke kaldes semantiske facts. Adskil allerede valgte immutable read-only-kort fra aktiv skrive-/samtaleautoritet: kun normale closekanter kan bevare dem, oprindelig120s/sourceexpiry gælder, og nyt input/session/owner samt fejl/stop/privacy tilbagekalder. Pending/stale selectorarbejde må aldrig blive admitted efter close. Regression: faktiske Thin query/call-bindinger, source-shaped helper→kendte factIDs→faktisk rendereradapter, normal close→inaktiv snapshot/session-null→kildelæsning, stop/error/newwake/newinput/expiry og nul sideeffekter/ekstra I/O. Det nye read-only flag er ingen pairing, controlgrant eller taskownership. Uafhængigt Sol-high-review kræves på sammensat diff før admission/CI/release; ingen policy aktiveres her.

Faktisk implementering og scoped Sol-review: kun accepteret completed tool-query med exact call/task/input/session/provider/owner-binding føres til eksisterende finite20-selector. Hele korte source-sætninger/linjer erstatter vilkårlige80-tegnschunks; lange tvetydige output afvises. Allerede valgte read-only-kort overlever normal close uden ny deadline, pairing eller skriveautoritet. Stop/privacy/error tilbagekalder synkront, også hvis et normal-close-task allerede kører.24 blokeret-teardown-regressioner på VoicePE/Talk/Live består; independent reviewer reproducerede den oprindelige fejl og bekræftede rettelsen.126 fokuserede visual-Pythoncases:120 sandboxPASS plus6 HTTPcases alene socketblokerede, derefter6/6 autoriseret loopbackPASS. Ruff/format, syntaks og mypy78filer PASS. Ingen provider/HA/model blev kaldt.

Forrige samlede staticpakning før den sidste3filsvejrrettelse:131 aktuelle rootassets byteidentiske,45 normaliserede root-testfiler, root324PASS, faktisk packaged350PASS. Manifest SHA-256 `bfc5fbe4ae5b6a0287eb52e49e201f95a44c5bf5d6e52e20cebb4e5e4c8889cd`; tidligere manifesttal nedenfor er historiske/ugyldige som aktuelle pins. Pakningen indeholder rootens rain/wind/fade, stabil home/SSE-rækkefølge og neutral robot-history tomtekst. Faktisk første musikåbning er nu initial modelgrænse; kontoindlæsning på Ro/Lige nu kalder ingen moodAI, senere navigation bevarer kort/fane. Scoped first-music-opening independent Sol-review gav GO;7 fokuserede tests bestod. Siste weather-fixturefreeze er med: fast lokal replay af de12 faktiske captured timer, uden at fremstille fixtureby/dato/currentværdier som livebevis. Final ny komplet SHA-synkroniseret mirror med cold-setupmodulet består også mypy --no-incremental på79 kildefiler. De tidligere rapporterede to visualtypefejl kom fra en byteafvigende gammel cold-mirror; aktuelle GO-hashes krævede ingen rettelse. Aktuel sourceinventory ligger uden for repo i `integration/podvoice31-checks/source-inventory.json`; nye kolde mood-setup-/admissionændringer kan kræve nye pins. Faktisk31route/Green, spørgsmålssvarsrelevans og visuel/fysisk accept er ikke givet; ingen installering, budgetprovisionering eller CI/releaseGO her.


Observeret problem: Stemning har ingen reelle playlistvalg i30, mens nyere rootUI har separate svar-/modal-/offlinerettelser, som ikke er i den gamle pakke. Hypotese: den snævre isolated playlistpatch kan genbruge de eksisterende model-, source-, selection- og native command-ejere og samtidig pakke præcis nuværende rootUI uden at genindføre en ældre UI-kopi. Kæden er parret frame → særskilt default-off coarse time/room theme selection → exact-account playlistcatalogue → ét sourcebundet sæt → samme opaque voice/touch options → eksisterende native prepare/commit/context playback. Ukendt effekt gensendes ikke. Voice PE, GPT-Live/ThinSession, startvolume, autoplay, close/rearm og firmwareejere bevares.

Plan før freeze: afvent tema-ejerens stabile minimalpatch/receipt; anvend kun dens PodVoice runtime-/testhunks; bevar hele baselineSTATUS; merge eventuelle aktuelle rootUI-hunks uden at overskrive nyere UI; pak alle aktuelle rootdist-assets og normaliser de tilhørende tests; bump de tre eksisterende versionsfelter til2.0.31 med sand CHANGELOG; kør kun berørte syntaks-/pytest-/JS-kontroller fra usynkroniseret prøvekopi. Strict31-admission ejes separat af lead/reviewer; denne implementering må ikke selv give GO. Scope: separat Supervisor-owned tom moodpolicy, separat formålsbundet finite allowance, exact session/task/revision/account/epoch, retained tre kort, explicit refresh og nul implicit modelkald ved navigation/authority renewal. Rollbackgrænse: denne31-kandidat, med merged30 uberørt. Fysisk lyd, spørgsmålssvar-relevans, browser-/Green-paritet og husstandens voice/touch-accept er fortsat ubevist på31.


Første integration før routingrettelsen (manifestet nedenfor er nu ugyldigt som endeligt31-pin): den stabile isolated PodVoice-minimalpatch `27f669b14e2aa53b9982ca6f8c6869e56ccf056b569f1ec2ac0e1b9bd25351f5` er anvendt rent mod merged30, uden at kopiere dens gamle STATUS eller gamle UI. Den afgrænsede temaudvidelse har lead-kildereview; P2-fornyelsesrettelsen har sin separate uafhængige kildekvittering. De fem statiske moodhunks er flettet på aktuelle rootfiler, og alle131 nuværende rootassets er pakket byteidentisk med eksisterende packager. Assetmanifest SHA-256: `6853202369aa1a4f37312648b58995e10f4a8dc17bb8c10dce791e7241d43024`.43 root-testfiler er normaliseret til pakkens faktiske importstier; særskilte eksisterende ingressregressioner bevares. De tre versionsfelter er2.0.31. Coupled playlistservice kræver den særskilte Control0.10.13-kandidat; Speakers0.26.19-ejeren er uændret.

Faktiske fokuserede kontroller på bytekopi i `/private/tmp`, med eksisterende Python3.12:144 pytestcases bestod først;48 lokale HTTP-cases blev blokeret alene ved sandboxens loopback-bind og bestod48/48 i den målrettede autoriserede genkørsel. Ingen provider/HA/Spotify blev kaldt. Den første forkerte teststi gav ingen testkørsel og er bevaret som toolingfejl; sandboxrun er også bevaret. Ruff/format på14 berørte filer og mypy på70 gatekeeperfiler bestod; ændret Python/JS-syntaks og diff-check bestod. Aktuelle rootJS:300/300 PASS; efter afsluttet pakning faktisk packagedJS:330/330 PASS. En tidligere316PASS blev kørt før pakningens afslutning på gammel prøvekopi og er udtrykkeligt ugyldig som31-evidens. Endelig31-admission/CI er ikke kørt eller godkendt af denne implementering; nye policyfingeraftryk og uafhængig freeze-review ejes separat.

Policy forbliver tom/default off. En fremtidig særskilt reviewed policy kræver præcis `purpose=podview_mood_v1`, eksisterende `gpt-6-luna`,1–20 requests, grov roomkind og approvalreference; request≤4KiB, output≤128tokens,4s timeout, separat formålsmarkeret allowance og ingen retry/refill. Navigation og authority renewal genererer ingen nye temaer eller modelrequests. Der er ikke oprettet virkelig policy/allowance eller controlgrant. Ingen ny web-/visualproducer, samtalemotor, firmware-, mic-, latency-, startvolume- eller autoplaypolitik er indført. Visuel widget er fortsat ikke godkendt; browser/Green/assets-readback og egentlig fysisk lyd/voice/touch/relevansaccept mangler på denne kandidat.

---

<!-- candidate-scope-coupling
{
  "version": 5,
  "kind": "podview_native_source_ui_parity",
  "base_tip": "beed27b0528917e4872516a53d88bedb17d3d6ed",
  "merge_base": "beed27b0528917e4872516a53d88bedb17d3d6ed",
  "domains": [
    "ha_tools",
    "physical_output"
  ],
  "fingerprint": "74ea9dfc454b2834912bd967baa1ba0a2d213a02778ad7a56b27da2dfcd956bb",
  "regression_fingerprint": "1698407dd8a78227f457535afbe06d19874470bf82e06a2702a31bb510dff8c1",
  "policy_fingerprint": "1ba69b0d815d54507a2dc5d766a53faffb00bdc478e6316da621dd268a212da2",
  "config_fingerprint": "16115112cc71407eff6710402a473d0fc1bdae49cba124a4af1d21fbf5c58e17",
  "manifest_fingerprint": "ac9b6a75ca687dc93aa7357f7d8291777516a71e09116929aa1e99c7b3fa4fd8",
  "reviewer": "independent GPT-6.1 Sol Ultra / final_freeze_ultra / 2026-10-15",
  "rationale": "Independent final source GO on exact PodVoice30 and coupled PodConnect native05be2aec. Exact closed runtime and regression inventory; historical policy guards retained. Actual domains include ha_tools from existing large-diff weather text. CI, image, installation and physical acceptance remain pending. CI fixture repair: observed empty permits start; existing owner ID blocks new start and remains cancellable. Independent scoped delta GO confirmed by final_freeze_ultra; runtime and config unchanged."
}
-->

# Aktiv beslutning · samlet PodView UI/data-paritet · 15. oktober2026

Lead root. Status: planlagt build; 2.0.30 reserveret og forberedt, ikke installeret/testklar. Bruger bestiller samlet Green-installation med låst demoUI og fortsat parallel udførelse. Ny base er public2.0.29 a1bdc2ba1cf9e80f62874e4764586ec10d6d8042 med docsopfølgning beed27b0528917e4872516a53d88bedb17d3d6ed; tidligere28-base er historisk. v2.X har bekræftet29 publiceret, Green sidst28;30 er efterfølgende reserveret; deres opfølgende docsændringer skal bevares.

Observeret: Green bruger afvigende live widgets; lokale kort/playergeometri og tilstandsrettelser skal deles med native runtime. Reviewede isolatedinputs er native startpolicy0d1231e9, PodVoice native roomcontractb150a929, kiosk71673c69, hourly adviceb224b418 og fælles rootUI. Hypotese: fælles renderere + eksplicitte dataadaptere giver samme UI uden at tildele passive data ny autoritet. Native Speakers ejer startvolume/autoplay; PodVoice ejer serverissued valg og GPT-Live samtale; viewer er ingen grant. Ukendt effekt gensendes ikke.

Kæde: autentificeret HA-frame → room/account/source/ownerepoch → sourcebundne candidateIDs → paired serverissued option/session/task/revision → native prepare/readback/oneusecommit → provider/nativeobservation → samme player. Udløb, tab/boot/accountskift, revocation mellem awaits, duplicateclick og pagehide er nabogrænser. Timer/robot retain autoritative IDs og ingen simulerede data i live. Ingen Thin/firmware/prompt/providerændring; public29 GPT-Live-only/full-duplex/CI bevares.

Plan: compose exact reviewed narrow patches, ret faktiske mergekonflikter uden at genindføre28runtime; målrettede regressioner via durable scripts/dev fast; strict existing admission profiler skal udvides/reviewes til faktiske ændrede bytes, ingen gatebypass; uafhængigt adversarial review og exactmanifest; officiel PR/main/ARM64CI; faktisk Greenversion/assets/datareadback før testlink. Fysisk lyd/robot/iPadaccept rapporteres særskilt. Rollback: bevaret installeret28 og public29, nye grants/betalt AI er ikke aktiveret her.

Nye produktkrav til Stemning (ikke foregivet færdige): rigtige playlister, egen AI ud fra lokalt tidspunkt/rum med matchende skiftende illustrationer, kun initialload/Andre forslag ændrer indhold; fanenavigation bevarer valg. Autoplay næste+lignende er eksisterende nativeadfærd som skal bevares og verificeres. Humør som mulig nyfane er under brugerafklaring; ingen lydløs ny fane eller playlistfallback. Original20visualfactselectorbudget giver ingen ny moodAIudgift.

---

# Aktuel status · 2.0.29 leveret / resterende produktarbejde · 15. oktober 2026

**Lead:** root. V2.x er **kun GPT-Live med full duplex** for Voice PE og Talk.
Brugeren har præciseret den allerede valgte retning; det er ikke en ny featurebestilling.
Mit tidligere #164-P1-fund og #156-dokumenternes krav om lukket mic under svar var
forkerte anvendelser af en v1.x-kontrakt. De er trukket tilbage; intet mic-gatefix laves.

## Leveret og installeret er adskilt

**2.0.29 er publiceret:** PR #165 er merged som `a1bdc2ba1cf9e80f62874e4764586ec10d6d8042`,
exact tree `e670ecc2de6a235e68a0228e2c97b1e17a633c7e`. Slut-PR-CI
[38705578552](https://github.com/BixelVentures/podvoice/actions/runs/38705578552) og
[main-CI/publisher 38706448103](https://github.com/BixelVentures/podvoice/actions/runs/38706448103)
er grønne. Versionstag 2.0.29 og source-SHA-tag er faktisk pushet med digest
`sha256:3ad2d0a886cd294cf430ec85aed37cc85c433a467749666c2e4b56da6f117376`.
#156 og #166 er lukkede med leveringskvittering; #157 har den samlede opfølgning.

**Frisk HA-readback 15/10:** PodVoice-panelet viser v2.0.28/status live efter reload.
HA/MCP og PodConnect vises verificeret; Voice PE-vækning er ikke bekræftet. Dette er
ikke en image-digest-, lyd-, barge-in- eller lifecycleaccept. Root har ikke installeret,
genstartet eller flashet noget; den fysiske prøveversion er ikke ændret herfra.

## Aktivt arbejde · parallel færdiggørelse uden ny fysisk serie

Brugeren bestiller hastighed, recovery, mobil/settings og stabilitetsarbejde parallelt
med mindste tilstrækkeligt kompetente agenter. Tre GPT-6-Luna/medium-spor har gennemgået
de konkrete rester; runtimeændringer kræver fortsat årsagsbevis og leadbeslutning.

- **#113:** den manglende navngivne Supervisor-rollbackvej er nu skrevet i add-on-DOCS
  og uafhængigt kontrolleret mod config/settings-kilder og officielle HA-backupdocs.
  App-backup gendanner version/data; panel-`.bak` alene gør ikke. Ingen rollback udført.
- **#150:** den faktiske HA `google_web_sogning`-YAML er nu læst. Den bevarer
  `response_type=error` som eksplicit `ok:false` med kode/besked; den gamle påstand om
  ulæst konfiguration er ophævet. Én offentlig, syntetisk URL-søgning er kørt uden
  Voice PE. Efter brugerens konkrete godkendelse blev den gemte Sporing læst:
  15/10 kl. 10.49.11–10.49.12, 1,03 s, `response_type=action_done`, efterfulgt af
  `result: {output: https://www.home-assistant.io/}` og normal afslutning. Ingen
  script-, agent-, nøgle- eller driftsændring. #150's software/backendrettelse er
  afsluttet; #119 og fysisk Voice PE-/Talk-funktionsaccept står separat åbne.
  Den første automatiske afvisning og den efterfølgende brugergodkendelse bevares
  som proceshistorik; ingen ekstra kørsel blev brugt til at læse resultatet.
- **#153:** et eksisterende syntetisk spor er fundet i
  `/private/tmp/pv24-timer-close-results-20261014/candidate/baseline-timer-10s/`.
  Provider-PCM bliver ikke-nul omkring 12,499 s; providertranscript er `Mm.` ved
  12,532 s, før timerdelegation/resultat omkring 13,588/13,590 s. Prøvens promptfil
  er bundet til `a4d5b82c0567954119b5648666ff9e89f58d43c1` / SHA-256
  `96534d2c3682e8896c2871f3a769ecbc203bf540157e95d4967409a3167d736c`.
  Det er den GAMLE prompt uden det eksplicitte forbud mod ikkeverbale kvitteringer,
  som blev tilføjet i `975936bb1d6fd57a5089cc72b9ca778eee8c7757` og bevares i 29.
  Aktuel promptfil SHA-256 er
  `1f10f64d44962dc905c5a0f77882d9c62c89ee84cda867664810d03bb5c1b050`.
  Sporet beviser provider-output i dén gamle prøve, ikke en aktuel promptfejl, lokal
  timerkvittering eller den konkrete feltlyd. Rapporten forbliver FAIL; ingen rumlyd/
  akustisk accept arves. Ingen ny promptpatch er begrundet af denne prøve.
- **#104–107:** ingen ny målt fysisk flaskehals eller kildebevist unødig ventetid.
  Lukkegrace er ikke første-svar-latens. Ingen blind ændring af prompt, buffer eller timeout.
- **#109/#111:** eksisterende recovery dækker bounded probe/backoff, atomisk discovery,
  stale schema/generation og ingen genafspilning af side effects. Ingen ny kildebevist
  fejl er fundet; reel HA/Connect recoveryaccept står fortsat åben.
- **#115:** readiness/settings-koden og de eksisterende browserregressioner dækker
  kendte fejlveje. Faktisk HA-app/Safari/VoiceOver/tastatur/safe-area mangler fortsat.
- **#116:** syvdøgnsperioden er ikke startet som godkendt stabilitetsbevis. Den kræver
  accepteret samme artifact; observation er ikke flere ugers kodearbejde.

Denne opfølgning ændrer kun dokumentation/kvitteringer. Ingen ny produktversion,
providerprøvesuite, testplatform, firmware-, prompt-, lyd- eller lifecycleændring.

## Afsluttet beslutning · #164 og oprydning af forældede krav

**Observeret fejl:** docs/agentkontrakt blandede v1.x-half-duplex og Realtime-wirekrav
ind i GPT-Live v2.x. Det gav et fejloprettet P1-issue. Kilden og den eksisterende
`test_selection_is_next_wake_and_stop_rejects_stale_stream_and_generation` i
`tests/integration/test_thin_live.py` kræver derimod mic-append under native playback.

**Kæde og invarianter:** firmware → VoicePELink → ThinSession/Live-input → GPT-Live →
outputstream/Live WAV → fysisk playback → afbrydelse/opfølgning → close/rearm/næste wake.
Aktiv session, privacy, connection/audio-generation, inputrevision, toolpolicy,
confirmation-rotation, fysisk output og én teardown/rearm bevares. State er lifecycle,
ikke et påbud om at lukke Live-input mens modellen tænker/taler. Transcript-fragmenter
må ikke opfindes som speech-start/interrupt-ACKs eller bruges til lokal semantik.

**Hypotese:** den konkrete #164-P1 er kravdrift, ikke en runtimefejl. Den falsificeres,
hvis Live-input under playback ikke er tilsigtet i gældende v2.x-retning; brugerens
præcisering og eksisterende kausale regression bekræfter netop denne retning.
Åben mic beviser ikke akustisk sikkerhed eller hørbar afbrydelse. Kilden har ingen
almindelig Live-inputfragment→stop_playback-kobling; provideren kan ændre sin løbende
outputstrøm. Det faktiske hørbare resultat er ikke afgjort af denne audit. #112/#103
følger full-duplex-input/afbrydelse/fortsættelse uden selvsvar, lukning og næste wake.
Der oprettes ikke en ny feltfejl alene ud fra manglende lokal interrupt-callback.

**Faktisk docsændring:** AGENTS, detaljeret agentkontrakt, README, INVARIANTER,
PRODUKTMÅL og ARKITEKTUR beskriver GPT-Live-only/full duplex. Gamle provider-vælgere,
closed-mic-gates og fabricated Realtime-ACKs er ikke v2.x-produktkrav. Historiske
Realtime-regressioner beholdes særskilt, ikke som en parallel produktionsmotor.
Native `full_duplex=False` er et legacyflag; Live-pump bypasser det eksplicit. Flaget
ændres ikke blindt, fordi andre grene også læser det.

**#166 og CI-hastighed:** brugeren bestiller hele projektets docs-/agentoprydning og
integration af #157's udviklings-/CI-forbedringer med #156. Alle 29 eksisterende
Markdown-filer plus nyt indeks er dækket. Direkte kildefund: Dockerfile kopierer
requirements/gatekeeper/run, ikke top-level DOCS/CHANGELOG; CI's `podvoice/**` tæller
alligevel disse som imageændring og kan udløse unødigt build/immutable-versionfejl.
Den afgrænsede hypotese er, at en eksakt nonpayload-allowlist og korrekt imagefilter
fjerner dette arbejde uden at lade nogen payload-/config-/workflowændring passere.
Kæden er changed paths → scopeklasse → required checks → addonchanged → immutable
publisherguard. Ukendt/escaped/ægte payload forbliver fuld CI; gatekeeper-Markdown må
ikke skjules generisk. Planlagte regressioner er positiv docs-only og negativ
config/requirements/run/Docker/gatekeeper/workflow, samt faktisk filtermatching og
bevarede guardtests. Uafhængigt review binder ændringen før freeze. Rollback er det
samlede CI/tooling-delta; versions-/publisherautorisation omgås ikke.

**Faktisk #166-CI-rettelse:** samme `git diff --no-renames -z` leverer tooling_only,
addon_changed og pr_addon_changed. Kun to eksakte top-level add-on-docs og to
script/spike-guides får nonpayload-undtagelsen; escaped/backslash/symlink/missing
paths og ukendt scope narrowes ikke. En eksisterende ikke-forfader afvises før diff.
PR-imagebuild og main immutable-guard bruger samme vurdering; dorny-dobbeltfilteret
fjernes. Reelle payload-/config-/workflowændringer beholder kontrollerne.

**Faktiske kontroller/review:** eksisterende CI/release-kontrakttests bestod samlet
50 cases før sidste rene parameter-/ancestrytilføjelser; kun scopefilen blev derefter
genkørt, sidst 47/47 PASS. Release-kontraktbits genbruges; metadata-versiontesten
og hele den berørte syntetiske music-scope-fil bestod efter 29-bump. Ruff/format og
diff-check PASS på ændrede Python-filer; 30/30 Markdown-links findes. Ingen ny lokal
bred suite, testplatform, provider- eller fysisk prøve. Den første linkscan læste
Git-quoted Unicode-navn forkert; kun den scan blev rettet til NUL-skilte filnavne.
Sol-reviewer(e) GO på docs/metadata/fixture; selvstændigt Ultra-review GO på CI ved
scopehash `cd6dcf898ec50710ac0cd6cee5cd8831395f3d97f7c4446f2e865504d759acd8`,
testhash `f3fc46593dbd86a440616f3ce24af95beb6360fdba3ced7f914a02230f44582c`,
workflowhash `05111a17f2c488af78618ee6aec75da2f749ddb7802d609c607209d29bc5430e`.
Ancestryfinding er lukket med permanent actual-Git-regression. Ingen uløst P0–P2
på det reviewede diff. Sidste mekaniske scope PASS mod main e272d181.

**Afgrænsning:** #166 ændrer docs, præcis CI-scope og issues; #156's tidligere
reviewede konstruktions-/replay-/packagingændring leveres samlet med version29.
Thin/provider/prompt/schema/audio/firmware ændres ikke. PodView28 bevares.
Slut-PR/main-CI og publisher er nu PASS som registreret ovenfor og i PR/issues.
Denne nye opfølgning er særskilt docsarbejde; fysisk accept står stadig separat.

**Ny leveringsordre:** brugeren beder nu om at merge alle færdige ændringer, så nyeste
samlede version er klar. #165/#156 og #166 samles derfor i én 2.0.29-kandidat fra
seneste udgivne 2.0.28. Versionbump er nødvendig, fordi #156 ændrer faktisk image-
payload og den immutable publisher med rette afviser genbrug af 28. Kun metadata,
release-note og den versionsuafhængige syntetiske scope-fixture ændres yderligere.
CI/source-review og første officielle slut-PR/main-CI åbner merge/publicering; ingen
manuel CI-retry uden faktisk invalideret årsag. HA/Voice PE installeres eller flashes
ikke af denne ordre: den eksisterende fysiske prøveversion står urørt. Rollback er
forrige immutable image; en ny udgivelse arver ikke fysisk accept.

## Slut-CI · afgrænset fixtureopfølgning

Første slutrun [38703933906](https://github.com/BixelVentures/podvoice/actions/runs/38703933906)
på head `beb12fc0e4b336d5f712b238fddcf75de269fafc`, tree
`741b8eb02e13cf88c896185f2f02065fd5be138e` bestod scope, rest, browser og ARM-build;
unit fejlede på to gamle `test_dev_cycle.py`-assertions om det fjernede dorny-filter.
Lead havde ikke fanget disse to kaldesteds-/workflowfixtures før freeze. Run bevares
som fejlet. Kun de to assertions er opdateret til den faktiske fælles scope-/publish-
kontrakt; hele assertionkæden og øvrige referencer er gennemgået. De to noder bestod
2/2, Ruff/format/diff-check PASS. Lead-review bekræfter bevarede parallelle ARM-/
main-checks og immutable guard; fixturehash
`ba734d0c5fceb6dc214dc1bcb75b95887afb4862e92bc15c85077e7d15b145a6`. Der følger ingen
runtime-, version-, CI-policy- eller payloadændring. Tidligere produktchecks og
reviews genbruges; kun de to berørte noder og filens statiske checks køres lokalt.
Kravet om ny officiel exact-head CI og derefter normal main-publisher er nu opfyldt.
Endelige kvitteringer står ovenfor og i PR/issues; ingen tests eller produktbytes
blev ændret efter den beståede kandidat.

## Kilde- og leveringsbinding

29-produkt-/metadatamanifest SHA-256: `6cfd0eb10f1cbbce389759e3a65161435154b249d5f6d2cc6a263455081a4020`.

```text
678af0c37f5103309f02116565b8721ec089d96ce318eebbacee1c9935f82ce4  podvoice/.dockerignore
ab77f51966601e0f0a4079b2c070e1ac23ddfa797a8fa883cb90a3cf417e482f  podvoice/gatekeeper/__main__.py
e5e06a851f18b14d434893271fa80a1c27a512f9c27550a2ba57a69a141c2a59  podvoice/gatekeeper/eval_harness.py
4523f241e408ed224785f5ac5a0352b11a552bc9d7fbc4544d0f2b3f04507510  podvoice/gatekeeper/web.py
31279c153f2c79a6e3e36f88e8423485e08363dc282c012b029e37605ef95df8  podvoice/gatekeeper/__init__.py
ea1fa533eef3530200bde92649bdb3ba853eff7fdfac45d981605120b0b4d12f  podvoice/config.yaml
cafba1b85e0c2dc535a5124ded432afcf7a7572306056c63da2552e0f01d2898  pyproject.toml
```


- PodVoice main / udgivet 2.0.29: `a1bdc2ba1cf9e80f62874e4764586ec10d6d8042`.
  Forrige udgivne 2.0.28 var `e272d1813930b819c019ca48469bf6f796f4fec0`.
- Første #156-kildefreeze (historisk): [nu merged PR #165](https://github.com/BixelVentures/podvoice/pull/165),
  kode/test-head `bb9db7f57d547b404b704b77d043243dff91fd1b`, tree
  `fbe3e8ff7a6a8ed34be138ec65d4587593bd6df7`. Exact-head CI
  [38697957426](https://github.com/BixelVentures/podvoice/actions/runs/38697957426)
  bestod scope/unit/browser/ARM/rest. #156-runtimebytes genbruges; 29 ændrer versionsmetadata/beskrivelser som reviewet.
  Første [CI 38696690975](https://github.com/BixelVentures/podvoice/actions/runs/38696690975)
  bevares som fejlet; de to stale fixtures blev rettet og fokuseret godkendt.
- PodConnect main: `8b178943e7c937338edaeeaffb2bf01600b696b1`; Control 0.10.11 har
  [grøn HA-CI](https://github.com/BixelVentures/podconnect/actions/runs/38688246337).
  Speakers 0.26.18/RSS-writerfix kom fra `643b86488a6af9392f82f6098531c61ee16b6f4c`,
  [native check](https://github.com/BixelVentures/podconnect/actions/runs/38415648831)
  og [publisher](https://github.com/BixelVentures/podconnect/actions/runs/38415648981) grønne.
- Frisk egen HA-panel-readback viser 2.0.28/status live som beskrevet ovenfor.
  Sidste egen fulde artifactkvittering er 2.0.27/`669e739a`, artifact
  `rootfs-v1:c5855fa18a9f01ef9c7dcfbe0498b8cb64c0a95cbf36ff911fea60efb02559fb`,
  firmware `podvoice_build_113114_livetimeroutput1`; disse er historiske og arves ikke
  som nye 28/29-identiteter. GitHub/image-publicering er ikke HA-readback.
- Brugeren har tidligere bekræftet Texas Sun→næste nummer, hurtig mobil→HomePod-lyd
  og perfekt højttaler→højttaler-flytning. Det er delvis fysisk evidens, ikke nul test;
  det arver ikke fuld accept på en nyere samlet kandidat.

## Alle åbne issues vurderet mod koden

27 PodVoice-issues (inklusive tre epics) og otte tilknyttede PodConnect-issues er læst
og sammenholdt med aktuelle ejere, callsites, eksisterende regressioner og leverings-
kvitteringer. Tre parallelle agenter bidrog; lead korrigerede historiske P0-/duplex-
slutninger med nyere source/publisher og brugerens fysiske tilbagemeldinger. Ingen
nye tests, providerkald eller fysiske prøver blev startet til selve auditen.
Prioritet er næste handling, ikke en påstand om, at alle gamle symptomer stadig findes.

| PodVoice | Aktuel status | Næste handling |
|---|---|---|
| [#94](https://github.com/BixelVentures/podvoice/issues/94) · P1 | Åben epic: måling og optimering | #104 først; #106/#105 vælges ud fra største målte ventetid. #108 samlet accept. |
| [#95](https://github.com/BixelVentures/podvoice/issues/95) · P2 | Åben epic: hovedparten af UI-koden leveret | #113 reel rollback og #115 samlet mobil/HA-app/Talk/accessibility-accept. |
| [#96](https://github.com/BixelVentures/podvoice/issues/96) · P1 | Åben epic: daglig brug og samlet accept | Prioritér aktuelt observeret svar/close, musik/timer og full-duplex-afbrydelse; derefter #112/#116. |
| [#98](https://github.com/BixelVentures/podvoice/issues/98) · P2 | Kode leveret; native evidensaccept åben | Kontrollér komplet native device/provider/speaker-kæde i den samlede prøve; ingen ny testplatform. |
| [#101](https://github.com/BixelVentures/podvoice/issues/101) · P2 | Historisk symptom; ingen ny kildebevist fejl | Kun genåbn konkret koderettelse hvis samme symptom ses med aktuel input/tool/lydkæde; medtag ét tidsopslag i serien. |
| [#102](https://github.com/BixelVentures/podvoice/issues/102) · P3 | Historisk regneopfølgning; nedprioriteret | Ingen lokal regnemotor eller tuning fra gammel transcript. Vurder kendt input/lyd/kontekst hvis fejlen gentages. |
| [#103](https://github.com/BixelVentures/podvoice/issues/103) · P1 | Lifecycle-kode/regressioner findes; fysisk accept åben | Samme-artifact samtale, afbrydelse/opfølgning, lukning, fuld lyd og ny wake. ON/OFF-motorvalg er forældet; Live-only gemte præferencer bevares. |
| [#104](https://github.com/BixelVentures/podvoice/issues/104) · P1 | Aktuel Live-baseline mangler; gammel reporter er Realtime-specifik | Brug korreleret rum/device-taleslut→første meningsfulde lyd med faktisk clockproveniens på samme kandidat. Bevar reporterens legacy40 adskilt; ingen ny testplatform. |
| [#105](https://github.com/BixelVentures/podvoice/issues/105) · P2 | Ingen dokumenteret ny opstartsoptimering | Afvent #104-data; bevar same-breath-input og kontinuerlig Live-input. Ingen blind timeouttuning. |
| [#106](https://github.com/BixelVentures/podvoice/issues/106) · P1 | Måledrevet svartidsarbejde åbent | Optimér største målte flaskehals fra #104. Gamle ON/OFF-adaptervalg og half-duplex-krav er historiske. |
| [#107](https://github.com/BixelVentures/podvoice/issues/107) · P1 | Lukkerettelser leveret; oplevet tid mangler | Mål aktuel talebesked→fuld lukning og næste wake. Forkort kun dokumenteret unødig ventetid, ikke guards ud fra gammel måling. |
| [#108](https://github.com/BixelVentures/podvoice/issues/108) · P2 | Samlet latencyaccept mangler | Vurder v2.x full duplex og meningsfuldt fysisk svar på samme bits; historiske mål bevares, ingen half-duplex-gate. |
| [#109](https://github.com/BixelVentures/podvoice/issues/109) · P2 | Recovery implementeret; systemaccept åben | Kontroller faktisk HA/MCP-tab→tilbagekomst uden reload/genstart eller tabt Live-samtale i samlet prøve. |
| [#110](https://github.com/BixelVentures/podvoice/issues/110) · P1 | HA-timer/lyd/Stop-kode findes; fysisk accept åben | Hør reel alarm, stop den, bekræft stilhed og næste wake. Manglende lyd er ikke løst alene af status/CI. |
| [#111](https://github.com/BixelVentures/podvoice/issues/111) · P1 | Recovery/attention-kode leveret; samlet accept åben | Aktuel Spotify/Connect-recovery, hørbar duck/restore og næste wake; saml med #118 og PC#9/#10. |
| [#112](https://github.com/BixelVentures/podvoice/issues/112) · P1 | Fysisk funktionsmatrix åben | Dansk/hjem/vejr/web/musik/timer/opfølgning samt tale under svar→relevant afbrydelse/fortsættelse uden selvsvar. Åben mic er ikke alene bevis. |
| [#113](https://github.com/BixelVentures/podvoice/issues/113) · P2 | Live-only migration leveret; rollbackvej dokumenteret | Supervisor/app-backup-vej er dokumenteret; faktisk rollback og platformaccept mangler. Gamle motorvælgere er ikke produktfunktion. |
| [#115](https://github.com/BixelVentures/podvoice/issues/115) · P2 | Browserrettelser leveret; samlet platformaccept åben | Samlet mobil/HA-app/Safari/VoiceOver, keyboard/safe-area, Talk/autoplay/drain og tilgængelighed; ingen ny samtaletest-UI. |
| [#116](https://github.com/BixelVentures/podvoice/issues/116) · P3 | Syvdøgns observation ikke accepteret | Efter funktions-/platformaccept: observer samme version uden manuelle genstarter. Dette er ikke syv dages yderligere kodearbejde. |
| [#118](https://github.com/BixelVentures/podvoice/issues/118) · P1 | Mål-/flyttekode leveret; delvis fysisk bekræftelse | Kreditér det bevis; fuld aktuel kandidat/queue/duck/close/nextwake-accept mangler. Ingen ny kildebevist flyttefejl fra audit alene. |
| [#119](https://github.com/BixelVentures/podvoice/issues/119) · P2 | Kapacitetsbeskyttelse kodet; oprindelig årsag uafklaret | Skeln gammel lokal afvisning/providerkvote fra aktuel drift. Ved gentagelse: korrelér tool-batch→resultat→cleanup; ingen kvote-/timeouttuning uden årsag. |
| [#124](https://github.com/BixelVentures/podvoice/issues/124) · P1 | Input/close-rettelser leveret; fysisk accept åben | Ny tale må ugyldiggøre gammel close, også under svar. Kontroller fuld lyd, fortsættelse, lukning og ny wake; ingen mic-lukning som workaround. |
| [#150](https://github.com/BixelVentures/podvoice/issues/150) · P2 | Lukket; fejlkontrakt og HA-backend verificeret | Faktisk HA-YAML bevarer ok:false; én aktuel URL-søgning gav action_done og sandt output på 1,03 s. Fysisk accept følges særskilt. |
| [#151](https://github.com/BixelVentures/podvoice/issues/151) · Senere | Eksplicit udsat af brugeren | Bevar udsættelsen. Undersøg senere; ingen skjult feature- eller releaseblokering nu. |
| [#153](https://github.com/BixelVentures/podvoice/issues/153) · P1 | Tale-/backchannelrettelser leveret; aktuel accept åben | Det kendte Mm-spor brugte gammel prompt før rettelsen; ingen ny fejl på aktuelle bits er bevist. Bind faktisk feltlyd før ny patch. |
| [#156](https://github.com/BixelVentures/podvoice/issues/156) · P2 | Lukket; 2.0.29 publiceret | PR/main/publisher PASS; fysisk installation ikke ændret herfra. |
| [#164](https://github.com/BixelVentures/podvoice/issues/164) · Forældet | Lukket som forældet fejlfortolkning | Intet mic-gatefix; faktisk afbrydelse/akustik følges i #112/#103. |
| [#166](https://github.com/BixelVentures/podvoice/issues/166) · P1 levering | Lukket; agent-/docs-/CI-oprydning leveret | Samlet 29-publicering PASS; ingen HA-installation her. |
| PodConnect | Aktuel status | Næste handling |
|---|---|---|
| [#6](https://github.com/BixelVentures/podconnect/issues/6) · P2 | Autoplay-fix leveret; én fysisk overgang bekræftet | Følgende nummer/øvrige kø/start/reconnect/OFF/stop-veje er ikke fuldt accepteret; ingen ny kildebevist fejl. |
| [#8](https://github.com/BixelVentures/podconnect/issues/8) · P1 | Rum-/targetflytning leveret; delvis fysisk bekræftelse | Samme aktuelle artifact + bevaret queue/position/duck/restore/nextwake; aktuelt Control0.10.11 er kode/CI, ikke installeringsbevis. |
| [#9](https://github.com/BixelVentures/podconnect/issues/9) · P1 | Native attention/custody-kode leveret; samlet accept åben | Faktisk installation af18 er ikke genlæst her. Aktuel A→B-volumen/restore/stale-owner og nextwake kræver fysisk accept. |
| [#10](https://github.com/BixelVentures/podconnect/issues/10) · P1 | Konkrete races rettet; delvis fysisk forbedring bekræftet | Tidligere lydløse episode er ikke fuldt årsagsforklaret; mål aktuel visning/valg/hørbar start før yderligere kodeændring. |
| [#11](https://github.com/BixelVentures/podconnect/issues/11) · P2 | Stale target/status-races rettet; aktuel accept åben | Resterende samme-artifact targetaccept samles med #8/#10; åben checkliste er ikke i sig selv manglende implementering. |
| [#12](https://github.com/BixelVentures/podconnect/issues/12) · P2 | Falske play-kvitteringer rettet; gammel403-årsag uafklaret | Ingen ny auth/pairingpatch uden aktuel kausal episode; gammel /info og pair-pin403 må ikke sammenblandes. Fysisk accept åben. |
| [#13](https://github.com/BixelVentures/podconnect/issues/13) · P2 | Contextforberedelse og URL-fix leveret; feltårsag uafklaret | Gammel konkret404-årsag og fuld postfailure/next-command-afspilning ikke accepteret; ingen blind retry/fallback. |
| [#29](https://github.com/BixelVentures/podconnect/issues/29) · P1 accept | Startup- og RSS-writerfix leveret; historisk P0 er ikke ny bevist fejl | Generisk manglende totaldeadline er ikke i sig selv en aktuel kildebevist blocker. Feltårsag/installeret18/Connect→lyd-accept er fortsat uafklaret. |

## Prioritet nu

1. 2.0.29 er merged og publiceret; #156/#166/#157 har faktiske kvitteringer.
   Lever den afgrænsede rollback-/driftsdokumentation; HA-resultatkontrollen er PASS.
2. Daglig brug: afklar faktisk gentaget kvittering (#153), close under ny tale/lukketid
   (#124/#103/#107), musik/attention (#118/#111, PC#9/#10) og timeralarm/Stop (#110).
   Kod kun ved en aktuel kausal fejl; flere af rettelserne er allerede leveret.
3. Saml én aktuel fysisk serie, herunder tale under svar→relevant fortsættelse uden
   selvsvar. Brug samme artifact og de eksisterende optagelser; krediter tidligere PASS.
4. Tag #104's faktiske latencybaseline og optimér største målte flaskehals (#106/#105).
   Ekstern HA-webfejl (#150), recovery (#109), reel rollback (#113) og UI (#115)
   får konkrete kilde-/systemchecks; udfør ikke blind tuning fra gamle incidents.
5. #151 er udsat af brugeren. #102 er lavere prioritet. #116 er senere observation,
   ikke en begrundelse for flere ugers udvikling eller at blokere daglig brug.

Alle uafsluttede produkt-/latency-/UI-epics forbliver åbne. Kilde, CI, publicering,
installation og fysisk accept er separate påstande; ingen af de gamle lukkede-mic-
krav genindføres som en gate for v2.x.


Sidste afgrænsede staticfreeze ·15. oktober2026: kun weather-view.js, widget-view.js og weather-only compactCSS ændres efter ovenstående samlede350-testpakning; vejrtesten er normaliseret igen. Alle131 rootassets og45 normaliserede testfiler er byteverificeret. Nyt manifest SHA-256 `a783c741d7aaee5c3759b6116bb9c15cc7f5b23a446e5eb87fa4c8bbfc1f7ebf`. Authorens fulde aktuelle rootkørsel er325PASS; målrettet root og faktisk packaged26/26PASS for weather, first-music-opening og scroll-edges, ændret JS-syntaks og diff-check PASS. Uændrede øvrige staticchecks genbruges; ingen ny fuld packaged351PASS påstås. Root ejer endelige admissionpins/CI og faktisk Green/fysisk accept.
