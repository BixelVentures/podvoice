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

// Dead-man safety: if PodVoice stops re-asserting start/keepalive for this long,
// force-stop forwarding so a crashed/half-open add-on can NEVER leave the mic
// streaming. MUST exceed lounge_window_s (8 s) + PodVoice's keepalive cadence +
// jitter so it never cuts a live conversation/grace short. // VERIFY on hardware.
static const uint32_t SAFETY_MS = 25000;

micro_wake_word::WakeAudioPosition PodVoiceAudio::audio_position() {
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  return {this->produced_samples_, this->audio_epoch_, 0, this->ring_buffer_ != nullptr};
}

bool PodVoiceAudio::begin_conversation(micro_wake_word::WakeAudioPosition boundary) {
  if (this->wake_detector_ == nullptr)
    return false;
  uint64_t produced = 0;
  size_t retained = 0;
  const bool claimed = this->wake_detector_->claim_wake_audio(boundary, [this, boundary, &produced, &retained]() {
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    if (this->ring_buffer_ == nullptr || !boundary.valid || this->boundary_consumed_ ||
        boundary.epoch != this->audio_epoch_ || boundary.sample <= this->epoch_start_sample_ ||
        boundary.sample > this->produced_samples_)
      return false;
    const size_t available = this->ring_buffer_->available();
    const uint64_t oldest = this->produced_samples_ - available / sizeof(int16_t);
    // An overflow can remove post-detection speech; never silently accept that cut.
    if (boundary.sample < oldest)
      return false;
    size_t discard = (boundary.sample - oldest) * sizeof(int16_t);
    while (discard > 0) {
      const size_t chunk = std::min(discard, this->drain_buffer_.size());
      const size_t got = this->ring_buffer_->read(this->drain_buffer_.data(), chunk, 0);
      if (got != chunk)
        return false;
      discard -= got;
    }
    this->boundary_consumed_ = true;
    this->user_enabled_ = true;
    this->last_keepalive_ms_ = millis();
    produced = this->produced_samples_;
    retained = this->ring_buffer_->available() / sizeof(int16_t);
    return true;
  });
  if (claimed)
    ESP_LOGI(TAG, "Wake sample boundary: epoch=%u run=%u detector=%llu produced=%llu retained=%u samples",
             (unsigned) boundary.epoch, (unsigned) boundary.detector_run,
             (unsigned long long) boundary.sample, (unsigned long long) produced, (unsigned) retained);
  return claimed;
}

void PodVoiceAudio::start_streaming() {
  // Idempotent enable/keepalive. Never reset here: the add-on calls this again while
  // the session is live, and doing so would cut words out of an active utterance.
  this->user_enabled_ = true;
  this->last_keepalive_ms_ = millis();
}
void PodVoiceAudio::stop_streaming() {
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  ++this->audio_epoch_;
  this->epoch_start_sample_ = this->produced_samples_;
  this->boundary_consumed_ = false;
  this->user_enabled_ = false;
  // A completed conversation must never leak its tail into the next wake's pre-roll.
  // From the next mic callback onward the ring starts building a fresh local window.
  if (this->ring_buffer_ != nullptr)
    this->ring_buffer_->reset();
}

void PodVoiceAudio::set_mic_gain(int gain) {
  if (this->mic_source_ == nullptr || gain < 1 || gain > 64)
    return;
  this->mic_source_->set_gain_factor(gain);
  this->gain_ = gain;
  ESP_LOGI(TAG, "mic gain -> %d", gain);
}
void PodVoiceAudio::keepalive() { this->last_keepalive_ms_ = millis(); }

