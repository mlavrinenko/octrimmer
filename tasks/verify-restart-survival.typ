#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Verify: restart survival",
  status: done(2026, 9, 5),
)

== Summary
Persisted records re-load on a new opencode process (storage/plugin/
octrimmer). Confirm a trim still applies after restart + new messages.
