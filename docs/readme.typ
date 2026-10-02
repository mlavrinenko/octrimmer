// Source of README.md: `just docs` renders it with typlite, and `just check`
// fails when README.md differs from a fresh render. Everything the plugin can
// say for itself — the reference table, the list reply, the trim, what the
// model sees next — is read from docs/generated/facts.json, which
// docs/facts.ts writes by running the plugin. Prose that only restates
// behaviour sits in outdatty.yaml's `behaviour` group instead.
//
// typlite: `=` renders as `##`, so the title is a literal <h1>; a `|` inside a
// table cell splits the row; never end a wrapped line on a hyphen.

#let facts = json("generated/facts.json")
#let sample(text) = raw(block: true, lang: "text", text)

#html.elem("h1")[octrimmer]

An #link("https://opencode.ai")[OpenCode] plugin that brings a `trim-context`
tool to your agents. It lets them replace the last N messages with a summary,
and that summary can carry placeholders that refer to earlier context, so the
agent does not generate useless tokens for what can just be copied.

Octrimmer aims to stay lightweight: it has no nudges and adds nothing extra to
the context, except one tool description and one skill. Even that skill loads
right before a trim and is forgotten until a new trim is needed.

= Possible summary placeholders

#table(
  columns: 2,
  [*Written*], [*Rendered*],
  ..facts.syntax.map(row => (raw(row.at(0)), row.at(1))).flatten(),
)

= Behaviour

- A phrase must match exactly one entry; otherwise the error lists the
  candidates.
- One failing reference refuses the whole trim and reports every failure.
- The agent picks only a starting position; the trim always ends at the last
  message.
- Raw history is never modified. A trim is a record re-applied on every
  request, and messages after it are kept.
- Positions are the conversation as the model sees it: earlier summaries
  included, and after native compaction too.
- Records name messages by ID, so compaction and reverts cannot shift a trim
  onto other messages. A record whose messages are out of sight is skipped,
  never deleted.
- A trim starting before an earlier one replaces it. A trim right after
  another, with no user message or tool work in between, is refused.
- Subagent sessions trim like any other; state is per session.
- `[[` followed by anything else is plain text, so a TOML table or a bash test
  in a summary stays as written.

= Example

#sample(facts.list)

Then it trims from #facts.call.start, keeping the contract by reference:

#raw(block: true, lang: "json", json.encode(facts.call))

The next request carries:

#sample(facts.seen.join("\n\n"))

Everything before the start is byte-identical, so the provider's prompt cache
stays warm. The trim swallows the request that asked for it and the call
itself; `actionRightAfterTrim` tells the model what comes next.

= Development

- #link("https://github.com/mlavrinenko/mindtape")[mindtape] for local task tracking.
- `just check` to find issues.
- `just e2e` to test it with an opencode instance through scripted scenarios.
- `just docs` to re-render `README.md`.

= Similar projects

- #link("https://github.com/Opencode-DCP/opencode-dynamic-context-pruning")[opencode-dcp]: its compress tool expands `(bN)` placeholders in a summary.

= License

MIT
