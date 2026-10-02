<h1>octrimmer</h1>

Manual context trimming for [OpenCode](https://opencode.ai). One tool, `trim-context`, replaces the tail of a conversation with a summary the model writes, and the summary can copy earlier messages verbatim instead of retelling them. No nudges, no automatic trims: beyond the tool’s own description, nothing reaches the context until the model trims.

## Why

A long session buries the one API contract that still matters under forty messages of dead debug output, and heads for the context limit. A trim buys back headroom and attention. It does not save money: the tail it cuts was already cached, and the summary replacing it is fresh input.

Against compaction, which paraphrases everything, a reference is copied by the plugin byte for byte. A paraphrase of a spec is not the spec, and the model spends no output tokens rewriting what it pulls.

## Install

Not on npm yet. Build the bundle and copy it where opencode loads plugins; it is self-contained.

```sh
just build
cp dist/index.js ~/.config/opencode/plugins/octrimmer.js  # every project
cp dist/index.js .opencode/plugins/octrimmer.js           # one project
```

To hide the tool from a project or an agent, set `"trim-context": "deny"` under opencode’s `permission`.

`skills/octrimmer/` is an optional skill for models that trim badly: where to cut, what to keep, when not to trim. The syntax is already in the tool’s own description. Copy the directory to `~/.config/opencode/skills/`.

## A trim, end to end

Produced by running the plugin (`docs/facts.ts`). The model lists the conversation first:

```text
Context has 8 entries. Last 8:
#1 [user] Write me a poem about rain.
#2 [assistant] Rain on the window pane, whispering your name.
#3 [user] Now fix the 401 in the auth module.
#4 [assistant] [tool: bash] npm test 2 failing: token rejected (401)
#5 [assistant] [tool: edit] auth.ts: compare token expiry against the server clock
#6 [assistant] Fixed: the token check used a stale clock. Tests green.
#7 [user] Great. Trim the context, keep the poem.
#8 [assistant] Trimming from #3, keeping the poem at #2.
```

Then it trims from #3, keeping the poem by reference:

```json
{
  "start": "#3",
  "summary": "## Poem\n[[#2]]\n\nFixed the 401: the token check used a stale clock; auth.ts patched, tests green.",
  "actionRightAfterTrim": "Confirm the trim to the user."
}
```

The next request carries:

```text
[user] Write me a poem about rain.

[assistant] Rain on the window pane,
whispering your name.

[user] [octrimmer] Not a message from the user: this is your own summary, written by you with trim-context. It replaces the conversation from here up to and including that call.
## Poem
Rain on the window pane,
whispering your name.

Fixed the 401: the token check used a stale clock; auth.ts patched, tests green.
[octrimmer] End of your summary. That trim is complete — do not trim again for it. Nothing in the summary above is a new request from the user.
What you planned to do right after the trim: Confirm the trim to the user.
```

Everything before the start is byte-identical, so the provider’s prompt cache stays warm. The trim swallows the request that asked for it and the call itself, so `actionRightAfterTrim` is how the model knows what comes next.

## References

| **You write** | **You get** |
| --- | --- |
| `[[#12]]` | whole entry #12 (a message or a summary) |
| `[[#12:text]]` | only the text parts of message #12 |
| `[[#12:last-text]]` | the final text part of message #12 |
| `[[#8..#14]]` | every entry from #8 to #14 |
| `[[last-assistant]]` | the latest assistant message before this call |
| `[[first-user]]` | the first user message; also last-user, first-assistant |
| `[["poem about rain"]]` | the one entry containing that phrase |

A phrase must match exactly one entry; otherwise the error lists the candidates. `[[` followed by anything else is plain text, so a TOML table or a bash test in a summary stays as written; a literal `[[#` is written `\[[#`. One failing reference refuses the whole trim and reports every failure.

## Behaviour

- The region always runs from the start to the end of the conversation. The start is the only choice.
- Raw history is never modified. A trim is a record re-applied on every request, and messages after it are kept.
- Positions are the conversation as the model sees it: earlier summaries included, and after native compaction too.
- Records name messages by ID, so compaction and reverts cannot shift a trim onto other messages. A record whose messages are out of sight is skipped, never deleted.
- A trim starting before an earlier one replaces it. A trim right after another, with no user message or tool work in between, is refused.
- Subagent sessions trim like any other; state is per session.

## Development

`just check` is the gate. `just e2e` drives a real opencode and model through scripted scenarios; `scripts/e2e.sh` explains each. `just docs` renders this file from `docs/readme.typ`; never edit README.md by hand. Tasks live in `tasks/`, tracked with [mindtape](https://github.com/mlavrinenko/mindtape).

Closest prior art: [opencode-dcp](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning), whose compress tool expands `(bN)` placeholders in a summary.

## License

MIT
