#include "stop_context.h"
#include <cassert>
using esphome::podvoice_reply::StopContext;
int main() {
  StopContext context;
  assert(context.begin("session-A"));
  assert(!context.admits("session-A", 0));
  assert(context.set("session-A", 1, true));
  uint32_t delayed = context.command;
  assert(context.admits("session-A", 1));
  assert(!context.set("session-B", 2, true));
  assert(!context.set("session-A", 1, false));
  assert(context.set("session-A", 2, false));
  assert(!context.detect(delayed));
  assert(context.set("session-A", 3, true));
  assert(context.detect(context.command));
  assert(!context.detect(context.command));
  assert(!context.admits("session-A", 3)); // thinking Stop blocks future play
  assert(!context.set("session-A", 4, true));
  assert(context.set("session-A", 4, false)); // teardown still allowed
  context.clear();
  assert(context.begin("session-B"));
  assert(!context.set("session-A", 5, true));
  assert(context.set("session-B", 1, true));
  assert(!context.detect(delayed));
  assert(context.admits("session-B", 1));
}
