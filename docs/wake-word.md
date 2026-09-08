# Vækkeord på Voice PE

Indstillinger → Daglig brug → Vækkeord tilbyder Okay Nabu (standard), Hey Jarvis,
Hey Mycroft og Hey Chat. Valget gemmes med **Gem og genstart** og gælder alle
konfigurerede Voice PE-enheder. Eksisterende gyldige valg bevares ved opgradering.

Hey Chat kræver den parrede firmware med `podvoice_build_11362_heychat1`.
Modellen er Tater Tottersons færdige microWakeWord; upstream-commit og SHA-256
for manifest og TFLite står i `esphome/hey-chat-model.json`. Dens cutoff 0.95,
vindue 5, feature-step 10 og tensor-arena 30000 ændres ikke af PodVoice.
Modellen deklarerer engelsk træningssprog; naturlig dansk udtale er endnu ikke bevist.

Panelet viser gemt valg og hver enheds firmwarebekræftede valg separat.
En afsendt kommando eller firmwarekvittering beviser ikke akustisk kvalitet.
Ved manglende støtte: **Opdatér Voice PE-firmware**. Ved manglende forbindelse eller
readback: **Kan ikke bekræfte vækkeord**. VoicePELink genanvender valget ved hver
forbindelse, også efter strømsvigt; retained eller tidligere generations ACK afvises.

Den eneste wakevej er lokal microWakeWord → firmware-latch/`wake_okay_nabu` →
VoicePELink → ThinSession. Eventnavnet er en eksisterende intern kontrakt, også for
Hey Chat. Stock HA Assist startes aldrig. Stopmodellen beholder sin separate ejer.
Tilføj modeller i den vendorede bases liste, ikke et overlay med en ekstra wake-trigger.

Før installation kræves software-/firmwaregates og uafhængigt review. Før godkendelse
kræves frisk golden chain, 10/10 ubrudte lifecycle-cyklusser samt Hey Chat-gaten i
`docs/PRODUKTMÅL.md` (40 wakes, selvsvar og baggrundslyd). `docs/STATUS.md` er den
eneste aktuelle kandidatstatus. Ved regression tilbageføres hele Hey Chat-ændringen
som add-on/firmware-par; rollback arver ikke fysisk godkendelse.
