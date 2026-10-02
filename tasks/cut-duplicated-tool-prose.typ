#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Cut duplicated tool prose",
  status: done(2026, 10, 2),
)

== Summary
`start` and `actionRightAfterTrim` are explained twice — in the tool
description and in each argument's `describe` — and both ship on every
request. Each fact once: what an argument means lives in its `describe`, the
description carries the model of the tool and the reference syntax.
