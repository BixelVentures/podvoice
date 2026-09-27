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
factory_reset_requested=true;
clock_ms=4300;press();clock_ms=4400;assert(!release());
}
""".replace("PRESS", press).replace("RELEASE", release)
    cpp = tmp_path / "button.cpp"
    cpp.write_text(source)
    binary = tmp_path / "button"
    subprocess.run([shutil.which("c++"), "-std=c++17", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
