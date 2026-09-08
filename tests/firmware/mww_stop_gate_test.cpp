#include "streaming_model.h"
#include "stop_gate.h"
#include <cassert>
using namespace esphome::micro_wake_word;
int main() {
  uint8_t weights[1]{};
  int8_t features[40]{};
  WakeWordModel model("stop", weights, 200, 1, "Stop", 1024, true, true);
  StopGate gate;
  gate.worker_start();
  auto step = [&](uint8_t probability) {
    gate.begin_write(); gate.end_write(160); gate.consume(160);
    tflite::probability = probability;
    assert(model.perform_streaming_inference(features));
    auto event = model.determine_detected();
    gate.observe(model.is_ready_for_detection(), event.max_probability < model.get_probability_cutoff(), 480);
    return gate.detect(event.detected);
  };
  for (int i = 0; i < 110; ++i) assert(step(0) == 0);
  for (int i = 0; i < 110; ++i) assert(step(255) == 0); // inactive never resets model
  const int allocations = tflite::allocations;
  gate.request(3); // epoch 1, enabled
  for (int i = 0; i < 20; ++i) assert(step(255) == 0); // pre-arm score cannot arm
  assert(gate.acknowledged() != 3);
  assert(step(0) == 0);
  assert(gate.acknowledged() == 3);
  auto delayed = step(255);
  assert(delayed == 3);
  assert(step(255) == 0); // one event per epoch
  gate.request(4); // disable invalidates delivery before worker observes it
  assert(!gate.accepts(delayed));
  assert(step(0) == 0);
  assert(gate.acknowledged() == 4);
  gate.request(7);
  // old producer backlog must not be assigned the new epoch
  gate.begin_write(); gate.end_write(1600);
  gate.observe(true, true, 480);
  assert(gate.acknowledged() != 7);
  for (int i = 0; i < 10; ++i) {
    gate.consume(160); gate.observe(true, true, 480);
    assert(gate.detect(true) == 0);
  }
  for (int i = 0; i < 3; ++i) assert(step(0) == 0);
  assert(step(255) == 7); // warm; no additional 100-slice window
  assert(tflite::allocations == allocations);
  assert(!gate.accepts(delayed));
  gate.invalidate(); // overflow/restart invalidates even already produced events
  assert(!gate.accepts(7));
  gate.request(9);
  for (int i = 0; i < 20; ++i) assert(step(0) == 0);
  assert(gate.acknowledged() != 9);
  gate.worker_start(); // restart before main observed the fault must retain it
  assert(gate.faulted());
  assert(!gate.accepts(9));
  gate.request(10);
  gate.observe(true, true, 480);
  assert(gate.acknowledged() == 10);
  gate.worker_start(); // now a disabled recovery can start fresh
  assert(!gate.faulted());
  assert(gate.acknowledged() != 9);
  model.unload_model();
}
