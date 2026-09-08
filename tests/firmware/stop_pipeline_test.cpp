#include "podvoice_reply.h"
#include <cassert>
using namespace esphome;
int main() {
  podvoice_reply::PodVoiceReply reply;
  speaker_source::SpeakerSourceMediaPlayer player;
  resampler::ResamplerSpeaker resampler;
  mixer_speaker::SourceSpeaker source;
  mixer_speaker::MixerSpeaker mixer;
  speaker::Speaker output;
  text_sensor::TextSensor status;
  micro_wake_word::WakeWordModel model;
  micro_wake_word::MicroWakeWord detector;
  text_sensor::TextSensor context_status;
  switch_::Switch mute;
  reply.set_detector(&detector); reply.set_context_status(&context_status); reply.set_mute_switch(&mute);
  std::string session;
  auto start = [&](const std::string &token) {
    assert(reply.begin_conversation()); reply.loop();
    session = context_status.values.back().substr(0, 32);
    reply.set_stop_context(session, 1, true); reply.loop();
    reply.play(token, "url", session, 1);
  };
  auto disarm = [&]() { reply.set_stop_context(session, 2, false); reply.loop(); };
  reply.set_player(&player); reply.set_resampler(&resampler); reply.set_source(&source);
  reply.set_mixer(&mixer); reply.set_output(&output); reply.set_status(&status); reply.set_stop_model(&model);
  output.add_audio_output_callback([&](uint32_t frames, int64_t) {
    mixer.consumed += frames;
    mixer.pending = frames >= mixer.pending ? 0 : mixer.pending - frames;
  });
  reply.setup(); assert(model.enabled);
  start("A"); assert(player.plays==1); assert(model.enabled);
  player.state=media_player::MEDIA_PLAYER_STATE_ANNOUNCING; reply.loop();
  assert(model.enabled); assert(status.values.back()=="A:started");
  player.idle=false; detector.deliver(detector.command);
  assert(player.stops==1); assert(model.enabled); assert(!reply.ready_to_rearm());
  reply.play("B", "late-url", session, 1); assert(player.plays==1);
  reply.loop(); assert(status.values.back()=="A:stop_detected");
  player.idle=true; reply.loop(); // producer is gone, reassert resampler stop
  source.quiet=false; reply.loop(); assert(status.values.back()=="A:stop_detected");
  source.quiet=true; mixer.pending=100; reply.loop();
  output.consumed(99); reply.loop(); assert(!reply.ready_to_rearm());
  output.consumed(1); reply.loop(); assert(!reply.ready_to_rearm());
  disarm(); assert(reply.ready_to_rearm());
  assert(status.values.back()=="A:stopped_word");
  reply.cancel("A"); assert(status.values.back()=="A:stopped_word");
  reply.rearmed(); start("B");
  reply.cancel("A"); assert(!reply.ready_to_rearm());
  player.state=media_player::MEDIA_PLAYER_STATE_ANNOUNCING; reply.loop();
  // Timer demand stays enabled when normal reply demand ends.
  reply.set_timer_required(true);
  player.state=media_player::MEDIA_PLAYER_STATE_IDLE; mixer.pending=0; reply.loop();
  assert(status.values.back()=="B:finished"); assert(model.enabled);
  reply.set_timer_required(false); assert(model.enabled);
  disarm();
  // Callback interleaving: consumption is published before pending depth falls.
  // An old independent owner callback would count these 50 frames twice.
  reply.cancel("B"); reply.loop();
  mixer.pending=100; mixer.consumed=0xfffffff0;
  mixer.consumed += 50; // callback first half, including uint32 wrap
  mixer.pending -= 50; // callback second half, before the owner loop
  reply.loop(); assert(!reply.ready_to_rearm());
  assert(mixer.pending==50);
  output.consumed(49); reply.loop(); assert(!reply.ready_to_rearm());
  output.consumed(1); reply.loop(); assert(reply.ready_to_rearm());
  reply.rearmed(); start("C"); disarm();
  player.state=media_player::MEDIA_PLAYER_STATE_ANNOUNCING; reply.loop();
  reply.cancel("C"); reply.loop();
  mixer.pending=100; mixer.consumed += 50;
  reply.loop(); // snapshot BETWEEN counter publication and depth reduction
  mixer.pending-=50;
  reply.loop(); assert(!reply.ready_to_rearm());
  output.consumed(50); reply.loop(); assert(!reply.ready_to_rearm()); // conservative
  output.stopped=true; reply.loop(); assert(reply.ready_to_rearm());
  reply.rearmed();
  // Idle timer keeps a separate epoch, including mute/unmute around a queued
  // detection. Listening cannot consume it or intercept a complete command.
  reply.set_timer_required(true);
  uint32_t stale_timer = detector.command;
  mute.publish(true); detector.deliver(stale_timer);
  assert(reply.get_timer_stop_trigger()->fires==0);
  mute.publish(false); assert(detector.command != stale_timer);
  detector.deliver(stale_timer); assert(reply.get_timer_stop_trigger()->fires==0);
  detector.deliver(detector.command); assert(reply.get_timer_stop_trigger()->fires==1);
  assert(reply.begin_conversation()); reply.loop();
  session=context_status.values.back().substr(0,32);
  detector.deliver(stale_timer); assert(reply.get_timer_stop_trigger()->fires==1);
  // Thinking Stop before any reply blocks a late first play, still cancels a
  // ringing timer, and requires disable ACK plus the normal physical drain.
  reply.set_stop_context(session, 1, true); reply.loop();
  int prior_plays=player.plays;
  detector.deliver(detector.command);
  assert(reply.get_timer_stop_trigger()->fires==2);
  reply.play("late-first", "url", session, 1); assert(player.plays==prior_plays);
  reply.set_timer_required(false);
  reply.loop(); reply.loop();
  assert(!reply.ready_to_rearm());
  disarm(); assert(reply.ready_to_rearm());
  assert(context_status.values.back()==session+":2:cancelled");
  reply.rearmed(); start("D"); disarm();
  // Paused/shared-output stop must report fault, never successful silence.
  reply.cancel("D"); output.paused=true; reply.loop();
  assert(status.values.back()=="D:fault"); assert(!reply.ready_to_rearm());
}
