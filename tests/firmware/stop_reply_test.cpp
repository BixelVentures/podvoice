#include "reply_state.h"
#include <cassert>
using esphome::podvoice_reply::ReplyState;
int main() {
  ReplyState s;
  assert(!s.cancel("empty", true));
  assert(s.play("A"));
  assert(!s.play("A"));
  assert(!s.cancel("A", true)); // thinking / pending is not a local stop
  s.phase = ReplyState::PLAYING;
  assert(s.cancel("A", true));
  assert(s.word && s.blocked);
  assert(!s.play("B")); // already sent late URL after spoken stop
  assert(!s.finish("A", false)); // stop dominates ordinary finish
  assert(!s.finish("old", true));
  assert(s.finish("A", true));
  assert(s.cancel("A", false)); // idempotent remote retry preserves word cause
  assert(s.word && s.phase == ReplyState::STOPPED);
  s.reset(); assert(s.play("B"));
  assert(!s.cancel("A", false)); // old callback after next wake
  s.phase = ReplyState::DRAINING;
  assert(s.cancel("B", true)); // stop throughout tail
  assert(s.finish("B", true));
  s.reset(); assert(s.cancel("cleanup", false)); // no-playback teardown
  assert(s.finish("cleanup", true));
}
