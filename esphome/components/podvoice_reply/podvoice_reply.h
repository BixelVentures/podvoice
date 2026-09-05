#pragma once
#include "reply_state.h"
#include "esphome/core/component.h"
#include "esphome/components/speaker_source/speaker_source_media_player.h"
#include "esphome/components/mixer/speaker/mixer_speaker.h"
#include "esphome/components/resampler/speaker/resampler_speaker.h"
#include "esphome/components/micro_wake_word/streaming_model.h"
#include "esphome/components/text_sensor/text_sensor.h"
#include <atomic>

namespace esphome::podvoice_reply {
class PodVoiceReply : public Component {
 public:
  void set_player(speaker_source::SpeakerSourceMediaPlayer *v) { player_ = v; }
  void set_resampler(resampler::ResamplerSpeaker *v) { resampler_ = v; }
  void set_source(mixer_speaker::SourceSpeaker *v) { source_ = v; }
  void set_mixer(mixer_speaker::MixerSpeaker *v) { mixer_ = v; }
  void set_output(speaker::Speaker *v) { output_ = v; }
  void set_status(text_sensor::TextSensor *v) { status_ = v; }
  void set_stop_model(micro_wake_word::WakeWordModel *v) { stop_model_ = v; }
  void setup() override {
    output_->add_audio_output_callback([this](uint32_t frames, int64_t) {
      output_frames_.fetch_add(frames, std::memory_order_release);
    });
    update_model_();
  }
  void play(const std::string &token, const std::string &url) {
    if (!state_.play(token)) return;
    fence_armed_ = false; producer_stopped_ = false;
    auto call = player_->make_call();
    call.set_media_url(url); call.set_announcement(true); call.perform();
  }
  void cancel(const std::string &token) {
    if (!state_.cancel(token, false)) return;
    if (state_.phase == ReplyState::STOPPED) { publish_(state_.word ? "stopped_word" : "stopped"); return; }
    stop_();
  }
  bool local_stop() {
    if (!state_.cancel(state_.token, true)) return false;
    // Latch before issuing STOP or publishing; queued plays can never reopen it.
    stop_(); publish_("stop_detected"); return true;
  }
  bool ready_to_rearm() const {
    return state_.phase == ReplyState::IDLE || state_.phase == ReplyState::STOPPED;
  }
  void rearmed() { state_.reset(); update_model_(); }
  void set_timer_required(bool value) { timer_required_ = value; update_model_(); }
  void loop() override {
    if (state_.phase == ReplyState::REQUESTED && player_->state == media_player::MEDIA_PLAYER_STATE_ANNOUNCING) {
      state_.phase = ReplyState::PLAYING; update_model_(); publish_("started");
    }
    if (state_.phase == ReplyState::PLAYING && player_->state != media_player::MEDIA_PLAYER_STATE_ANNOUNCING) {
      state_.phase = ReplyState::DRAINING; drain_started_ = millis(); fence_armed_ = false;
    }
    if (state_.phase != ReplyState::DRAINING && state_.phase != ReplyState::STOPPING) return;
    const bool stopping = state_.phase == ReplyState::STOPPING;
    // A paused/shared-stop fallback is not a successful music-preserving drain.
    if (output_->get_pause_state() || millis() - drain_started_ > 3000) {
      state_.phase = ReplyState::FAULT; update_model_(); publish_("fault"); return;
    }
    if (!player_->podvoice_announcement_idle()) return;
    if (stopping && !producer_stopped_) {
      // Decoder and its queued commands are now gone. Flush again so a final
      // in-flight producer write cannot restart a speaker after the early STOP.
      resampler_->stop(); producer_stopped_ = true; return;
    }
    if (!resampler_->podvoice_quiescent() || !source_->podvoice_quiescent()) return;
    if (!fence_armed_) {
      // Snapshot depth BEFORE counter: conservative if an output callback races.
      fence_frames_ = mixer_->get_frames_in_pipeline();
      fence_anchor_ = output_frames_.load(std::memory_order_acquire);
      fence_armed_ = true;
    }
    const bool advanced = static_cast<uint32_t>(output_frames_.load(std::memory_order_acquire) - fence_anchor_) >= fence_frames_;
    // No new announcement reference exists. A stopped sink with zero pipeline
    // depth also proves drain when a conservative snapshot outlasted final audio.
    const bool empty = output_->is_stopped() && mixer_->get_frames_in_pipeline() == 0;
    if (!advanced && !empty) return;
    const std::string token = state_.token;
    if (state_.finish(token, stopping)) {
      update_model_(); publish_(stopping ? (state_.word ? "stopped_word" : "stopped") : "finished");
    }
  }
 protected:
  void update_model_() {
    const bool wanted = timer_required_ || state_.detecting();
    if (wanted && !stop_model_->is_enabled()) stop_model_->enable();
    if (!wanted && stop_model_->is_enabled()) stop_model_->disable();
  }
  void stop_() {
    drain_started_ = millis(); fence_armed_ = false; producer_stopped_ = false;
    update_model_();
    auto call = player_->make_call(); call.set_command(media_player::MEDIA_PLAYER_COMMAND_STOP);
    call.set_announcement(true); call.perform();
    resampler_->stop();
  }
  void publish_(const char *value) { status_->publish_state(state_.token + ":" + value); }
  ReplyState state_;
  speaker_source::SpeakerSourceMediaPlayer *player_;
  resampler::ResamplerSpeaker *resampler_;
  mixer_speaker::SourceSpeaker *source_;
  mixer_speaker::MixerSpeaker *mixer_;
  speaker::Speaker *output_;
  text_sensor::TextSensor *status_;
  micro_wake_word::WakeWordModel *stop_model_;
  std::atomic<uint32_t> output_frames_{0};
  uint32_t fence_frames_{0}, fence_anchor_{0}, drain_started_{0};
  bool fence_armed_{false}, producer_stopped_{false}, timer_required_{false};
};
}  // namespace esphome::podvoice_reply
