"""Gemini Live session — the single long-lived WebSocket to the Live API (PLAN.md §5).

This module owns the Live protocol. Everything upstream consumes a typed async
event stream (the dataclasses below); tool calls are bridged out to ha_tools.py.

Two hard constraints shape this file:

1. It MUST import on Python 3.9+ even though we target 3.12 — hence
   ``from __future__ import annotations`` and no ``match`` statements.
2. The ``google-genai`` SDK is **lazy-imported inside ``connect()``**. The module
   itself (dataclasses + ``build_config``) imports with stdlib only, so the unit
   suite can import it without the SDK installed.

Every SDK attribute / kwarg / config field that could drift between SDK versions
is marked ``# VERIFY:`` — re-confirm against the pinned google-genai at impl time.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from . import constants as C
from .config import Config
from .voice import (
    AudioChunk,
    GoAway,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    TurnComplete,
    VoiceEvent,
)

if TYPE_CHECKING:  # pragma: no cover - typing only, never imported at runtime
    from collections.abc import AsyncIterator

_LOG = logging.getLogger("podvoice.gemini")

# The typed events now live in voice.py (shared across providers). Re-exported
# here so existing ``from gatekeeper.gemini import AudioChunk, ...`` keep working.
GeminiEvent = VoiceEvent
__all__ = [
    "SYSTEM_PROMPT_DA",
    "AudioChunk",
    "GeminiEvent",
    "GeminiLiveSession",
    "GoAway",
    "InputTranscript",
    "Interrupted",
    "OutputTranscript",
    "ToolCall",
    "TurnComplete",
    "build_config",
]


# --- Danish system prompt (PLAN §5.10, verbatim) -------------------------------

SYSTEM_PROMPT_DA = """Du er PodVoice, en stemmeassistent i et privat dansk hjem med flere beboere — voksne, måske børn og ældre. Du taler ALTID rigsdansk og svarer kort, som tale. Aldrig markdown, punktopstillinger, emoji eller symboler. Svar ALTID; gå aldrig i stå uden et hørbart svar.

RÆKKEFØLGE VED KONFLIKT
Kolliderer reglerne, gælder denne prioritet: 1) tal rigsdansk og kun som tale, og udfør ikke følsomme handlinger uden sikkerhed, 2) gæt aldrig — slå op, 3) vær kort og hurtig.

SPROG
Svar ALTID umiskendeligt på korrekt rigsdansk — aldrig norsk, svensk eller engelsk, uanset hvilket sprog brugeren bruger, hvordan ord staves eller udtales, eller hvilke sprog der blandes. Du forstår gerne andre sprog, men du svarer kun på dansk. Spejl ALDRIG brugerens sprog tilbage.
Glid aldrig over i norsk eller svensk. Er du i tvivl om et ord, så vælg den danske form: 'ikke' (ikke 'inte'), 'jeg' (ikke 'jag'), 'gør' (ikke 'gjør'), 'lige nu' (ikke 'akkurat nå'), 'måske', 'selvfølgelig', 'lidt', 'rigtigt'. Vælg ALTID den danske form også for: 'noget' (ikke 'noe/något'), 'meget' (ikke 'mye/mycket'), 'findes' (ikke 'finnes/finns'), 'igen' (ikke 'igjen'), 'inde/ude' (ikke 'inne/inni'), 'kun' (ikke 'bare' i betydningen kun), 'hvad' (ikke 'vad'), 'hvordan' (ikke 'hur'), 'godt' (ikke 'bra'). Tjek hvert eneste ord i dit svar: er det ikke en form du ville bruge i en dansk radioavis, så skift det ud.
Selv om brugeren blander engelske eller skandinaviske ord ind, er din kvittering ALTID den faste danske ('Slukket.', 'Skruet ned.') — gentag aldrig brugerens engelske eller udenlandske ord tilbage som bekræftelse.
Sig 'du' til alle — børn, voksne og ældre. Brug aldrig De, Dem eller Deres. Vær varm og afslappet høflig, aldrig stiv.
Egennavne oversættes ALDRIG: sangtitler, kunstnere, mærker, app-navne og navnene på rum, scener og enheder siges præcis som de hedder, også når de er engelske. Sig 'Jeg spiller Bohemian Rhapsody i stuen' — oversæt ikke titlen. At sige et engelsk egennavn (Movie Night, Living Room, Bohemian Rhapsody) eller et engelsk fagord eller produktnavn i et vidensspørgsmål (iOS, Champions League) er IKKE at tale engelsk — det er navnet. Oversæt aldrig sådan et navn for at undgå engelsk; sig det som det hedder, men resten af sætningen er altid dansk. Indeholder et egennavn tal (Blink-182, Maroon 5, U2, Sum 41), så sig tallet som en del af navnet på den måde det normalt udtales — ikke som dansk talord. Tal-som-ord-reglen gælder IKKE inde i egennavne.

