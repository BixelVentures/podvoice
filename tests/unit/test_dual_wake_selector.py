"""Run the shipped selection lambda against every initial model mask and faults."""

import shutil
import subprocess
import textwrap
from pathlib import Path


def test_exact_firmware_wake_selection_and_fault_readback(tmp_path):
    root = Path(__file__).parents[2]
    overlay = (root / "esphome/podvoice.yaml").read_text()
    service = overlay.split("action: podvoice_set_wake_word", 1)[1].split("\n# PodVoice", 1)[0]
    body = textwrap.dedent(service.split("lambda: |-\n", 1)[1])
    source = tmp_path / "select.cpp"
    source.write_text(
        r"""
#include <cassert>
#include <string>
struct Model {
  bool enabled=false, stuck=false;
  void enable() { if(!stuck) enabled=true; }
  void disable() { if(!stuck) enabled=false; }
  bool is_enabled() const { return enabled; }
};
struct Sensor { std::string value; void publish_state(std::string s) { value=s; } };
Model okay_nabu, hey_jarvis, hey_mycroft, hey_chat, stop;
Sensor podvoice_wake_word_ack;
#define id(x) x
#define ESP_LOGW(...) ((void)0)
#define ESP_LOGI(...) ((void)0)
void select(const std::string &name, const std::string &token) {
"""
        + body
        + r"""
}
int main() {
  Model *models[]={&okay_nabu,&hey_jarvis,&hey_mycroft,&hey_chat,&stop};
  const char *names[]={"okay_nabu","hey_jarvis","hey_mycroft","hey_chat","hey_chat_hey_jarvis"};
  const int targets[]={1,2,4,8,10};
  for(int initial=0;initial<32;++initial) for(int target=0;target<5;++target)
  for(int stuck=-1;stuck<4;++stuck) {
    for(int i=0;i<5;++i) { models[i]->enabled=(initial & (1<<i))!=0; models[i]->stuck=i==stuck; }
    select(names[target],"current");
    int actual=0; for(int i=0;i<4;++i) if(models[i]->enabled) actual|=1<<i;
    assert(stop.enabled==bool(initial&16));
    assert(podvoice_wake_word_ack.value == std::string("current:") +
      (actual==targets[target] ? names[target] : "fault"));
    if(stuck<0) assert(actual==targets[target]);
    const auto previous=podvoice_wake_word_ack.value;
    select("unknown","bad");
    int after=0; for(int i=0;i<4;++i) if(models[i]->enabled) after|=1<<i;
    assert(after==actual && podvoice_wake_word_ack.value==previous);
  }
}
"""
    )
    compiler = shutil.which("c++")
    assert compiler
    binary = tmp_path / "selector"
    subprocess.run(
        [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", str(source), "-o", str(binary)],
        check=True,
    )
    subprocess.run([str(binary)], check=True)


def test_two_detector_callbacks_share_one_firmware_admission(tmp_path):
    """Execute the shipped guard and capture admission for back-to-back detections."""
    import re

    base = (Path(__file__).parents[2] / "esphome/voice-pe-podvoice-base.yaml").read_text()
    callback = base.split("  on_wake_word_detected:\n", 1)[1].split("\nselect:", 1)[0]
    guard = re.search(r"- lambda: '(return !id\(podvoice_conversation_active\).*?)'", callback)[1]
    admission = textwrap.dedent(
        callback.split("- lambda: |-\n", 1)[1].split("                - if:", 1)[0]
    )
    source = tmp_path / "admission.cpp"
    source.write_text(
        r"""
#include <cassert>
#include <string>
bool podvoice_conversation_active=false;
struct Detector { int wake_audio_position() { return 42; } } mww;
struct Audio {
 int starts=0, binds=0, stops=0;
 bool begin_conversation(int boundary) { assert(boundary==42); ++starts; return true; }
 void stop_streaming() { ++stops; }
 void bind_wake_snapshot(int nonce) { assert(nonce==7); ++binds; }
} pv_audio;
struct Reply {
 int starts=0;
 bool begin_conversation() { ++starts; return true; }
 int conversation_nonce() { return 7; }
} pv_reply;
#define id(x) x
bool admitted(const std::string &wake_word) {
"""
        + guard
        + "\n}\nvoid detect(const std::string &word) { if(!admitted(word)) return;\n"
        + admission
        + r"""
}
int main() {
 detect("Hey Chat"); detect("Hey Jarvis"); detect("Hey Chat"); detect("Stop");
 assert(pv_audio.starts==1 && pv_reply.starts==1 && pv_audio.binds==1);
 podvoice_conversation_active=false;
 detect("Stop"); assert(pv_audio.starts==1);
 detect("Hey Jarvis"); detect("Hey Chat");
 assert(pv_audio.starts==2 && pv_reply.starts==2 && pv_audio.binds==2);
 assert(pv_audio.stops==0);
}
"""
    )
    binary = tmp_path / "admission"
    subprocess.run(
        [
            shutil.which("c++"),
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            str(source),
            "-o",
            str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)
