#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Fork a worktree with its envrc allowed",
  status: done(2026, 10, 2),
)

== Summary
Every worktree is a new path, so direnv has not approved its `.envrc`, the dev
shell never loads there, and agents reach for `nix develop -c` instead.
`just fork SLUG [BASE]` creates the branch and worktree under the ignored
`.worktree/`, allows that `.envrc`, and loads the shell once.
