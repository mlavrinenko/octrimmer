#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Verify: subagent cadence",
  status: proposed(2026, 9, 5),
)

== Summary
Confirm experimental.chat.messages.transform fires for subagent sessions on
the same cadence as primary. If not, subagent trims are no-ops (document).
allowSubAgents currently true by default.
