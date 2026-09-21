#pragma once
#include "wake_audio_clock.h"
#include <cstdint>
#include <mutex>

namespace esphome::micro_wake_word {
struct ActivityObservation {
  uint32_t sequence{0}, source_ms{0};
  WakeAudioPosition position{};
  uint8_t probability{0};
  bool valid{false}, active{false};
};
// Observation only. Never changes VAD inference, wake, Stop or microphone gates.
class ActivityObserver {
 public:
  void publish(uint32_t source_ms, WakeAudioPosition position, uint8_t probability, bool active, bool ready) {
    std::lock_guard<std::mutex> lock(mutex_);
    ++value_.sequence;
    value_.source_ms = source_ms;
    value_.position = position;
    value_.probability = probability;
    value_.active = active;
    value_.valid = ready && position.valid;
  }
  void invalidate() {
    std::lock_guard<std::mutex> lock(mutex_);
    value_.valid = false;
  }
  ActivityObservation snapshot() {
    std::lock_guard<std::mutex> lock(mutex_);
    return value_;
  }
 private:
  std::mutex mutex_;
  ActivityObservation value_{};
};
}  // namespace esphome::micro_wake_word
