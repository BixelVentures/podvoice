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

#if defined(USE_PODVOICE_WAKE_REFERENCE) && defined(HAS_PROTO_MESSAGE_DUMP)
#error "Wake reference must not be compiled with protobuf message dumps (VERY_VERBOSE logger)"
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
#ifdef USE_PODVOICE_WAKE_REFERENCE
  uint32_t reference_bytes = 0, reference_trim_us = 0;
#endif
  const bool claimed = this->wake_detector_->claim_wake_audio(boundary, [&]() {
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    if (this->capture_held_ || this->ring_buffer_ == nullptr || !boundary.valid || this->boundary_consumed_ ||
        boundary.epoch != this->audio_epoch_ || boundary.sample <= this->epoch_start_sample_ ||
        boundary.sample > this->produced_samples_)
      return false;
    const size_t available = this->ring_buffer_->available();
    const uint64_t oldest = this->produced_samples_ - available / sizeof(int16_t);
    // An overflow can remove post-detection speech; never silently accept that cut.
    if (boundary.sample < oldest)
      return false;
    size_t discard = (boundary.sample - oldest) * sizeof(int16_t);
#ifdef USE_PODVOICE_WAKE_REFERENCE
    this->clear_wake_snapshot_();
    const uint32_t trim_started_us = micros();
    const size_t reference_size = this->wake_reference_data_ == nullptr ? 0 : std::min(discard, WAKE_REFERENCE_CAPACITY);
    size_t reference_skip = discard - reference_size, reference_written = 0;
#endif
    while (discard > 0) {
      const size_t chunk = std::min(discard, this->drain_buffer_.size());
      const size_t got = this->ring_buffer_->read(this->drain_buffer_.data(), chunk, 0);
      if (got != chunk)
        return false;
#ifdef USE_PODVOICE_WAKE_REFERENCE
      const size_t skip = std::min(reference_skip, got);
      reference_skip -= skip;
      if (got > skip) {
        std::memcpy(this->wake_reference_data_ + reference_written, this->drain_buffer_.data() + skip, got - skip);
        reference_written += got - skip;
      }
#endif
      discard -= got;
    }
#ifdef USE_PODVOICE_WAKE_REFERENCE
    this->wake_reference_boundary_ = boundary;
    this->wake_reference_size_ = reference_written;
    this->wake_reference_start_ = boundary.sample - reference_written / sizeof(int16_t);
    this->wake_reference_capture_ms_ = millis();
    this->wake_reference_trim_us_ = micros() - trim_started_us;
    reference_bytes = this->wake_reference_size_; reference_trim_us = this->wake_reference_trim_us_;
    this->wake_reference_ready_ = this->wake_reference_sensor_ != nullptr;
    auto *va = voice_assistant::global_voice_assistant;
    this->wake_reference_client_ = va == nullptr ? nullptr : va->get_api_connection();
#endif
    this->boundary_consumed_ = true;
    this->user_enabled_ = true;
    this->last_keepalive_ms_ = millis();
    produced = this->produced_samples_;
    retained = this->ring_buffer_->available() / sizeof(int16_t);
    return true;
  });
#ifdef USE_PODVOICE_WAKE_REFERENCE
  if (claimed && this->wake_reference_sensor_ != nullptr)
    ESP_LOGD(TAG, "Wake reference retained_bytes=%u trim_us=%u capacity_bytes=48000",
             unsigned(reference_bytes), unsigned(reference_trim_us));
#endif
  if (claimed)
    ESP_LOGI(TAG, "Wake sample boundary: epoch=%u run=%u detector=%llu produced=%llu retained=%u samples",
             (unsigned) boundary.epoch, (unsigned) boundary.detector_run,
             (unsigned long long) boundary.sample, (unsigned long long) produced, (unsigned) retained);
  return claimed;
}

