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
  assert(context.set_live("session-B", 2));
  assert(!context.enabled && context.playback_allowed && !(context.command & 1));
  assert(context.admits("session-B", 2));
  assert(!context.detect(context.command));
  assert(!context.set_live("session-A", 3));
  assert(!context.set_live("session-B", 2));
  assert(context.set("session-B", 3, false));
  assert(!context.enabled && !context.playback_allowed);
  assert(!context.admits("session-B", 3));
  assert(context.set_live("session-B", 4));
  context.cancelled = true; // fail-closed owner after device fault
  assert(!context.set_live("session-B", 5));
  assert(!context.admits("session-B", 4));
  assert(context.set("session-B", 5, false));
  context.clear();
  assert(!context.playback_allowed);
  assert(context.begin("session-C"));
  assert(context.set_live("session-C", 1));
  assert(context.set("session-C", 2, false));
  assert(!context.set_live("session-C", 1)); // old pending admission cannot cross close generation
  assert(!context.admits("session-C", 2));
  assert(context.set_live("session-C", 3)); // controlled provider rotation preserves firmware context
  context.clear(); assert(context.begin("session-D"));
  assert(context.set("session-D", 1, true));
  assert(context.set("session-D", 2, false));
  assert(context.set("session-D", 3, true)); // OFF rearm remains unchanged
}
