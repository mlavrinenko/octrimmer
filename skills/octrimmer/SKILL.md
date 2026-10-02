---
name: octrimmer
description: >-
    Where to cut a session's context with `trim-context`, what to keep verbatim,
    what to leave alone. Load when context is tight, or a topic just finished
    with heavy tool output behind it.
---

## Procedure

1. Call `trim-context` with no arguments. Positions come from that list — never
   guess them.
2. `start` = the first message of the finished topic. The region always runs
   from `start` to the end of the conversation, so the cut point is the only
   choice you make.
3. Say what you are dropping and what you are keeping ("trim from #14, keeping
   the API contract at #9") before you call. A trim changes what you can see
   next; it is not a silent optimization.
4. Write the summary: references for the artifacts, prose for the rest.
5. Write `actionRightAfterTrim`: what you do the moment the trim lands —
   confirming it to the user, answering them, or the next step of the task.
   Never "wait for the user": you keep going first, and with nothing to do you
   will take your own summary for their request.

```
start:   "#14"
summary: "## API contract (verbatim)\n[[#9]]\n\nDebugged the 401, cause was a
          stale clock skew in the token check; fixed in auth.ts."
actionRightAfterTrim: "Tell the user the 401 is fixed; ask whether to ship."
```

## Keep by reference

Anything you would otherwise re-derive or re-read: a spec, an API contract, a
decision and its reason, exact error text you are still chasing, content the
user asked you to hold. `[[#N]]` copies it byte-for-byte — no tokens spent
regenerating it, no paraphrase drift.

Let go in prose: tool output, debug loops, search results, superseded drafts,
anything already written to a file.

## Do not trim

- Over work in progress, or just before you answer. The region reaches the end
  of the conversation, so a cut above live work takes the material you were
  about to reply with. Trim between tasks, not inside one — and if you are a
  subagent, your final message is the deliverable, so trim before you build it
  or not at all.
- A short session — nothing to reclaim.
- Twice for the same ground. A summary closing with "That trim is complete" is
  the trim you just made: do its `actionRightAfterTrim`, not another trim — a trim with nothing
  in between is refused anyway. When a reply says
  the region was already summarized, the trim is done too. Reach for the tool
  again once the conversation has grown.

## This skill is inside every region you trim

The region ends at the end of the conversation, so it always covers the message
that loaded these instructions. That is fine, and reloading afterwards is
waste: `trim-context`'s own description carries the syntax and stays in the
tool list. Judgment is what this file adds, and one read gives you that.