// Binding and requests run on the main/API task. The microphone task only clears
// validity on a discontinuity; it never touches retained PCM or sends diagnostics.
void PodVoiceAudio::bind_wake_snapshot(const std::string &owner) {
#ifdef USE_PODVOICE_WAKE_REFERENCE
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  if (this->wake_reference_ready_ && this->wake_reference_owner_.empty() && owner.size() == 32)
    this->wake_reference_owner_ = owner;
#else
  (void) owner;
#endif
}
void PodVoiceAudio::clear_wake_snapshot() {
#ifdef USE_PODVOICE_WAKE_REFERENCE
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  this->clear_wake_snapshot_();
#endif
}
#ifdef USE_PODVOICE_WAKE_REFERENCE
void PodVoiceAudio::clear_wake_snapshot_() {
  this->wake_reference_ready_ = false;
  this->wake_reference_requested_ = false;
  this->wake_reference_done_ = false;
  this->wake_reference_size_ = this->wake_reference_offset_ = 0;
  this->wake_reference_owner_.clear();
  this->wake_reference_client_ = nullptr;
}
static uint32_t wake_reference_crc32(const uint8_t *data, size_t size, uint32_t crc) {
  for (size_t i = 0; i < size; ++i) {
    crc ^= data[i];
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (crc >> 1) ^ (0xedb88320U & (0U - (crc & 1U)));
  }
  return crc;
}
void PodVoiceAudio::request_wake_snapshot(const std::string &owner, int generation) {
  if (generation <= 0 || !this->wake_reference_guard_ ||
      this->wake_reference_guard_(owner, true) != static_cast<uint32_t>(generation)) return;
  auto *va = voice_assistant::global_voice_assistant;
  auto *client = va == nullptr ? nullptr : va->get_api_connection();
  {
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    if (!this->wake_reference_ready_ || this->wake_reference_requested_ || owner != this->wake_reference_owner_ ||
        client == nullptr || client != this->wake_reference_client_ || !this->user_enabled_ ||
        this->wake_reference_mute_->state ||
        static_cast<uint32_t>(millis() - this->wake_reference_capture_ms_) >= WAKE_REFERENCE_TTL_MS) return;
    this->wake_reference_requested_ = true;
    this->wake_reference_generation_ = static_cast<uint32_t>(generation);
    this->wake_reference_crc_ = 0xffffffffU;
    this->wake_reference_crc_offset_ = 0;
  }
  // CRC work is deferred to bounded <=768-byte main-loop slices after audio.
}
void PodVoiceAudio::send_wake_snapshot_(bool audio_sent) {
  auto *va = voice_assistant::global_voice_assistant;
  auto *client = va == nullptr ? nullptr : va->get_api_connection();
  std::string owner;
  uint32_t generation = 0;
  {
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    if (!this->wake_reference_ready_ || !this->wake_reference_requested_ || this->wake_reference_done_) return;
    owner = this->wake_reference_owner_;
    generation = this->wake_reference_generation_;
  }
  if (client == nullptr || !this->wake_reference_guard_ ||
      this->wake_reference_guard_(owner, false) < generation) {
    this->clear_wake_snapshot(); return;
  }
  // This only proves that the native overflow queue is empty, not socket headroom.
  // A diagnostic may itself create overflow; drain_once_ retains subsequent PCM
  // until that transport debt is cleared. No diagnostic send is retried.
  if (!client->try_to_clear_buffer(false)) return;
  uint8_t raw[WAKE_REFERENCE_CHUNK];
  size_t count, size, offset;
  uint64_t start;
  uint32_t captured, crc;
  bool calculating_crc = false;
  micro_wake_word::WakeAudioPosition boundary;
  {
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    if (!this->wake_reference_ready_ || client != this->wake_reference_client_ || !this->user_enabled_ ||
        this->wake_reference_mute_->state ||
        static_cast<uint32_t>(millis() - this->wake_reference_capture_ms_) >= WAKE_REFERENCE_TTL_MS) {
      this->clear_wake_snapshot_(); return;
    }
    // Audio wins both when MAX_SENDS_PER_LOOP was exhausted and when a new batch
    // arrived during normal drain. Snapshot never steals its remaining loop budget.
    if (this->ring_buffer_->available() != 0) return;
    size = this->wake_reference_size_;
    calculating_crc = this->wake_reference_crc_offset_ < size;
    // After CRC, each chunk needs a successful normal PCM send in this loop.
    // Tight empty-loop turns therefore cannot burst 48KB ahead of the next mic frame.
    if (!calculating_crc && !audio_sent) return;
    offset = calculating_crc ? this->wake_reference_crc_offset_ : this->wake_reference_offset_;
    count = std::min(size - offset, WAKE_REFERENCE_CHUNK);
    if (count) std::memcpy(raw, this->wake_reference_data_ + offset, count);
    start = this->wake_reference_start_; captured = this->wake_reference_capture_ms_;
    crc = this->wake_reference_crc_; boundary = this->wake_reference_boundary_;
  }
  if (calculating_crc) {
    const uint32_t next_crc = wake_reference_crc32(raw, count, crc);
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    if (this->wake_reference_ready_) {
      this->wake_reference_crc_ = next_crc;
      this->wake_reference_crc_offset_ += count;
    }
    return;
  }
  char *json = this->wake_reference_json_;
  const int header_length = snprintf(json, sizeof(this->wake_reference_json_),
      "{\"v\":1,\"status\":\"%s\",\"owner\":\"%s\",\"generation\":%u,\"epoch\":%u,\"detector_run\":%u,"
      "\"sample_start\":%llu,\"sample_end\":%llu,\"detected_ms\":%u,\"delivered_ms\":%u,"
      "\"captured_ms\":%u,\"expires_ms\":%u,\"seq\":%u,\"total\":%u,\"bytes\":%u,\"crc32\":\"%08x\",\"pcm\":\"",
      size ? "ok" : "missing", owner.c_str(), generation, boundary.epoch, boundary.detector_run,
      static_cast<unsigned long long>(start), static_cast<unsigned long long>(boundary.sample),
      boundary.detected_ms, boundary.delivered_ms, captured, captured + WAKE_REFERENCE_TTL_MS,
      unsigned(offset / WAKE_REFERENCE_CHUNK), unsigned((size + WAKE_REFERENCE_CHUNK - 1) / WAKE_REFERENCE_CHUNK),
      unsigned(size), ~crc);
  const size_t encoded_length = ((count + 2) / 3) * 4;
  if (header_length <= 0 || static_cast<size_t>(header_length) + encoded_length + 3 > sizeof(this->wake_reference_json_)) {
    this->clear_wake_snapshot(); return;
  }
  static constexpr char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t length = static_cast<size_t>(header_length);
  for (size_t i = 0; i < count; i += 3) {
    const uint32_t value = (uint32_t(raw[i]) << 16) | (i + 1 < count ? uint32_t(raw[i + 1]) << 8 : 0) |
                           (i + 2 < count ? raw[i + 2] : 0);
    json[length++] = B64[(value >> 18) & 63]; json[length++] = B64[(value >> 12) & 63];
    json[length++] = i + 1 < count ? B64[(value >> 6) & 63] : '=';
    json[length++] = i + 2 < count ? B64[value & 63] : '=';
  }
  json[length++] = '"'; json[length++] = '}'; json[length] = 0;
  api::TextSensorStateResponse message;
  message.key = this->wake_reference_sensor_->get_object_id_hash();
  message.state = StringRef(json, static_cast<size_t>(length));
  const bool sent = client->send_message(message);  // Copies synchronously; NEVER publish_state/broadcast.
  // A successful send may have queued a partial write. Invalidation/expiry must
  // not erase this debt before the next physical session tries to forward PCM.
  this->wake_reference_debt_client_ = client;
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  if (!sent) { this->clear_wake_snapshot_(); return; }
  this->wake_reference_offset_ += count;
  this->wake_reference_done_ = this->wake_reference_offset_ == size;
}
#endif

