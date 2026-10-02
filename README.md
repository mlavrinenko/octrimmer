<h1>octrimmer</h1>

An [OpenCode](https://opencode.ai) plugin that brings a `trim-context` tool to your agents. It lets them replace the last N messages with a summary, and that summary can carry placeholders that refer to earlier context, so the agent does not generate useless tokens for what can just be copied.

Octrimmer aims to stay lightweight: it has no nudges and adds nothing extra to the context, except one tool description and one skill. Even that skill loads right before a trim and is forgotten until a new trim is needed.

## Possible summary placeholders

| **Written** | **Rendered** |
| --- | --- |
| `[[#12]]` | whole entry #12 (a message or a summary) |
| `[[#12:text]]` | only the text parts of message #12 |
| `[[#12:last-text]]` | the final text part of message #12 |
| `[[#8..#14]]` | every entry from #8 to #14 |
| `[[last-assistant]]` | the latest assistant message before this call |
| `[[first-user]]` | the first user message; also last-user, first-assistant |
| `[["updatedAt"]]` | the one entry containing that phrase |

## Behaviour

- A phrase must match exactly one entry; otherwise the error lists the candidates.
- One failing reference refuses the whole trim and reports every failure.
- The agent picks only a starting position; the trim always ends at the last message.
- Raw history is never modified. A trim is a record re-applied on every request, and messages after it are kept.
- Positions are the conversation as the model sees it: earlier summaries included, and after native compaction too.
- Records name messages by ID, so compaction and reverts cannot shift a trim onto other messages. A record whose messages are out of sight is skipped, never deleted.
- A trim starting before an earlier one replaces it. A trim right after another, with no user message or tool work in between, is refused.
- Subagent sessions trim like any other; state is per session.
- `[[` followed by anything else is plain text, so a TOML table or a bash test in a summary stays as written.

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
