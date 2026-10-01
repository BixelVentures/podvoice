#define main existing_boundary_regressions
#include "wake_audio_boundary_test.cpp"
#undef main
int main() {
  existing_boundary_regressions();
  assert(podvoice_audio::PodVoiceAudio::closing_yellow_raw(255,255,0,0));
  assert(podvoice_audio::PodVoiceAudio::closing_yellow_raw(100,99,0,0));
  assert(!podvoice_audio::PodVoiceAudio::closing_yellow_raw(0,0,0,0));
  assert(!podvoice_audio::PodVoiceAudio::closing_yellow_raw(0,255,255,0));
  assert(!podvoice_audio::PodVoiceAudio::closing_yellow_raw(255,0,0,0));
  assert(!podvoice_audio::PodVoiceAudio::closing_yellow_raw(100,10,0,0));
  test_millis=100;
  Rig r; r.feed({0,1,2,3,4}); assert(r.audio.begin_conversation(r.detector.consume(2)));
  assert(r.audio.enable_source_provenance(123));
  text_sensor::TextSensor sensor;
  r.audio.set_closing_status_sensor(&sensor);
  unsigned renders=0,cancels=0;
  r.audio.set_closing_led_request([&](uint32_t token){++renders;return token==2;});
  r.audio.set_closing_led_cancel([&](){++cancels;});
  assert(r.audio.begin_live_closing(123,2));
  assert(renders==1 && r.client.reference.size()==1);
  assert(r.client.reference[0].state.value.find("command_admitted")!=std::string::npos);
  assert(r.client.pcm.empty());  // Command does not drain/discard provider audio.
  r.audio.closing_led_tx_done(3,9,0xFFFFFFFF); assert(r.client.reference.size()==1);
  assert(cancels==0);  // Delayed old token is inert for this owner.
  r.audio.closing_led_tx_done(2,9,0xFFFFFFFF);
  assert(r.client.reference.back().state.value.find("led_tx_done")!=std::string::npos);
  assert(r.client.reference.back().state.value.find("4294967295")!=std::string::npos);
  r.audio.loop(); assert(r.client.pcm.size()==6);  // Original pre-F samples survive.
  // Existing provider rotation retires nonce and LED ownership at capture hold.
  assert(r.audio.hold_capture(1));
  size_t retired=r.client.reference.size();
  r.audio.closing_led_tx_done(2,10,1); assert(r.client.reference.size()==retired);
  assert(r.audio.resume_capture(1));
  assert(!r.audio.request_callback_fence(123,3));
  assert(r.audio.enable_source_provenance(124));
  assert(r.audio.request_callback_fence(124,3));
  r.audio.stop_from_button();
  size_t n=r.client.reference.size();
  r.audio.closing_led_tx_done(2,10,1); assert(r.client.reference.size()==n);
  assert(!r.audio.begin_live_closing(123,3));
}
