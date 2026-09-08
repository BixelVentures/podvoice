#pragma once
#include <functional>
#include <vector>
#include <string>
#include <cstdint>
#ifdef PODVOICE_TEST_REAL_STOP_GATE
#include "stop_gate.h"
#endif
namespace esphome {
inline uint32_t now_ms = 0;
inline uint32_t millis() { return now_ms; }
inline uint32_t random_uint32() { static uint32_t n = 0; return ++n; }
template<class... Ts> class Trigger { public: int fires=0; void trigger(Ts...) { ++fires; } };
namespace switch_ { class Switch { public:
  bool state=false;
  std::function<void(bool)> cb;
  void add_on_state_callback(std::function<void(bool)> f) { cb=f; }
  void publish(bool value) { state=value; if (cb) cb(value); }
}; }
class Component { public: virtual void setup() {} virtual void loop() {} virtual ~Component() = default; };
namespace speaker {
class Speaker {
 public:
  bool stopped=false, paused=false;
  std::vector<std::function<void(uint32_t,int64_t)>> callbacks;
  void add_audio_output_callback(std::function<void(uint32_t,int64_t)> cb) { callbacks.push_back(cb); }
  bool is_stopped() const { return stopped; }
  bool get_pause_state() const { return paused; }
  void consumed(uint32_t frames) { for (auto &cb: callbacks) cb(frames, 0); }
}; }
namespace media_player { enum { MEDIA_PLAYER_STATE_IDLE, MEDIA_PLAYER_STATE_ANNOUNCING, MEDIA_PLAYER_COMMAND_STOP }; }
namespace speaker_source {
class SpeakerSourceMediaPlayer {
 public:
  int state=media_player::MEDIA_PLAYER_STATE_IDLE, plays=0, stops=0;
  bool idle=true;
  struct Call {
    SpeakerSourceMediaPlayer *owner; bool stop=false, play=false;
    void set_media_url(const std::string &) { play=true; }
    void set_announcement(bool) {}
    void set_command(int) { stop=true; }
    void perform() { if (play) ++owner->plays; if (stop) ++owner->stops; }
  };
  Call make_call() { return {this}; }
  bool podvoice_announcement_idle() const { return idle; }
}; }
namespace resampler { class ResamplerSpeaker { public: bool quiet=true; int stops=0;
  bool podvoice_quiescent() const { return quiet; } void stop() { ++stops; }
}; }
namespace mixer_speaker {
class SourceSpeaker { public: bool quiet=true; bool podvoice_quiescent() const { return quiet; } };
class MixerSpeaker { public:
  uint32_t pending=0, consumed=0;
  uint32_t get_frames_in_pipeline() const { return pending; }
  uint32_t podvoice_consumed_frames() const { return consumed; }
};
}
namespace text_sensor { class TextSensor { public: std::vector<std::string> values;
  void publish_state(const std::string &v) { values.push_back(v); }
}; }
namespace micro_wake_word { class WakeWordModel { public: bool enabled=false;
  bool is_enabled() const { return enabled; } void enable() { enabled=true; } void disable() { enabled=false; }
}; }
namespace micro_wake_word { class MicroWakeWord { public:
  uint32_t command=0;
  bool fault=false;
  std::function<void(uint32_t)> callback;
#ifdef PODVOICE_TEST_REAL_STOP_GATE
  StopGate gate;
  MicroWakeWord() { gate.worker_start(); }
  void request_stop_context(uint32_t value) { command=value; gate.request(value); }
  uint32_t stop_context_ack() const { return gate.acknowledged(); }
  bool stop_context_fault() const { return gate.faulted(); }
  void frame() {
    gate.begin_write(); gate.end_write(160); gate.consume(160);
    gate.observe(true, true, 480);
  }
  void deliver(uint32_t value) { if (gate.accepts(value)) callback(value); }
#else
  void request_stop_context(uint32_t value) { command=value; }
  uint32_t stop_context_ack() const { return command; }
  bool stop_context_fault() const { return fault; }
  void deliver(uint32_t value) { if (value == command && (value & 1) && !fault) callback(value); }
#endif
  void set_stop_model(WakeWordModel *m) { m->enable(); }
  void add_on_stop_detected_callback(std::function<void(uint32_t)> f) { callback=f; }
}; }
}
