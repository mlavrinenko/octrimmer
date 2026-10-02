#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Fix: native compaction must not delete live trims",
  status: done(2026, 10, 2),
)

== Summary
opencode runs `experimental.chat.messages.transform` from compaction on the
head only (`session/compaction.ts`, `selected.head`), without the retained
tail. A trim's end anchor is the last message at trim time, so it sits in that
tail and does not resolve; `lib/transform.ts` then prunes the record and saves
the removal. The trim is gone after the next compaction.

Fix by cutting: the transform never prunes or saves. `resolveSpans` already
skips a record that does not resolve, so pruning only loses data.
