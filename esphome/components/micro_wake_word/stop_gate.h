#pragma once
#include <atomic>
#include <cstdint>

namespace esphome::micro_wake_word {
// One producer, one inference worker and one main-loop control owner. No strings
// cross threads. Epochs never repeat during a boot; main maps epochs to sessions.
class StopGate {
 public:
  // Main: the low bit is eligibility. Changing command immediately invalidates
  // queued events, even if the worker is currently stalled inside inference.
  void request(uint32_t command) { command_.store(command); }
  bool accepts(uint32_t command) const {
    return (command & 1) && command == command_.load() && !fault_.load();
  }
  uint32_t acknowledged() const { return acknowledged_.load(); }
  bool faulted() const { return fault_.load(); }

  // Producer: bracket actual ring writes. The worker must not snapshot a write
  // between publication of its bytes and publication of its sample count.
  void begin_write() { producer_sequence_.fetch_add(1); }
  void end_write(uint32_t accepted_samples) {
    produced_.fetch_add(accepted_samples);
    producer_sequence_.fetch_add(1);
  }
  void invalidate() { fault_.store(true); }

  // Worker lifecycle only; called before microphone start, never at arm/wake.
  void worker_start() {
    consumed_ = 0;
    produced_.store(0);
    worker_command_ = command_.load();
    acknowledged_.store(0xffffffff);
    // An armed context cannot silently lose its fault if restart and failure
    // happen between two main-loop ticks. Only disabled recovery may clear it.
    fault_.store((worker_command_ & 1) != 0);
    fired_ = true; // restart cannot revive an old enabled command
  }
  void consume(uint32_t samples) { consumed_ += samples; }
  void observe(bool model_ready, bool released, uint32_t frontend_samples) {
    const uint32_t command = command_.load();
    if (command != worker_command_) {
      uint32_t sequence = producer_sequence_.load();
      if (sequence & 1) return;
      uint32_t watermark = produced_.load();
      if (sequence != producer_sequence_.load() || command != command_.load()) return;
      worker_command_ = command;
      floor_ = watermark + frontend_samples;
      fired_ = false;
      acknowledged_.store(0xffffffff);
    }
    if (!(command & 1)) {
      acknowledged_.store(command);
      return;
    }
    if (fault_.load() || !model_ready || fired_) return;
    // A high score carried over from before arm cannot arm a new generation.
    // This guards model release, not a claim of complete neural-state isolation.
    if (static_cast<int32_t>(consumed_ - floor_) >= 0 && released)
      acknowledged_.store(command);
  }
  // Worker: at most one event per enabled epoch, with the epoch at production.
  // Stop never invokes upstream reset_probabilities, including stale detections.
  uint32_t detect(bool detected) {
    if (!detected || fired_ || acknowledged_.load() != worker_command_ || !accepts(worker_command_)) return 0;
    fired_ = true;
    return worker_command_;
  }

 private:
  std::atomic<uint32_t> command_{0}, acknowledged_{0xffffffff};
  std::atomic<uint32_t> produced_{0}, producer_sequence_{0};
  std::atomic<bool> fault_{false};
  uint32_t consumed_{0}, worker_command_{0}, floor_{0};
  bool fired_{false};
};
}  // namespace esphome::micro_wake_word
