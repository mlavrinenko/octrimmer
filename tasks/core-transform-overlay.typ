#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Core: transform overlay",
  status: done(2026, 9, 5),
)

== Summary
experimental.chat.messages.transform re-applies every record per fetch:
synthetic summary at each start position, covered region skipped, new
messages kept. Idempotent; invalidates records whose anchor vanished.
