"""Execute the shipped press/release decision lambdas, including rapid-repeat timing."""

import re
import shutil
import subprocess
from pathlib import Path


def test_shipped_button_first_release_and_repeat_suppression(tmp_path):
    root = Path(__file__).parents[2]
    text = (
        (root / "esphome/voice-pe-podvoice-base.yaml")
        .read_text()
        .split("    id: center_button", 1)[1]
    )
    press = re.search(r"on_press:\n      - lambda: \|-\n(.*?)      - script.execute", text, re.S)[1]
    release = re.search(r"const uint32_t now = millis\(\);(.*?)\n          then:", text, re.S)[1]
    source = """#include <cassert>
#include <cstdint>
#define id(x) x
uint32_t clock_ms=0;
uint32_t millis(){ return clock_ms; }
uint32_t podvoice_button_down_ms=0,podvoice_button_last_release_ms=0;
bool podvoice_button_seen_release=false,podvoice_button_repeat=false;
bool init_in_progress=false,color_changed=false,group_volume_changed=false;
bool factory_reset_requested=false,podvoice_conversation_active=false;
struct Reply { bool stopped=false; bool button_stop_latched(){return stopped;} } pv_reply;
void press(){ PRESS }
bool release(){ const uint32_t now=millis(); RELEASE }
int main(){
clock_ms=1000;press();clock_ms=1100;assert(release());
// Gap 200ms + hold 150ms: a double must not become a second command.
clock_ms=1300;press();clock_ms=1450;assert(!release());
clock_ms=1800;press();clock_ms=1900;assert(release());
// An active conversation's Stop is not blocked by a previous dial interaction.
podvoice_conversation_active=true;color_changed=true;
clock_ms=2300;press();clock_ms=2350;assert(release());
clock_ms=2700;press();clock_ms=3800;assert(!release());
pv_reply.stopped=true;clock_ms=4000;press();clock_ms=4050;assert(!release());
pv_reply.stopped=false;factory_reset_requested=true;
clock_ms=4300;press();clock_ms=4400;assert(!release());
}
""".replace("PRESS", press).replace("RELEASE", release)
    cpp = tmp_path / "button.cpp"
    cpp.write_text(source)
    binary = tmp_path / "button"
    subprocess.run([shutil.which("c++"), "-std=c++17", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)


def test_shipped_button_capture_latch_rejects_late_start_hold_resume_until_new_boundary(tmp_path):
    root = Path(__file__).parents[2]
    source = (root / "esphome/components/podvoice_audio/podvoice_audio.cpp").read_text()

    def method(name):
        begin = re.search(r"(?:bool|void) PodVoiceAudio::" + name + r"\([^)]*\) \{", source).start()
        brace = source.index("{", begin)
        depth = 1
        end = brace + 1
        while depth:
            depth += (source[end] == "{") - (source[end] == "}")
            end += 1
        return source[begin:end]

    methods = "\n".join(
        method(n)
        for n in (
            "begin_button_conversation",
            "start_streaming",
            "stop_streaming",
            "stop_from_button",
            "hold_capture",
            "resume_capture",
            "reset_capture_barrier",
        )
    )
    cpp = tmp_path / "capture.cpp"
    cpp.write_text(
        """#include <cassert>
#include <cstdint>
#include <mutex>
#define USE_VOICE_ASSISTANT
uint32_t millis(){ return 100; }
struct Client {} client;
namespace voice_assistant {
struct VA { Client *get_api_connection(){ return &client; } } instance;
auto *global_voice_assistant = &instance;
}
struct Ring { void reset(){} } ring;
struct PodVoiceAudio {
 std::mutex audio_mutex_;
 Ring *ring_buffer_=&ring;
 bool capture_held_=false,button_stop_latched_=false,boundary_consumed_=false,user_enabled_=false;
 uint32_t last_keepalive_ms_=0,audio_epoch_=0,capture_token_=0,capture_last_token_=0;
 uint64_t epoch_start_sample_=0,produced_samples_=0;
 Client *capture_client_=nullptr;
 bool begin_button_conversation(); void start_streaming(); void stop_streaming(); void stop_from_button();
 bool hold_capture(uint32_t); bool resume_capture(uint32_t); void reset_capture_barrier();
};
"""
        + methods
        + """
int main(){
 PodVoiceAudio p;
 assert(p.begin_button_conversation()); assert(p.user_enabled_);
 assert(p.hold_capture(10)); // a provider rotation was in flight
 p.stop_from_button();
 assert(!p.user_enabled_ && p.capture_held_ && p.button_stop_latched_);
 p.start_streaming(); assert(!p.user_enabled_);
 assert(!p.resume_capture(10)); assert(!p.hold_capture(11));
 assert(!p.begin_button_conversation()); // repeated button while cleanup owns latch
 p.stop_streaming(); p.start_streaming(); assert(!p.user_enabled_);
 p.reset_capture_barrier(); // authoritative firmware rearm, not a remote Stop
 assert(!p.capture_held_ && !p.user_enabled_);
 p.start_streaming(); assert(!p.user_enabled_); // delayed old keepalive while idle
 assert(!p.resume_capture(10)); assert(!p.hold_capture(11));
 assert(p.begin_button_conversation()); assert(p.user_enabled_);
 assert(!p.hold_capture(10)); assert(!p.resume_capture(10)); // retired token cannot cross wake
 assert(p.hold_capture(11)); assert(p.resume_capture(11)); // fresh generation works
 p.stop_from_button(); p.stop_from_button(); assert(!p.user_enabled_);
}
"""
    )
    binary = tmp_path / "capture"
    subprocess.run([shutil.which("c++"), "-std=c++17", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
    wake = source.split("bool PodVoiceAudio::begin_conversation(", 1)[1].split(
        "bool PodVoiceAudio::begin_button_conversation()", 1
    )[0]
    assert "this->button_stop_latched_ = false;" in wake


def test_button_local_cancel_precedes_event_and_rearm_is_only_release():
    root = Path(__file__).parents[2]
    base = (root / "esphome/voice-pe-podvoice-base.yaml").read_text()
    click = base.split("    id: center_button", 1)[1].split("    on_multi_click:", 1)[0]
    assert click.index("pv_audio).stop_from_button()") < click.index("event_type: single_press")
    assert click.index("pv_reply).stop_from_button()") < click.index("event_type: single_press")
    assert "podvoice_conversation_active) = false" not in click
    indicator = base.split("if (id(pv_reply).button_stop_latched())", 1)[1].split("return;", 1)[0]
    assert indicator.index("voice_assistant_leds).turn_off()") < indicator.index(
        "led_ring).turn_on()"
    )
    assert 'animation.set_effect("None")' in indicator
    reply = (root / "esphome/components/podvoice_reply/podvoice_reply.h").read_text()
    local_stop = reply.split("  void stop_from_button()", 1)[1].split("  bool ready_to_rearm", 1)[0]
    assert local_stop.index("context_.stop_from_button()") < local_stop.index("stop_()")
    assert "state_.blocked = true;" in local_stop
    assert reply.count("button_stop_latched_ = false;") == 1
    assert (
        "button_stop_latched_ = false;"
        in reply.split("void rearmed()", 1)[1].split("void set_timer", 1)[0]
    )


def test_active_button_stop_takes_precedence_over_ringing_timer(tmp_path):
    root = Path(__file__).parents[2]
    base = (root / "esphome/voice-pe-podvoice-base.yaml").read_text()
    click = base.split("    id: center_button", 1)[1].split("    on_multi_click:", 1)[0]
    condition = re.search(r'lambda: "(return id\(timer_ringing\).*?;)"', click)[1]
    cpp = tmp_path / "timer.cpp"
    cpp.write_text(
        """#include <cassert>
#define id(x) x
struct Timer { bool state=false; } timer_ringing;
bool podvoice_conversation_active=false;
bool timer_only(){ CONDITION }
int main(){
 timer_ringing.state=true; assert(timer_only());
 podvoice_conversation_active=true; assert(!timer_only());
 timer_ringing.state=false; assert(!timer_only());
 podvoice_conversation_active=false; assert(!timer_only());
}
""".replace("CONDITION", condition)
    )
    binary = tmp_path / "timer"
    subprocess.run([shutil.which("c++"), "-std=c++17", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
    active = click.split("# Active Stop is local", 1)[1].split("pv_audio).stop_from_button()", 1)[0]
    assert "switch.turn_off: timer_ringing" in active
