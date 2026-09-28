"""Execute the Alpha ring's shipped animation, including delayed work after Stop."""

import re
import shutil
import subprocess
from pathlib import Path


def test_alpha_native_work_effect_rotates_and_yields_to_local_safety_display(tmp_path):
    root = Path(__file__).parents[2]
    firmware = (root / "esphome/podvoice-live-alpha.yaml").read_text()
    ring = firmware.split("- id: !extend led_ring", 1)[1].split("\napi:", 1)[0]
    assert 'name: "Thinking"' in ring
    animation = re.search(r"lambda: \|-\n(.*?)(?=\n\S|\Z)", ring, re.S)[1]
    source = r"""
#include <array>
#include <cassert>
#include <cstdint>
#include <string>
#define id(x) x
struct Color {
  int r=0,g=0,b=0;
  Color() = default;
  Color(int r,int g,int b):r(r),g(g),b(b){}
  Color operator*(int n) const { return Color(r*n/255,g*n/255,b*n/255); }
  bool operator==(Color other) const { return r==other.r && g==other.g && b==other.b; }
  static const Color BLACK;
};
const Color Color::BLACK{};
struct Values {
  float get_red(){return .094f;}
  float get_green(){return .733f;}
  float get_blue(){return .949f;}
};
struct Ring {
  Values current_values;
  int stops=0;
  struct Call {
    Ring* ring;
    std::string effect;
    void set_effect(const char* value){effect=value;}
    void perform(){assert(effect=="None"); ++ring->stops;}
  };
  Call turn_off(){return {this,{}};}
} led_ring;
struct Reply { bool stopped=false; bool button_stop_latched(){return stopped;} } pv_reply;
struct Mute { bool state=false; } master_mute_switch;
struct VoiceKit { bool failed=false; bool is_failed(){return failed;} } voice_kit_component;
struct Controls {
  int calls=0;
  void execute(){++calls; assert(led_ring.stops==calls);}
} control_leds;
void frame(std::array<Color,12>& it, bool initial_run) { ANIMATION }
int main(){
  std::array<Color,12> pixels{};
  frame(pixels,true);
  const auto first=pixels;
  assert(first[0].b>first[0].r && first[0].g>first[0].r);
  assert(first[0]==first[6] && first[1]==Color::BLACK);
  frame(pixels,false);
  for(int i=0;i<12;++i) assert(pixels[(i+1)%12]==first[i]);
  // Re-selecting work starts a fresh rotation, with no inherited frame phase.
  frame(pixels,true);
  assert(pixels==first && control_leds.calls==0);
  // Firmware safety can win before or after the host sent its work command.
  // Stop the exposed partition's effect BEFORE the internal partition paints;
  // otherwise work could keep overwriting mute/error without a host connection.
  for(int condition=0;condition<3;++condition){
    pv_reply.stopped=condition==0;
    master_mute_switch.state=condition==1;
    voice_kit_component.failed=condition==2;
    pixels.fill(Color::BLACK);
    frame(pixels,true);
    frame(pixels,false);
    assert(control_leds.calls==2*(condition+1));
    for(auto pixel:pixels) assert(pixel==Color::BLACK);
    // Only the real owners clear these states; the effect never does.
    assert(pv_reply.stopped==(condition==0));
    assert(master_mute_switch.state==(condition==1));
    assert(voice_kit_component.failed==(condition==2));
  }
  pv_reply.stopped=false;
  master_mute_switch.state=false;
  voice_kit_component.failed=false;
  frame(pixels,true);
  assert(pixels==first);
}
""".replace("ANIMATION", animation)
    cpp = tmp_path / "live_work_led.cpp"
    cpp.write_text(source)
    binary = tmp_path / "live_work_led"
    subprocess.run([shutil.which("c++"), "-std=c++17", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
