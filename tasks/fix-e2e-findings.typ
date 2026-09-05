#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Fix E2E findings: self-contained dist, visible-space addressing, cover-replace",
  status: wip(2026, 9, 5),
)

== Summary

Live E2E (opencode/mimo-v2.5-free) proved the core (poem pulled byte-for-byte,
cache warm, raw store untouched) and exposed four bugs:

1. Local plugin-dir install hangs silently unless deps resolve — bundle
   @opencode-ai/plugin + zod into dist.
2. Re-trims at the same start stack summaries instead of replacing.
3. No duplicate-region no-op, so a weak model looped 48x re-trimming.
4. Ref map shows raw session positions while the model perceives the trimmed
   context — positions mismatch, model chased its own tool calls.

Fix: tsup noExternal; visible-space addressing (ref map / refs / start all
resolve against the transform overlay, summary entries included); cover-replace
(drop records the new trim fully covers); duplicate-region no-op reply.