void PodVoiceAudio::start_streaming() {
  // Idempotent enable/keepalive. Never reset here: the add-on calls this again while
  // the session is live, and doing so would cut words out of an active utterance.
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  if (this->capture_held_)
    return;
  this->user_enabled_ = true;
  this->last_keepalive_ms_ = millis();
}
void PodVoiceAudio::stop_streaming() {
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
#ifdef USE_PODVOICE_WAKE_REFERENCE
  this->clear_wake_snapshot_();
#endif
  ++this->audio_epoch_;
  this->epoch_start_sample_ = this->produced_samples_;
  this->boundary_consumed_ = false;
  this->user_enabled_ = false;
  this->capture_token_ = 0;
  this->capture_client_ = nullptr;
  // A completed conversation must never leak its tail into the next wake's pre-roll.
  // From the next mic callback onward the ring starts building a fresh local window.
  if (this->ring_buffer_ != nullptr)
    this->ring_buffer_->reset();
}

bool PodVoiceAudio::hold_capture(uint32_t token) {
#ifdef USE_VOICE_ASSISTANT
  auto *va = voice_assistant::global_voice_assistant;
  auto *client = va != nullptr ? va->get_api_connection() : nullptr;
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  if (token == 0 || token > 0x7FFFFFFF || client == nullptr || this->ring_buffer_ == nullptr)
    return false;
  if (this->capture_held_)
    return token == this->capture_token_ && client == this->capture_client_;
  if (!this->user_enabled_ || token <= this->capture_last_token_)
    return false;
  this->capture_held_ = true;
  this->capture_token_ = this->capture_last_token_ = token;
  this->capture_client_ = client;
  this->user_enabled_ = false;
#ifdef USE_PODVOICE_WAKE_REFERENCE
  this->clear_wake_snapshot_();
#endif
  ++this->audio_epoch_;
  this->epoch_start_sample_ = this->produced_samples_;
  this->boundary_consumed_ = false;
  if (this->ring_buffer_ != nullptr)
    this->ring_buffer_->reset();
  return true;
#else
  return false;
#endif
}

