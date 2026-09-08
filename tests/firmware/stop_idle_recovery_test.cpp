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
  output.stopped=true;
  reply.setup(); detector.frame(); reply.loop();
  reply.set_timer_required(true);
  for (int i=0;i<4;++i) detector.frame();
  reply.loop(); assert(detector.command & 1);
  assert(!reply.ready_to_rearm()); // a timer epoch must never cross worker restart
  reply.cancel("cleanup"); reply.loop(); reply.loop();
  assert(!reply.ready_to_rearm()); // disabled worker ACK is mandatory
  detector.frame(); reply.loop();
  assert(reply.ready_to_rearm());
  detector.gate.invalidate(); reply.loop();
  assert(reply.get_timer_stop_trigger()->fires==0); // planned restart preserves timer
  assert(!reply.ready_after_restart());
  detector.gate.worker_start();
  assert(!reply.ready_after_restart()); // is_running/old ACK is not fresh proof
  detector.frame(); assert(reply.ready_after_restart());
  reply.rearmed();
  for (int i=0;i<4;++i) detector.frame();
  reply.loop(); assert(detector.command & 1); // ringing timer demand resumed
  assert(!detector.stop_context_fault());
  // Ring overflow while idle/ringing: visible fault and timer cancellation,
  // no new wake, then the SAME cancel/drain/disabled/rearm recovery.
  detector.gate.invalidate(); reply.loop();
  assert(reply.get_timer_stop_trigger()->fires==1);
  assert(std::find(context.values.begin(),context.values.end(),
                   "00000000000000000000000000000000:0:fault") != context.values.end());
  assert(!reply.begin_conversation());
  reply.set_timer_required(false); // the real YAML timer-stop action
  reply.cancel("recover"); detector.frame(); reply.loop(); reply.loop();
  assert(reply.ready_to_rearm());
  detector.gate.worker_start(); detector.frame(); assert(reply.ready_after_restart());
  reply.rearmed(); detector.frame(); reply.loop();
  assert(reply.begin_conversation());
}
