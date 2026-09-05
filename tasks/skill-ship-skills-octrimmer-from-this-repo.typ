#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Skill: ship skills/octrimmer from this repo",
  status: done(2026, 9, 5),
)

== Summary
The skill lived in the nix config, duplicating the tool description almost
line for line and costing Claude Code catalog space for a tool only opencode
has. It ships from here instead, and carries only what the tool description
cannot: where to cut, what to keep verbatim, what never to trim.

Every trim covers the message that loaded the skill, so the skill is written
to be read once — the durable syntax lives in the tool description.
