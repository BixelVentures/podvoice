#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <mutex>

namespace esphome::mixer_speaker {
struct SourceActivityObservation {
  uint32_t epoch{0}, sequence{0}, source_ms{0}, sample_rate{0};
  uint64_t frame_begin{0}, frame_end{0}, consumed_frames{0};
  int64_t consumed_us{0};
  uint64_t sum_squares{0}, sample_count{0};
  uint32_t peak{0};
  bool valid{false};
};
// Metrics are taken from the announcement source before music is mixed in.
// Each snapshot covers all newly mixed samples since the previous take(), not
// only the last packet. Frame counters are source-relative within one epoch.
// Output callback consumption is device evidence, not a room/audibility claim.
class SourceActivityObserver {
 public:
  uint32_t restart() {
    std::lock_guard<std::mutex> lock(mutex_);
    const uint32_t epoch = value_.epoch + 1;
    value_ = {};
    value_.epoch = epoch;
    valid_window_ = true;
    ready_ = false;
    coverage_lost_ = false;
    return epoch;
  }
  void ready(uint32_t epoch) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (value_.epoch == epoch) ready_ = true;
  }
  uint64_t capture() {
    std::lock_guard<std::mutex> lock(mutex_);
    return (static_cast<uint64_t>(value_.epoch) << 1) | uint64_t(ready_);
  }
  void mixed(uint64_t captured, const uint8_t *data, uint32_t frames, uint8_t channels, uint8_t bits,
             uint32_t sample_rate, uint32_t source_ms) {
    // A full output buffer can produce an empty mixer pass. It observes no
    // samples: preserve existing coverage without advancing its freshness.
    if (frames == 0) return;
    uint32_t peak = 0;
    uint64_t squares = 0;
    const bool valid = bits == 16 && channels > 0 && sample_rate > 0 && frames > 0;
    const uint64_t count = static_cast<uint64_t>(frames) * channels;
    if (valid) {
      for (uint64_t i = 0; i < count; ++i) {
        int16_t sample;
        std::memcpy(&sample, data + i * sizeof(sample), sizeof(sample));
        const int32_t wide = sample;
        const uint32_t magnitude = wide < 0 ? -wide : wide;
        if (magnitude > peak) peak = magnitude;
        squares += static_cast<uint64_t>(static_cast<int64_t>(wide) * wide);
      }
    }
    std::lock_guard<std::mutex> lock(mutex_);
    if (!accepts_(captured)) return;
    ++value_.sequence;
    value_.source_ms = source_ms;
    value_.sample_rate = sample_rate;
    value_.frame_end += frames;
    value_.sample_count += count;
    value_.sum_squares += squares;
    if (peak > value_.peak) value_.peak = peak;
    valid_window_ = valid_window_ && valid;
    value_.valid = valid_window_ && !coverage_lost_;
  }
  void consumed(uint64_t captured, uint32_t frames, int64_t source_us) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!accepts_(captured)) return;
    value_.consumed_frames += frames;
    value_.consumed_us = source_us;
  }
  SourceActivityObservation take() {
    std::lock_guard<std::mutex> lock(mutex_);
    auto result = value_;
    result.valid = result.valid && ready_ && !coverage_lost_;
    // A heartbeat with no new samples is not a newly observed quiet interval.
    value_.frame_begin = value_.frame_end;
    value_.sum_squares = value_.sample_count = 0;
    value_.peak = 0;
    value_.valid = false;
    valid_window_ = true;
    return result;
  }
 private:
  bool accepts_(uint64_t captured) {
    if ((captured >> 1) != value_.epoch) return false; // old worker cannot taint new epoch
    if (!(captured & 1) || !ready_) {
      // A source/counter transition crossed this observation. Keep the entire
      // epoch unknown: missing frames cannot be repaired with a later timestamp.
      coverage_lost_ = true;
      return false;
    }
    return true;
  }
  bool ready_{false}, coverage_lost_{false};
  std::mutex mutex_;
  SourceActivityObservation value_{};
  bool valid_window_{true};
};
}  // namespace esphome::mixer_speaker
