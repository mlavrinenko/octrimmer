// Source of README.md: `just docs` renders it with typlite, and `just check`
// fails when README.md differs from a fresh render. Everything the plugin can
// say for itself — the reference table, the list reply, the trim, what the
// model sees next — is read from docs/generated/facts.json, which
// docs/facts.ts writes by running the plugin. Prose that only restates
// behaviour sits in outdatty.yaml's `behaviour` group instead. Cache numbers
// need a real model, so `RECORD=1 just e2e-cache` writes docs/measured/.
//
// typlite: `=` renders as `##`, so the title is a literal <h1>; a `|` inside a
// table cell splits the row; never end a wrapped line on a hyphen.

#let facts = json("generated/facts.json")
#let cache = json("measured/cache.json")
#let sample(text) = raw(block: true, lang: "text", text)

#html.elem("h1")[octrimmer]

An #link("https://opencode.ai")[OpenCode] plugin that lets the model shrink its
own context. When a topic is done, the model calls `trim-context`, and
everything from a message it picks onward becomes a short summary. What is worth
keeping, a spec or an error text, the summary pulls by reference, `[[#9]]`;
octrimmer copies it verbatim, so no tokens go to re-writing it and nothing drifts.

No nudges, nothing injected into your prompts: the cost is one tool description,
plus a skill the model loads only when it is about to trim.

= Install

Add `"plugin": ["octrimmer"]` to `opencode.json` and restart opencode, which
fetches it from npm, skill included. With nix:

```nix
octrimmer.url = "github:mlavrinenko/octrimmer";
# home-manager: every session
imports = [ inputs.octrimmer.homeManagerModules.default ];
programs.octrimmer.enable = true;
# or one project's dev shell
shellHook = "mkdir -p .opencode/plugins && ln -sfn ${inputs.octrimmer.packages.${system}.default.plugin} .opencode/plugins/";
```

= Possible summary placeholders

#table(
  columns: 2,
  [*Written*], [*Rendered*],
  ..facts.syntax.map(row => (raw(row.at(0)), row.at(1))).flatten(),
)

= Behaviour

- A trim runs from the start position to the end of the conversation. The start
  is the only choice; positions are the conversation as the model sees it,
  earlier summaries included.
- An entry renders as its text, its reasoning blocks (marked `[reasoning]`) and
  its tool calls. A part is addressable by number — `[[#12.2]]`, numbered
  `.1 .2 …` in that render order. Flags subtract sections, in any order.
- References resolve before the cut, so content inside the tail survives only
  if a reference pulls it. One bad reference refuses the whole trim and lists
  every failure; a phrase must match exactly one entry, and a cut runs from its
  first phrase through its second, markers included. A `[[` that opens no valid
  reference is plain text, so a TOML table or a bash test stays as written.
- History is never edited: the hidden messages stay in the session, and every
  request re-injects the summary as expanded at trim time. Trims name messages
  by ID, so compaction and reverts cannot shift one; a trim whose messages are
  out of sight is skipped, never deleted.
- The list is a preview: `query` searches every entry's full render, reasoning
  and tool output included, and points at the matching `#N.M` parts; `inspect`
  maps one entry part by part with sizes and previews; `before` pages older
  entries. All three are read-only.
- A newer trim replaces an older one. Two trims in a row, with nothing in
  between, are refused. State is per session; subagents trim like any other.

= Example

#sample(facts.list)

Then it trims from #facts.call.start, keeping the contract by reference:

#raw(block: true, lang: "json", json.encode(facts.call))

The next request carries:

#sample(facts.seen.join("\n\n"))

The trim swallows the request that asked for it and the call itself;
`actionRightAfterTrim` tells the model what comes next. Everything before the
start is byte-identical, so the provider's prompt cache stays warm. Measured on #cache.model: the context fell from #cache.before to #cache.after
tokens, all #cache.keptRead tokens before the start came from cache, the trim
cost #cache.trimWrite tokens of cache writes, and the next turn was
#cache.nextCachedPct% cached.

= Development

`just check` is the gate, `just e2e` runs scripted scenarios against a real
opencode, `just e2e-cache` measures the prompt cache across a trim, `just docs`
re-renders `README.md`, `just ship patch` releases. Tasks live in
#link("https://github.com/mlavrinenko/mindtape")[mindtape].

= Similar projects

- #link("https://github.com/Opencode-DCP/opencode-dynamic-context-pruning")[opencode-dcp]: its compress tool expands `(bN)` placeholders in a summary.

= License

MIT
