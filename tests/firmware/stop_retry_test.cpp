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
}
