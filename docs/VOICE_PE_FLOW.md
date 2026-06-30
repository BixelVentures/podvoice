# Voice PE — Complete Audio & Conversation Flow Design

Status: **DESIGN — for review before building.** Supersedes the ad-hoc "Vej A" bring-up.
Grounded in two deep investigations (firmware audio architecture + gatekeeper flow) and
the observed hardware failures (no sound out; self-interrupting/fragmented replies; LED
stuck blue; session never closes).

---

## 1. Goal & hard constraints

- **Goal:** a real, natural voice conversation on the physical Voice PE — wake → talk →
  the assistant replies *out loud on the device* → you can keep talking → it ducks
  PodConnect music → privacy (no streaming except between wake and grace-end).
- **Constraints:**
  - Firmware does as little as possible; all logic lives in the Python gatekeeper.
  - `!extend` is unusable for single-instance components (voice_assistant/mww) on
    ESPHome 2026.6.x — proven. So we cannot re-wire the stock voice_assistant in YAML.
  - Firmware compiles natively on the Mac (the HA-VM compile env corrupts builds) and
    flashes over USB.
  - The user is non-dev: it must "just work," and be testable in one clean pass.

---

## 2. The hardware reality (what actually works)

The Voice PE is built for **half-duplex HA Assist**, not raw bidirectional PCM. Three facts
decided by reading the upstream firmware:

1. **Mic IN works (our `podvoice_audio`).** The XMOS XU316 runs a full AEC + beamforming +
   noise-suppression pipeline and outputs two channels on the I2S input bus. Channel 0 =
   fully processed (AEC→IC→NS→AGC) clean mic. `podvoice_audio` taps it passively and
   streams it gap-free (S1 proven). Multiple taps can coexist; the stock VA's mic tap is
   independent.

2. **AEC is path-independent and sound.** The XMOS taps the **I2S output bus directly** as
   its echo reference. *Any* audio that physically plays through `i2s_audio_speaker` →
   aic3204 → speaker is cancelled from channel 0. There is **no feedback-loop risk from the
   architecture** as long as the AI reply plays through the normal speaker chain. (Refutes
   the earlier echo-architecture worry.)

3. **Speaker OUT via `send_voice_assistant_audio` is DEAD.** The firmware configures the VA
   with `set_media_player(external_media_player)`, **not** `set_speaker(...)`. So the device's
   `on_audio()` handler — which only fills a `speaker_buffer_` that exists when a *speaker* is
   set — is a permanent no-op. **Every PCM chunk we send is silently discarded.** That is the
   single, definitive cause of "no sound from the Voice PE." The device only plays audio via
   the **media-player announce path** (an HTTP/URL source feeding the mixer → speaker chain).

**Implication:** to get sound out *now* with zero firmware risk, the gatekeeper must serve the
AI reply as an HTTP stream and play it via the device's `external_media_player` (announce).
That path goes through the same mixer → `i2s_audio_speaker` → aic3204 chain the XMOS monitors,
so **AEC stays correct**.

---

## 3. Root causes of the observed failures

| Symptom | Root cause | Fix |
|---|---|---|
| **No sound from Voice PE** | `send_voice_assistant_audio` is dead (media_player config, not speaker) | Play reply via `external_media_player` HTTP announce (§5, Phase 1) |
| **Reply fragmented into syllables, self-interrupting** | Mic forwarded to the provider **during AI_SPEAKING** → ambient noise/VAD (and later echo) fire `speech_started` → cancels the model's own reply → loop | Gate-shut (send silence) during AI_SPEAKING + barge-in sustain debounce (§4) |
| **History shows每 syllable as a turn** | `hub.transcript()` persists every transcript *delta* | Coalesce deltas, flush one turn at end (§6) |
| **LED stuck blue / session never closes** | The self-interrupt loop keeps it in LISTENING/AI_SPEAKING; no clean close | Fixed by the gating + the watchdog/no-speech timeout + the LED settle (already shipped) |

---

## 4. The conversation flow — state machine (the core)

States: **IDLE → LISTENING → AI_SPEAKING → LOUNGE_WINDOW → IDLE.** The decisive change is what
each state does to the **mic gate**.

### State × concern table (target)

