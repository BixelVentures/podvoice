#pragma once
// Only platform/TFLite boundaries are simulated. StreamingModel is compiled
// unchanged from the pinned ESPHome source, including load/cooldown/detection.
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#include <functional>
#include <deque>
#include <sys/types.h>

#define ESP_LOGI(...) ((void)0)
#define ESP_LOGCONFIG(...) ((void)0)
#define ESP_LOGE(...) ((void)0)
#define ESP_LOGD(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define LOG_STR(x) x
#define LOG_STR_ARG(x) x
#define pdTRUE 1
#define portMAX_DELAY 0xffffffff
#define pdMS_TO_TICKS(x) (x)
#define TFLITE_SCHEMA_VERSION 3
enum TfLiteStatus { kTfLiteOk, kTfLiteError };
enum TfLiteType { kTfLiteInt8, kTfLiteUInt8 };
struct TfLiteIntArray { int size; int data[3]; };
struct TfLiteTensor {
  TfLiteIntArray *dims;
  TfLiteType type;
  union { uint8_t *uint8; int8_t *int8; } data;
};
namespace tflite {
inline uint8_t probability = 0;
inline int invocations = 0;
inline int allocations = 0;
struct Model { int version() const { return TFLITE_SCHEMA_VERSION; } };
inline const Model *GetModel(const uint8_t *) { static Model model; return &model; }
struct MicroAllocator {
  static MicroAllocator *Create(uint8_t *, size_t) { static MicroAllocator a; return &a; }
};
struct MicroResourceVariables {
  static MicroResourceVariables *Create(MicroAllocator *, int) { static MicroResourceVariables a; return &a; }
};
template<int N> struct MicroMutableOpResolver {
#define OP(name) TfLiteStatus name() { return kTfLiteOk; }
  OP(AddCallOnce) OP(AddVarHandle) OP(AddReshape) OP(AddReadVariable)
  OP(AddStridedSlice) OP(AddConcatenation) OP(AddAssignVariable) OP(AddConv2D)
  OP(AddMul) OP(AddAdd) OP(AddMean) OP(AddFullyConnected) OP(AddLogistic)
  OP(AddQuantize) OP(AddDepthwiseConv2D) OP(AddAveragePool2D) OP(AddMaxPool2D)
  OP(AddPad) OP(AddPack) OP(AddSplitV)
#undef OP
};
class MicroInterpreter {
 public:
  template<class... Args> explicit MicroInterpreter(Args&&...) {}
  TfLiteStatus AllocateTensors() { ++allocations; return kTfLiteOk; }
  size_t arena_used_bytes() const { return 128; }
  TfLiteTensor *input(int) { return &input_; }
  TfLiteTensor *output(int) { return &output_; }
  TfLiteStatus Invoke() { ++invocations; output_data_[0] = probability; return kTfLiteOk; }
 private:
  int8_t input_data_[40]{};
  uint8_t output_data_[1]{};
  TfLiteIntArray input_dims_{3, {1, 1, 40}}, output_dims_{2, {1, 1, 0}};
  TfLiteTensor input_{&input_dims_, kTfLiteInt8, {.int8 = input_data_}};
  TfLiteTensor output_{&output_dims_, kTfLiteUInt8, {.uint8 = output_data_}};
};
template<class T> T *GetTensorData(TfLiteTensor *tensor) { return reinterpret_cast<T *>(tensor->data.int8); }
}
namespace esphome {
using LogString = char;
template<class T> T clamp(T v, T lo, T hi) { return std::min(hi, std::max(lo, v)); }
using std::make_unique;
template<class T> struct RAMAllocator {
  T *allocate(size_t n) { return new T[n]; }
  void deallocate(T *p, size_t) { delete[] p; }
};
struct ESPPreferenceObject {
  template<class T> bool load(T *) { return false; }
  template<class T> bool save(T *) { return true; }
};
struct Preferences {
  template<class T> ESPPreferenceObject make_preference(uint32_t) { return {}; }
};
inline uint32_t millis() { return 100; }
inline Preferences preferences;
inline Preferences *global_preferences = &preferences;
inline uint32_t fnv1_hash(const std::string &) { return 1; }
}

