#pragma once
#include <cstdint>
#include <string>

namespace esphome::podvoice_reply {
// Main-loop state only. Nonce is minted by firmware at physical wake. Remote
// commands cannot create/rebind a session, replay a generation, or clear Stop.
class StopContext {
 public:
  std::string session;
  uint32_t generation{0}, command{0};
  bool enabled{false}, cancelled{false}, active{false};
  bool begin(const std::string &nonce) {
    if (active || nonce.empty() || command >= 0xfffffffc) return false;
    session = nonce; generation = 0; enabled = false; cancelled = false; active = true;
    advance(false); return true;
  }
  bool set(const std::string &nonce, uint32_t next, bool value) {
    if (!active || nonce != session || next <= generation || next > 0x7fffffff ||
        command >= 0xfffffffc || (value && cancelled)) return false;
    generation = next; enabled = value; advance(value); return true;
  }
  bool detect(uint32_t captured) {
    if (!active || !enabled || cancelled || captured != command) return false;
    cancelled = true; // latch before publishing or stopping the speaker graph
    return true;
  }
  bool admits(const std::string &nonce, uint32_t gen) const {
    return active && enabled && !cancelled && nonce == session && gen == generation;
  }
  void clear() { active = false; enabled = false; cancelled = true; session.clear(); advance(false); }
  void timer(bool value) { if (!active) advance(value); }
 private:
  void advance(bool value) {
    // Saturate fail-closed rather than wrapping an epoch to a delayed event.
    if (command >= 0xfffffffc) { command = 0xfffffffe; enabled = false; cancelled = true; return; }
    command = ((command & ~uint32_t(1)) + 2) | uint32_t(value);
  }
};
}  // namespace esphome::podvoice_reply
