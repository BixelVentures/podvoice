#include "esphome/components/micro_wake_word/activity_observer.h"
#include "esphome/components/mixer/speaker/activity_observer.h"
#include <cassert>
#include <thread>
using namespace esphome;
int main() {
  micro_wake_word::ActivityObserver vad;
  assert(!vad.snapshot().valid);
  micro_wake_word::WakeAudioPosition position{800, 2, 3, true};
  vad.publish(11, position, 4, false, false); // model warm-up is unknown, never quiet
  assert(!vad.snapshot().valid);
  vad.publish(12, position, 4, false, true);
  auto quiet = vad.snapshot();
  assert(quiet.valid && !quiet.active && quiet.sequence == 2 && quiet.source_ms == 12);
  vad.invalidate(); // worker stop/microphone gap invalidates stale quiet
  assert(!vad.snapshot().valid && vad.snapshot().source_ms == 12);
  position.valid = false;
  vad.publish(13, position, 255, true, true);
  assert(!vad.snapshot().valid);
  position.valid = true;
  // Compound snapshot stays coherent across inference and main-loop threads.
  std::thread writer([&]() {
    for (uint32_t i = 0; i < 10000; ++i) {
      position.sample = i; vad.publish(i, position, i % 256, (i % 2) != 0, true);
    }
  });
  for (int i = 0; i < 10000; ++i) {
    auto value = vad.snapshot();
    if (value.valid) assert(value.position.sample == value.source_ms);
  }
  writer.join();
  mixer_speaker::SourceActivityObserver output;
  output.ready(output.restart());
  const int16_t pcm[] = {-32768, 32767, 0, 2};
  output.mixed(output.capture(), reinterpret_cast<const uint8_t *>(pcm), 4, 1, 16, 48000, 100);
  output.consumed(output.capture(), 2, 100000);
  auto first = output.take();
  assert(first.valid && first.peak == 32768 && first.sample_count == 4);
  assert(first.sum_squares == 2147418117ULL);
  assert(first.frame_begin == 0 && first.frame_end == 4 && first.consumed_frames == 2);
  assert(first.consumed_us == 100000 && first.epoch == 1);
  auto no_new_samples = output.take();
  assert(!no_new_samples.valid && no_new_samples.sample_count == 0);
  assert(no_new_samples.sequence == first.sequence && no_new_samples.source_ms == 100);
  assert(no_new_samples.frame_begin == 4 && no_new_samples.frame_end == 4);
  const int16_t zero[] = {0,0};
  output.mixed(output.capture(), reinterpret_cast<const uint8_t *>(zero), 2, 1, 16, 48000, 110);
  output.mixed(output.capture(), reinterpret_cast<const uint8_t *>(pcm + 3), 1, 1, 16, 48000, 115);
  auto second = output.take();
  assert(second.valid && second.frame_begin == 4 && second.frame_end == 7);
  assert(second.sample_count == 3 && second.peak == 2 && second.sum_squares == 4);
  // Unsupported data is observed as unknown without reading or interpreting it.
  output.mixed(output.capture(), nullptr, 10, 2, 32, 48000, 120);
  auto unsupported = output.take();
  assert(!unsupported.valid && unsupported.sample_count == 20);
  output.ready(output.restart());
  auto restarted = output.take();
  assert(restarted.epoch == 2 && restarted.consumed_frames == 0 && !restarted.valid);
  const auto old_work = output.capture(); // selected source / output debit before restart
  output.ready(output.restart());
  output.mixed(old_work, reinterpret_cast<const uint8_t *>(pcm), 4, 1, 16, 48000, 130);
  output.consumed(old_work, 4, 130000);
  auto fenced = output.take();
  assert(fenced.frame_end == 0 && fenced.consumed_frames == 0 && !fenced.valid);
  output.mixed(output.capture(), reinterpret_cast<const uint8_t *>(pcm), 4, 1, 16, 48000, 140);
  assert(output.take().valid); // old work did not taint a healthy next epoch
  const auto transition_epoch = output.restart();
  const auto during_transition = output.capture();
  output.ready(transition_epoch);
  output.mixed(during_transition, reinterpret_cast<const uint8_t *>(pcm), 4, 1, 16, 48000, 150);
  output.mixed(output.capture(), reinterpret_cast<const uint8_t *>(pcm), 4, 1, 16, 48000, 160);
  assert(!output.take().valid); // ambiguous coverage remains unknown, never guessed quiet
}
