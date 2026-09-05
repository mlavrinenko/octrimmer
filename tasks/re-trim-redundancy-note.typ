#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Re-trim redundancy note + file-based install docs",
  status: done(2026, 9, 5),
)

== Summary
E2E-2 (post-fix) confirmed a weak model can still chain re-trims by
escalating to fresh tail starts; the exact-no-op is structurally unreachable
(no visible real message can sit inside a covered region), so the honest
move is to inform, not block. The trim reply now notes when an earlier
summary precedes the new start ("earlier content was already summarized at
#K; this trim covers only the messages after it").

Also corrected the local-install story: opencode 1.18+ loads plugins as
files (.opencode/plugins/octrimmer.js), not directories — README updated,
and the self-contained dist means no node_modules is needed.