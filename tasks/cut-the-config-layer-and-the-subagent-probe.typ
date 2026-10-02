#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Cut the config layer and the subagent probe",
  status: proposed(2026, 10, 2),
)

== Summary
Every value in `lib/config.ts` is a constant. `enabled` guards a branch that
cannot run; `allowSubAgents` is always true yet costs a `session.get` per
session load; the `config` hook overwrites the user's own
`permission["trim-context"]` with `allow`, though opencode already lets a user
set any tool key. Cut the file, the hook and the subagent probe; the ref-map
size becomes a constant where it is used.