using UBaseType_t = unsigned;
using EventGroupHandle_t = uint32_t *;
inline EventGroupHandle_t xEventGroupCreate() { static uint32_t value; value=0; return &value; }
inline uint32_t xEventGroupGetBits(EventGroupHandle_t h) { return *h; }
inline void xEventGroupSetBits(EventGroupHandle_t h, uint32_t v) { *h |= v; }
inline void xEventGroupClearBits(EventGroupHandle_t h, uint32_t v) { *h &= ~v; }
struct TestQueue { size_t capacity, size; std::deque<std::vector<uint8_t>> items; };
using QueueHandle_t = TestQueue *;
inline QueueHandle_t xQueueCreate(size_t capacity, size_t size) { return new TestQueue{capacity, size, {}}; }
inline int xQueueSend(QueueHandle_t q, const void *data, uint32_t) {
  if (q->items.size() == q->capacity) return 0;
  auto p=static_cast<const uint8_t *>(data); q->items.emplace_back(p,p+q->size); return pdTRUE;
}
inline int xQueueReceive(QueueHandle_t q, void *data, uint32_t) {
  if (q->items.empty()) return 0;
  std::memcpy(data,q->items.front().data(),q->size); q->items.pop_front(); return pdTRUE;
}
inline void xQueueReset(QueueHandle_t q) { q->items.clear(); }
inline void vTaskSuspend(void *) {}
inline void vTaskResume(void *) {}
struct FrontendConfig {
  struct { int size_ms, step_size_ms; } window;
  struct { int num_channels, lower_band_limit, upper_band_limit; } filterbank;
  struct { int smoothing_bits; float even_smoothing, odd_smoothing, min_signal_remaining; } noise_reduction;
  struct { bool enable_pcan; float strength, offset; int gain_bits; } pcan_gain_control;
  struct { bool enable_log; int scale_shift; } log_scale;
};
struct FrontendState {};
struct FrontendOutput { size_t size; uint16_t *values; };
inline bool FrontendPopulateState(FrontendConfig *, FrontendState *, int) { return true; }
inline void FrontendFreeStateContents(FrontendState *) {}
inline int frontend_resets=0;
inline void FrontendReset(FrontendState *) { ++frontend_resets; }
inline FrontendOutput FrontendProcessSamples(FrontendState *, const int16_t *, size_t n, size_t *consumed) {
  *consumed=n; return {0,nullptr};
}
namespace esphome {
namespace setup_priority { inline constexpr float AFTER_CONNECTION=100; }
template<class Sig> struct CallbackManager;
template<class... Args> struct CallbackManager<void(Args...)> {
  std::vector<std::function<void(Args...)>> callbacks;
  void add(std::function<void(Args...)> f) { callbacks.push_back(f); }
  void call(Args... args) { for (auto &f:callbacks) f(args...); }
};
template<class... Args> struct Trigger {
  std::vector<std::tuple<Args...>> delivered;
  void trigger(Args... args) { delivered.emplace_back(args...); }
};
struct Component {
  virtual ~Component() = default;
  virtual void setup() {} virtual void loop() {} virtual void dump_config() {}
  virtual float get_setup_priority() const { return 0; }
  bool is_ready() const { return true; } bool is_failed() const { return false; }
  bool status_has_error() const { return false; }
  void mark_failed() {} void status_momentary_error(const char *, int) {}
};
struct StaticTask {
  bool is_created() const { return false; } void *get_handle() { return nullptr; }
  void deallocate() {}
  template<class... Args> bool create(Args...) { return true; }
};
struct TestApp { void wake_loop_threadsafe() {} };
inline TestApp App;
struct AudioStreamInfo {
  int channels{1}; int get_channels() const { return channels; }
  size_t frames_to_bytes(size_t n) const { return n*2; }
  size_t ms_to_bytes(size_t n) const { return n*32; }
  int get_sample_rate() const { return 16000; }
};
namespace microphone {
struct MicrophoneSource {
  AudioStreamInfo info;
  const AudioStreamInfo &get_audio_stream_info() { return info; }
  std::vector<std::function<void(const std::vector<uint8_t> &)>> callbacks;
  void add_data_callback(std::function<void(const std::vector<uint8_t> &)> cb) { callbacks.push_back(cb); }
  void emit(const std::vector<uint8_t> &data) { for(auto &cb:callbacks) cb(data); }
  void set_gain_factor(int) {}
  void start() {} void stop() {}
};
}
namespace ring_buffer {
struct RingBuffer {
  enum class MemoryPreference { EXTERNAL_FIRST };
  size_t capacity; bool short_next{false}; std::deque<uint8_t> bytes;
  explicit RingBuffer(size_t n): capacity(n) {}
  static std::unique_ptr<RingBuffer> create(size_t n, MemoryPreference = MemoryPreference::EXTERNAL_FIRST) {
    return std::make_unique<RingBuffer>(n);
  }
  size_t available() const { return bytes.size(); }
  size_t free() const { return capacity-bytes.size(); }
  void reset() { bytes.clear(); }
  size_t read(void *out, size_t n, int) {
    n=std::min(n,bytes.size()); auto p=static_cast<uint8_t *>(out);
    for(size_t i=0;i<n;++i) { p[i]=bytes.front(); bytes.pop_front(); } return n;
  }
  size_t write(const void *in, size_t n) {
    auto p=static_cast<const uint8_t *>(in);
    size_t discard=n>free()?std::min(n-free(),bytes.size()):0;
    while(discard--) bytes.pop_front();
    n=std::min(n,free()); if(short_next) { short_next=false; n/=2; }
    for(size_t i=0;i<n;++i) bytes.push_back(p[i]); return n;
  }
  size_t write_without_replacement(const uint8_t *in, size_t n, int, bool) {
    if(n>free()) return 0; return write(in,n);
  }
};
}
namespace audio {
struct RingBufferAudioSource {
  std::shared_ptr<ring_buffer::RingBuffer> ring;
  static std::unique_ptr<RingBufferAudioSource> create(std::shared_ptr<ring_buffer::RingBuffer> ring, size_t, uint8_t) {
    auto source=std::make_unique<RingBufferAudioSource>(); source->ring=ring; return source;
  }
  void clear_buffered_data() { ring->reset(); } void fill(uint32_t, bool) {} void consume(size_t) {}
  size_t available() const { return 0; } uint8_t *data() { return nullptr; }
};
}
}

namespace esphome::api {
struct VoiceAssistantAudio { const uint8_t *data{}; uint16_t data_len{}; bool end{}; };
struct APIConnection {
  std::vector<uint8_t> pcm;
  bool send_message(const VoiceAssistantAudio &msg) { pcm.insert(pcm.end(), msg.data, msg.data+msg.data_len); return true; }
};
}
namespace esphome::voice_assistant {
struct VoiceAssistant { api::APIConnection *client{}; api::APIConnection *get_api_connection() { return client; } };
inline VoiceAssistant *global_voice_assistant{};
}
