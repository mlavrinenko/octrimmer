#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "E2E: reproducible just recipe with a scorecard",
  status: done(2026, 9, 5),
)

== Summary
The E2E lived in the README as a copy-paste recipe with hardcoded home paths,
manual verification, and no way to tell a plugin failure from a model that
wandered off. `just e2e` replaces it: sandboxed config and data homes so only
the bundle under test loads, assertions machine-checked, statistics printed for
the human, and per-scenario retries so small-model noise reads as a retry count
instead of a red gate.

Assertions cover what the plugin owes: registration, a persisted record with
ID-addressed spans, no two records on one anchor, verbatim survival of anything
a reference pulled, and the loop shield. Model behaviour — how many trims, and
whether it reached for a reference at all — is a statistic.

shellcheck joined `just check` at the same time, since the repo now carries
shell.
