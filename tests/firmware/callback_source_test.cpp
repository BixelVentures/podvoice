#define main original_boundary_regressions
#include "wake_audio_boundary_test.cpp"
#undef main
#include <iostream>
static uint64_t field(const std::vector<uint8_t> &header,size_t offset,size_t width) {
  assert(header.size()==68); uint64_t value=0;
  for(size_t i=0;i<width;++i) value|=uint64_t(header[offset+i])<<(8*i);
  return value;
}
static void begin(Rig &r) { r.feed({0,1,2,3,4}); assert(r.audio.begin_conversation(r.detector.consume(2))); }
int main() {
  original_boundary_regressions();
  test_millis=100;
  // OFF uses the original native mono ABI and byte-identical payload.
  { Rig r; begin(r); r.audio.loop(); assert(r.client.source_headers[0].empty()); assert(r.client.pcm.size()==6); }
  // Requesting a fence retains all queued pre-fence PCM, including the exact prefix.
  { Rig r; begin(r); assert(r.audio.enable_source_provenance(123));
    assert(r.audio.request_callback_fence(123,7));
    assert(r.audio.request_callback_fence(123,7)); // exact retry cannot move the cut
    r.feed({5,6}); r.audio.loop();
    const auto &h=r.client.source_headers[0];
    assert(field(h,4,4)==123 && field(h,12,8)==1);
    assert(field(h,20,8)==2 && field(h,28,8)==7);
    assert(field(h,52,4)==7 && field(h,56,8)==5 && field(h,64,4)==field(h,8,4));
    assert(r.client.pcm.size()==10); // samples 2..6 unchanged
    assert(!r.audio.request_callback_fence(123,6));
    assert(!r.audio.enable_source_provenance(124));
    for(size_t i=0;i<5;++i){ int16_t got; std::memcpy(&got,r.client.pcm.data()+2*i,2); assert(got==2+i); }
    r.audio.stop_from_button(); assert(!r.audio.request_callback_fence(123,8));
    assert(!r.audio.enable_source_provenance(123)); // source telemetry cannot override local Stop
  }
  // Native send consumes six samples and fails: next frame exposes both the
  // missing attempt and exact lost interval, without a host timestamp guess.
  { Rig r; begin(r); assert(r.audio.enable_source_provenance(123));
    r.client.audio_success=false; r.audio.loop();
    r.client.audio_success=true; r.feed({5,6}); r.audio.loop();
    const auto &h=r.client.source_headers[0];
    assert(field(h,12,8)==2 && field(h,20,8)==5 && field(h,28,8)==7);
    assert(field(h,44,8)==3 && field(h,36,8)==0);
  }
  // Ring overwrite excludes a claim of complete input, while retained PCM and
  // source interval still identify exact surviving samples (64ms ring=1024).
  { Rig r(64); begin(r); assert(r.audio.enable_source_provenance(123));
    std::vector<int16_t> pcm(1500,99); r.feed(pcm); r.audio.loop();
    const auto &h=r.client.source_headers[0];
    assert(field(h,20,8)==481 && field(h,28,8)==1505);
    assert(field(h,36,8)==479 && field(h,44,8)==0);
  }
  // Connection retirement cannot reuse a nonce, even if the pointer returns.
  { Rig r; begin(r); assert(r.audio.enable_source_provenance(123));
    r.va.client=nullptr; r.audio.loop(); r.va.client=&r.client;
    assert(!r.audio.request_callback_fence(123,1));
  }
  // Export the ACTUAL C++ header paired with exact PCM for Python/SDK decoding.
  { Rig r; begin(r); assert(r.audio.enable_source_provenance(123));
    assert(r.audio.request_callback_fence(123,7)); r.audio.loop();
    for(auto v:r.client.source_headers[0]) std::cout<<"0123456789abcdef"[v>>4]<<"0123456789abcdef"[v&15];
    std::cout<<'\n';
    for(auto v:r.client.pcm) std::cout<<"0123456789abcdef"[v>>4]<<"0123456789abcdef"[v&15];
    std::cout<<'\n';
  }
}
