// The real trim/drain path also runs its complete prior field regression suite.
#define main original_wake_boundary_regressions
#include "wake_audio_boundary_test.cpp"
#undef main
#include <chrono>
#include <iostream>

static const std::string OWNER="0123456789abcdef0123456789abcdef";
static void wake(Rig &r, size_t samples=800) {
  std::vector<int16_t> pcm(samples+13);
  for(size_t i=0;i<pcm.size();++i) pcm[i]=static_cast<int16_t>(i);
  r.feed(pcm); auto boundary=r.detector.consume(samples);
  boundary.detected_ms=91; boundary.delivered_ms=99;
  assert(r.audio.begin_conversation(boundary)); r.audio.bind_wake_snapshot(OWNER);
}
static void tick(Rig &r) { r.feed({1234}); r.audio.loop(); }
static void finish(Rig &r, bool supply_pcm=false) { for(int i=0;i<70;++i) { if(supply_pcm) tick(r); else r.audio.loop(); } }
int main() {
  original_wake_boundary_regressions();
  test_millis=100;
  // No unsolicited diagnostic, no prewake bytes in conversation audio, and exact
  // real wire fixtures for independent Python CRC/base64/sample-bound validation.
  {
    Rig r(1500,true); wake(r); finish(r); assert(r.client.reference.empty());
    assert(r.client.pcm.size()==26);
    for(int i=0;i<13;++i) {
      int16_t actual; std::memcpy(&actual,r.client.pcm.data()+i*2,2); assert(actual==800+i);
    }
    r.audio.request_wake_snapshot("ffffffffffffffffffffffffffffffff",1);
    r.audio.request_wake_snapshot(OWNER,2); finish(r); assert(r.client.reference.empty());
    r.ack=false; r.audio.request_wake_snapshot(OWNER,1); finish(r); assert(r.client.reference.empty());
    r.ack=true; r.audio.request_wake_snapshot(OWNER,1); finish(r);
    assert(r.client.reference.empty()); // CRC slices cannot produce an empty-loop reference burst.
    tick(r);
    assert(r.client.reference.size()==1);
    r.audio.request_wake_snapshot(OWNER,1); // Never restarts/replays chunk 0.
    r.live_generation=2; r.ack=false; finish(r,true); // Same-wake playback generation/ACK transition is legitimate.
    assert(r.client.reference.size()==3 && r.client.pcm.size()==26+142);
    for(const auto &event:r.client.reference) { assert(event.key==0x12345678); std::cout<<event.state.value<<'\n'; }
  }
  // Maximum retained suffix is 48KB even with a larger configured rolling ring.
  {
    Rig r(4000,true); wake(r,29000); r.audio.request_wake_snapshot(OWNER,1); finish(r);
    assert(r.client.reference.empty()); finish(r,true);
    assert(r.client.reference.size()==63 && r.client.pcm.size()==26+140);
    for(const auto &event:r.client.reference) std::cout<<event.state.value<<'\n';
  }
  // Optional allocation failure yields an explicit missing reference, without
  // failing the wake or dropping one post-detection microphone byte.
  {
    fail_optional_psram=true; Rig r(1500,true); fail_optional_psram=false;
    wake(r); r.audio.request_wake_snapshot(OWNER,1); finish(r);
    assert(r.client.pcm.size()==26 && r.client.reference.size()==1);
    std::cout<<r.client.reference[0].state.value<<'\n';
  }
  // Every retirement is irreversible for this snapshot, even when mute/client
  // pointers/generation later return to their former values before another loop.
  for(int kind=0;kind<8;++kind) {
    test_millis=100; Rig r(1500,true); wake(r); r.audio.request_wake_snapshot(OWNER,1);
    if(kind==0) { r.mute.set(true); r.mute.set(false); }
    if(kind==1) { r.audio.stop_streaming(); r.audio.start_streaming(); }
    if(kind==2) r.audio.reset_capture_barrier();
    if(kind==3) { r.va.client=nullptr; r.audio.loop(); r.va.client=&r.client; }
    if(kind==4) { api::APIConnection next; r.va.client=&next; r.audio.loop(); r.va.client=&r.client; }
    if(kind==5) { test_millis+=15000; r.audio.loop(); test_millis=100; }
    if(kind==6) { r.live_generation=0; r.audio.loop(); r.live_generation=1; }
    if(kind==7) { assert(r.audio.hold_capture(99)); assert(r.audio.resume_capture(99)); }
    r.audio.request_wake_snapshot(OWNER,1); finish(r,true); assert(r.client.reference.empty());
  }
  // Unsigned device-clock wrap does not extend or prematurely expire the 15s TTL.
  {
    test_millis=0xfffffff0; Rig r(1500,true); wake(r); r.audio.request_wake_snapshot(OWNER,1);
    test_millis=0x10; finish(r); tick(r); assert(r.client.reference.size()==1);
    test_millis=0xfffffff0U+15000U; finish(r); assert(r.client.reference.size()==1);
  }
  // Normal audio goes first; socket backpressure or failed PCM send excludes a
  // diagnostic that loop. Failed diagnostic send is never retried/duplicated.
  {
    test_millis=100; Rig r(1500,true); wake(r); r.audio.request_wake_snapshot(OWNER,1);
    r.client.audio_success=false; r.audio.loop(); assert(r.client.reference.empty());
    r.client.audio_success=true; r.client.writable=false; finish(r); assert(r.client.reference.empty());
    r.client.writable=true; finish(r); r.feed({1,2}); r.audio.loop();
    assert((r.client.sends==std::vector<char>{'a','a','r'}));
    r.client.reference_success=false; tick(r); finish(r); assert(r.client.reference.size()==1);
    assert(r.client.sends.back()=='r' && r.client.sends.size()==5);
  }
  // Concrete native-helper causality: accepted diagnostic creates overflow;
  // the NEXT microphone frame remains ring-owned, even after snapshot expiry or
  // teardown. Clearing snapshot permission must not forgive transport debt.
  for (int retirement=0;retirement<3;++retirement) {
    test_millis=100; Rig r(1500,true); wake(r); r.audio.request_wake_snapshot(OWNER,1); finish(r);
    r.client.pressure_after_reference=true; tick(r);
    assert(r.client.reference.size()==1 && !r.client.writable);
    const size_t before=r.client.pcm.size();
    if(retirement==0) test_millis+=15000; // expiry
    if(retirement==1) { r.mute.set(true); r.mute.set(false); }
    if(retirement==2) { r.audio.stop_streaming(); r.audio.start_streaming(); }
    r.feed({10,20,30}); finish(r);
    assert(r.client.pcm.size()==before && r.client.reference.size()==1);
    r.client.writable=true; r.audio.loop();
    assert(r.client.pcm.size()==before+6);
    int16_t recovered[3]; std::memcpy(recovered,r.client.pcm.data()+before,6);
    assert(recovered[0]==10 && recovered[1]==20 && recovered[2]==30);
    assert(r.client.reference.size()==1);
  }
  // Next wake cannot resurrect the previous nonce/snapshot request.
  {
    test_millis=100; Rig r(1500,true); wake(r); r.audio.request_wake_snapshot(OWNER,1);
    r.audio.stop_streaming(); r.detector.reset_clock(); wake(r);
    r.audio.request_wake_snapshot("ffffffffffffffffffffffffffffffff",1); finish(r);
    assert(r.client.reference.empty());
  }
  // Host-only upper-bound measurement, not an ESP32 timing claim. Copy is bounded
  // by 48KB; CRC is deferred until an admitted request and never holds audio lock.
  {
    test_millis=100; Rig r(1500,true); r.feed(std::vector<int16_t>(24000,123));
    auto boundary=r.detector.consume(24000);
    auto start=std::chrono::steady_clock::now(); assert(r.audio.begin_conversation(boundary));
    auto us=std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now()-start).count();
    r.audio.bind_wake_snapshot(OWNER); r.audio.request_wake_snapshot(OWNER,1);
    long long crc_max_ns=0, send_max_ns=0;
    for(int i=0;i<63;++i) {
      auto slice_start=std::chrono::steady_clock::now(); r.audio.loop();
      auto ns=std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-slice_start).count();
      crc_max_ns=std::max(crc_max_ns,static_cast<long long>(ns));
    }
    assert(r.client.reference.empty());
    for(int i=0;i<63;++i) {
      r.feed(std::vector<int16_t>(512,456));
      auto slice_start=std::chrono::steady_clock::now(); r.audio.loop();
      auto ns=std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-slice_start).count();
      send_max_ns=std::max(send_max_ns,static_cast<long long>(ns));
    }
    assert(r.client.reference.size()==63);
    std::cerr<<"host_trim_48000_bytes_us="<<us<<" optional_psram_bytes=48000 chunk_raw_bytes=768"
      <<" host_max_crc_slice_ns="<<crc_max_ns<<" host_max_normal_plus_reference_send_ns="<<send_max_ns<<"\n";
  }
}
