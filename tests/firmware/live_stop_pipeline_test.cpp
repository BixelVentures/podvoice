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
  assert(reply.begin_conversation()); detector.frame(); reply.loop();
  const auto session = context.values.back().substr(0,32);
  reply.set_stop_context(session, 1, true);
  for (int i=0;i<4;++i) detector.frame();
  reply.loop(); assert(context.values.back()==session+":1:armed");
  const uint32_t queued_old_keyword = detector.command;
  reply.set_live_context(session, 2);
  assert(!(detector.command & 1));
  reply.play("premature", "url", session, 2);
  assert(player.plays == 0); // native service send is not the disabled-worker ACK
  assert(!reply.ready_to_rearm()); // idle playback state is not a closed Live context
  detector.frame(); reply.loop();
  assert(context.values.back()==session+":2:live");
  reply.play("live-reply", "url", session, 2);
  assert(player.plays == 1);
  player.state=media_player::MEDIA_PLAYER_STATE_ANNOUNCING; reply.loop();
  // Both the real worker and the delivery-side context reject queued local Stop.
  detector.deliver(queued_old_keyword);
  detector.callback(queued_old_keyword);
  detector.callback(detector.command);
  assert(player.stops == 0);
  assert(context.values.back()==session+":2:live");
  reply.set_live_context("foreign", 3);
  reply.set_live_context(session, 2); // duplicate generation cannot advance worker command
  const auto live_command = detector.command;
  assert(!(live_command & 1));
  // A whole disabled-worker restart between main-loop turns must not erase the
  // fault by clearing it and ACKing the same command again (observed P1 chain).
  detector.gate.invalidate();
  detector.gate.worker_start(); detector.frame();
  assert(!detector.stop_context_fault());
  assert(detector.stop_context_ack() == live_command);
  reply.set_live_context(session, 3); // cannot rebind a new run within this wake
  assert(detector.command == live_command);
  reply.loop();
  assert(context.values.back()==session+":2:fault");
  const int stops_after_fault = player.stops;
  reply.loop(); assert(player.stops == stops_after_fault); // one fault owner
  reply.set_live_context(session, 3);
  reply.set_stop_context(session, 3, true);
  reply.play("revive", "url", session, 3);
  assert(detector.command == live_command && player.plays == 1);
  // Old disable still permits deterministic teardown and cannot keep playback permission.
  reply.set_stop_context(session, 3, false); detector.frame(); reply.loop(); reply.loop();
  assert(context.values.back()==session+":3:cancelled");
  assert(reply.ready_to_rearm());
  detector.gate.worker_start(); detector.frame();
  assert(reply.ready_after_restart());
  reply.rearmed(); detector.frame(); reply.loop();
  assert(reply.begin_conversation()); detector.frame(); reply.loop();
  const auto next_session=context.values.back().substr(0,32);
  assert(next_session != session);
  reply.set_live_context(session, 99); // prior wake cannot admit new playback
  reply.play("late", "url", session, 99); assert(player.plays == 1);
  // Cancel/disable revokes this generation; provider rotation may explicitly admit a newer one.
  reply.set_live_context(next_session, 1); detector.frame(); reply.loop();
  reply.play("second-live", "url", next_session, 1); assert(player.plays == 2);
  reply.cancel("old-stale-token"); assert(player.stops == stops_after_fault);
  reply.set_stop_context(next_session, 2, false); detector.frame(); reply.loop();
  reply.cancel("second-live"); reply.loop(); reply.loop();
  assert(reply.ready_to_rearm());
  const auto closed_command = detector.command;
  reply.set_live_context(next_session, 1); detector.frame(); reply.loop();
  reply.play("stale", "url", next_session, 1);
  assert(detector.command == closed_command && player.plays == 2);
  reply.set_live_context(next_session, 3); detector.frame(); reply.loop();
  assert(context.values.back()==next_session+":3:live");
  reply.play("rotated-live", "url", next_session, 3); assert(player.plays == 3);
  reply.set_stop_context(next_session, 4, false); detector.frame(); reply.loop();
  reply.cancel("rotated-live"); reply.loop(); reply.loop(); assert(reply.ready_to_rearm());
  reply.rearmed(); detector.frame(); reply.loop();
  assert(reply.begin_conversation()); detector.frame(); reply.loop();
  const auto off_session=context.values.back().substr(0,32);
  // OFF on the same firmware preserves the old armed/disabled contract.
  reply.set_stop_context(off_session, 1, true);
  for (int i=0;i<4;++i) detector.frame();
  reply.loop(); assert(context.values.back()==off_session+":1:armed");
  reply.play("off-reply", "url", off_session, 1); assert(player.plays == 4);
  reply.set_stop_context(off_session, 2, false); detector.frame(); reply.loop();
  assert(context.values.back()==off_session+":2:disabled");
  reply.play("off-disabled", "url", off_session, 2); assert(player.plays == 4);
  reply.cancel("off-reply"); reply.loop(); reply.loop(); assert(reply.ready_to_rearm());
  reply.rearmed(); detector.frame(); reply.loop();
  assert(reply.begin_conversation()); detector.frame(); reply.loop();
  const auto initial_session=context.values.back().substr(0,32);
  reply.set_live_context(initial_session, 1); detector.frame(); reply.loop();
  const auto initial_command=detector.command;
  // No existing playback-state check may mask this: first play itself rejects
  // restart even BEFORE the next owner loop can publish/cancel the fault.
  detector.gate.invalidate(); detector.gate.worker_start(); detector.frame();
  assert(detector.stop_context_ack()==initial_command && !detector.stop_context_fault());
  reply.play("first-after-restart", "url", initial_session, 1);
  assert(player.plays == 4);
  reply.set_live_context(initial_session, 2); assert(detector.command == initial_command);
  reply.loop(); assert(context.values.back()==initial_session+":1:fault");
  reply.set_stop_context(initial_session, 2, false); detector.frame(); reply.loop(); reply.loop();
  assert(reply.ready_to_rearm());
  detector.gate.worker_start(); detector.frame(); assert(reply.ready_after_restart());
  reply.rearmed(); detector.frame(); reply.loop();
  assert(reply.begin_conversation()); detector.frame(); reply.loop();
  const auto recovered_session=context.values.back().substr(0,32);
  reply.set_live_context(recovered_session, 1); detector.frame(); reply.loop();
  reply.play("recovered", "url", recovered_session, 1); assert(player.plays == 5);
}
