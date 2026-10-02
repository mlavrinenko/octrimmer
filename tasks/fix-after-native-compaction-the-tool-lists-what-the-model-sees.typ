#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Fix: after native compaction the tool lists what the model sees",
  status: done(2026, 10, 2),
)

== Summary
The tool reads `client.session.messages` — the whole history in order. The
model sees `MessageV2.filterCompacted` output: pre-compaction messages dropped,
the retained tail moved after the compaction summary. After any compaction the
ref list shows messages the model does not have, positions disagree, and a
start picked before the compaction point writes a record the transform never
applies, while the tool reports the trim done.

Fix: the transform remembers the list it last handed the model for each
session; the tool addresses that list, plus the messages after it in the raw
history (the in-progress turn, so the trim still swallows its own call).
