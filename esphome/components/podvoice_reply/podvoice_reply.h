#pragma once
#include "reply_state.h"
#include "stop_context.h"
#include "esphome/core/component.h"
#include "esphome/components/speaker_source/speaker_source_media_player.h"
#include "esphome/components/mixer/speaker/mixer_speaker.h"
#include "esphome/components/resampler/speaker/resampler_speaker.h"
#include "esphome/components/micro_wake_word/micro_wake_word.h"
#include "esphome/components/text_sensor/text_sensor.h"
#include "esphome/components/switch/switch.h"
#include "esphome/core/helpers.h"

namespace esphome::podvoice_reply {
class PodVoiceReply : public Component {
 public:
  void set_player(speaker_source::SpeakerSourceMediaPlayer *v) { player_ = v; }
  void set_resampler(resampler::ResamplerSpeaker *v) { resampler_ = v; }
  void set_source(mixer_speaker::SourceSpeaker *v) { source_ = v; }
  void set_mixer(mixer_speaker::MixerSpeaker *v) { mixer_ = v; }
  void set_output(speaker::Speaker *v) { output_ = v; }
  void set_status(text_sensor::TextSensor *v) { status_ = v; }
  void set_context_status(text_sensor::TextSensor *v) { context_status_ = v; }
  void set_detector(micro_wake_word::MicroWakeWord *v) { detector_ = v; }
  void set_mute_switch(switch_::Switch *v) { mute_switch_ = v; }
  Trigger<> *get_timer_stop_trigger() { return &timer_stop_trigger_; }
  void set_stop_model(micro_wake_word::WakeWordModel *v) { stop_model_ = v; }
  void setup() override {
    detector_->set_stop_model(stop_model_);
    muted_ = mute_switch_->state;
    mute_switch_->add_on_state_callback([this](bool muted) {
      muted_ = muted;
      if (!context_.active) {
        context_.timer(timer_required_ && !muted_ && !timer_suspended_); request_context_();
      }
    });
    detector_->add_on_stop_detected_callback([this](uint32_t command) {
      if (mute_switch_->state) return;
      // ACK is published before the detection, even if the worker queued both
      // between main-loop iterations. No event can outrun its armed ACK.
      publish_context_ack_();
      if (context_.detect(command)) {
        state_.cancel(state_.token, false);
        state_.blocked = true; state_.word = true;
        stop_(); publish_context_("stopped");
        if (!state_.token.empty()) publish_("stop_detected");
        if (timer_required_) timer_stop_trigger_.trigger();
      } else if (!context_.active && timer_required_ && command == context_.command) {
        timer_stop_trigger_.trigger();
      }
    });
  }
  bool begin_conversation() {
    if (idle_fault_ || timer_suspended_) return false;
    char nonce[33];
    snprintf(nonce, sizeof(nonce), "%08x%08x%08x%08x", random_uint32(), random_uint32(), random_uint32(), random_uint32());
    if (!context_.begin(nonce)) return false;
    request_context_(); return true;
  }
  void set_stop_context(const std::string &session, int generation, bool enabled) {
    if (generation <= 0 || !context_.set(session, static_cast<uint32_t>(generation), enabled)) return;
    request_context_();
  }
  void play(const std::string &token, const std::string &url, const std::string &session, int generation) {
    if (generation <= 0 || !context_.admits(session, static_cast<uint32_t>(generation)) ||
        detector_->stop_context_ack() != context_.command || detector_->stop_context_fault()) return;
    if (!state_.play(token)) return;
    fence_armed_ = false; producer_stopped_ = false;
    auto call = player_->make_call();
    call.set_media_url(url); call.set_announcement(true); call.perform();
  }
  void cancel(const std::string &token) {
    if (!state_.cancel(token, false)) return;
    if (!context_.active && !timer_suspended_) {
      timer_suspended_ = true; context_.timer(false); request_context_();
    }
    if (state_.phase == ReplyState::STOPPED) { publish_(state_.word ? "stopped_word" : "stopped"); return; }
    stop_();
  }
  bool ready_to_rearm() const {
    return !(context_.command & 1) && detector_->stop_context_ack() == context_.command &&
      (state_.phase == ReplyState::IDLE || state_.phase == ReplyState::STOPPED);
  }
  bool ready_after_restart() const { return ready_to_rearm() && !detector_->stop_context_fault(); }
  void rearmed() {
    state_.reset(); context_.clear(); timer_suspended_ = false; idle_fault_ = false;
    context_.timer(timer_required_ && !muted_); request_context_();
  }
  void set_timer_required(bool value) {
    timer_required_ = value;
    if (!context_.active) { context_.timer(value && !muted_ && !timer_suspended_); request_context_(); }
  }
  void loop() override {
    if (!context_.active && !timer_suspended_ && detector_->stop_context_fault() && !idle_fault_) {
      // No second restart owner: stop the ringing timer and publish a fault for
      // the same adapter/Thin cleanup that handles reconnect. Block wake until it
      // has proved drain, disabled worker state and the existing rearm sequence.
      idle_fault_ = true; timer_suspended_ = true;
      context_.timer(false); request_context_();
      state_.cancel(state_.token, false); stop_();
      if (timer_required_) timer_stop_trigger_.trigger();
      context_status_->publish_state("00000000000000000000000000000000:0:fault");
    }
    publish_context_ack_();
    if (state_.phase == ReplyState::REQUESTED && player_->state == media_player::MEDIA_PLAYER_STATE_ANNOUNCING) {
      state_.phase = ReplyState::PLAYING; publish_("started");
    }
    if (state_.phase == ReplyState::PLAYING && player_->state != media_player::MEDIA_PLAYER_STATE_ANNOUNCING) {
      state_.phase = ReplyState::DRAINING; drain_started_ = millis(); fence_armed_ = false;
    }
    if (state_.phase != ReplyState::DRAINING && state_.phase != ReplyState::STOPPING) return;
    const bool stopping = state_.phase == ReplyState::STOPPING;
    // A paused/shared-stop fallback is not a successful music-preserving drain.
    if (output_->get_pause_state() || millis() - drain_started_ > 3000) {
      state_.phase = ReplyState::FAULT; publish_("fault"); return;
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
      fence_anchor_ = mixer_->podvoice_consumed_frames();
      fence_armed_ = true;
    }
    const bool advanced = static_cast<uint32_t>(mixer_->podvoice_consumed_frames() - fence_anchor_) >= fence_frames_;
    // No new announcement reference exists. A stopped sink with zero pipeline
    // depth also proves drain when a conservative snapshot outlasted final audio.
    const bool empty = output_->is_stopped() && mixer_->get_frames_in_pipeline() == 0;
    if (!advanced && !empty) return;
    if (!context_.active && detector_->stop_context_ack() != context_.command) return;
    const std::string token = state_.token;
    if (state_.finish(token, stopping)) {
      publish_(stopping ? (state_.word ? "stopped_word" : "stopped") : "finished");
    }
  }
 protected:
  void request_context_() {
    context_published_ = false;
    detector_->request_stop_context(context_.command);
  }
  void publish_context_(const char *value) {
    if (context_.active) context_status_->publish_state(context_.session + ":" + std::to_string(context_.generation) + ":" + value);
    else context_status_->publish_state("00000000000000000000000000000000:0:idle");
  }
  void publish_context_ack_() {
    if (detector_->stop_context_fault() && context_.enabled && !context_.cancelled) {
      context_.cancelled = true;
      state_.cancel(state_.token, false); state_.blocked = true;
      stop_(); context_published_ = true; publish_context_("fault");
    }
    if (context_published_) return;
    if (detector_->stop_context_fault() && context_.enabled) {
      context_published_ = true; publish_context_("fault");
    } else if (detector_->stop_context_ack() == context_.command) {
      context_published_ = true; publish_context_(context_.enabled ? "armed" : (context_.cancelled ? "cancelled" : "disabled"));
    }
  }
  void stop_() {
    drain_started_ = millis(); fence_armed_ = false; producer_stopped_ = false;
    auto call = player_->make_call(); call.set_command(media_player::MEDIA_PLAYER_COMMAND_STOP);
    call.set_announcement(true); call.perform();
    resampler_->stop();
  }
  void publish_(const char *value) { status_->publish_state(state_.token + ":" + value); }
  ReplyState state_;
  StopContext context_;
  Trigger<> timer_stop_trigger_;
  micro_wake_word::MicroWakeWord *detector_;
  text_sensor::TextSensor *context_status_;
  switch_::Switch *mute_switch_;
  bool context_published_{false};
  bool muted_{false};
  bool timer_suspended_{false}, idle_fault_{false};
  speaker_source::SpeakerSourceMediaPlayer *player_;
  resampler::ResamplerSpeaker *resampler_;
  mixer_speaker::SourceSpeaker *source_;
  mixer_speaker::MixerSpeaker *mixer_;
  speaker::Speaker *output_;
  text_sensor::TextSensor *status_;
  micro_wake_word::WakeWordModel *stop_model_;
  uint32_t fence_frames_{0}, fence_anchor_{0}, drain_started_{0};
  bool fence_armed_{false}, producer_stopped_{false}, timer_required_{false};
};
}  // namespace esphome::podvoice_reply
