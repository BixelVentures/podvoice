#include "podvoice_reply.h"
#include <cassert>
#include <iostream>
using namespace esphome;
int main() {
  podvoice_reply::PodVoiceReply reply;
  speaker_source::SpeakerSourceMediaPlayer player;
  resampler::ResamplerSpeaker resampler;
  mixer_speaker::SourceSpeaker source;
  mixer_speaker::MixerSpeaker mixer;
  speaker::Speaker output;
  text_sensor::TextSensor status, context_status, activity;
  micro_wake_word::WakeWordModel model;
  micro_wake_word::MicroWakeWord detector;
  switch_::Switch mute;
  reply.set_detector(&detector); reply.set_context_status(&context_status); reply.set_mute_switch(&mute);
  reply.set_player(&player); reply.set_resampler(&resampler); reply.set_source(&source);
  reply.set_mixer(&mixer); reply.set_output(&output); reply.set_status(&status); reply.set_stop_model(&model);
  reply.set_activity_status(&activity); reply.setup();
  assert(source.observing);
  detector.observer.publish(50, {800, 2, 3, true}, 0, false, true);
  now_ms = 100; reply.loop(); assert(activity.values.empty());
  assert(reply.begin_conversation()); reply.loop();
  const auto session = context_status.values.back().substr(0, 32);
  reply.set_stop_context(session, 1, true); reply.loop();
  now_ms = 200; reply.loop();
  // Pre-wake snapshot cannot become fresh quiet by being stamped with new owner.
  assert(activity.values.back().find("\"state\":\"unknown\"") != std::string::npos);
  detector.observer.publish(210, {960, 2, 3, true}, 240, true, true);
  reply.play("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "url", session, 1);
  source.observer.ready(source.observer.restart());
  const int16_t pcm[] = {0,100,-100,0};
  source.observer.mixed(source.observer.capture(), reinterpret_cast<const uint8_t *>(pcm), 4, 1, 16, 48000, 230);
  source.observer.consumed(source.observer.capture(), 2, 240000);
  now_ms = 300; reply.loop();
  std::cout << activity.values.back() << "\n";
  assert(player.plays == 1 && player.stops == 0); // observer never controls playback
  mute.publish(true); now_ms = 400; reply.loop();
  assert(activity.values.back().find("\"state\":\"unknown\"") != std::string::npos);
  assert(activity.values.back().find("\"sample_count\":0") != std::string::npos);
  mute.publish(false);
  detector.observer.publish(410, {1120, 2, 3, true}, 0, false, true);
  now_ms = 500; reply.loop();
  assert(activity.values.back().find("\"state\":\"quiet\"") != std::string::npos);
  now_ms = 600; reply.loop(); // worker stalls; last quiet must not be refreshed
  assert(activity.values.back().find("\"state\":\"unknown\"") != std::string::npos);
  detector.observer.publish(610, {1280, 2, 3, true}, 0, false, true);
  now_ms = 700; reply.loop();
  assert(activity.values.back().find("\"state\":\"quiet\"") != std::string::npos);
  detector.observer.invalidate(); now_ms = 800; reply.loop();
  assert(activity.values.back().find("\"state\":\"unknown\"") != std::string::npos);
}
