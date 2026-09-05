#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Gate green (just check)",
  status: done(2026, 9, 5),
)

== Summary
Run `just check`: prettier, oxlint, tsc --noEmit, vitest, jscpd -k 50,
mt check. Fix findings.
