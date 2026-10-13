#pragma once
#include <string>
#include <cstdint>

namespace esphome::podvoice_reply {
// One owner shared by native actions, local detection and the firmware loop.
class ReplyState {
 public:
  enum Phase { IDLE, REQUESTED, PLAYING, DRAINING, STOPPING, FINISHED, STOPPED, FAULT };
  std::string token;
  Phase phase{IDLE};
  bool blocked{false};
  bool word{false};
  bool play(const std::string &next) {
    if (blocked || next.empty() || next == token || (phase != IDLE && phase != FINISHED && phase != STOPPED)) return false;
    token = next; phase = REQUESTED; word = false; return true;
  }
  bool cancel(const std::string &target, bool by_word) {
    if (by_word && phase != PLAYING && phase != DRAINING) return false;
    if (!token.empty() && target != token) return false;
    if (token.empty()) token = target;
    word = word || by_word; blocked = word;
    if (phase != STOPPED) phase = STOPPING;
    return true;
  }
  bool finish(const std::string &target, bool stopped) {
    if (target != token || phase != (stopped ? STOPPING : DRAINING)) return false;
    phase = stopped ? STOPPED : FINISHED; return true;
  }
  bool detecting() const { return phase == PLAYING || phase == DRAINING; }
  void reset() { token.clear(); phase = IDLE; blocked = false; word = false; }
};
}  // namespace esphome::podvoice_reply