SÅDAN TALER DU
Vær ekstremt kort. Sigt efter ÉN sætning, brug højst to, aldrig tre. Sæt svaret eller resultatet først, forklaring kun bagefter hvis det er nødvendigt. Korte svar er ikke bare stil — alt du siger læses højt og får brugeren til at vente.
Tal hverdagsdansk, som man taler i et hjem. Brug 'det' frem for 'dette', undgå kancellisprog som 'Jeg vil hermed informere om at…'. Start altid med selve svaret: 'Atten grader udenfor.' — ikke 'Med hensyn til vejret kan jeg oplyse, at…'.
Gentag aldrig brugerens anmodning tilbage. Bekræft ved resultatet, ikke ved at gentage ønsket: sig 'Tændt.' — ikke 'Du vil have lyset tændt, okay, jeg tænder lyset.'
Brug FASTE, ens kvitteringer for samme handling hver gang, næsten som en lyd: 'Tændt.', 'Slukket.', 'Sat på pause.', 'Næste.', 'Skruet op.', 'Skruet ned.', 'Lagt på indkøbslisten.' Find ikke på nye formuleringer for det samme. Brug højst én kvittering pr. svar — stabl dem aldrig ('Okay, ja, det gør jeg, øjeblik…').
Sig tal, klokkeslæt, datoer, priser, mål og temperaturer som ord på rigsdansk, så de udtales rigtigt: 'kvart over syv', 'halv otte', 'ti minutter i ni', 'enogtyve grader', 'minus tre grader', 'tyve procent', 'halvtreds kroner', 'halvanden liter', 'den fjerde juli'. Brug korrekte danske talord (halvtreds, tres, halvfjerds, firs, halvfems) og 'komma' i decimaltal ('treogtyve komma fem grader'). Sig årstal som danske årstal: 'nitten syvoghalvfems' (1997), 'nittenhundrede femogfirs' (1985), 'to tusind fireogtyve' (2024). Læs aldrig symboler som procent, grader eller skråstreg, og aldrig ciffer for ciffer, medmindre det er en kode.
Læs aldrig lister op. Har et resultat flere ting, så nævn højst tre i almindelig tale med 'og' før det sidste, eller opsummér antallet: 'Du har syv lamper — skal jeg nævne dem alle?'

HURTIGT KONTRA LANGSOMT
Tommelfingerregel: er handlingen øjeblikkelig, så TAL EFTER. Tager den tid, så TAL FØR.
Øjeblikkelige lokale handlinger (lys, tænd/sluk, scener, gardiner, lydstyrke på en aktiv højttaler, pause, afspil, skift sang, aflæsning af kendt tilstand): udfør straks og bekræft bagefter med ét kort udsagn i datid. Sig IKKE en kvittering først — det føles kun langsommere. 'Sluk stuelyset' fører til 'Slukket.'
Langsomme opslag (historik, vejr, priser, nyheder, websøgning, og enhver afspilning der skal HENTES — alt der kræver en tjeneste der RETURNERER data eller tager tid at starte, eller hvor du først må slå tjenesten op): sig straks en meget kort, varieret kvittering på under fem ord ('Lige et øjeblik…', 'Det tjekker jeg'), og kald så tjenesten. Vær derefter stille indtil svaret kommer — fyld ikke ventetiden med flere ord.
Blander en tur en øjeblikkelig handling med et langsomt opslag ('sluk lyset og hvad er vejret?'), så udfør den øjeblikkelige handling straks og lad det langsomme opslags korte kvittering dække hele turen: 'Slukket — vejret tjekker jeg.' Vent så på data og meld vejret. Saml kun til sidst når ALLE handlinger er øjeblikkelige.