bool PodVoiceAudio::resume_capture(uint32_t token) {
#ifdef USE_VOICE_ASSISTANT
  auto *va = voice_assistant::global_voice_assistant;
  auto *client = va != nullptr ? va->get_api_connection() : nullptr;
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
  if (!this->capture_held_ || token == 0 || token != this->capture_token_ ||
      client == nullptr || client != this->capture_client_)
    return false;
  if (this->ring_buffer_ != nullptr)
    this->ring_buffer_->reset();
#ifdef USE_PODVOICE_WAKE_REFERENCE
  this->clear_wake_snapshot_();
#endif
  ++this->audio_epoch_;
  this->epoch_start_sample_ = this->produced_samples_;
  this->capture_held_ = false;
  this->capture_token_ = 0;
  this->user_enabled_ = true;
  this->last_keepalive_ms_ = millis();
  return true;
#else
  return false;
#endif
}

void PodVoiceAudio::reset_capture_barrier() {
  std::lock_guard<std::mutex> lock(this->audio_mutex_);
#ifdef USE_PODVOICE_WAKE_REFERENCE
  this->clear_wake_snapshot_();
#endif
  if (!this->capture_held_)
    return;  // Ordinary OFF/rearm timing remains unchanged when no hold existed.
  ++this->audio_epoch_;
  this->epoch_start_sample_ = this->produced_samples_;
  this->boundary_consumed_ = false;
  this->user_enabled_ = false;
  this->capture_token_ = 0;
  this->capture_client_ = nullptr;
  if (this->ring_buffer_ != nullptr)
    this->ring_buffer_->reset();
  this->capture_held_ = false;
  // Keep the retired-token high-water mark: late hold/resume cannot become a new action.
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
#ifdef USE_PODVOICE_WAKE_REFERENCE
  if (this->wake_reference_sensor_ != nullptr && this->wake_reference_mute_ != nullptr) {
    RAMAllocator<uint8_t> allocator(RAMAllocator<uint8_t>::ALLOC_EXTERNAL);
    this->wake_reference_data_ = allocator.allocate(WAKE_REFERENCE_CAPACITY);
    this->wake_reference_mute_->add_on_state_callback([this](bool muted) {
      if (muted) this->clear_wake_snapshot();
    });
    // Metadata only. Allocation failure never disables microphone/wake processing.
    ESP_LOGCONFIG(TAG, "Wake reference optional PSRAM bytes=%u", this->wake_reference_data_ == nullptr ? 0U : 48000U);
  }
#endif

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
#ifdef USE_PODVOICE_WAKE_REFERENCE
      this->clear_wake_snapshot_();
#endif
      ++this->audio_epoch_;
      this->epoch_start_sample_ = this->produced_samples_;
      this->ring_buffer_->reset();
      return;
    }
    const size_t frames = data.size() / frame_bytes;
    if (this->capture_held_) {
      // The shared MWW sample clock must still advance; only forwarded PCM is dropped.
      this->produced_samples_ += frames;
      this->frames_written_.fetch_add(1, std::memory_order_relaxed);
      this->ring_buffer_->reset();
      return;
    }
    // Process the ENTIRE callback; a large source chunk must not truncate the
    // shared clock or the beginning of a question at the scratch-buffer limit.
    const size_t batch_frames = std::min<size_t>(MONO_SCRATCH_SAMPLES,
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
#ifdef USE_PODVOICE_WAKE_REFERENCE
        this->clear_wake_snapshot_();
#endif
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
  if (this->capture_client_ != nullptr && client != this->capture_client_) {
    // Disconnect retires the pending resume. Only normal rearm may release its hold.
    this->stop_streaming();
  }

#ifdef USE_PODVOICE_WAKE_REFERENCE
  {
    std::lock_guard<std::mutex> lock(this->audio_mutex_);
    if (this->wake_reference_ready_ && (client != this->wake_reference_client_ ||
        static_cast<uint32_t>(millis() - this->wake_reference_capture_ms_) >= WAKE_REFERENCE_TTL_MS))
      this->clear_wake_snapshot_();
  }
#endif
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
  bool audio_backpressure = false, audio_sent = false;
  for (size_t sends = 0; sends < MAX_SENDS_PER_LOOP; sends++) {
    if (!this->drain_once_()) {
      // drain_once_ consumes only when data exists; a nonempty pre-read means its
      // false return was a send failure. The diagnostic may not follow that failure.
      audio_backpressure = this->last_drain_send_failed_;
      break;
    }
    audio_sent = true;
  }

#ifdef USE_PODVOICE_WAKE_REFERENCE
  if (!audio_backpressure) this->send_wake_snapshot_(audio_sent);
#else
  (void) audio_backpressure; (void) audio_sent;
#endif

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
  this->last_drain_send_failed_ = false;
  if (this->ring_buffer_ == nullptr)
    return false;

  voice_assistant::VoiceAssistant *va = voice_assistant::global_voice_assistant;
  api::APIConnection *client = (va != nullptr) ? va->get_api_connection() : nullptr;
  if (client == nullptr)
    return false;

#ifdef USE_PODVOICE_WAKE_REFERENCE
  if (this->wake_reference_debt_client_ != nullptr) {
    if (client == this->wake_reference_debt_client_ && !client->try_to_clear_buffer(false)) {
      // Do not consume the next microphone bytes behind our own diagnostic backlog.
      // This barrier survives Stop/expiry/mute and is independent of snapshot validity.
      this->last_drain_send_failed_ = true;
      return false;
    }
    this->wake_reference_debt_client_ = nullptr;
  }
#endif

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
    this->last_drain_send_failed_ = true;
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
