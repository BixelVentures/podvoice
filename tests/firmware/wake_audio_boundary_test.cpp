#include "podvoice_audio.h"
#include <cassert>
#include <thread>
using namespace esphome;
using namespace micro_wake_word;

class Detector : public MicroWakeWord {
 public:
  std::shared_ptr<ring_buffer::RingBuffer> storage;
  void init() {
    setup(); state_=DETECTING_WAKE_WORD;
    storage=ring_buffer::RingBuffer::create(64000); ring_buffer_=storage;
    std::lock_guard<std::mutex> lock(wake_audio_clock_.mutex);
    wake_audio_clock_.restart();
  }
  WakeAudioPosition consume(size_t samples) {
    std::lock_guard<std::mutex> lock(wake_audio_clock_.mutex);
    std::vector<uint8_t> scratch(samples*2);
    assert(storage->read(scratch.data(),scratch.size(),0)==scratch.size());
    return feature_wake_audio_=wake_audio_clock_.consume(samples);
  }
  void invalidate() {
    std::lock_guard<std::mutex> lock(wake_audio_clock_.mutex);
    wake_audio_clock_.invalidate();
  }
  void reset_clock() {
    std::lock_guard<std::mutex> lock(wake_audio_clock_.mutex);
    storage->reset(); wake_audio_clock_.restart();
  }
  void recover() {
    auto source=audio::RingBufferAudioSource::create(storage,320,2);
    reset_audio_source_(*source);
  }
  void arm_stop() {
    stop_gate_.worker_start(); stop_gate_.request(3);
    stop_gate_.observe(true,true,1);
    stop_gate_.consume(1); stop_gate_.observe(true,true,1);
    assert(stop_gate_.acknowledged()==3 && stop_gate_.accepts(3));
  }
  bool stop_armed() { return stop_gate_.accepts(3); }
  void queue(WakeAudioPosition marker, std::string *word) {
    DetectionEvent e{}; e.wake_word=word; e.detected=true;
    QueuedDetection q{e,0,marker}; xQueueSend(detection_queue_, &q,0);
  }
};
class Audio : public podvoice_audio::PodVoiceAudio {
 public: void short_write() { ring_buffer_->short_next=true; }
};
struct Rig {
  microphone::MicrophoneSource pv_mic, mww_mic;
  Detector detector; Audio audio;
  api::APIConnection client; voice_assistant::VoiceAssistant va;
  explicit Rig(uint32_t ring_ms=400) {
    va.client=&client; voice_assistant::global_voice_assistant=&va;
    detector.set_microphone_source(&mww_mic); detector.set_features_step_size(10);
    detector.set_stop_after_detection(false);
    pv_mic.info.channels=2;
    audio.set_microphone_source(&pv_mic); audio.set_wake_detector(&detector);
    audio.set_ring_ms(ring_ms); audio.setup(); detector.init();
  }
  void feed(const std::vector<int16_t> &mono) {
    std::vector<int16_t> stereo;
    for(auto s:mono) { stereo.push_back(-100); stereo.push_back(s); }
    const auto *s=reinterpret_cast<const uint8_t *>(stereo.data());
    pv_mic.emit(std::vector<uint8_t>(s,s+stereo.size()*2));
    const auto *m=reinterpret_cast<const uint8_t *>(mono.data());
    mww_mic.emit(std::vector<uint8_t>(m,m+mono.size()*2));
  }
  std::vector<int16_t> output() {
    audio.loop(); std::vector<int16_t> out(client.pcm.size()/2);
    std::memcpy(out.data(),client.pcm.data(),client.pcm.size()); return out;
  }
};
int main() {
  // Same breath: the question begins inside the SAME physical callback as wake.
  // Inference consumes only wake samples; later producer callbacks/main-loop
  // delay must never slide that boundary into question PCM.
  {
    Rig r; std::vector<int16_t> input(160,3000);
    for(int i=1;i<=352;++i) input.push_back(i);
    r.feed(input); auto mark=r.detector.consume(160);
    r.feed(std::vector<int16_t>(512,777));
    assert(r.audio.begin_conversation(mark));
    assert(!r.audio.begin_conversation(mark)); // one wake is single-use
    r.audio.start_streaming(); r.audio.keepalive();
    auto out=r.output(); assert(out.size()==864);
    for(int i=0;i<352;++i) assert(out[i]==i+1);
    for(size_t i=352;i<out.size();++i) assert(out[i]==777);
  }
  // Pause: no wake-prefix bytes get sent; waiting sends silence and retains the
  // complete subsequent question, including an arbitrarily short first word.
  {
    Rig r; r.feed(std::vector<int16_t>(512,2000)); auto mark=r.detector.consume(512);
    r.feed(std::vector<int16_t>(512,0)); assert(r.audio.begin_conversation(mark));
    r.feed({31,32,33}); auto out=r.output(); assert(out.size()==515);
    for(size_t i=0;i<512;++i) assert(out[i]==0);
    assert(out[512]==31 && out[514]==33);
  }
  // Claim race: invalidation after delivery/check but before trim is rejected.
  {
    Rig r; r.feed(std::vector<int16_t>(512,100)); auto mark=r.detector.consume(160);
    r.detector.invalidate(); assert(!r.audio.begin_conversation(mark));
    assert(!r.audio.is_streaming() && r.output().empty());
    r.detector.reset_clock(); r.feed(std::vector<int16_t>(512,200));
    auto fresh=r.detector.consume(160); assert(fresh.detector_run!=mark.detector_run);
    assert(!r.audio.begin_conversation(mark)); assert(r.audio.begin_conversation(fresh));
  }
  // Gate epoch changes while MWW remains running: old buffered feature and old
  // delivered marker cannot open the gate. Fresh post-floor input can.
  {
    Rig r; r.feed(std::vector<int16_t>(512,100)); auto old=r.detector.consume(160);
    r.audio.stop_streaming(); r.feed(std::vector<int16_t>(512,200));
    auto before_floor=r.detector.consume(160);
    assert(!r.audio.begin_conversation(old)); assert(!r.audio.begin_conversation(before_floor));
    auto after_floor=r.detector.consume(512); assert(r.audio.begin_conversation(after_floor));
    auto out=r.output(); assert(out.size()==192);
    for(auto s:out) assert(s==200);
  }
  // Actual worker reset helper: a fully written mapping-gap chunk faults Stop,
  // resets both source buffers/frontend, invalidates queued work, and remaps.
  {
    Rig r; r.feed(std::vector<int16_t>(512,100)); auto old=r.detector.consume(160);
    r.detector.arm_stop();
    // MWW alone gets another chunk: PV did not publish its matching source frame.
    r.mww_mic.emit(std::vector<uint8_t>(1024,0));
    assert(!r.detector.stop_armed() && r.detector.stop_context_fault());
    int before=frontend_resets; r.detector.recover();
    assert(frontend_resets==before+1 && !r.detector.stop_armed());
    assert(r.detector.storage->available()==0 && !r.audio.begin_conversation(old));
    r.feed(std::vector<int16_t>(512,200)); auto fresh=r.detector.consume(160);
    assert(r.audio.begin_conversation(fresh));
    assert(r.detector.stop_context_fault()); // only lifecycle may clear Stop fault
  }
  // A normal PV gate epoch leaves shared frontend and active Stop untouched.
  {
    Rig r; r.feed(std::vector<int16_t>(512,100)); r.detector.consume(512);
    r.detector.arm_stop(); int before=frontend_resets;
    r.audio.stop_streaming(); r.feed(std::vector<int16_t>(512,200));
    assert(r.detector.stop_armed() && !r.detector.stop_context_fault());
    assert(frontend_resets==before);
  }
  // Concurrent producer and claim: exact post-boundary bytes, with neither
  // duplicate nor gap regardless of which short critical section wins.
  {
    Rig r; r.feed(std::vector<int16_t>(512,100)); auto mark=r.detector.consume(160);
    std::thread producer([&] { r.feed(std::vector<int16_t>(512,200)); });
    assert(r.audio.begin_conversation(mark)); producer.join();
    auto out=r.output(); assert(out.size()==864);
    for(size_t i=0;i<352;++i) assert(out[i]==100);
    for(size_t i=352;i<864;++i) assert(out[i]==200);
  }
  // Ring wrap loses a delayed marker: reject, never present a clipped question.
  // Also exceeds the old 2048-frame scratch limit in one producer callback.
  {
    Rig r; r.feed(std::vector<int16_t>(512,100)); auto mark=r.detector.consume(160);
    r.feed(std::vector<int16_t>(7000,200));
    assert(r.audio.audio_position().sample==7512);
    assert(!r.audio.begin_conversation(mark)); assert(!r.audio.is_streaming());
  }
  // Smallest supported ring and oversized callback: actual partial-write rules
  // would preserve a prefix. Bounded writes must instead retain the newest PCM.
  {
    Rig r(64); std::vector<int16_t> samples;
    for(int i=1;i<=3000;++i) samples.push_back(i);
    r.feed(samples); auto mark=r.detector.consume(2200);
    assert(r.audio.begin_conversation(mark)); auto out=r.output();
    assert(out.size()==800); for(int i=0;i<800;++i) assert(out[i]==2201+i);
  }
  // Unexpected short write rejects the damaged epoch, and only fresh input can
  // reopen the gate. Cursor reflects all physical frames, never a partial prefix.
  {
    Rig r; r.feed(std::vector<int16_t>(512,100)); auto old=r.detector.consume(160);
    r.audio.short_write(); r.feed(std::vector<int16_t>(512,200));
    assert(r.audio.audio_position().sample==1024 && !r.audio.begin_conversation(old));
    r.feed(std::vector<int16_t>(512,300)); auto fresh=r.detector.consume(1024);
    assert(r.audio.begin_conversation(fresh)); auto out=r.output();
    assert(out.size()==352); for(auto s:out) assert(s==300);
  }
  // Real MWW main-loop queue delivery drops an old run after reset.
  {
    Rig r; std::string word="Hey Chat";
    r.feed(std::vector<int16_t>(512,100)); auto old=r.detector.consume(160);
    r.detector.queue(old,&word); r.detector.reset_clock();
    r.feed(std::vector<int16_t>(512,200)); auto fresh=r.detector.consume(160);
    r.detector.queue(fresh,&word); r.detector.loop();
    assert(r.detector.get_wake_word_detected_trigger()->delivered.size()==1);
  }
}