| Concern | IDLE | LISTENING | AI_SPEAKING | LOUNGE_WINDOW |
|---|---|---|---|---|
| Device mic stream | stopped | streaming | streaming | streaming |
| **Mic → provider (gate)** | — | **open (real frames)** | **shut (silence)** | shut (silence) |
| AI audio out | — | — | **playing (announce)** | draining |
| Lounge VAD (local) | off | off | off | on |
| LED | off | cyan | green | dim cyan |
| Ducking | released | duck % | duck % | lounge % |
| Watchdog | disarmed | armed at end-of-speech | armed (re-armed on output) | disarmed |
| Transcript buffer | clear | accumulating (you) | accumulating (AI) | flushed |

**Why gate-shut during AI_SPEAKING:** with the gate open, the never-ending mic stream makes
the provider's server-VAD fire `speech_started` on ambient noise (and, once audio plays,
residual echo) → it cancels its own reply. Sending **silence** while the AI speaks keeps the
session clock alive without false barge-ins. This is the fix for the self-interrupt loop.

**Barge-in policy (Phase 1):** while the AI speaks, a real interruption comes from the **center
button** (BUTTON_PRESS → stop) or the **wake word** again. Voice-barge-in (interrupting by just
talking) is **Phase 2** (§7) — it needs the gate open during AI_SPEAKING + a sustain debounce +
validated AEC, so it doesn't false-trigger.

### Gap transitions to add (robustness)

- **LOUNGE_WINDOW + WAKE_WORD/BUTTON_PRESS →** LISTENING (re-open) — today it's a no-op.
- **LOUNGE_WINDOW + GEMINI_RESPONDING →** AI_SPEAKING (a late follow-up reply).
- **LISTENING/AI_SPEAKING + BUTTON_PRESS →** IDLE (clean stop).
- **No-speech timeout:** arm an 8 s "first speech" timeout on wake; if nothing comes back,
  close cleanly instead of hanging in LISTENING.

### Barge-in debounce (provider layer)

`speech_started` must NOT instantly cancel the reply. Record the time; only treat it as a real
barge-in if speech **sustains ≥ ~300 ms** (checked at `speech_stopped`). Kills the fast-loop
even if a blip of energy leaks through.

---

## 5. Audio OUT — the speaker path

### Phase 1 (now, zero firmware change) — HTTP announce

1. Gatekeeper resolves the `external_media_player` entity key on connect.
2. Gatekeeper runs a tiny HTTP endpoint `GET /reply/<id>.wav` that streams a WAV header then
   the AI reply PCM **as it arrives** from the provider (chunked).
3. On reply start, the gatekeeper calls `media_player_media_play(key=…, media_url=…,
   announcement=True)`. The device's `http_announcement_source` (250 KB buffer) absorbs jitter;
   audio flows mixer → `i2s_audio_speaker` → aic3204 → speaker. **AEC correct.**
4. Barge-in / stop = `media_player.stop` (or play silence).

Tradeoff: ~300–500 ms first-audio latency (HTTP + resampler). Acceptable for a first working
conversation. **No firmware change, no risk.**

### Phase 2 (later, low latency) — custom firmware

For ~50 ms latency we add a `podvoice_speaker` C++ component (the mirror of `podvoice_audio`)
that writes received PCM straight into the `announcement_mixing_input` speaker, OR switch the VA
to `speaker: announcement_mixing_input` + one new public C++ method to hold it in the
streaming-response state. Both need a firmware/C++ change — deferred until Phase 1 works.

---

## 6. Transcript coalescing (clean History)

- Accumulate `OutputTranscript` / `InputTranscript` deltas into per-session buffers.
- Broadcast **live deltas** to the panel for display (nice UX) but DO NOT persist each.
- **Flush** one complete turn to history on `TurnComplete` (AI) / `UserSpeechStopped` (you);
  **discard** the AI buffer on a real `Interrupted` (the reply was cancelled).
- Result: History shows clean "you / assistant" turns, not syllables.

---

## 7. Good-case user journey (Phase 1)

1. **"Okay Nabu"** → device wake → gatekeeper `handle_start` → WAKE_WORD.
   - Gate opens, mic → provider, music ducks, LED **cyan**, watchdog will arm at end-of-speech.
2. **You speak** ("hvad er klokken?"). Provider transcribes; at end-of-speech the watchdog arms.
3. **AI replies** → first audio → AI_SPEAKING: **gate shuts (silence)**, LED **green**, the
   reply streams to the device via announce and **plays out loud**. Transcript accumulates.
