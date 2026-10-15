# PodVoice · fysisk lydvej og bevisgrænser

Dette er et kildekort til den aktuelle GPT-Live v2.x-vej. Bindende ejerskab og
acceptkrav står i [ARKITEKTUR](ARKITEKTUR.md), [INVARIANTER](INVARIANTER.md),
[PRODUKTMÅL](PRODUKTMÅL.md) og aktuel [STATUS](STATUS.md).

```text
XMOS/I2S → podvoice_audio → ESPHome native API → VoicePELink (16 kHz PCM)
    → ThinSession → OpenAILiveSession (resampler til 24 kHz) → GPT-Live
GPT-Live audio → ThinSession/LiveAudioStreams → /reply/live/{stream_id}.wav
    → Voice PE media-player announcement → mixer/højttaler
```

`podvoice_audio` tapper mikrofonen uden HA Assist/STT. Firmware åbner
mic-forward efter et lokalt wake og lukker det ved samtalens teardown. Den
aktuelle standard er XMOS-kanal 1 (AEC/IC/NS uden AGC), `mic_gain=16` og
`openai_noise=off`; kanal 0 er AEC/IC/NS/AGC og kan vælges til en konkret
diagnose. `VoicePELink` genanvender valgt kanal/gain ved forbindelse.
`OpenAILiveSession.send_audio` resampler indgående PCM til 24 kHz før providerens
input. Begge XMOS-kanaler er efter AEC; "uden AGC" betyder ikke rå pre-AEC-lyd.

GPT-Live v2.x beholder inputvejen åben under eget svar. Den aktuelle
`ThinSession`-pumpe videresender Live-frames også i playback- og thinking-faser;
native `full_duplex=False` er et ældre flag for andre grene, ikke en Live-mic-gate.
Fysisk wake-latch, privacy, aktuel input-/outputgeneration, playback-lease og én
teardown/rearm afgrænser strømmen. En åben softwarevej beviser ikke, at AEC fjerner
selvsvar eller at en faktisk stemmeafbrydelse bliver hørt og håndteret rigtigt.

Voice PE-svar bruger den korrelerede Live WAV-announcement via
`/reply/live/{stream_id}.wav`. Den ældre `/reply/<room>.flac` findes som
legacy-/fallback-replybus; den beskriver ikke standardoutput for en GPT-Live-tur.
Firmware-events om playback-start/slut er mekaniske observationer. Providerens
audio-bytes og transcript er ikke optagelse af det, familien hørte i rummet.
Talk bruger browserens egen mikrofon, AEC og lydafspilning gennem den samme
`ThinSession`, men kan ikke validere puckens akustik.

Automatiske og manuelle lydspor kan fastholde `device.wav` (modtaget native PCM),
`provider.wav` (PCM mod provider), svarlyd før højttaleren og en korreleret
eventtidslinje. De er nyttige til at lokalisere fejl i input, resampling, toolrunde,
playback og close; fysisk hørbarhed kræver en rumoptagelse eller direkte fysisk
prøve. Sporene er lokale, privacy-bundne og er ikke et alternativ til gates i
[PRODUKTMÅL](PRODUKTMÅL.md).

Den tidligere 26.6.0-kildeanalyse af HA's to-kanals STT og historiske ch1/gain4-
matrix findes i Git-historikken. Den var en forklaring på en ældre prøve, ikke
en aktiv anbefaling om at ændre v2.x-gain, VAD eller mikrofonlås.
