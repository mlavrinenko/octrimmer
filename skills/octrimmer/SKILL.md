---
name: octrimmer
description: >-
    Where to cut a session's context with `trim-context`, what to keep verbatim,
    what to leave alone. Load when context is tight, or a topic just finished
    with heavy (and now useless) tool output behind it.
---

## Procedure

1. Call `trim-context` with no arguments. Positions come from that list, never
   guessed. If the topic is not there, `query` it; `inspect` when a pull might
   be bigger than it is worth.
2. `start` = the first message of the finished topic. The region always runs to
   the end of the conversation, so the cut point is the only choice.
3. Say what you drop and what you keep before the call ("trim from #14, keeping
   the API contract at #9"). A trim changes what you can see next; it is not a
   silent optimization.
4. Write the summary: references for artifacts, prose for the rest.
5. Write `actionRightAfterTrim`: what you do the moment the trim lands —
   confirm it, answer, or take the next step. Never "wait for the user": you
   keep going first, and with nothing to do you will read your own summary as
   their request.

```
start:   "#14"
summary: "## API contract (verbatim)\n[[#9]]\n\n[[#11:-output]]\n\nFixed the
          401: clock skew in the token check."
actionRightAfterTrim: "Tell the user the 401 is fixed; ask whether to ship."
```

## Keep by reference

Anything you would otherwise re-derive or re-read: a spec, an API contract, a
decision and its reason, exact error text you are still chasing, content the
user asked you to hold. `[[#N]]` copies it byte-for-byte — no tokens spent
regenerating, no paraphrase drift. `[[#N:-output]]` keeps a call without its
result when only the fact it ran matters; `[[#N:-reasoning]]` drops its
reasoning blocks, and `[[#N.M]]` pulls one part (parts count in render order:
response, reasoning, tool calls).

Let go in prose: tool output, debug loops, search results, superseded drafts,
anything already written to a file.

## Do not trim

- Over work in progress, or just before you answer. The region reaches the end
  of the conversation, so a cut above live work takes the material you were
  about to reply with. Trim between tasks, not inside one; a subagent's final
  message is the deliverable, so trim before you build it or not at all.
- A short session — nothing to reclaim.
- Twice for the same ground. A summary closing with "That trim is complete" is
  the trim you just made: do its `actionRightAfterTrim`, not another trim; one
  with nothing in between is refused anyway. A reply saying earlier content was
  already summarized means the same. Trim again once the conversation has
  grown.

## This file is inside the cut

The region always ends at the end of the conversation, so it covers the message
that loaded these instructions. Reloading them afterwards is waste:
`trim-context`'s own description still carries the syntax, and judgment is what
this file adds.
