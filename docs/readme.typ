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

Manual context trimming for #link("https://opencode.ai")[OpenCode]. One tool,
`trim-context`, replaces the tail of a conversation with a summary the model
writes. The summary can copy earlier messages verbatim instead of retelling
them. No nudges, no automatic trims: beyond the tool's own description,
nothing reaches the context until the model trims.

= Why

A long session buries the one API contract that still matters under forty
messages of dead debug output, and heads for the context limit. A trim buys
back headroom and attention, not money: the tail it cuts was already cached,
and the summary replacing it is fresh input.

Compaction paraphrases everything. A reference is copied by the plugin byte for
byte. A paraphrase of a spec is not the spec. The model also spends no output
tokens rewriting what it pulls.

= Install

Not on npm yet. Build the bundle and copy it where opencode loads plugins; it
is self-contained.

```sh
just build
cp dist/index.js ~/.config/opencode/plugins/octrimmer.js  # every project
cp dist/index.js .opencode/plugins/octrimmer.js           # one project
```

Hide the tool from a project or an agent: set `"trim-context": "deny"` under
opencode's `permission`.

`skills/octrimmer/` is an optional skill for models that trim badly: where to
cut, what to keep, when not to trim. The syntax is already in the tool's own
description. Copy the directory to `~/.config/opencode/skills/`.

= A trim, end to end

Produced by running the plugin (`docs/facts.ts`). The model lists the
conversation first:

#sample(facts.list)

Then it trims from #facts.call.start, keeping the poem by reference:

#raw(block: true, lang: "json", json.encode(facts.call))

The next request carries:

#sample(facts.seen.join("\n\n"))

Everything before the start is byte-identical, so the provider's prompt cache
stays warm. The trim swallows the request that asked for it and the call
itself; `actionRightAfterTrim` tells the model what comes next.

= References

#table(
  columns: 2,
  [*You write*], [*You get*],
  ..facts.syntax.map(row => (raw(row.at(0)), row.at(1))).flatten(),
)

A phrase must match exactly one entry; otherwise the error lists the
candidates. `[[` followed by anything else is plain text, so a TOML table or a
bash test in a summary stays as written; write a literal `[[#` as `\[[#`.
One failing reference refuses the whole trim and reports every failure.

= Behaviour

- The region always runs from the start to the end of the conversation. The
  start is the only choice.
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

= Development

`just check` is the gate. `just e2e` drives a real opencode and model through
scripted scenarios; `scripts/e2e.sh` explains each. `just docs` renders this
file from `docs/readme.typ`; never edit README.md by hand. Tasks live in
`tasks/`, tracked with #link("https://github.com/mlavrinenko/mindtape")[mindtape].

Closest prior art:
#link("https://github.com/Opencode-DCP/opencode-dynamic-context-pruning")[opencode-dcp],
whose compress tool expands `(bN)` placeholders in a summary.

= License

MIT
