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
  reply.set_player(&player); reply.set_resampler(&resampler); reply.set_source(&source);
  reply.set_mixer(&mixer); reply.set_output(&output); reply.set_status(&status); reply.set_stop_model(&model);
  reply.setup(); assert(!model.enabled);
  reply.play("A", "url"); assert(player.plays==1); assert(!model.enabled);
  player.state=media_player::MEDIA_PLAYER_STATE_ANNOUNCING; reply.loop();
  assert(model.enabled); assert(status.values.back()=="A:started");
  player.idle=false; assert(reply.local_stop());
  assert(player.stops==1); assert(!model.enabled); assert(!reply.ready_to_rearm());
  reply.play("B", "late-url"); assert(player.plays==1);
  reply.loop(); assert(status.values.back()=="A:stop_detected");
  player.idle=true; reply.loop(); // producer is gone, reassert resampler stop
  source.quiet=false; reply.loop(); assert(status.values.back()=="A:stop_detected");
  source.quiet=true; mixer.pending=100; reply.loop();
  output.consumed(99); reply.loop(); assert(!reply.ready_to_rearm());
  output.consumed(1); reply.loop(); assert(reply.ready_to_rearm());
  assert(status.values.back()=="A:stopped_word");
  reply.cancel("A"); assert(status.values.back()=="A:stopped_word");
  reply.rearmed(); reply.play("B", "url");
  reply.cancel("A"); assert(!reply.ready_to_rearm());
  player.state=media_player::MEDIA_PLAYER_STATE_ANNOUNCING; reply.loop();
  // Timer demand stays enabled when normal reply demand ends.
  reply.set_timer_required(true);
  player.state=media_player::MEDIA_PLAYER_STATE_IDLE; mixer.pending=0; reply.loop();
  assert(status.values.back()=="B:finished"); assert(model.enabled);
  reply.set_timer_required(false); assert(!model.enabled);
  // Paused/shared-output stop must report fault, never successful silence.
  reply.cancel("B"); output.paused=true; reply.loop();
  assert(status.values.back()=="B:fault"); assert(!reply.ready_to_rearm());
}
