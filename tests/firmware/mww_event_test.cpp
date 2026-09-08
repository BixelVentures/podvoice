#include "micro_wake_word.h"
#include <cassert>
using namespace esphome::micro_wake_word;
// Full actual component and StreamingModel compiled. Only hardware, FreeRTOS
// queue storage and TFLite kernels are simulated. Event production AND delivery
// use the shipped methods, with an intentional delay between the two tasks.
class Detector : public MicroWakeWord {
 public:
  void init() { setup(); state_=DETECTING_WAKE_WORD; stop_gate_.worker_start(); }
  void frame(uint8_t probability) {
    stop_gate_.begin_write(); stop_gate_.end_write(160); stop_gate_.consume(160);
    int8_t features[40]{};
    tflite::probability=probability;
    assert(update_model_probabilities_(features));
    process_probabilities_();
  }
  size_t queued() const { return detection_queue_->items.size(); }
  void full_queue() { detection_queue_->capacity=0; }
};
int main() {
  uint8_t weights[1]{};
  WakeWordModel stop("stop", weights, 200, 1, "Stop", 1024, true, true);
  WakeWordModel wake("hey_chat", weights, 200, 1, "Hey Chat", 1024, true, false);
  esphome::microphone::MicrophoneSource mic;
  Detector detector;
  detector.set_microphone_source(&mic); detector.set_features_step_size(10);
  detector.set_stop_after_detection(false); detector.set_stop_model(&stop);
  detector.add_wake_word_model(&stop); detector.add_wake_word_model(&wake);
  detector.init();
  std::vector<uint32_t> stops;
  detector.add_on_stop_detected_callback([&](uint32_t epoch) { stops.push_back(epoch); });
  for (int i=0;i<110;++i) detector.frame(0);
  detector.frame(255); detector.loop();
  assert(stops.empty()); // inactive Stop has not put itself on the queue
  assert(detector.get_wake_word_detected_trigger()->delivered.size()==1);
  int allocations=tflite::allocations;
  detector.request_stop_context(3);
  for (int i=0;i<4;++i) detector.frame(0);
  assert(detector.stop_context_ack()==3);
  detector.frame(255);
  assert(detector.queued()==1);
  detector.request_stop_context(4); // disable before main drains pending detection
  detector.loop(); assert(stops.empty());
  detector.frame(0); assert(detector.stop_context_ack()==4);
  detector.request_stop_context(7);
  for (int i=0;i<4;++i) detector.frame(0);
  detector.frame(255); detector.loop();
  assert(stops==std::vector<uint32_t>{7});
  for (int i=0;i<10;++i) { detector.frame(255); detector.loop(); }
  assert(stops.size()==1); assert(tflite::allocations==allocations);
  // Full event queue faults Stop instead of blocking the shared inference worker.
  detector.request_stop_context(9);
  for (int i=0;i<4;++i) detector.frame(0);
  detector.full_queue(); detector.frame(255); detector.loop();
  assert(detector.stop_context_fault()); assert(stops.size()==1);
  stop.unload_model(); wake.unload_model();
}
