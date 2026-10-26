#include "podvoice_reply.h"
#include <cassert>
#include <cstdio>
using namespace esphome;

int main() {
  podvoice_reply::PodVoiceReply reply;
  text_sensor::TextSensor timer_status;
  reply.set_timer_status(&timer_status);
  speaker_source::SpeakerSourceMediaPlayer player;
  resampler::ResamplerSpeaker resampler;
  mixer_speaker::SourceSpeaker source;
  mixer_speaker::MixerSpeaker mixer;
  speaker::Speaker output;
  text_sensor::TextSensor status, context;
  micro_wake_word::WakeWordModel model;
  micro_wake_word::MicroWakeWord detector;
  switch_::Switch mute;
  reply.set_player(&player); reply.set_resampler(&resampler); reply.set_source(&source);
  reply.set_mixer(&mixer); reply.set_output(&output); reply.set_status(&status);
  reply.set_stop_model(&model); reply.set_detector(&detector);
  reply.set_context_status(&context); reply.set_mute_switch(&mute);
  reply.setup();
  auto start = [&](const std::string &token) {
    assert(reply.begin_conversation()); reply.loop();
    const auto session = context.values.back().substr(0, 32);
    reply.set_live_context(session, 1); reply.loop();
    reply.play(token, "url", session, 1);
    player.state = media_player::MEDIA_PLAYER_STATE_ANNOUNCING; reply.loop();
  };
  start("A");
  reply.stop_from_button();
  assert(reply.button_stop_latched());
  reply.loop(); // producer stopped; second resampler flush
  mixer.pending = 100; reply.loop(); // original consumed fence
  mixer.consumed += 60; mixer.pending -= 60;
  const int stops = player.stops, flushes = resampler.stops;
  now_ms = 2000; reply.cancel("A"); // host retry after waiting for ACK
  assert(player.stops == stops && resampler.stops == flushes);
  reply.cancel("wrong");
  mixer.consumed += 40; mixer.pending = 0;
  reply.loop();
  assert(status.values.back() == "A:stopped");
  assert(reply.button_stop_latched());
  reply.play("late", "url", context.values.back().substr(0,32), 1);
  assert(player.plays == 1);
  reply.cancel("A"); assert(status.values.back() == "A:stopped");
  assert(player.stops == stops);
  reply.rearmed();
  start("B");
  player.idle = false; now_ms = 4000; reply.cancel("B");
  now_ms = 6000; reply.cancel("B");
  now_ms = 7001; reply.loop(); // duplicate cannot postpone original 3s deadline
  assert(status.values.back() == "B:fault");
  const int before_recovery = player.stops;
  reply.cancel("B"); // FAULT must still support a fresh recovery
  assert(player.stops == before_recovery + 1);
  player.idle = true; output.stopped = true; reply.loop(); reply.loop();
  assert(status.values.back() == "B:stopped");
  reply.rearmed();
  assert(reply.begin_conversation()); reply.loop();
  // A button can win before any playback token exists. Host cleanup adopts its
  // token without starting another physical stop or releasing the button latch.
  reply.stop_from_button();
  const int preplay_stops = player.stops;
  reply.cancel("preplay");
  assert(player.stops == preplay_stops && reply.button_stop_latched());
  reply.loop(); reply.loop();
  assert(status.values.back() == "preplay:stopped");
  reply.rearmed();
  now_ms = 8000; output.stopped = false;
  start("host-drain"); reply.cancel("host-drain");
  reply.loop(); // producer stopped; second resampler flush
  mixer.pending = 100; reply.loop();
  mixer.consumed += 60; mixer.pending -= 60;
  const int drain_stops = player.stops, drain_flushes = resampler.stops;
  const auto queued_host_command = detector.command;
  const auto drain_session = context.values.back().substr(0, 32);
  now_ms = 10000; reply.stop_from_button(); reply.loop();
  assert(reply.button_stop_latched());
  assert(context.values.back().find(":cancelled") != std::string::npos);
  assert(status.values.back() == "host-drain:started");
  // A captured native callback cannot reopen the button-cancelled generation.
  detector.deliver(queued_host_command);
  detector.callback(queued_host_command); detector.callback(detector.command);
  const int drain_plays = player.plays;
  reply.set_live_context(drain_session, 2);
  reply.play("late-after-button", "url", drain_session, 1);
  reply.play("wrong-generation", "url", drain_session, 2);
  reply.cancel("wrong-owner");
  assert(player.plays == drain_plays);
  assert(player.stops == drain_stops && resampler.stops == drain_flushes);
  mixer.consumed += 40; mixer.pending = 0; reply.loop();
  assert(status.values.back() == "host-drain:stopped");
  assert(player.stops == drain_stops && resampler.stops == drain_flushes);
  reply.rearmed();
  player.idle = false; output.stopped = false; now_ms = 12000;
  start("host-first");
  reply.cancel("host-first");
  const int host_stops = player.stops, host_flushes = resampler.stops;
  const uint32_t host_context = detector.command;
  now_ms = 14000; reply.stop_from_button(); reply.loop();
  assert(reply.button_stop_latched() && detector.command != host_context);
  assert(context.values.back().find(":cancelled") != std::string::npos);
  now_ms = 15001; reply.loop();
  std::fprintf(stderr, "host-first original_stop=12000 button=14000 observed=15001 stop_delta=%d flush_delta=%d status=%s context=%s\n",
      player.stops - host_stops, resampler.stops - host_flushes,
      status.values.back().c_str(), context.values.back().c_str());
  // The same already-stopping reply keeps its original 3s drain bound.
  assert(status.values.back() == "host-first:fault");
  assert(player.stops == host_stops && resampler.stops == host_flushes);
}
