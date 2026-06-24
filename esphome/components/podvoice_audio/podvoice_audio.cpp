// =============================================================================
// podvoice_audio.cpp — S1 continuous-audio shim implementation
// =============================================================================
#include "podvoice_audio.h"

#include "esphome/core/log.h"
#include "esphome/core/hal.h"
#include "esphome/core/helpers.h"  // YESNO()

// We talk to the native API connection that PodVoice already holds, via the
// voice_assistant component (it owns the subscribed APIConnection*). The
// VoiceAssistantAudio message + global_voice_assistant only exist when
// USE_VOICE_ASSISTANT is defined (the api.proto ifdef guard) — which it is,
// because we DEPEND on voice_assistant.
#ifdef USE_VOICE_ASSISTANT
#include "esphome/components/api/api_pb2.h"                      // api::VoiceAssistantAudio
#include "esphome/components/api/api_connection.h"               // api::APIConnection
#include "esphome/components/voice_assistant/voice_assistant.h"  // global_voice_assistant
#endif

namespace esphome {
namespace podvoice_audio {

static const char *const TAG = "podvoice_audio";

// Max bytes drained per read() call. One ~32 ms frame @ 16 kHz/16-bit/mono is
// ~1024 bytes; this lets us flush a few frames per send. send_message() copies
// synchronously, so this also bounds the transient copy size. data_len is
// uint16_t, so this MUST stay <= 65535 (it is). VERIFY: tune against measured
// loop() cadence on hardware (gap-free continuous audio is gate S1).
static const size_t MAX_DRAIN_PER_LOOP = 4096;

// Bound the number of send_message() calls per loop() so a deep backlog can't
// monopolise the API task. At 4 KB/send this is up to 32 KB drained per loop —
// far more than one loop ever produces, so it only matters when catching up.
static const size_t MAX_SENDS_PER_LOOP = 8;

// How often to emit the throughput/drop stats line.
static const uint32_t STAT_LOG_INTERVAL_MS = 10000;

void PodVoiceAudio::setup() {
  ESP_LOGCONFIG(TAG, "Setting up PodVoice audio shim...");

  if (this->mic_source_ == nullptr) {
    ESP_LOGE(TAG, "No microphone source configured");
    this->mark_failed();
    return;
  }

  // Fixed-size PSRAM ring buffer. bytes = ring_ms * sample_rate * 2 (16-bit) / 1000.
  // create() defaults to EXTERNAL_FIRST (PSRAM, falling back to internal only if
  // PSRAM is exhausted) and is internally FreeRTOS-safe. MemoryPreference is a
  // nested enum: ring_buffer::RingBuffer::MemoryPreference::EXTERNAL_FIRST.
  const size_t bytes_per_ms = (this->sample_rate_ * sizeof(int16_t)) / 1000;
  const size_t ring_bytes = static_cast<size_t>(this->ring_ms_) * bytes_per_ms;
  this->ring_buffer_ = ring_buffer::RingBuffer::create(
      ring_bytes, ring_buffer::RingBuffer::MemoryPreference::EXTERNAL_FIRST);
  if (this->ring_buffer_ == nullptr) {
    ESP_LOGE(TAG, "Failed to allocate %u-byte PSRAM ring buffer", (unsigned) ring_bytes);
    this->mark_failed();
    return;
  }
  ESP_LOGCONFIG(TAG, "Allocated %u-byte ring buffer (%u ms @ %u Hz)", (unsigned) ring_bytes,
                (unsigned) this->ring_ms_, (unsigned) this->sample_rate_);

  // Pre-allocate the drain scratch buffer once (never reallocated in loop()).
  this->drain_buffer_.resize(MAX_DRAIN_PER_LOOP);

  // Register the audio-task callback. This is the ONLY thing that runs off the
  // main task. It must not block: copy bytes into the ring buffer and return.
  // The MicrophoneSource is passive, so this only fires while micro_wake_word
  // already has i2s_mics running — i.e. continuously, for free.
  this->mic_source_->add_data_callback([this](const std::vector<uint8_t> &data) {
    if (data.empty() || this->ring_buffer_ == nullptr)
      return;
    // Overwriting write(): if the buffer is too full, it discards the OLDEST
    // bytes to make room and writes the new frame in full. For a continuous
    // stream that's the right policy (newest audio is most relevant). We only
    // detect+count the overwrite event here; the NEW frame is never dropped.
    if (this->ring_buffer_->free() < data.size())
      this->overwrite_events_++;
    this->ring_buffer_->write((const void *) data.data(), data.size());
    this->frames_written_++;
  });

  // NOTE: we deliberately do NOT call mic_source_->start(). In passive mode the
  // callback gate is `if (enabled_ || passive_)`, so frames flow without it, and
  // start() is a guaranteed no-op when passive_ is true. Calling it would muddy
  // the "we never touch mic lifecycle" invariant (micro_wake_word owns i2s_mics).

  ESP_LOGCONFIG(TAG, "PodVoice audio shim ready (passive mic tap installed)");
}

#ifdef USE_VOICE_ASSISTANT
void PodVoiceAudio::loop() {
  // Drain whatever the audio task has queued, but only if a client is subscribed.
  // The subscribed client == the connection PodVoice opened + subscribe_voice_assistant
  // (api_client_ set in client_subscription(), voice_assistant.cpp:567).
  // VERIFY (hardware): global_voice_assistant is non-null on Voice PE (the overlay
  // keeps the upstream voice_assistant: block) and get_api_connection() returns
  // PodVoice's connection — AND no other client holds the single VA slot.
  voice_assistant::VoiceAssistant *va = voice_assistant::global_voice_assistant;
  api::APIConnection *client = (va != nullptr) ? va->get_api_connection() : nullptr;

  const bool connected = (client != nullptr) && this->user_enabled_;

  // Edge logging.
  if (connected != this->was_connected_) {
    if (connected) {
      ESP_LOGI(TAG, "Consumer subscribed — starting continuous audio forward");
    } else {
      ESP_LOGI(TAG, "Consumer gone — pausing forward (mic tap stays live)");
    }
    this->was_connected_ = connected;
  }

  if (!connected) {
    // No consumer: discard backlog so we don't deliver stale audio on reconnect.
    if (this->ring_buffer_ != nullptr && this->ring_buffer_->available() > 0) {
      this->ring_buffer_->reset();
    }
    return;
  }

  // Drain up to MAX_SENDS_PER_LOOP chunks (each up to MAX_DRAIN_PER_LOOP bytes).
  for (size_t sends = 0; sends < MAX_SENDS_PER_LOOP; sends++) {
    if (!this->drain_once_())
      break;
  }

  // Periodic stats.
  const uint32_t now = millis();
  if (now - this->last_stat_log_ms_ >= STAT_LOG_INTERVAL_MS) {
    this->last_stat_log_ms_ = now;
    ESP_LOGD(TAG, "stats: written=%u overwrites=%u sent=%u bytes backlog=%u",
             (unsigned) this->frames_written_, (unsigned) this->overwrite_events_,
             (unsigned) this->bytes_sent_,
             (unsigned) (this->ring_buffer_ != nullptr ? this->ring_buffer_->available() : 0));
  }
}

bool PodVoiceAudio::drain_once_() {
  if (this->ring_buffer_ == nullptr)
    return false;

  voice_assistant::VoiceAssistant *va = voice_assistant::global_voice_assistant;
  api::APIConnection *client = (va != nullptr) ? va->get_api_connection() : nullptr;
  if (client == nullptr)
    return false;

  // ATOMIC receive+return into our pre-allocated scratch buffer. read() holds NO
  // outstanding item (unlike receive_acquire), so it is safe against the audio
  // task's overwriting write()/discard. ticks_to_wait=0 => non-blocking.
  const size_t length = this->ring_buffer_->read(this->drain_buffer_.data(), MAX_DRAIN_PER_LOOP, /*ticks_to_wait=*/0);
  if (length == 0)
    return false;

  // Build and send the VoiceAssistantAudio message. This is the SAME wire message
  // voice_assistant.cpp:242-251 emits, so aioesphomeapi decodes it via
  // subscribe_voice_assistant unchanged. Generated fields (api_pb2.h:2436):
  //   const uint8_t *data; uint16_t data_len; bool end; const uint8_t *data2; uint16_t data2_len;
  // data_len is uint16_t; length <= MAX_DRAIN_PER_LOOP (<= 65535). OK.
  api::VoiceAssistantAudio msg;
  msg.data = this->drain_buffer_.data();
  msg.data_len = static_cast<uint16_t>(length);
  msg.end = false;
  // data2/data2_len intentionally left default (single channel forward).

  const bool ok = client->send_message(msg);
  if (!ok) {
    // TX buffer full / client busy. The bytes we read() are already consumed and
    // gone — acceptable for a continuous stream (drop, don't stall the API task).
    // Return false so loop() stops draining this pass instead of spinning.
    return false;
  }

  this->bytes_sent_ += length;
  return true;
}
#else   // !USE_VOICE_ASSISTANT — should be impossible given DEPENDENCIES, kept for safety.
void PodVoiceAudio::loop() {}
bool PodVoiceAudio::drain_once_() { return false; }
#endif  // USE_VOICE_ASSISTANT

void PodVoiceAudio::dump_config() {
  ESP_LOGCONFIG(TAG, "PodVoice audio shim:");
  ESP_LOGCONFIG(TAG, "  ring buffer: %u ms (%u Hz, 16-bit mono, PSRAM)", (unsigned) this->ring_ms_,
                (unsigned) this->sample_rate_);
  if (this->is_failed()) {
    ESP_LOGE(TAG, "  COMPONENT FAILED TO SET UP");
  }
}

}  // namespace podvoice_audio
}  // namespace esphome