VÆRKTØJER
Brug 'list_home' for at se hvilke enheder og rum der findes. Brug 'list_services' for at finde den rette tjeneste, dens påkrævede felter, og om den returnerer data. Udfør med 'home_call', eller brug de hurtige genveje (tænd/sluk, lys).
Gæt ALDRIG et tjenestenavn, et FELTnavn eller et enheds-id. Kender du ikke det præcise navn, så slå det op først. Felt-gæt (fx 'brightness' i stedet for 'brightness_pct', eller 'volume' i stedet for 'volume_level') får kaldet til at fejle lydløst.
Slå kun op én gang PER enhed eller tjeneste. Når du har fundet en enhed eller en tjeneste, så genbrug den resten af samtalen. Men slå en NY tjeneste op du ikke har set før (fx multi-room-gruppering eller lydstyrke) via 'list_services' før du kalder den — genbrug betyder aldrig at gætte en ukendt tjenestes navn eller felter. Slå kun op igen hvis et kald fejler med ukendt enhed eller tjeneste, eller brugeren nævner noget du ikke har set. Kald ikke 'list_home' bare for at tjekke, før noget brugeren tydeligt har navngivet.
Saml handlinger. Skal du gøre det samme flere steder ('sluk lyset i stue og køkken'), så gør det i ÉT kald med flere enheder. Beder brugeren om flere uafhængige ting i samme sætning ('sluk lyset og skru ned for varmen'), så send begge kald PARALLELT i samme tur — ikke ét ad gangen — og bekræft samlet til sidst. Saml-og-udfør-parallelt gælder dog ALDRIG handlinger der kræver bekræftelse (se SIKKERHED): dem bekræfter du hver for sig FØR udførelse.
Er kommandoen tvetydig ('tænd lyset' uden rum, eller 'højttaleren' når der er flere), så gå ud fra det rum du står i, eller den enhed der allerede er aktiv. Vælg aldrig i blinde mellem flere. Kan det stadig ikke afgøres, så stil ét kort enten/eller-spørgsmål: 'Stuen eller køkkenet?'

RESULTATER
Brug 'summary' og 'data' som DIN KILDE til indhold, men formulér ALTID selv svaret på rigsdansk. Er 'summary' helt eller delvist på engelsk, norsk eller svensk, så oversæt indholdet til dansk før du siger det — gentag aldrig en 'summary' ordret på et fremmedsprog. Kun egennavne (sangtitler, kunstnere, mærker, enheds- og rumnavne) bevares uoversat.
'summary' er KUN din tale ved et opslag der returnerer et rigtigt sprogligt svar. Ved en almindelig handling er 'summary' blot en intern kvittering (fx den engelske streng 'Done.') — sig den ALDRIG højt; brug i stedet din faste danske kvittering ('Tændt.', 'Slukket.', 'Sat på pause.').
Findes 'summary' med et rigtigt dansk eller oversat svar, så byg din tale på den. Mangler 'summary', men er der 'data', så formulér SELV et kort dansk svar ud fra 'data' (højst tre ting, tal som ord). Læs ALDRIG id'er, felt-navne, JSON, URL'er eller tekniske strenge højt. Sig 'Lyset i stuen er tændt' — aldrig 'light.stue er sat til on'.
Et vellykket men tomt svar har 'ok': sandt og 'empty': sandt (uden 'summary' og uden 'data') — det er IKKE en fejl. Fortæl det som en kendsgerning: 'Der er ikke noget i historikken' / 'Listen er tom'. Slå aldrig over i din egen viden, fordi data mangler. Et resultat der bare ser anderledes ud end ventet, er heller ikke en fejl.
Sig KUN at noget mislykkedes når 'ok' er falsk (eller værktøjet selv fejlede). Er 'error_kind' lig 'denied' (enheden er ikke gjort tilgængelig), så sig kort at den ikke er sat op endnu — fx 'Den enhed er ikke tilføjet endnu' — ikke bare 'det kan jeg ikke'. Ved andre fejl: står der en kort, forståelig forklaring i 'error' (fx fra en søge- eller samtale-agent — 'error_kind' lig 'intent_error' — eller en HA-fejl der siger hvad der mangler), så gengiv den kort med dine egne ord på dansk; ellers sig 'Det kan jeg desværre ikke.' Læs aldrig id'er, felt-navne eller rå tekniske strenge ordret højt.
Drag ikke konklusioner som dataene ikke selv indeholder. Returnerer vejret kun temperatur, så sig temperaturen — gæt ikke om regn, eller om man skal vande. Sig hvad der står, ikke hvad du tror det betyder.
Et returneret resultat opsummeres i ÉN sætning: enten op til tre ting med 'og', eller blot antallet. Tilbyd ikke at læse resten, og stil ingen opfølgning, medmindre brugeren selv beder om mere. Brug 'Jeg har lige tjekket' højst når det reelt er nødvendigt, aldrig som fast indledning — og nævn aldrig tjeneste- eller værktøjsnavne højt.

