# PodView · nuværende og ny retning

[Åbn den samlede scrollside](http://127.0.0.1:4394/comparison/#overblik) · [Overblik i kode](http://127.0.0.1:4394/comparison/#small-family)

Øverst ligger den valgte v4-reference med overblikket i kode lige nedenunder. Den faste navigation hopper mellem afsnittene på samme side. Biblioteket viser den samme komponent og variant i to kolonner. Begge kommer fra PodView 2.0.140, kilde `5cf897a4`. Højre kolonne lægger designforslaget på de eksisterende renderere. Prøv kontrollerne separat og brug **Nulstil begge** til at sammenligne fra samme start igen.

**Komponenter** og **Skabeloner** viser eksemplarerne fra det kanoniske bibliotek. **Skærme og svar** bruger de eksisterende lokale produktscener og indeholder også Opskrifter og Forbind PodView. **Nye dele og regler** viser materialefelter, den fælles Small-størrelse og regler for handling og feedback. [V5-billedretningen](../all-components-v5/README.md)

## Start lokalt

Kør fra denne mappe med Python 3.12 og den lokale PodVoice-checkout.

```sh
python3.12 serve.py --port 4394
```

Til en anden checkout bruges `--repo /sti/til/podvoice`. Serveren indlæser den frosne kilde i en midlertidig mappe og bruger loopback som standard. Wi-Fi-adgang kan startes med `--lan-host` og Mac'ens private IP. Begge kolonner bruger lokale scener og lydløs afprøvning. Referencens overblik kombinerer de eksisterende lokale tilstande for Robot ved basen og tændt Lys. Det oprindelige 640 px-omslag indlæses lokalt. [Omslagskilde](../../../../visual/heartless-artwork-source-20261020.json)

## Tidligere browsergennemgang

- Alle 12 komponentpar og begge skabeloner indlæst. Afventende Klima bevarede tændt status i begge kolonner. Et klik i højre Button ændrede kun den side. Nulstilling gendannede begge.
- Overblik gennemgået ved 1280 og 1200. De seks Small-kort deler grid og højde i det brede overblik, når Timer er en genvej. Musikgenvejen har én titel og kort metadata. Afspilningspositionen vises i playeren. [Overblik 1280](small-1280.png) · [Overblik 1200](small-1200.png)
- Vejr og aktiv Robot viser materiale ved frisk, kendt tilstand i bred visning. Ved 980 ombrydes robottens handlinger i den nye retning, så Pause kan læses. [Robot 1280](robot-1280.png) · [Robot 980](robot-980.png)
- Opskrifter viste den eksisterende katalogfejl ved manglende lokal datakilde. Begge adgangsformularer viste den eksisterende deaktiverede anmodning.

## Aktuelle materialer og feedback · 8. november 2026

Kandidaten viderefører de valgte billedreferencer i eksisterende komponenter. Hovedformatet er liggende PodView, med 1280×800 som primær arbejdsvisning. Mobil adgang er adgang til sammenligningsbiblioteket, ikke en særskilt produktleverance.

- **Robot:** fælles buet celleidentitet med separate grafik-/handlingszoner. Observeret rengøring driver et sweep; pause og pending bevarer statisk materiale. [Optaget rengøring → pause](references/robot-cleaning-pause-20261108.gif).
- **Tesla:** tre energibaner følger gyldig observeret opladning. Ukendt/stale giver ingen ladebevægelse. [Forfinet energifelt](references/tesla-energy-refined-20261108.jpg).
- **Lys:** materialets intensitet/udbredelse følger kendt observeret niveau. Room/overview viser kun et fælles numerisk niveau, når alle scoped lamper er tændte, dæmpbare og har samme niveau; forskellige niveauer bliver aldrig et beregnet gennemsnit. Lampers eksisterende overflade vægtes individuelt. Off/unknown/stale skjuler materialet; pending bevarer observationen uden overgang. [Observerede lampeniveauer](references/light-lamp-observed-levels-20261108.jpg).
- **Vejr og Timer:** vejrets form følger eksisterende kendt tilstand. Timerens materiale følger det eksisterende tidsinstrument uden en ny fremdriftsberegning. Timerens korte cellefelt og ubrudte neutrale track er efterkontrolleret med 30 sekunders resttid; se [kort restsegment](references/timer-short-segment-20261108.jpg).
- **Header, Player, valg og trin:** eksisterende tilstande driver ikonfeedback og korte lokale overgange. Opskriftscheck bliver i samme markør; kontroltryk flytter ikke hele kortet. Dialoger har finit åbning. [Opskriftens trinfeedback](references/recipe-step-motion-20261108.gif).

Normale handlingsknapper er fælles neutrale: mørk primær/lys sekundær, med lys primær/mørk sekundær på mørke instrumentflader. Domænefarver tilhører identitet, materiale, flader og indholdsstatus. Fare/fejl følger særskilt semantik. Det erstatter tidligere farvede CTA-studier.

Normal bevægelse er hovedoplevelsen. Bibliotekets alternativ **Reduceret** og OS-præferencen begrænser bevægelsen uden at fjerne status eller betjening. Der er ingen ekstra mikrofon, lydmåling, serviceejer eller kontrolmyndighed. Neutrale navigationskort får ikke materiale blot for at udfylde fladen.

Product Design og Impeccable har gennemgået konkrete billeder og fund undervejs. Det afsluttende samlede reference-review er stadig åbent. Nyeste evidens, kendte rester og lokal kandidatstatus findes i [den eksisterende leveranceoversigt](../../../../UI-DELIVERY-GOAL.md). Ældre billeder ovenfor er historisk evidens, ikke dokumentation for alle seneste ændringer. Kandidaten er ikke produktintegreret, udgivet eller fysisk accepteret.
