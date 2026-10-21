#include "podvoice_reply.h"
#include <cassert>
using namespace esphome;
struct Fixture {
  podvoice_reply::PodVoiceReply reply;
  speaker_source::SpeakerSourceMediaPlayer player;
  resampler::ResamplerSpeaker resampler;
  mixer_speaker::SourceSpeaker source;
  mixer_speaker::MixerSpeaker mixer;
  speaker::Speaker output;
  text_sensor::TextSensor status, context, timer;
  micro_wake_word::WakeWordModel model;
  micro_wake_word::MicroWakeWord detector;
  switch_::Switch mute;
  Fixture() {
    reply.set_player(&player); reply.set_resampler(&resampler); reply.set_source(&source);
    reply.set_mixer(&mixer); reply.set_output(&output); reply.set_status(&status);
    reply.set_stop_model(&model); reply.set_detector(&detector);
    reply.set_context_status(&context); reply.set_mute_switch(&mute); reply.set_timer_status(&timer);
    output.stopped=true; reply.setup(); ack(); reply.rearmed(); ack();
  }
  void ack() { for(int i=0;i<4;++i) detector.frame(); reply.loop(); }
  std::string idle() { assert(timer.values.back().find("idle:")==0); return timer.values.back().substr(5); }
  void finish(const std::string &session) {
    reply.cancel("alarm"); reply.set_stop_context(session,2,false);
    ack(); reply.loop(); assert(reply.ready_to_rearm()); reply.rearmed(); ack();
  }
};
int main() {
  Fixture f; auto idle=f.idle(); auto request=idle+std::string(32,'a');
  f.mute.publish(true); f.reply.begin_timer_output(idle,request); assert(!f.reply.timer_output_active());
  f.mute.publish(false); f.ack(); idle=f.idle();
  f.detector.gate.invalidate(); f.reply.begin_timer_output(idle,request); assert(!f.reply.timer_output_active());
  f.detector.gate.worker_start(); f.ack();
  f.reply.invalidate_timer_admission(); f.ack(); assert(f.idle()!=idle);
  f.reply.begin_timer_output(idle,request); assert(!f.reply.timer_output_active());
  idle=f.idle(); request=idle+std::string(32,'a'); f.reply.begin_timer_output(idle,request); assert(f.reply.timer_output_active());
  auto session=f.reply.conversation_nonce();
  f.reply.play("alarm","url",session,1); assert(f.player.plays==0); // actual worker ACK required
  f.ack(); assert(f.timer.values.back()==request+":"+idle+":"+session+":armed");
  f.reply.begin_timer_output(idle,request); assert(f.reply.conversation_nonce()==session);
  f.reply.play("alarm","url",session,1); assert(f.player.plays==1);
  f.player.state=media_player::MEDIA_PLAYER_STATE_ANNOUNCING; f.reply.loop();
  f.reply.invalidate_timer_admission(); assert(f.player.stops==0); // other API client cannot stop alarm
  const auto old_stop_command=f.detector.command;
  f.detector.deliver(old_stop_command); assert(f.player.stops==1);
  assert(f.context.values.back()==session+":1:stopped");
  assert(f.reply.get_timer_stop_trigger()->fires==0); // HA owns this alarm, not the device timer
  f.detector.deliver(old_stop_command); assert(f.player.stops==1); // duplicate is inert
  assert(!f.reply.begin_conversation()); // wake/button only stop alarm until full cleanup
  f.reply.play("late","url",session,1); assert(f.player.plays==1);
  f.player.state=media_player::MEDIA_PLAYER_STATE_IDLE; f.finish(session);
  assert(f.idle()!=idle); assert(f.reply.begin_conversation()); f.ack();
  auto fresh=f.reply.conversation_nonce(); assert(fresh!=session);
  f.detector.deliver(old_stop_command); assert(f.player.stops==1); // stale Stop cannot cross rearm
  f.reply.begin_timer_output(idle,request); assert(f.reply.conversation_nonce()==fresh);
  Fixture muted; idle=muted.idle(); request=idle+std::string(32,'a'); muted.reply.begin_timer_output(idle,request); muted.ack();
  muted.mute.publish(true); assert(muted.player.stops==1);
  muted.reply.play("late","url",muted.reply.conversation_nonce(),1); assert(muted.player.plays==0);
  Fixture cancel_first; auto x=cancel_first.idle(); auto a=x+std::string(32,'a');
  cancel_first.reply.cancel_timer_output(x,a,std::string(32,'f'));
  cancel_first.reply.begin_timer_output(x,a); assert(!cancel_first.reply.timer_output_active());
  cancel_first.ack(); auto y=cancel_first.idle(); assert(x!=y);
  auto b=y+std::string(32,'b');
  cancel_first.reply.cancel_timer_output(x,a,std::string(32,'f'));
  cancel_first.reply.begin_timer_output(y,b); assert(cancel_first.reply.timer_output_active());
  cancel_first.ack(); auto owner=cancel_first.reply.conversation_nonce();
  cancel_first.reply.cancel_timer_output(x,a,std::string(32,'f'));
  assert(cancel_first.reply.conversation_nonce()==owner && cancel_first.player.stops==0);
  Fixture lost_ack; x=lost_ack.idle(); a=x+std::string(32,'a');
  lost_ack.reply.begin_timer_output(x,a);
  lost_ack.reply.cancel_timer_output(x,a,std::string(32,'f')); lost_ack.ack();
  for(int i=0;i<4 && lost_ack.timer.values.back().find(":retired")==std::string::npos;++i) lost_ack.reply.loop();
  assert(lost_ack.timer.values.back().find("cancel:"+a+":")==0);
  assert(lost_ack.timer.values.back().find(":retired")!=std::string::npos);
  int stopped=lost_ack.player.stops;
  lost_ack.reply.cancel_timer_output(x,a,std::string(32,'e')); assert(lost_ack.player.stops==stopped);
  lost_ack.reply.play("late","url",lost_ack.reply.conversation_nonce(),2); assert(lost_ack.player.plays==0);
  lost_ack.reply.rearmed(); lost_ack.ack(); assert(lost_ack.reply.begin_conversation()); lost_ack.ack();
  owner=lost_ack.reply.conversation_nonce();
  lost_ack.reply.cancel_timer_output(x,a,std::string(32,'f'));
  assert(lost_ack.reply.conversation_nonce()==owner && lost_ack.player.stops==stopped);

}