VIDEN OG OPSLAG
Det afgørende er ikke om brugeren siger 'nu' eller 'i dag', men om svaret KAN have ændret sig siden du sidst lærte noget. Alt der har en indehaver, en rekord, en pris, en seneste version eller et antal der ændrer sig over tid — statsministre, mestre, befolkningstal, hvem der sidder på en post, nyeste model af noget, vejr, priser, nyheder, sportsresultater, åbningstider — skal slås op via en tjeneste der returnerer data, også når spørgsmålet lyder tidløst ('hvem er statsministeren', ikke kun 'hvem er statsminister nu'). Også omskrevne spørgsmål om aktuelle værdier — 'er det dyrt', 'er det steget', 'kan det betale sig', 'er det normalt lige nu' — kræver opslag, ikke et skøn. Svar aldrig på aktuelle ting fra hukommelsen.
Svar kun direkte fra din egen viden, uden opslag og uden kvittering, når svaret er principielt uforanderligt: matematik, geografi, hvordan ting fysisk virker, afsluttede historiske begivenheder.
Findes der ingen tjeneste der kan slå det aktuelle op (intet i 'list_services' returnerer den slags data), så GÆT IKKE fra hukommelsen. Sig kort at du ikke kan tjekke det lige nu: 'Det kan jeg ikke slå op her.' Aktuelle tal og status fra hukommelsen er altid forbudt — også når et opslag mislykkes.
Skeln mellem at VIDE og at TRO. Er du sikker, så svar lige ud. Er du det mindste i tvivl om et konkret tal, en dato eller et navn, så enten rund af og markér det ('omkring tre hundrede meter') eller sig 'det er jeg ikke sikker på' — sig ALDRIG et præcist tal du ikke er sikker på. Et afrundet eller forbeholdent svar er altid bedre end et skarpt forkert. Find aldrig på tal, datoer, navne eller status for at fylde et hul. Kan du hverken vide det eller slå det op, så sig 'Det ved jeg ikke.'
Et vidensspørgsmål besvares med ÉN sætning og højst to fakta — aldrig en remse. Bedt om en forklaring ('hvorfor', 'hvordan virker'), så giv kernen i én til to sætninger og tilbyd resten: 'Kort fortalt spreder luften det blå lys mest — vil du have den lange forklaring?' Læs aldrig en lang forklaring højt uden at brugeren har sagt ja til mere.
Når en tjeneste har svaret, så svar KUN ud fra 'summary' og 'data' — tilføj ikke fakta fra din egen viden. Mangler det brugeren spurgte om i svaret, så sig hvad du har.

MUSIK OG HØJTTALERE
Pause, afspil, næste, forrige, start forfra og lydstyrke på en allerede aktiv højttaler er øjeblikkelige — udfør straks uden kvittering, sig højst ét kort ord.
Relativ lydstyrke ('lidt højere', 'skru op', 'dæmp den'): find via 'list_services' den rette lydstyrke-tjeneste og dens felter FØR du kalder — gæt ikke felt- eller tjenestenavne fra hukommelsen. Flyt kun det nuværende niveau nogle få trin. Find ALDRIG selv på en procentsats. Kun ved et konkret tal ('sæt lyden til halvtreds') sætter du den absolutte værdi.
Nævner brugeren ikke en højttaler, så styr DENNE højttaler, den du bliver talt til. Spørg ikke 'på hvilken højttaler?'. 'Lidt højere' rammer kun den højttaler der spiller i dit rum, ikke alle.
Åbne ønsker ('spil noget', 'sæt noget musik på') starter en afspilning der kan tage et øjeblik at hente — sig derfor en kort kvittering først ('Sætter noget på…') og bekræft kort når den spiller. Genoptag gerne det der sidst spillede, eller brug et bredt søgeord. Spørg kun hvis der slet ikke findes et fornuftigt valg.
'Hvad spiller der nu?' aflæser titel og kunstner direkte fra højttaleren — svar straks, uden kvittering. Spørgsmål om HISTORIK ('hvad hørte vi i går?') er data: sig 'Lige et øjeblik…', slå det op via en tjeneste der returnerer svar, og brug derefter svaret. Bland aldrig de to sammen.
Multi-room: 'i hele huset' betyder gruppér højttalerne, 'flyt musikken ud i køkkenet' betyder flyt afspilningen, 'også i stuen' betyder tilføj den højttaler. Find tjenesten via 'list_services'. Tager kaldet mærkbart tid, så sig en kort kvittering FØR; svarer det hurtigt, så drop forfilleren og meld kun det korte resultat bagefter ('Nu spiller det i hele huset'). Stabl aldrig en filler og en bekræftelse tæt på hinanden.

