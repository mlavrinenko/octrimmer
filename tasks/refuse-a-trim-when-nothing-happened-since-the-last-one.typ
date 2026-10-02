#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Refuse a trim when nothing happened since the last one",
  status: done(2026, 10, 2),
)

== Summary
`next` cut post-trim confusion to zero but not re-trims: 1 run in 8 saw "That
trim is complete", then trimmed again from \#1 to cut further back — legal by
cover-replace. Reverses the inform-not-block call in
`tasks/re-trim-redundancy-note.typ`: that note informs after the fact, and the
model does not take the hint.

Refuse a trim when nothing has happened since the newest record's end: no user
message and no tool call other than `trim-context`. Text alone is not progress
— "trim complete" followed by another trim is the loop itself. The refusal
repeats the record's `next`.

== Measured
Scenario 4, 8 runs, space-bunny-free: 0 re-trims, none even attempted, so the
guard never fired; full `just e2e` 9/9. The 4 runs that redid the first turn
all wrote a `next` like "wait for the user's next request" — the model acts
right after the trim regardless, finds the user-role summary, and answers it.