void PodVoiceAudio::setup() {
  ESP_LOGCONFIG(TAG, "Setting up PodVoice audio shim...");

  if (this->mic_source_ == nullptr || this->wake_detector_ == nullptr) {
    ESP_LOGE(TAG, "Missing microphone source or wake detector");
    this->mark_failed();
    return;
  }

  this->stereo_in_ = this->mic_source_->get_audio_stream_info().get_channels() == 2;

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
  this->wake_detector_->set_wake_audio_clock([this]() { return this->audio_position(); });
  this->mic_source_->add_data_callback([this](const std::vector<uint8_t> &data) {
    if (data.empty() || this->ring_buffer_ == nullptr)
      return;
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    const size_t frame_bytes = this->stereo_in_ ? 4 : 2;
    if (data.size() % frame_bytes != 0) {
      ++this->audio_epoch_;
      this->epoch_start_sample_ = this->produced_samples_;
      this->ring_buffer_->reset();
      return;
    }
    const size_t frames = data.size() / frame_bytes;
    // Process the ENTIRE callback; a large source chunk must not truncate the
    // shared clock or the beginning of a question at the scratch-buffer limit.
    const size_t batch_frames = std::min(MONO_SCRATCH_SAMPLES,
                                        static_cast<size_t>(this->ring_ms_) * this->sample_rate_ / 1000);
    for (size_t first = 0; first < frames; first += batch_frames) {
      const size_t take = std::min(frames - first, batch_frames);
      const int16_t *input = reinterpret_cast<const int16_t *>(data.data());
      for (size_t i = 0; i < take; ++i)
        this->mono_scratch_[i] = input[(first + i) * (this->stereo_in_ ? 2 : 1) +
                                      (this->stereo_in_ && this->channel_ == 1 ? 1 : 0)];
      const size_t n_bytes = take * sizeof(int16_t);
      if (this->ring_buffer_->free() < n_bytes)
        this->overwrite_events_++;
      if (this->ring_buffer_->write(this->mono_scratch_, n_bytes) != n_bytes) {
        // A partial write cannot be described by the contiguous sample clock.
        // Preserve the physical cursor but reject every marker at/before this gap.
        this->produced_samples_ += frames;
        ++this->audio_epoch_;
        this->epoch_start_sample_ = this->produced_samples_;
        this->ring_buffer_->reset();
        this->frames_written_.fetch_add(1, std::memory_order_relaxed);
        return;
      }
    }
    this->produced_samples_ += frames;
    this->frames_written_.fetch_add(1, std::memory_order_relaxed);
  });

  // NOTE: we deliberately do NOT call mic_source_->start(). In passive mode the
  // callback gate is `if (enabled_ || passive_)`, so frames flow without it, and
  // start() is a guaranteed no-op when passive_ is true. Calling it would muddy
  // the "we never touch mic lifecycle" invariant (micro_wake_word owns i2s_mics).

  if (this->autostart_) {
    this->user_enabled_ = true;  // S1 test: stream from boot, no PodVoice start needed
    ESP_LOGCONFIG(TAG, "autostart ON — forwarding from boot (dead-man timer disabled)");
  }

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
  // Dead-man safety stop: if PodVoice hasn't re-asserted start/keepalive within
  // SAFETY_MS, force forwarding OFF (covers a crashed / hung / half-open add-on
  // that a clean TCP disconnect — client==nullptr below — would not catch).
  if (!this->autostart_ && this->user_enabled_ &&
      (millis() - this->last_keepalive_ms_) > SAFETY_MS) {
    ESP_LOGW(TAG, "dead-man timeout (%u ms) — force-stopping mic forward", (unsigned) SAFETY_MS);
    this->stop_streaming();
  }

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
    // No subscribed PodVoice connection: discard continuously. With a subscriber but
    // the privacy gate closed, the ring may roll locally, but begin_conversation()
    // atomically discards it at wake. No pre-wake byte is ever conversation input.
    if (client == nullptr && this->ring_buffer_ != nullptr) {
      std::lock_guard<std::mutex> lock(this->audio_mutex_);
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
             (unsigned) this->frames_written(), (unsigned) this->overwrite_events_,
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
  size_t length;
  {
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    length = this->ring_buffer_->read(this->drain_buffer_.data(), MAX_DRAIN_PER_LOOP, 0);
  }
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
