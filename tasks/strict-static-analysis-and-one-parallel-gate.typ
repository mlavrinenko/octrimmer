#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "Strict static analysis and one parallel gate",
  status: proposed(2026, 10, 2),
)

== Summary
Nothing caught an unused runtime dependency (`@opencode-ai/sdk`), dead class
members (`Logger.info`, `debug`, `error`) or persisted fields nobody reads
(`TrimRecord.refs`, `originMessageId`, `lastUpdated`). Add knip (unused files,
exports, members, dependencies), the strict `tsc` flags, and oxlint's stricter
categories; fix every finding by cutting. Write-only fields stay a review
matter — no tool sees them.

One gate: `just check`, with `[parallel]`. `npm run check` and its
`format:check`/`lint`/`typecheck`/`test` wrappers go; so do the d.ts build and
the `types` export nobody imports.
