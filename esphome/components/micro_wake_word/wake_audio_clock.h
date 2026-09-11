#pragma once

#include <cstddef>
#include <cstdint>
#include <mutex>

namespace esphome::micro_wake_word {

// Absolute mono-frame position in the single physical microphone stream.
// epoch belongs to the firmware microphone gate, not to provider/VAD semantics.
struct WakeAudioPosition {
  uint64_t sample{0};
  uint32_t epoch{0};
  uint32_t detector_run{0};
  bool valid{false};
};

// The caller serializes producer append and consumer/reset with mutex. Inference
// itself does not hold the lock. A position is copied when a feature is consumed,
// so subsequently produced audio can never move a queued detection's boundary.
class WakeAudioClock {
 public:
  std::mutex mutex;
  void restart() {
    ++run_;
    mapped_ = false;
    valid_ = false;
    produced_ = consumed_ = 0;
  }
  bool append(WakeAudioPosition end, size_t frames, bool written) {
    if (!end.valid || end.sample < frames) {
      valid_ = false;
      return false;
    }
    if (!mapped_) {
      consumed_ = end.sample - frames;
      epoch_ = end.epoch;
      epoch_start_ = consumed_;
      mapped_ = true;
      valid_ = true;
    } else if (end.sample - frames != produced_) {
      valid_ = false;
    }
    if (end.epoch != epoch_) {
      epoch_ = end.epoch;
      epoch_start_ = end.sample - frames;
    }
    produced_ = end.sample;
    if (!written)
      valid_ = false;
    return valid_;
  }
  WakeAudioPosition consume(size_t frames) {
    if (!mapped_ || consumed_ > produced_ || frames > produced_ - consumed_)
      valid_ = false;
    consumed_ += frames;
    return {consumed_, epoch_, run_, mapped_ && valid_ && consumed_ >= epoch_start_};
  }
  void invalidate() { valid_ = false; }
  bool accepts(WakeAudioPosition position) const {
    return valid_ && mapped_ && position.valid && position.detector_run == run_ &&
           position.epoch == epoch_ && position.sample >= epoch_start_ && position.sample <= consumed_;
  }
  // Only the worker may restart after draining both source buffers and resetting
  // frontend/model probability history. A PV mic-gate epoch does not drop PCM.
  uint32_t run() const { return run_; }

 private:
  uint64_t produced_{0}, consumed_{0}, epoch_start_{0};
  uint32_t epoch_{0}, run_{0};
  bool mapped_{false}, valid_{false};
};
}  // namespace esphome::micro_wake_word
