"""Execute the shipped selector, including model isolation and rollback."""

import shutil
import subprocess
import textwrap
from pathlib import Path


def test_actual_firmware_selector_changes_chat_and_preserves_other_models(tmp_path):
    root = Path(__file__).parents[2]
    base = (root / "esphome/voice-pe-podvoice-base.yaml").read_text()
    selector = base.split('name: "Wake word sensitivity"', 1)[1].split("\nvoice_assistant:", 1)[0]
    assert "restore_value: true" in selector
    assert "initial_option: Slightly sensitive" in selector
    body = textwrap.dedent(selector.split("lambda: |-\n", 1)[1])
    source = tmp_path / "selector.cpp"
    source.write_text(
        """
#include <cassert>
#include <cstdint>
#include <string>
struct Model {
  uint8_t cutoff = 123;
  void set_probability_cutoff(uint8_t value) { cutoff = value; }
  uint8_t get_probability_cutoff() const { return cutoff; }
};
Model okay_nabu, hey_jarvis, hey_mycroft, hey_chat, stop;
#define id(name) name
#define ESP_LOGI(...) ((void)0)
void select(const std::string &x) {
"""
        + body
        + """
}
void expect(unsigned nabu, unsigned jarvis, unsigned mycroft, unsigned chat) {
  assert(okay_nabu.cutoff == nabu);
  assert(hey_jarvis.cutoff == jarvis);
  assert(hey_mycroft.cutoff == mycroft);
  assert(hey_chat.cutoff == chat);
  assert(stop.cutoff == 123);
}
int main() {
  select("Slightly sensitive"); expect(217, 247, 253, 242);
  select("Moderately sensitive"); expect(176, 235, 242, 230);
  select("Very sensitive"); expect(143, 212, 237, 217);
  select("unknown"); expect(143, 212, 237, 217);
  select("Slightly sensitive"); expect(217, 247, 253, 242);
  select("Moderately sensitive"); expect(176, 235, 242, 230);
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