4. **Reply ends** (TurnComplete) → LOUNGE_WINDOW: LED **dim cyan**, music to lounge %, the
   transcript is flushed as one clean turn, a grace timer starts, local VAD listens.
5. **You follow up within grace** → LOCAL_VOICE_DETECTED → back to LISTENING (no wake needed).
   Or **say nothing** → grace expires → IDLE: stream stops, music restored, LED **off**.
6. **Interrupt the AI** → press the center button (Phase 1) → clean stop → IDLE.

---

## 8. Edge cases (complete)

| Case | Behaviour |
|---|---|
| **Echo / self-interrupt** | Gate-shut during AI_SPEAKING + 300 ms barge-in debounce → eliminated. |
| **Genuine barge-in (Phase 1)** | Center button or re-wake stops the reply. Voice-barge-in = Phase 2. |
| **Grace re-open** | Local VAD in LOUNGE → LISTENING without a new wake. |
| **Mute** | Hardware/`master_mute_switch` → gatekeeper observes it → LED **red**, session closed, no audio leaves the device (firmware already mutes the i2s mic). |
| **Network drop mid-reply** | Gemini auto-resumes (make-before-break). **OpenAI needs a reconnect loop added** (it has none today) → otherwise the session ends and you re-wake. |
| **Model hangs (no reply)** | Watchdog (3000 ms, armed at end-of-speech) → error flash → IDLE. |
| **Wake but you say nothing** | No-speech timeout (~8 s) → clean close (new). |
| **Wake while AI speaking** | WAKE_WORD → stop reply → LISTENING. |
| **Provider differences** | OpenAI server/semantic VAD vs Gemini auto-VAD: all handled by gate-shut (silence has no energy, so neither fires false barge-in) + the debounce. |
| **Two rooms** | Per-room sessions already isolated; each owns its device's single VA subscriber. |
| **HA also added the device** | Must NOT add Voice PE to HA Assist — it competes for the single VA subscriber. Panel warns; documented. |

---

## 9. LED + button + mute (from the button blueprint)

- **LED:** off=idle, cyan=listening, green=AI speaking, dim cyan=grace, **red=muted**,
  red-flash=error (now settles, no stuck-red). Driven off-device via `led_ring` light_command.
- **Center button:** short press = manual wake (already routes via `handle_start`); also a clean
  interrupt/stop while active.
- **Mute:** observe `master_mute_switch` over the API → set muted, paint red, close any session.
  Firmware already hard-mutes the mic, so no audio can leave when muted.

---

## 10. Implementation plan (phased, prioritized)

**Phase 1 — make it actually converse (software only, no flash):**
1. Audio OUT: `voicepe.play_url` via `external_media_player` + a streaming `/reply/<id>.wav`
   endpoint; wire `playback` to it; resolve the media-player key.
2. Gate-shut + silence during AI_SPEAKING (events/state/orchestrator) — the self-interrupt fix.
3. Barge-in sustain debounce (openai_realtime).
4. Transcript coalescing (hub/orchestrator).
5. State-machine gaps: LOUNGE re-wake, BUTTON_PRESS stop, no-speech timeout.

**Phase 2 — true full-duplex + robustness:**
6. Voice-barge-in: optional open-mic during AI_SPEAKING + debounce, once AEC validated.
7. Low-latency custom `podvoice_speaker` firmware (replaces HTTP announce).
8. OpenAI reconnect loop; per-room health surfaced in the panel.

**Phase 3 — the panel redesign (already partly done):** finish 4-tab + dummy-proof selectors;
the History tab + persistence already work.

---

## 11. Decision summary (what changes vs Vej A)

- **Keep:** `podvoice_audio` mic-in (works), wake via `handle_start`, off-device LED/control.
- **Change:** stop using `send_voice_assistant_audio` (dead) → **play replies via the
  media-player announce path**. Stop forwarding mic during AI_SPEAKING → **gate-shut + silence**.
  Coalesce transcripts. Add the missing state transitions + debounce.
- **Drop:** the assumption that the Voice PE supports raw bidirectional PCM out of the box — it
  does not; true low-latency full-duplex is a Phase-2 custom-firmware item.
