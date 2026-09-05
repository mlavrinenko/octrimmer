#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Fix session-state clobbering and index-addressed spans",
  status: done(2026, 9, 5),
)

== Summary
Two silent-wrong-output defects found reviewing the package.

One mutable state slot served every session. `ensureSessionInitialized` reset
it and then awaited twice, so two turns in flight — two subagents, say — each
overwrote the other's records, and `saveSessionState` could write one session's
records into another's file. Now a map of in-flight loads keyed by session id.

Trim records stored raw array indices while only the anchor ID was checked for
staleness. Native compaction drops messages ahead of the anchor, the indices
shift, and the overlay covers a different stretch of the conversation with
nothing to show for it. Records now carry `startRawId` + `endRawId` and resolve
against the current list; persisted records from before this change fail
validation and are dropped, which restores untrimmed history rather than
corrupting it.

Also deleted the unreachable "already trimmed" branch in the trim tool: a
record's anchor is always covered, so it is never a visible message, so the
guard could not fire.
