# Dokumentoversigt

Denne side er et indeks, ikke en plan, statusside eller selvstændig produktkontrakt.
Ved tvivl gælder [AGENTS.md](../AGENTS.md) og de fire produktdokumenter i den angivne
læserækkefølge. Beskrivelserne nedenfor klassificerer dokumenternes rolle; de giver
ikke en ældre tekst ny autoritet.

V2.x er GPT-Live-only med full duplex for Voice PE og Talk. Talk er en separat browser-
I/O-adapter, ikke fysisk bevis for Voice PE. Ældre half-duplex-/providerplaner og
Realtime-wirekrav er historik eller diagnostik, medmindre de autoritative produktfiler
udtrykkeligt siger andet.

## Autoritative indgange og arbejdskontrakt

| Fil | Rolle |
|---|---|
| [AGENTS.md](../AGENTS.md) | Kort agentindgang, læserækkefølge og aktiv retning. |
| [CLAUDE.md](../CLAUDE.md) | Aktiv Claude-indgang, der viderestiller til AGENTS.md; ikke en separat kontrakt. |
| [STATUS.md](STATUS.md) | Eneste aktuelle leadlog for kandidater, beslutninger, evidens og åbne gates. |
| [INVARIANTER.md](INVARIANTER.md) | Bindende ejer-, lifecycle- og sikkerhedskontrakt. |
| [PRODUKTMÅL.md](PRODUKTMÅL.md) | Målbare funktions-, fysisk-, latency-, stabilitets- og UI-gates. |
| [ARKITEKTUR.md](ARKITEKTUR.md) | Faktisk GPT-Live-produktionsvej og ejerskab. |
| [AGENTKONTRAKT.md](AGENTKONTRAKT.md) | Detaljerede ændrings-, review-, bevis- og releasekrav. |
| [UDVIKLINGSFLOW.md](UDVIKLINGSFLOW.md) | Faktisk lokal fast-flow, scope og CI-opdeling; ikke en ny produktgate. |
| [POD-SYSTEM-STANDARD.md](POD-SYSTEM-STANDARD.md) | Fælles bindende arbejds- og acceptkrav for PodVoice, PodView og PodConnect; resultater føres fortsat i STATUS. |

## Aktuelle støtte- og referencefiler

| Fil | Klassifikation |
|---|---|
| [Dette indeks](README.md) | Navigation og dokumentklassifikation; indeholder ingen selvstændig produktstatus eller gate. |
| [README.md](../README.md) | Kort produktoversigt og vej til aktuel status; STATUS afgør installerede bits. |
| [audio-path.md](audio-path.md) | Aktuelt GPT-Live-kildekort for lydvej og bevisgrænser; STATUS og de autoritative produktfiler ejer accept og fysisk evidens. |
| [EVALUERING.md](EVALUERING.md) | Afgrænset OpenAI Realtime-diagnostik/oracle; den evaluerer ikke GPT-Live-produktion og kan ikke godkende v2.x eller fysisk accept. |
| [LATENCY_MEASUREMENT.md](LATENCY_MEASUREMENT.md) | Aktuelle krav til fysisk rumsmåling samt historisk reporter-/manifestskema; offline-rapporteren er ikke den GPT-Live fysiske måleprotokol. STATUS ejer faktiske måleresultater. |
| [wake-word.md](wake-word.md) | Wake-word-procedure og baggrund; kontroller aktuelle firmware-/enhedsforhold i STATUS før brug. |
| [PODVIEW-CONTROLLER-POLICY-CANDIDATE.md](PODVIEW-CONTROLLER-POLICY-CANDIDATE.md) | Separat PodView-kontrolejeres kandidat. Den ændrer ikke PodVoice-adgang eller aktiv policy. |
| [PODVIEW-ROBOT-READ-CONTRACT.md](PODVIEW-ROBOT-READ-CONTRACT.md) | Separat PodView/Roborock read-contract-kandidat. Bevar filen og dens direkte ejerbeslutninger; den er ikke PodVoice-adgangsautoritet. |
| [reviews/RESEARCH-ENRICHMENT-2026-10-15.md](reviews/RESEARCH-ENRICHMENT-2026-10-15.md) | Dateret review-/research-record. Brug kun dens eksplicitte beslutningsstatus; den erstatter ikke core docs. |
| [podvoice/CHANGELOG.md](../podvoice/CHANGELOG.md) | Historik over add-on-udgivelser; ikke aktuel installation eller accept. |
| [podvoice/DOCS.md](../podvoice/DOCS.md) | Aktuel GPT-Live-only operator- og installationsguide for full duplex; STATUS og de autoritative produktfiler ejer kandidatstatus og accept. |

## Historik, diagnostik og projektarkiver

| Fil | Klassifikation |
|---|---|
| [PLAN.md](../PLAN.md) | Historisk Gemini-/første-arkitekturplan; ikke roadmap eller v2.x-autoritet. |
| [PLAN-BEAT-GEMINI.md](PLAN-BEAT-GEMINI.md) | Historisk Gemini-vs.-Realtime research og leveranceidéer; ikke runtimevalg eller acceptance. |
| [PLAN-DUPLEX.md](PLAN-DUPLEX.md) | Historisk duplex-protokolplan. Dens konkrete model, firmware og gates er ikke den aktuelle GPT-Live v2.x-kontrakt. |
| [HANDOVER-v2.md](HANDOVER-v2.md) | Historisk 0.91-handover med udløbne branch-, test- og hardwareinstruktioner. |
| [VOICE_PE_FLOW.md](VOICE_PE_FLOW.md) | Ældre audio-/announcement-designnotat. ARKITEKTUR og PRODUKTMÅL styrer den aktuelle vej. |
| [realtime-config.md](realtime-config.md) | Historisk OpenAI Realtime wire-/diagnostikreference. Ikke en production selector eller GPT-Live-gate. |
| [LIVE_WEBRTC_PROBE.md](LIVE_WEBRTC_PROBE.md) | Isoleret developer-probe for Live WebRTC; ikke importeret runtime eller fysisk Voice PE-bevis. |
| [scripts/LIVE_ALPHA_PROBE.md](../scripts/LIVE_ALPHA_PROBE.md) | Isoleret Alpha/protocol probe; ingen HA-, puck- eller produktionsadgang. |
| [spikes/README.md](../spikes/README.md) | Historiske S1/S2 bring-up-noter. Brug dem ikke som aktuelle instruktioner uden ny STATUS-beslutning. |
| [archive/PODVIEW-2.0.25-CANDIDATE.md](archive/PODVIEW-2.0.25-CANDIDATE.md) | Frosset historisk PodView-kandidat. Bevares som receipt, ikke som nuværende UI/policy. |
| [archive/STATUS-2026-10-14-pre-157.md](archive/STATUS-2026-10-14-pre-157.md) | Statussnapshot før #157; kun historisk provenance. |

Indekset klassificerer de dokumenterede Markdown-indgange, inklusive sig selv. Hvis filer flyttes,
opdatér link og klassifikation her; flyt ikke historik uden først at bevare fungerende
links og dens provenance.
