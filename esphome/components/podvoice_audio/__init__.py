# =============================================================================
# podvoice_audio — ESPHome external_component (S1 continuous-audio shim)
# =============================================================================
#
# WHAT THIS IS
#   The ONE custom-firmware piece for the HA Voice PE (ESP32-S3 + XMOS XU316).
#   It taps the already-free-running microphone (micro_wake_word keeps i2s_mics
#   running with stop_after_detection:false) via a *passive* MicrophoneSource,
#   pushes every ~32 ms PCM frame into a fixed-size PSRAM ring buffer from the
#   audio task, and DRAINS that ring buffer from the main loop()/API task as
#   VoiceAssistantAudio messages over the already-open, encrypted native API
#   connection that PodVoice holds (it subscribed via subscribe_voice_assistant).
#
# WHY THIS SHAPE (settled — do not relitigate)
#   - on_data fires on the audio task with AUDIO_CHANNEL_STALL_TIMEOUT_MS=2000;
#     it must NOT do network I/O, hence the ring buffer + loop() drain split.
#   - We reuse the voice_assistant component's api_client_ (global_voice_assistant
#     ->get_api_connection()) so we ride the same wire format aioesphomeapi
#     already decodes via subscribe_voice_assistant (PodVoice's diag.run_s1 path).
#   - We do NOT call voice_assistant.start_continuous (turn-gated dead zone) and
#     we do NOT fork voice_assistant.cpp.
#
# SOURCES (verified against current ESPHome, dev branch, 2026.x / ESP-IDF):
#   - microphone/__init__.py: microphone_source_schema() returns
#       cv.All(automation.maybe_conf(CONF_MICROPHONE, {...}))  -> so the SOURCE
#       schema is itself keyed under `microphone:`. We nest it ONCE under our own
#       CONF_MICROPHONE, exactly like voice_assistant/__init__.py:97 does. The
#       resulting YAML is `podvoice_audio: { microphone: { microphone: i2s_mics,
#       channels: [0], gain_factor: 1 } }` — identical to the voice_assistant block.
#     microphone_source_to_code(config, passive=...) reads CONF_MICROPHONE,
#       CONF_ID, CONF_BITS_PER_SAMPLE, CONF_CHANNELS, CONF_GAIN_FACTOR off the
#       SOURCE dict and passes gain to the MicrophoneSource ctor + add_channel().
#       => gain_factor is owned by the source sub-block; we do NOT set it again.
#     final_validate_microphone_source_schema(component_name, sample_rate=...)
#       -> a validator wrapped in a FV-context schema; mirror voice_assistant's
#       FINAL_VALIDATE_SCHEMA = cv.All(cv.Schema({CONF_MICROPHONE: ...}, ALLOW_EXTRA)).
#   - microphone/microphone_source.h: passive ctor (mic, bits, gain, passive);
#       add_data_callback gate is `if (enabled_ || passive_)` => passive flows
#       WITHOUT start(); start() is a guaranteed no-op when passive_ is true.
#   - api/api_pb2.h:2436 VoiceAssistantAudio { const uint8_t *data; uint16_t
#       data_len; bool end; const uint8_t *data2; uint16_t data2_len; } id=106,
#       ifdef USE_VOICE_ASSISTANT.
#   - ring_buffer/ring_buffer.h: RingBuffer::create(len, MemoryPreference) where
#       `enum class MemoryPreference` is NESTED in RingBuffer (default EXTERNAL_FIRST).
# =============================================================================

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_MICROPHONE
from esphome.components import microphone, voice_assistant  # noqa: F401  (DEPENDENCIES)

# api pulls in global_api_server / APIConnection symbols + defines USE_API;
# voice_assistant provides global_voice_assistant + defines USE_VOICE_ASSISTANT
# (which is the ifdef guarding the VoiceAssistantAudio message we emit).
DEPENDENCIES = ["microphone", "api", "voice_assistant"]
AUTO_LOAD = ["ring_buffer"]
CODEOWNERS = ["@BixelVentures"]

podvoice_audio_ns = cg.esphome_ns.namespace("podvoice_audio")
PodVoiceAudio = podvoice_audio_ns.class_("PodVoiceAudio", cg.Component)

CONF_RING_MS = "ring_ms"

# Voice PE i2s_mics is 16 kHz; the MicrophoneSource converts 32-bit -> 16-bit for us.
SAMPLE_RATE = 16000

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(PodVoiceAudio),
        # The microphone tap. microphone_source_schema() is itself wrapped in
        # maybe_conf(CONF_MICROPHONE, ...), so nesting it once under CONF_MICROPHONE
        # yields the canonical `microphone:` sub-block (short form `microphone: i2s_mics`
        # OR full form `microphone: { microphone: i2s_mics, channels: [0], gain_factor: N }`).
        #
        # bits_per_sample is pinned to 16 (VoiceAssistantAudio carries L16); the
        # MicrophoneSource truncates the mic's native 32-bit samples to 16-bit.
        # channels defaults to "0" inside the SOURCE schema -> channel 0 (the
        # XMOS-processed / AEC'd mic PodVoice forwards; micro_wake_word uses channel 1).
        # gain_factor lives inside this sub-block (source schema, default 1, range 1..64);
        # we do NOT expose a duplicate top-level key.
        cv.Required(CONF_MICROPHONE): microphone.microphone_source_schema(
            min_bits_per_sample=16,
            max_bits_per_sample=16,
            min_channels=1,
            max_channels=1,
        ),
        # Fixed PSRAM jitter/drain buffer. 400 ms @ 16 kHz/16-bit/mono = 12.8 KB.
        cv.Optional(CONF_RING_MS, default=400): cv.int_range(min=64, max=4000),
    }
).extend(cv.COMPONENT_SCHEMA)


# Mirror voice_assistant's FINAL_VALIDATE pattern (voice_assistant/__init__.py:188).
# final_validate_microphone_source_schema returns a validator that calls
# audio.final_validate_audio_schema(...), which needs the final-validation context.
# That context only exists when FINAL_VALIDATE_SCHEMA is a *schema object* run
# through the FV pipeline — NOT when hand-invoked. We allow exactly one mic source,
# so no cv.ensure_list (voice_assistant wraps in ensure_list only because it allows
# multiple). The (component_name, sample_rate=...) signature is confirmed.
# VERIFY (hardware/config): Voice PE i2s_mics actually reports 16 kHz to
# final-validate through the XMOS path (else this raises at config time, by design).
FINAL_VALIDATE_SCHEMA = cv.All(
    cv.Schema(
        {
            cv.Required(CONF_MICROPHONE): microphone.final_validate_microphone_source_schema(
                "podvoice_audio", sample_rate=SAMPLE_RATE
            ),
        },
        extra=cv.ALLOW_EXTRA,
    ),
)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    # passive=True => never start/stop the mic; only receive frames while the mic
    # is already running (micro_wake_word owns lifecycle). This is the whole trick.
    # microphone_source_to_code reads gain_factor/channels/bits off config[CONF_MICROPHONE]
    # itself and wires them via the MicrophoneSource ctor + add_channel().
    mic_source = await microphone.microphone_source_to_code(
        config[CONF_MICROPHONE], passive=True
    )
    cg.add(var.set_microphone_source(mic_source))

    cg.add(var.set_ring_ms(config[CONF_RING_MS]))
    cg.add(var.set_sample_rate(SAMPLE_RATE))
    # NOTE: USE_API + USE_VOICE_ASSISTANT defines come from the `api` and
    # `voice_assistant` dependencies respectively — do NOT add_define them here
    # (that risks duplicate-define and is not how ESPHome guards work).
