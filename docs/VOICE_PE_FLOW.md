# Voice PE flow · historisk v1.x-designnotat

> **Arkiv, ikke aktiv implementeringsplan.** Den oprindelige flowtegning og
> faseplan beskrev en ældre Realtime/announce/half-duplex-fejlsøgning. Dens
> state-styrede mic-lukning under `AI_SPEAKING`, lokale lounge-VAD,
> provider-sammenligning, PCM-faseplan og tal for timeout/latens er ikke krav eller
> instruktioner til GPT-Live v2.x. Den fulde oprindelige tekst findes i Git-historikken.

## Hvad den gamle undersøgelse afklarede

- En tidlig `send_voice_assistant_audio`-vej gav ingen lyd med den daværende
  media-player-konfiguration. Den fysiske svarvej måtte bruge Voice PE's
  announcement/mixer/speaker-kæde. Den aktuelle Live-vej er den korrelerede
  `/reply/live/{stream_id}.wav`; se [audio-path](audio-path.md).
- XMOS tager en fysisk speaker-reference fra I2S-kæden. Det forklarer, hvorfor
  AEC kan arbejde på begge behandlede mikrofonkanaler, men beviser ikke en
  akustisk sikker afbrydelse i det aktuelle rum.
- Tidlige selvsvar, fragmenterede transcripter og fastlåst LED gav nyttige
  regressioner for ejergrænser og fysisk playback. De er historiske symptomer;
  de må ikke omsættes til en ny v2.x-regel om at lukke Live-input under output.

## Aktiv vej

Lokal microWakeWord → firmware-latch → `VoicePELink` → én `ThinSession` med
`OpenAILiveSession` → løbende GPT-Live-input og svar → fysisk korreleret
announcement-playback → modelsemantisk eller teknisk lukning → én teardown og
rearm. Ny brugerlyd kan komme, mens svarlyd afspilles. `State` beskriver
samtalens lifecycle, ikke en separat v2.x half-duplex-inputlås. Talk bruger
samme Live/Thin-motor med browser-I/O og er ikke fysisk puckbevis.

Detaljer og beslutninger står i [ARKITEKTUR](ARKITEKTUR.md) og
[INVARIANTER](INVARIANTER.md). Målbare fysiske krav står i
[PRODUKTMÅL](PRODUKTMÅL.md), mens [STATUS](STATUS.md) siger, hvad der faktisk
er bevist på den aktuelle kandidat. Input, provider-, output- og
firmwareevents må korreleres; ingen af dem alene er hørbar lyd eller en
færdig full-duplex-afbrydelse.
