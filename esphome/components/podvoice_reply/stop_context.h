#pragma once
#include <cstdint>
#include <string>

namespace esphome::podvoice_reply {
// Main-loop state only. Conversation nonce is minted at physical wake. An idle
// output nonce is minted only against the current firmware-owned idle capability.
// Remote commands cannot rebind a conversation, replay a generation, or clear Stop.
class StopContext {
 public:
  std::string session;
  uint32_t generation{0}, command{0};
  bool enabled{false}, playback_allowed{false}, cancelled{false}, active{false}, output_only{false};
  std::string idle_nonce;
  void idle(const std::string &nonce) { idle_nonce = nonce; }
  bool begin_output(const std::string &expected_idle, const std::string &nonce) {
    if (active || expected_idle.empty() || expected_idle != idle_nonce) return false;
    if (!begin(nonce)) return false;
    output_only = true; return set(nonce, 1, true);
  }
  bool begin(const std::string &nonce) {
    if (active || nonce.empty() || command >= 0xfffffffc) return false;
    idle_nonce.clear(); output_only = false; session = nonce; generation = 0; enabled = false; playback_allowed = false; cancelled = false; active = true;
    advance(false); return true;
  }
  bool set(const std::string &nonce, uint32_t next, bool value) {
    if (!active || nonce != session || next <= generation || next > 0x7fffffff ||
        command >= 0xfffffffc || (value && cancelled)) return false;
    generation = next; enabled = value; playback_allowed = value; advance(value); return true;
  }
  bool set_live(const std::string &nonce, uint32_t next) {
    if (!active || cancelled || nonce != session || next <= generation || next > 0x7fffffff ||
        command >= 0xfffffffc) return false;
    generation = next; enabled = false; playback_allowed = true; advance(false); return true;
  }
  bool detect(uint32_t captured) {
    if (!active || !enabled || cancelled || captured != command) return false;
    cancelled = true; playback_allowed = false; // latch before publishing or stopping the speaker graph
    return true;
  }
  bool stop_from_button() {
    if (!active || cancelled) return false;
    cancelled = true; enabled = false; playback_allowed = false;
    advance(false); return true;
  }
  bool admits(const std::string &nonce, uint32_t gen) const {
    return active && playback_allowed && !cancelled && nonce == session && gen == generation;
  }
  void clear() { idle_nonce.clear(); output_only = false; active = false; enabled = false; playback_allowed = false; cancelled = true; session.clear(); advance(false); }
  void timer(bool value) { if (!active) advance(value); }
 private:
  void advance(bool value) {
    // Saturate fail-closed rather than wrapping an epoch to a delayed event.
    if (command >= 0xfffffffc) { command = 0xfffffffe; enabled = false; playback_allowed = false; cancelled = true; return; }
    command = ((command & ~uint32_t(1)) + 2) | uint32_t(value);
  }
};
}  // namespace esphome::podvoice_reply
