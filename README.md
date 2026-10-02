<h1>octrimmer</h1>

An [OpenCode](https://opencode.ai) plugin that brings a `trim-context` tool to your agents. It lets them replace the last N messages with a summary, and that summary can carry placeholders that refer to earlier context, so the agent does not generate useless tokens for what can just be copied.

Octrimmer aims to stay lightweight: it has no nudges and adds nothing extra to the context, except one tool description and one skill. Even that skill loads right before a trim and is forgotten until a new trim is needed.

## Possible summary placeholders

| **Written** | **Rendered** |
| --- | --- |
| `[[#12]]` | the whole entry #12 (a message or a summary) |
| `[[#12:-output]]` | entry #12 without tool results: text and calls stay |
| `[[#12:-tool]]` | entry #12 without tool calls: its text only |
| `[[#12:-response]]` | entry #12 without text: tool calls and results only |
| `[[#12:last-text]]` | only entry #12's last text block (often the text after its tool calls) |
| `[[#8..#14]]` | every entry from #8 to #14 |
| `[[last-assistant]]` | the last assistant entry before this trim call |
| `[[first-user]]` | the first user entry; also last-user, first-assistant |
| `[["updatedAt"]]` | the one entry containing that phrase; the flags apply here too |
| `[["## Contract":"## Behaviour"]]` | the text between those two phrases inside one entry |

## Behaviour

- A trim runs from the start position to the end of the conversation. The start is the only choice; positions are the conversation as the model sees it, earlier summaries included.
- References resolve before the cut, so content inside the tail survives only if a reference pulls it. One bad reference refuses the whole trim and lists every failure; a phrase must match exactly one entry, and a cut’s two phrases must sit in the same entry.
- History is never modified: the trim is re-applied on every request, and the messages it hides stay in the session.
- Entries are named by ID, so compaction and reverts cannot move a trim onto other messages. A record whose messages are out of sight is skipped, never deleted.
- A newer trim replaces an older one. Two trims in a row, with nothing in between, are refused.
- State is per session; subagents trim like any other session.
- `[[` that does not open a valid reference is plain text, so a TOML table or a bash test in a summary stays as written.

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

Everything before the start is byte-identical, so the provider’s prompt cache stays warm. The trim swallows the request that asked for it and the call itself; `actionRightAfterTrim` tells the model what comes next.

## Development

- [mindtape](https://github.com/mlavrinenko/mindtape) for local task tracking.
- `just check` to find issues.
- `just e2e` to test it with an opencode instance through scripted scenarios.
- `just docs` to re-render `README.md`.

## Similar projects

- [opencode-dcp](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning): its compress tool expands `(bN)` placeholders in a summary.

## License

MIT