BEKRÆFTELSE OG SIKKERHED
Reversible handlinger (lys, musik, lydstyrke, gardiner, scener, robotstøvsuger, ét eller få navngivne punkter på indkøbslisten) udfører du STRAKS og melder kort tilbage — spørg aldrig om lov først. Skal noget gøres om, så tilbyd fortrydelse bagefter ('Det er gjort — sig til hvis jeg skal fortryde'). At fjerne ét eller få navngivne punkter fra indkøbslisten er reversibelt; kun at rydde HELE listen eller slette punkter du ikke selv kan navngive kræver bekræftelse først.
Bekræft ALTID kort FØR udførelse ved handlinger der er svære at gøre om eller rører ved sikkerhed, penge eller privatliv: låse døre op, åbne garage eller port, slå alarm FRA (frakobling), ringe op eller sende beskeder, slette data eller rydde en hel liste, gennemføre køb, og store eller usædvanlige varmeændringer (ændring på mere end tre grader, eller en måltemperatur under sytten eller over fireogtyve grader). At låse, slå alarm TIL og lukke gardiner kræver derimod ingen bekræftelse.
Små varmejusteringer (op til tre grader, og inden for sytten til fireogtyve grader) er øjeblikkelige — udfør straks og bekræft kort i datid ('Skruet op for varmen'). Kun ændringer uden for det interval bekræftes først.
Nævn altid den konkrete handling og enhed, så brugeren kan fange en misforståelse: 'Vil du låse hoveddøren op?' — aldrig et indholdsløst 'Er du sikker?'. Ved beskeder og opkald: gentag kort modtager OG kernen i indholdet før afsendelse ('Skal jeg skrive til Mette at du er forsinket?'); gæt aldrig modtageren — er den uklar, så spørg hvem, før du bekræfter.
Ved oplåsning, alarm fra, opkald og køb: udfør ALDRIG på selve den første kommando. Stil ÉN konkret bekræftelse der nævner handling og enhed, og udfør KUN ved et utvetydigt, fuldt 'ja'. Et gyldigt ja skal være et helt, utvetydigt bekræftende svar PÅ selve spørgsmålet, i umiddelbar forlængelse af det. Et løsrevet 'ja', et tøvende eller delvist svar, et svar fra en anden stemme i baggrunden, eller et svar der ikke passer til spørgsmålet, tæller IKKE — gør da INGENTING og sig kort 'Så gør jeg ikke noget.' Da højttaleren deles og kan udløses ved et tilfælde (tv, baggrundssnak, et barn der pludrer), må disse handlinger aldrig udføres på en uklar eller halv kommando.
Læs ALDRIG en privat besked, kalender, kontakt, placering eller lytte- eller søgehistorik højt på første kommando, da andre i rummet kan høre med. Sig hvad det handler om i ét ikke-følsomt ord og spørg 'Skal jeg læse den højt?'. Læs kun ordret efter et tydeligt ja.

NÅR NOGET ER UKLART
Kan du ikke høre eller forstå hvad der blev sagt (utydelig eller støjfyldt lyd), og du har intet rimeligt bud: sig kort 'Det forstod jeg ikke helt.' og bed om at få det gentaget — fx 'sig det lige igen?'. Gæt aldrig på en styringshandling ud fra et usikkert input.
Forstår du kommandoen, men er i tvivl om hvad eller hvilken enhed der menes: GÆT på det mest sandsynlige og spørg som ét lukket ja/nej- eller enten/eller-spørgsmål ('Mente du stuelampen?', 'Stuen eller køkkenet?'). Har du et sandsynligt gæt, så spørg på det i stedet for bare at sige 'Det forstod jeg ikke helt.' uden et forslag. Et afklarende spørgsmål ER hele dit svar — sæt INGEN kvittering, filler eller forklaring foran eller bagefter. Kun selve det korte spørgsmål. Bed aldrig brugeren begynde forfra. Stil højst ÉT spørgsmål pr. tur. Skal brugeren sige et bestemt ord tilbage, så sæt det ord sidst i sætningen.
Ved vage eller delvise kommandoer ('lidt lysere', 'sluk lyset'): handl på det mest sandsynlige — rummet du står i, eller den enhed der er tændt — og sig hvad du gjorde, så brugeren let kan rette dig.
Udtaler brugeren et navn skævt eller blander sprog ind: match til den nærmeste rigtige enhed og svar i ren rigsdansk. Gentag aldrig det skæve eller udenlandske ord tilbage — brug enhedens korrekte danske navn.

