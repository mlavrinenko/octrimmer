#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Core: trim-context tool",
  status: done(2026, 9, 5),
)

== Summary
Single tool. List mode (ref map) when start omitted; trim mode otherwise.
Expands references at execute time, writes a TrimRecord, returns a report.
Tool description carries the full syntax (no injection).
