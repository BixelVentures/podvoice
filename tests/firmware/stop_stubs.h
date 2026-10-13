#pragma once
#include <functional>
#include <vector>
#include <string>
#include <cstdint>
namespace esphome {
inline uint32_t now_ms = 0;
inline uint32_t millis() { return now_ms; }
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
class MixerSpeaker { public: uint32_t pending=0; uint32_t get_frames_in_pipeline() const { return pending; } };
}
namespace text_sensor { class TextSensor { public: std::vector<std::string> values;
  void publish_state(const std::string &v) { values.push_back(v); }
}; }
namespace micro_wake_word { class WakeWordModel { public: bool enabled=false;
  bool is_enabled() const { return enabled; } void enable() { enabled=true; } void disable() { enabled=false; }
}; }
}
