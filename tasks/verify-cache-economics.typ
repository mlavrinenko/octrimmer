#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Verify: cache economics",
  status: proposed(2026, 9, 5),
)

== Summary
Measure prompt-cache behavior: prefix before start stays warm; baked tail
re-sent. Compare against no-trim. Record numbers in README.
