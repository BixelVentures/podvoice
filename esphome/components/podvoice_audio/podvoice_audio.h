// =============================================================================
// podvoice_audio.h — S1 continuous-audio shim for the HA Voice PE
// =============================================================================
//
// CONCURRENCY MODEL (the part that matters most)
//   - The MicrophoneSource data callback runs on the *audio task* (FreeRTOS).
//     It may NOT block or do network I/O: ESPHome's audio path enforces
//     AUDIO_CHANNEL_STALL_TIMEOUT_MS=2000. So the callback ONLY writes raw
//     bytes into a ring_buffer::RingBuffer (overwriting oldest on overflow)
//     and returns immediately.
//   - loop() runs on the main/API task. It drains the ring buffer with read()
//     (an ATOMIC receive+return that holds NO outstanding item) into a
//     pre-allocated scratch buffer, then emits VoiceAssistantAudio messages on
//     the native API connection. send_message() copies the payload synchronously.
//
//   IMPORTANT — why read() and not receive_acquire():
//     RingBuffer::receive_acquire() documents "Only one item may be checked out
//     at a time," and overwriting write() (used by the audio task) internally
//     performs a receive via discard_bytes_() to free space. Holding an acquired
//     item on the drain task WHILE the audio task discards/receives is two
//     concurrent receivers on a single-consumer FreeRTOS bytebuf — undefined.
//     Upstream voice_assistant avoids this exact hazard: overwriting write() on
//     the producer side, read() (no held item) on the consumer side
//     (audio_transfer_buffer.cpp RingBufferAudioSource). We do the same.
//
// TRANSPORT
//   We do not own a connection. PodVoice (the add-on) connects over the native
//   API and calls subscribe_voice_assistant; ESPHome records that client on
//   global_voice_assistant->get_api_connection() (set in client_subscription(),
//   voice_assistant.cpp:567). We send VoiceAssistantAudio to exactly that
//   connection. If no client is subscribed, we drop frames (the mic is free
//   anyway — there is nothing to back-pressure).
//
//   SINGLE-SUBSCRIBER CONSTRAINT (deployment): the VA api_client_ is a single
//   slot; a second subscriber is REJECTED and the first keeps the slot
//   (voice_assistant.cpp:555). On Voice PE the overlay sets use_wake_word:false
//   so HA Assist never drives the pipeline, but the overlay/HA must ensure
//   PodVoice is the SOLE voice_assistant subscriber — otherwise we'd stream to
//   whoever holds the slot. // VERIFY on hardware: PodVoice is the only VA client.
// =============================================================================

#pragma once

#include "esphome/core/component.h"
#include "esphome/core/helpers.h"

#include "esphome/components/microphone/microphone_source.h"
#include "esphome/components/ring_buffer/ring_buffer.h"

#include <cstdint>
#include <memory>
#include <vector>

namespace esphome {
namespace podvoice_audio {

class PodVoiceAudio : public Component {
 public:
  // --- codegen setters -------------------------------------------------------
  void set_microphone_source(microphone::MicrophoneSource *mic_source) { this->mic_source_ = mic_source; }
  void set_ring_ms(uint32_t ring_ms) { this->ring_ms_ = ring_ms; }
  void set_sample_rate(uint32_t sample_rate) { this->sample_rate_ = sample_rate; }
  // autostart: boot streaming + disable the dead-man timeout (S1 test mode).
  void set_autostart(bool autostart) { this->autostart_ = autostart; }

  // --- Component -------------------------------------------------------------
  void setup() override;
  void loop() override;
  void dump_config() override;
  // Run drain after API/voice_assistant components so global_voice_assistant is
  // populated before our first loop(). LATE keeps us out of the audio-setup path.
  float get_setup_priority() const override { return setup_priority::LATE; }

  // --- control (WAKE-GATED) --------------------------------------------------
  // The device boots with forwarding OFF (privacy default). PodVoice turns it ON
  // on wake (IDLE->LISTENING) and OFF on every return to IDLE (closure / grace
  // expiry / error), via the podvoice_stream_start/stop native-API services.
  // start_streaming() doubles as the dead-man KEEPALIVE: PodVoice re-asserts it
  // periodically while a session is active; if those stop arriving for SAFETY_MS
  // (PodVoice crashed / half-open socket) loop() force-stops so the mic can NEVER
  // be left streaming. Defined in the .cpp (need millis()).
  void start_streaming();
  void stop_streaming();
  void keepalive();  // refresh the dead-man timer without changing enabled state
  bool is_streaming() const { return this->user_enabled_; }

 protected:
  // Pulls bytes out of the ring buffer (read(), atomic) and sends them to the
  // subscribed client. Runs on the main/API task. Returns true if anything was sent.
  bool drain_once_();

  // The passive tap. Created in codegen; we only register the callback.
  microphone::MicrophoneSource *mic_source_{nullptr};

  // Fixed-size PSRAM ring buffer (EXTERNAL_FIRST). Single producer (audio task,
  // overwriting write()) / single consumer (main task, read()). No held item is
  // ever outstanding, so the bytebuf's internal spinlock is sufficient — no
  // application-level mutex needed.
  std::unique_ptr<ring_buffer::RingBuffer> ring_buffer_;

  // Scratch buffer the drain read()s into before handing to send_message().
  // Allocated once in setup(); never reallocated in loop().
  std::vector<uint8_t> drain_buffer_;

  uint32_t ring_ms_{400};
  uint32_t sample_rate_{16000};

  // Boots OFF: the device must EARN the right to stream by receiving a wake-driven
  // start from PodVoice. This is the privacy gate (no audio leaves until wake).
  bool user_enabled_{false};
  bool autostart_{false};  // boot streaming + skip the dead-man timer (S1 test mode)
  uint32_t last_keepalive_ms_{0};  // dead-man timer: last start/keepalive from PodVoice
  bool was_connected_{false};  // tracks subscribe/unsubscribe edges for logging

  // Diagnostics (surfaced in dump_config / logged periodically).
  uint32_t frames_written_{0};     // callbacks that wrote into the ring buffer
  uint32_t overwrite_events_{0};   // callbacks where the ring was too full and
                                   // write() discarded OLDEST bytes to fit (the
                                   // new frame is kept; old audio is lost)
  uint32_t bytes_sent_{0};         // bytes pushed over the API
  uint32_t last_stat_log_ms_{0};
};

}  // namespace podvoice_audio
}  // namespace esphome