AFBRYDELSE OG ADFÆRD
Afbryder brugeren dig, mens du taler: stop straks, lyt, og svar på det nye. Gentag IKKE dit forrige svar fra start, og undskyld ikke for at blive afbrudt — afbrydelse er helt i orden.
Er afbrydelsen en rettelse af en handling du lige udførte ('nej, det var køkkenet'), så gør den oprindelige om hvis den er reversibel, udfør det rettede, og meld kort kun det rettede resultat.
Afbryder brugeren mens du venter på en bekræftelse af en følsom handling, så bortfalder den ventende handling helt — udfør den ALDRIG ud fra et 'ja' der gælder noget andet. Kræv en ny, udtrykkelig bekræftelse hvis brugeren igen beder om den følsomme handling.
Vær tålmodig: skæld aldrig ud, sig aldrig 'jeg venter', og antyd aldrig at brugeren var for langsom eller utydelig.
Stil ingen unødvendige opfølgende spørgsmål. Når en handling lykkedes, så meld kort og stop — ingen 'Er der ellers andet?'. Tal kun når der er noget at sige.
Spørger nogen 'hvad kan du?', så svar med én kort sætning: du styrer lys, varme, scener, gardiner, robotstøvsuger, musik og indkøbslister, og du kan slå ting op som vejr og historik. Tal i hverdagssprog ('lyset i stuen'), aldrig i tekniske enhedsnavne."""


# --- Config builder (PLAN §5.9) ------------------------------------------------


def build_config(
    cfg: Config, tool_declarations: list[dict] | None = None, voice: str | None = None
) -> dict:
    """Assemble the Live ``config`` dict (PLAN §5.9).

    Plain dict (not ``types.LiveConnectConfig``) so this function — and therefore
    the whole module — imports without google-genai. The SDK accepts a dict here.

    ``cfg`` is accepted for forward-compatibility (e.g. surfacing voice / model
    knobs as options later); the field values below are the canonical §5.9 spec.
    """
    config: dict = {
        # VERIFY: response_modalities is the field name; ["AUDIO"] for voice out.
        "response_modalities": ["AUDIO"],
        # VERIFY: system_instruction accepts a plain string on the Live config.
        "system_instruction": getattr(cfg, "system_prompt", "") or SYSTEM_PROMPT_DA,
        # VERIFY: speech_config -> voice_config -> prebuilt_voice_config -> voice_name
        # VERIFY: "Kore" is a Danish-suitable prebuilt voice (PLAN §5.9 flags this).
        "speech_config": {
            "voice_config": {
                "prebuilt_voice_config": {
                    "voice_name": voice or getattr(cfg, "gemini_voice", "") or "Kore"
                }
            }
        },
        # VERIFY: empty dicts enable transcription; the input transcript drives barge-in.
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        # VERIFY: sliding_window key under context_window_compression (PLAN §5.8).
        "context_window_compression": {"sliding_window": {}},
        # VERIFY: session_resumption {} opts in; handle is injected per-connect below.
        "session_resumption": {},
        # Automatic activity detection (VAD) — tunable in Settings. connect() upgrades
        # this to typed objects defensively (so a wrong enum name can't break connect).
        "realtime_input_config": {
            "automatic_activity_detection": {
                "start_of_speech_sensitivity": getattr(cfg, "gemini_vad_start", "high") or "high",
                "end_of_speech_sensitivity": getattr(cfg, "gemini_vad_end", "high") or "high",
                "prefix_padding_ms": int(getattr(cfg, "gemini_prefix_ms", 300)),
                "silence_duration_ms": int(getattr(cfg, "gemini_silence_ms", 500)),
            }
        },
        # NOTE: max_output_tokens is intentionally UNSET. On native-audio models it
        #       counts AUDIO tokens, so any small cap TRUNCATES speech mid-sentence.
        #       Brevity is enforced via the system prompt instead.
        #       VERIFY: temperature / max_output_tokens are even accepted in Live.
        # NOTE: language_code is intentionally NOT set — native-audio auto-selects
        #       the spoken language; Danish is driven by SYSTEM_PROMPT_DA.
    }
    tools: list[dict] = []
    if tool_declarations:
        # VERIFY: tools is a list of {"function_declarations": [...]} blocks (PLAN §5.6).
        tools.append({"function_declarations": list(tool_declarations)})
    if tools:
        config["tools"] = tools
    return config


# --- Live session (satisfies interfaces.GeminiLike) ----------------------------


@dataclass
class GeminiLiveSession:
    """One long-lived Live WebSocket. Satisfies ``interfaces.GeminiLike``.

    Reconnect strategy lives in the orchestrator, not here. The recommended
    bounded exponential backoff for the orchestrator's reconnect loop is::

        delay = min(BASE * 2 ** attempt, CAP)   # e.g. BASE=0.5s, CAP=30s
        await asyncio.sleep(delay + random.uniform(0, JITTER))

    On ``go_away`` (PLAN §5.8) the orchestrator opens a NEW session with the
    stored resume handle and switches over (make-before-break); a hard socket
    drop falls back to ``reconnect()`` (close + connect) below. Auth errors
    (401/403) are non-retryable — fail fast, never tight-loop (PLAN §5.12).
    """

    api_key: str
    model: str
    config: dict
    # Internal SDK handles (typed loosely so the module imports without the SDK).
    _client: object | None = field(default=None, init=False, repr=False)
    _session: object | None = field(default=None, init=False, repr=False)
    _cm: object | None = field(default=None, init=False, repr=False)
    _resume_handle: str | None = field(default=None, init=False, repr=False)

    async def connect(self) -> None:
        """Open the Live WebSocket. Lazy-imports the SDK so the module loads without it."""
        # LAZY IMPORT — do NOT hoist to module top (keeps the module SDK-free).
        from google import genai  # CONFIRMED 2026-06-22: `from google import genai`
        from google.genai import types

        if self._client is None:
            # CONFIRMED: genai.Client(api_key=...) — Gemini Developer API, NOT Vertex.
            self._client = genai.Client(api_key=self.api_key)

        # Start from the plain dict (build_config) and upgrade the two keys the SDK
        # prefers as typed objects; inject the resume handle for make-before-break.
        cfg = {
            k: v
            for k, v in self.config.items()
            if k
            not in ("session_resumption", "context_window_compression", "realtime_input_config")
        }
        cfg["session_resumption"] = types.SessionResumptionConfig(handle=self._resume_handle)
        cfg["context_window_compression"] = types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow()
        )

        # VAD (automatic activity detection) — typed, but never let it break connect.
        ric = self.config.get("realtime_input_config")
        if ric:
            try:  # VERIFY: enum + field names against current google-genai types.
                aad = ric["automatic_activity_detection"]
                start = types.StartSensitivity.START_SENSITIVITY_LOW
                if (aad.get("start_of_speech_sensitivity") or "high") == "high":
                    start = types.StartSensitivity.START_SENSITIVITY_HIGH
                end = types.EndSensitivity.END_SENSITIVITY_LOW
                if (aad.get("end_of_speech_sensitivity") or "high") == "high":
                    end = types.EndSensitivity.END_SENSITIVITY_HIGH
                cfg["realtime_input_config"] = types.RealtimeInputConfig(
                    automatic_activity_detection=types.AutomaticActivityDetection(
                        start_of_speech_sensitivity=start,
                        end_of_speech_sensitivity=end,
                        prefix_padding_ms=int(aad.get("prefix_padding_ms", 300)),
                        silence_duration_ms=int(aad.get("silence_duration_ms", 500)),
                    )
                )
            except Exception as e:  # VAD is a tuning nicety, never load-bearing
                _LOG.warning("Gemini VAD config not applied (%s) — using server defaults", e)

        # CONFIRMED: client.aio.live.connect(model=, config=) is an async context manager.
        self._cm = self._client.aio.live.connect(model=self.model, config=cfg)  # type: ignore[attr-defined]
        # VERIFY: entering the CM yields the live session object.
        self._session = await self._cm.__aenter__()  # type: ignore[attr-defined]

    async def send_audio(self, pcm16k: bytes) -> None:
        """Stream a small raw 16 kHz PCM chunk up (PLAN §5.2)."""
        if self._session is None:
            return
        from google.genai import types  # VERIFY: `from google.genai import types`

        # VERIFY: send_realtime_input(audio=types.Blob(data=, mime_type=)).
        # VERIFY: mime_type "audio/pcm;rate=16000".
        await self._session.send_realtime_input(  # type: ignore[attr-defined]
            audio=types.Blob(
                data=pcm16k,
                mime_type=f"audio/pcm;rate={C.GEMINI_INPUT_RATE}",
            )
        )

    async def send_text(self, text: str) -> None:
        """Send a typed user turn (used by the in-panel console, PLAN.md UI)."""
        if self._session is None:
            return
        # VERIFY: send_client_content(turns=[...], turn_complete=True) shape.
        await self._session.send_client_content(  # type: ignore[attr-defined]
            turns=[{"role": "user", "parts": [{"text": text}]}], turn_complete=True
        )

    async def audio_stream_end(self) -> None:
        """Flush the server's cached audio after a >1 s gate pause (PLAN §5.4)."""
        if self._session is None:
            return
        # VERIFY: send_realtime_input(audio_stream_end=True) is the flush shape.
        await self._session.send_realtime_input(audio_stream_end=True)  # type: ignore[attr-defined]

    async def send_tool_results(self, results: list) -> None:
        """Return FunctionResponses for dispatched tool calls (PLAN §5.6).

        Accepts either pre-built SDK FunctionResponse objects or plain dicts with
        ``id`` / ``name`` / ``response`` keys (so callers stay SDK-free).
        """
        if self._session is None:
            return
        from google.genai import types  # VERIFY: FunctionResponse import path

        frs = []
        for r in results:
            if isinstance(r, dict):
                frs.append(
                    types.FunctionResponse(
                        id=r.get("id"), name=r.get("name"), response=r.get("response")
                    )
                )
            else:
                frs.append(r)
        # VERIFY: send_tool_response(function_responses=[...]) kwarg name.
        await self._session.send_tool_response(function_responses=frs)  # type: ignore[attr-defined]

    async def events(self) -> AsyncIterator[GeminiEvent]:
        """Async generator of typed events for the WHOLE session — with SEAMLESS resume.

        Two layers of resilience so BOTH the in-panel console and the Voice PE room
        pipeline keep talking without the consumer noticing:
        - ``session.receive()`` yields one turn then returns; we re-enter it so the
          conversation continues across turns (no silence after the first reply).
        - On a server ``go_away`` (session time cap) OR a dropped socket, we transparently
          ``reconnect()`` using the stored resumption handle (make-before-break) and keep
          yielding — the consumer's ``async for`` never ends. Bounded backoff on failure.
        ``close()`` (deliberate teardown) sets ``_session`` to None and stops the loop.
        """
        backoff = 0.5
        while self._session is not None:
            session = self._session
            resume = False
            try:
                # VERIFY: session.receive() yields a turn's responses then completes.
                async for r in session.receive():  # type: ignore[attr-defined]
                    # VERIFY: r.data is the convenience accessor for raw 24 kHz PCM bytes.
                    data = getattr(r, "data", None)
                    if data is not None:
                        yield AudioChunk(data)

                    # VERIFY: r.tool_call.function_calls[].{id,name,args}.
                    tool_call = getattr(r, "tool_call", None)
                    if tool_call is not None:
                        for fc in tool_call.function_calls:
                            yield ToolCall(fc.id, fc.name, fc.args)

                    # VERIFY: r.server_content.{input_transcription,output_transcription,
                    #         interrupted,turn_complete}.
                    sc = getattr(r, "server_content", None)
                    if sc is not None:
                        in_tx = getattr(sc, "input_transcription", None)
                        if in_tx is not None:
                            yield InputTranscript(in_tx.text)  # VERIFY: .text attribute
                        out_tx = getattr(sc, "output_transcription", None)
                        if out_tx is not None:
                            yield OutputTranscript(out_tx.text)  # VERIFY: .text attribute
                        if getattr(sc, "interrupted", None):
                            yield Interrupted()
                        if getattr(sc, "turn_complete", None):
                            yield TurnComplete()

                    # VERIFY: r.session_resumption_update.{resumable,new_handle}.
                    update = getattr(r, "session_resumption_update", None)
                    if update is not None and getattr(update, "resumable", False):
                        new_handle = getattr(update, "new_handle", None)
                        if new_handle:
                            self._resume_handle = new_handle

                    # VERIFY: r.go_away.time_left (server's pre-disconnect warning).
                    go_away = getattr(r, "go_away", None)
                    if go_away is not None:
                        yield GoAway(getattr(go_away, "time_left", None))
                        resume = True  # session is closing — resume below, seamlessly
                        break
            except asyncio.CancelledError:
                raise
            except Exception as e:  # dropped socket / server hiccup -> resume
                _LOG.warning("gemini stream dropped (%s) — resuming", e)
                resume = True

            if self._session is None:
                break  # deliberate close()
            if resume:
                try:
                    await self.reconnect()  # preserves _resume_handle (make-before-break)
                    backoff = 0.5
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    _LOG.warning("gemini resume failed (%s) — retry in %.1fs", e, backoff)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 8.0)
            # else: clean turn-batch end -> loop re-enters receive() on the same session

    async def reconnect(self) -> None:
        """Close + reconnect, preserving the resumption handle (make-before-break).

        ``events()`` calls this automatically on go_away / socket drop, so both the
        console and the room pipeline resume seamlessly without the consumer noticing.
        """
        await self.close()
        await self.connect()

    async def close(self) -> None:
        """Tear down the WebSocket; preserves the resume handle for reconnect."""
        cm = self._cm
        self._cm = None
        self._session = None
        if cm is not None:
            # VERIFY: exiting the CM closes the session cleanly.
            await cm.__aexit__(None, None, None)  # type: ignore[attr-defined]
