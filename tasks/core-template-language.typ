#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Core: template reference language",
  status: done(2026, 9, 5),
)

== Summary
[[...]] syntax: \#N positions, \#N..\#M ranges, role keys, content patterns,
pickers (:text / :last-text), escapes. Pure + deterministic; errors abort
the whole expansion.
