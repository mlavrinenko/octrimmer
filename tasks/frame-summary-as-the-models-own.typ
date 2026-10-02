#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Frame the summary as the model's own and rename next to actionRightAfterTrim",
  status: done(2026, 10, 2),
)

== Summary
Measured in `tasks/refuse-a-trim-when-nothing-happened-since-the-last-one.typ`:
4 runs in 8 redid the first turn, and every one had written a `next` like
"wait for the user's next request". The model acts right after the trim
anyway, finds the user-role summary where that request should be, and answers
it. Runs whose `next` was an immediate action ("confirm the trim") stayed clean.

- The summary opens with a header: not a message from the user, but the
  model's own summary written with trim-context. The role stays `user` — an
  assistant message at the tail reads as a prefill, which some providers
  reject.
- The closing note adds that nothing in the summary is a new request.
- `next` becomes `actionRightAfterTrim`, described as what the model does
  immediately — never "wait for the user", since it keeps going first.

Re-measure: scenario 4, 8 runs.

== Measured
Scenario 4, 8 runs, space-bunny-free: 7 confirmed the trim, 1 redid the first
turn, 0 re-trims (was 4 redone with `next`). Every action now opens with
"Confirm the trim…"; the one that redid the work still ended "…and wait for
their next request". Full `just e2e` 9/9.
