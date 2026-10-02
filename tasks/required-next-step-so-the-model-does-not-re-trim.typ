#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Required next step so the model does not re-trim",
  status: done(2026, 10, 2),
)

== Summary
Reported: asked to trim, the model trimmed, then immediately trimmed again.

Cause: a region always runs to the end of the conversation, so it covers the
user's "trim" request, the `trim-context` call and the tool's own reply. The
next step sees a `user`-role summary as the last message and no trace that a
trim happened; a summary mentioning the request reads as a fresh one. The
refusal and redundancy note only act after the second call.

Fix: a required `next` argument — what to do right after the trim. Stored on
the record, not baked into the summary (so `[[\#K]]` copies stay clean), and
rendered by the transform as a harness-authored footer: the trim is complete,
do not trim again for it, then the model's next step.

== Measured
Scenario 4, 8 runs per build, space-bunny-free. Pre-fix: 2 re-trims (one run
trimmed 4 times), 4 runs lost track and redid or second-guessed the first turn,
2 clean. With `next`: 1 re-trim (trimmed from \#3, then again from \#1 to cut
further back), 0 lost track, every run confirmed the trim.
