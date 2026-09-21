#include "micro_wake_word.h"
#include <cassert>
using namespace esphome::micro_wake_word;
class Detector : public MicroWakeWord {
 public:
  void init() { setup(); state_=DETECTING_WAKE_WORD; stop_gate_.worker_start(); }
  void frame(uint8_t probability, uint64_t sample) {
    int8_t features[40]{};
    feature_wake_audio_ = {sample, 1, 1, true};
    tflite::probability=probability;
    assert(update_model_probabilities_(features));
    process_probabilities_();
  }
  void disable_vad() { vad_model_->disable(); }
  void reset() { esphome::audio::RingBufferAudioSource source; source.ring = std::make_shared<esphome::ring_buffer::RingBuffer>(1024); reset_audio_source_(source); }
};
int main() {
  uint8_t weights[1]{};
  esphome::microphone::MicrophoneSource mic;
  Detector detector;
  detector.set_microphone_source(&mic); detector.set_features_step_size(10);
  detector.set_stop_after_detection(false);
  detector.add_vad_model(weights, 200, 1, 1024);
  detector.init();
  tflite::inference_stride = 2;
  detector.frame(0, 160);
  assert(detector.podvoice_activity().sequence == 0); // feature-only stride
  detector.frame(0, 320);
  assert(detector.podvoice_activity().sequence == 1);
  assert(!detector.podvoice_activity().valid); // genuine inference, still warming
  detector.frame(0, 480);
  assert(detector.podvoice_activity().sequence == 1); // no stale inference republished
  for (int i=3;i<110;++i) detector.frame(0, (i+1)*160);
  auto quiet = detector.podvoice_activity();
  assert(quiet.valid && !quiet.active && quiet.position.sample == 17600);
  detector.frame(255, 17760); detector.frame(255, 17920);
  auto active = detector.podvoice_activity();
  assert(active.valid && active.active && active.probability == 255);
  detector.reset(); assert(!detector.podvoice_activity().valid);
  detector.disable_vad();
  const auto sequence = detector.podvoice_activity().sequence;
  detector.frame(0, 18080);
  assert(detector.podvoice_activity().sequence == sequence);
}
