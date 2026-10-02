#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Fix: a failed tool keeps its error text when referenced",
  status: proposed(2026, 10, 2),
)

== Summary
`lib/render.ts` renders a tool part from `state.output`, else `state.input` as
a string. opencode's `input` is always an object, so that branch never runs,
and a failed tool's `state.error` is dropped: a reference to a failed edit
loses exactly the error text the skill tells the model to keep. Render
`error`; drop the dead `input` branch.
