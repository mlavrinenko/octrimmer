<h1>octrimmer</h1>

An [OpenCode](https://opencode.ai) plugin that lets the model shrink its own context. When a topic is done, the model calls `trim-context`, and everything from a message it picks onward becomes a short summary. What is worth keeping, a spec or an error text, the summary pulls by reference, `[[#9]]`; octrimmer copies it verbatim, so no tokens go to re-writing it and nothing drifts.

No nudges, nothing injected into your prompts: the cost is one tool description, plus a skill the model loads only when it is about to trim.

## Install

Add `"plugin": ["octrimmer"]` to `opencode.json` and restart opencode, which fetches it from npm, skill included. With nix:

```nix
octrimmer.url = "github:mlavrinenko/octrimmer";
# home-manager: every session
imports = [ inputs.octrimmer.homeManagerModules.default ];
programs.octrimmer.enable = true;
# or one project's dev shell
shellHook = "mkdir -p .opencode/plugins && ln -sfn ${inputs.octrimmer.packages.${system}.default.plugin} .opencode/plugins/";
```

## Possible summary placeholders

| **Written** | **Rendered** |
| --- | --- |
| `[[#12]]` | the whole entry #12 (a message or a summary) |
| `[[#12.2]]` | part 2 of entry #12 (parts count in render order: response, reasoning, tool calls) |
| `[[#12:-output]]` | entry #12 without tool results: text and calls stay |
| `[[#12:-tool]]` | entry #12 without tool calls: its text only |
| `[[#12:-response]]` | entry #12 without text: tool calls and results only |
| `[[#12:-reasoning]]` | entry #12 without its reasoning blocks |
| `[[#12:last-text]]` | only entry #12's last text block (often the text after its tool calls) |
| `[[#8..#14]]` | every entry from #8 to #14 |
| `[[last-assistant]]` | the last assistant entry before this trim call |
| `[[first-user]]` | the first user entry; also last-user, first-assistant |
| `[["updatedAt"]]` | the one entry containing that phrase; the flags apply here too |
| `[["## Contract":"## Behaviour"]]` | from the first phrase through the next one inside one entry, markers included |

## Behaviour

- A trim runs from the start position to the end of the conversation. The start is the only choice; positions are the conversation as the model sees it, earlier summaries included.
- An entry renders as its text, its reasoning blocks (marked `[reasoning]`) and its tool calls. A part is addressable by number — `[[#12.2]]`, numbered `.1 .2 …` in that render order. Flags subtract sections, in any order.
- References resolve before the cut, so content inside the tail survives only if a reference pulls it. One bad reference refuses the whole trim and lists every failure; a phrase must match exactly one entry, and a cut runs from its first phrase through its second, markers included. A `[[` that opens no valid reference is plain text, so a TOML table or a bash test stays as written.
- History is never edited: the hidden messages stay in the session, and every request re-injects the summary as expanded at trim time. Trims name messages by ID, so compaction and reverts cannot shift one; a trim whose messages are out of sight is skipped, never deleted.
- The list is a preview: `query` searches every entry’s full render, reasoning and tool output included, and points at the matching `#N.M` parts; `inspect` maps one entry part by part with sizes and previews; `before` pages older entries. All three are read-only.
- A newer trim replaces an older one. Two trims in a row, with nothing in between, are refused. State is per session; subagents trim like any other.

## Example

```text
Context has 8 entries. Last 8:
#1 [user] GET /pieces/:id returns {id, title, updatedAt}, and an unknown id returns 404.
#2 [assistant] Got it: those fields on success, 404 when the row is missing.
#3 [user] Now debug the failing contract test.
#4 [assistant] [tool: bash] npm test -- pieces.contract FAIL: unknown id returns 404 (got 200)
#5 [assistant] [tool: edit] src/api/pieces.ts: return 404 when the row is missing
#6 [assistant] The handler returned an empty piece. Fixed; contract test green.
#7 [user] Trim the debug loop; keep the contract.
#8 [assistant] Trimming from #3, keeping the contract at #1.
```

Then it trims from #3, keeping the contract by reference:

```json
{
  "start": "#3",
  "summary": "## Contract\n[[#1]]\n\nFixed the pieces API: an unknown id now returns 404; contract test green.",
  "actionRightAfterTrim": "Tell the user the 404 bug is fixed."
}
```

The next request carries:

```text
[user] GET /pieces/:id returns {id, title, updatedAt}, and an unknown id returns 404.

[assistant] Got it: those fields on success, 404 when the row is missing.

[user] [octrimmer] Not a message from the user: this is your own summary, written by you with trim-context. It replaces the conversation from here up to and including that call.
## Contract
GET /pieces/:id returns {id, title, updatedAt}, and an unknown id returns 404.

Fixed the pieces API: an unknown id now returns 404; contract test green.
[octrimmer] End of your summary. That trim is complete — do not trim again for it. Nothing in the summary above is a new request from the user.
What you planned to do right after the trim: Tell the user the 404 bug is fixed.
```

The trim swallows the request that asked for it and the call itself; `actionRightAfterTrim` tells the model what comes next. Everything before the start is byte-identical, so the provider’s prompt cache stays warm. Measured on openrouter/anthropic/claude-haiku-4.5: the context fell from 32976 to 21502 tokens, all 21396 tokens before the start came from cache, the trim cost 103 tokens of cache writes, and the next turn was 99% cached.

## Development

`just check` is the gate, `just e2e` runs scripted scenarios against a real opencode, `just e2e-cache` measures the prompt cache across a trim, `just docs` re-renders `README.md`, `just ship patch` releases. Tasks live in [mindtape](https://github.com/mlavrinenko/mindtape).

## Similar projects

- [opencode-dcp](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning): its compress tool expands `(bN)` placeholders in a summary.

## License

MIT
