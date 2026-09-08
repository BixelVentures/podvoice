#include "streaming_model.h"
#include <cassert>
using esphome::micro_wake_word::WakeWordModel;
static int8_t features[40]{};
static uint8_t weights[1]{};
static bool step(WakeWordModel &model, uint8_t probability) {
  tflite::probability = probability;
  assert(model.perform_streaming_inference(features));
  return model.determine_detected().detected;
}
int main() {
  WakeWordModel stop("stop", weights, 200, 1, "Stop", 1024, true, true);
  // Real load initializes a 100-slice suppression window. High probability
  // cannot advance the cool-off; it is NOT merely a one-second wallclock timer.
  for (int i = 0; i < 200; ++i) assert(!step(stop, 255));
  for (int i = 0; i < 99; ++i) assert(!step(stop, 0));
  assert(!step(stop, 255));
  assert(!step(stop, 0));
  assert(step(stop, 255));
  // Current firmware toggles enable per reply, unloading the actual model.
  stop.disable();
  assert(!step(stop, 0));
  int allocations = tflite::allocations;
  stop.enable();
  assert(!step(stop, 255));
  assert(tflite::allocations > allocations);
  for (int i = 0; i < 100; ++i) assert(!step(stop, 0));
  assert(step(stop, 255));
  // Warm inference with ignored idle detections has no new loading window.
  allocations = tflite::allocations;
  for (int i = 0; i < 20; ++i) assert(step(stop, 255));
  assert(!step(stop, 0));
  assert(step(stop, 255));
  assert(tflite::allocations == allocations);
  // Upstream reset after event production causes its own suppression window.
  stop.reset_probabilities();
  assert(!step(stop, 255));
  for (int i = 0; i < 100; ++i) assert(!step(stop, 0));
  assert(step(stop, 255));
  stop.unload_model();
}
