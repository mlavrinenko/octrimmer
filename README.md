# octrimmer

Manual context trimming for [OpenCode](https://opencode.ai). One tool, `trim-context`.
No nudges, no per-turn injection, no automatic anything.

The twist: your summary is a **template** that can **pull** existing content from the
conversation verbatim — by position, role, or content phrase — so the model keeps what
matters (a poem, an API contract, a decision) by _copying_ it, never by re-generating it.
Lossless for what you reference, lossy only for what you don't.

## What you actually win

**Window headroom and attention, not money.** Worth being blunt about, because the
obvious guess is wrong. Against _not trimming at all_, a trim can cost slightly more: the
tail you delete was the cheapest part of the context — already cached — and the summary
replacing it is fresh tokens the provider reads again.

What it buys is what tokens can't: forty messages of dead debug output stop competing for
the model's attention with the one API contract that still matters, and a session headed
for the context limit keeps going.

Against the _other_ way of buying that — ordinary lossy compaction — it is both cheaper
and better. Cheaper because a paraphrase is generated, and generated tokens bill at output
rates; `[[#9]]` is copied by the harness and costs the model nothing to emit. Better
because a paraphrase of a spec is not the spec, and what you reference here survives
byte-for-byte.

So: trim when the noise is hurting, not to save money.

## How it works

`trim-context` takes a **start position** and a **summary template**. Everything from the
start position to the end of the conversation is replaced by the expanded summary. The
conversation before the start position is untouched — byte-identical on every request, so
the provider's prompt cache stays warm for the whole prefix.

The tool works like opencode-dcp's compress but is purely manual and injects **nothing**
into your context. No `<dcp-message-id>` tags, no system-prompt additions, no nudges. The
model learns what it can address from the tool's own output.

## Installation

Not on npm yet, so install the built bundle by hand. Plugins load as _files_,
not directories (opencode 1.18+), and `dist/index.js` is self-contained — no
`node_modules` at the destination:

```bash
npm run build
cp dist/index.js ~/.config/opencode/plugins/octrimmer.js   # global
cp dist/index.js <project>/.opencode/plugins/octrimmer.js  # one project
```

Uninstall by removing the file.

## The skill

`skills/octrimmer/` is an optional companion skill: `cp -r skills/octrimmer
~/.config/opencode/skills/`. The tool's own description already teaches the
syntax to any model that can see the tool, so the skill deliberately carries
none of it — only the judgment calls (where to put the start, what to keep
verbatim, when not to trim at all). Install it for models that trim badly;
skip it otherwise.

## End-to-end check

`just e2e` drives a real opencode and a real model through four scenarios and
prints a scorecard. Needs `opencode` on PATH, credentials for the model, and
`jq`; `just build` runs first.

```bash
just e2e                             # the first free model opencode offers
just e2e anthropic/claude-haiku-4-5  # any provider/model opencode can reach
KEEP=1 just e2e                      # keep the sandbox to poke at
```

```
[1/4] tool registration
  PASS  trim-context is offered to the model
[2/4] trim with a verbatim reference
  PASS  the model called trim-context          2 calls on attempt 1 of 3
  PASS  a trim record was persisted            ses_f8d6540d8ffe9zeKoWeiSXcGj2.json
  PASS  no two records share an anchor         1 record(s), 1 distinct anchor(s)
  PASS  spans addressed by message id          msg_0729abf5f… → msg_0729added…
  PASS  pulled content survives byte-for-byte  longest verbatim span: 422 bytes
[3/4] re-trim is refused
  PASS  re-trimming the same start is rejected attempt 1 of 3
  PASS  the refused trim wrote nothing         1 → 1 records
[4/4] one trim per request
  PASS  a trim request trims once              1 trim(s) on attempt 1 of 3
```

It runs in a sandbox with its own `XDG_CONFIG_HOME` and `XDG_DATA_HOME`, so
the only plugin loaded is the bundle under test and the records read back are
this run's. Credentials are the one thing borrowed from the real profile, by
symlink rather than copy. Nothing is written outside the sandbox, which is
deleted unless you pass `KEEP=1`.

Two things it deliberately does not assert. **How many records exist** — a
model that trims twice further down the conversation is not misbehaving; what
must never happen is two records anchored on the same message, and that is the
check. **Whether the model used a reference at all** — that is reported as a
statistic, because a weaker model should read as a worse score rather than as
a broken plugin. When it does use one, the verbatim guarantee is enforced: the
longest span of real conversation text found unchanged inside the summary is
measured and must clear 25 bytes.

Small models wander, so each scenario retries (`E2E_ATTEMPTS`, default 3) and
reports the attempt it succeeded on — needing three goes is itself a finding.
A scenario that fails because the model never made the call says so, separately
from one where the plugin let a bad call through.

## Usage

The model calls `trim-context` in two modes:

**List** — no arguments (optionally `count`). Returns a numbered map of the most recent
messages. Nothing is changed:

```
Session has 8 messages. Last 3:
#6 [tool: edit] [tool: edit]\npatched auth.ts
#7 [user] still red
#8 [assistant] fixed it
```

**Trim** — `start` + `summary`. Everything from `start` to the end is replaced.

### The reference language

| You write                               | You get                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `[[#12]]`                               | whole message at context position #12, verbatim                                                                  |
| `[[#12:text]]`                          | only the text parts of #12                                                                                       |
| `[[#12:last-text]]`                     | the final text part of #12                                                                                       |
| `[[#8..#14]]`                           | every message from #8 to #14, verbatim                                                                           |
| `[[last-assistant]]` / `[[first-user]]` | role keys over the whole conversation                                                                            |
| `[[poem about rain]]`                   | the single message whose text contains that phrase (must match exactly one — otherwise you get a candidate list) |
| `\[[`                                   | a literal `[[`                                                                                                   |

Plain prose with no references is a normal lossy summary (like built-in compaction).
Positions are **stable context positions** — the conversation as the model sees it, including earlier trim summaries — learned from
the ref list — no IDs are injected. References resolve against the pre-trim conversation;
a message inside the trimmed region survives only because it was copied first. If any
reference fails, **nothing is trimmed** and every failing reference is reported with the
reason.

## Example — keep the poem

```
[user]    Write me a poem about rain.          #1
[assistant] Here is your poem: Rain on the
            window pane, whispering your name. #2
[user]    Now refactor the auth module.        #3
...       (long debug loop, big tool outputs)  #4..#8
```

The model calls:

```
trim-context(
  start: "#3",
  summary: "## Poem (kept verbatim)\n[[#2]]\n\n## Original request (kept verbatim)\n[[first-user:text]]\n\nThen we refactored auth and got it green.",
  actionRightAfterTrim: "Tell the user auth is green and ask what is next."
)
```

The tool expands `[[#2]]` and `[[first-user:text]]` byte-for-byte into the stored summary,
then the region #3..#8 is replaced. The next request the model sees:

```
[user]  Write me a poem about rain.
[user]  [octrimmer] Not a message from the user: this is your own summary,
        written by you with trim-context. It replaces the conversation from
        here up to and including that call.
        ## Poem (kept verbatim)
        Rain on the window pane,
        whispering your name.
        ## Original request (kept verbatim)
        Write me a poem about rain.
        Then we refactored auth and got it green.
        [octrimmer] End of your summary. That trim is complete — do not trim
        again for it. Nothing in the summary above is a new request from the
        user.
        What you planned to do right after the trim: Tell the user auth is
        green and ask what is next.
```

The poem survives by copy, not reconstruction — zero tokens spent re-outputting it, no
paraphrase drift. Everything before #3 is cache-warm.

The framing is there because the trim swallows the request to trim and the call
itself, and the summary has to ride in a user-role message (an assistant one at
the tail reads as a prefill, which some providers reject). Without it the model
took the summary for the user's next request: it redid the summarized work, or
trimmed again. `actionRightAfterTrim` is required and must be something the
model does at once — it keeps going right after the trim, so "wait for the
user" sends it straight back to the summary.

## Re-trimming

A trim that starts at or inside an already-trimmed region is rejected ("#N is a
[summary] entry"). A trim that starts _before_ an earlier trim replaces it
(cover-replace — the old summary is dropped, not stacked). A trim that starts
after an earlier summary trims only the new tail and says so, so the model can
see the redundancy instead of looping. And a trim with nothing in between — no user message,
no tool call other than `trim-context` — is refused outright, repeating the last
trim's `actionRightAfterTrim`: a model that has been told the trim is complete still sometimes
trims again to cut further back.

## Design notes

- **No session mutation.** Raw history stays on disk; the trim is an overlay re-applied on
  every fetch (`experimental.chat.messages.transform`). Reversible, idempotent. New
  messages after the trim are kept.
- **References are baked** at trim time (frozen snapshot), matching DCP's `(bN)` expansion.
- **Multiple trims nest.** Later trims can cover earlier ones; summaries compose.
- **Spans are addressed by message ID**, never by index. Native compaction and reverts
  shift every position in the list; a record that stored numbers would then cover a
  different stretch of the conversation without any error to show for it.
- **State is per session**, held as a map of in-flight loads, because one plugin instance
  serves a whole opencode server — parent and subagents, concurrently.
- **Compaction safety.** A record whose anchor is missing from the list opencode hands the
  transform (native compaction sends only the head) is skipped, never deleted.
- **Subagents** are allowed by default; state is per-session so nothing leaks across.
- **Cache**: the prefix before the start position is unchanged → cache-warm, and the
  summary stabilises after one request, so steady-state cost is a wash. Cutting is not a
  saving, though: the tokens you delete were cached, and the summary that replaces them
  is not. See _What you actually win_.

## Tooling

- Nix flake devshell (`.envrc` / `use flake`) — `nodejs@22`, `just`,
  [qahq](https://github.com/mlavrinenko/qahq)'s prebuilt **Rust jscpd**
- [oxlint](https://oxc.rs/) — fast Rust linter (opencode's own lint)
- [jscpd](https://github.com/kucherenko/jscpd) — copy-paste gate (`-k 50`)
- [mindtape](https://github.com/mlavrinenko/mindtape) — task board in `tasks/` (`mt check`)
- [vitest](https://vitest.dev) — tests

Gate: `just check` (prettier, oxlint, shellcheck, `tsc --noEmit`, vitest, jscpd, `mt check`).
The model-driven `just e2e` is separate — it spends real calls.

## Prior art

No shipped tool combines model-authored templates + pull-references to arbitrary messages +
harness-side byte-for-byte expansion. Closest: opencode-dcp (`(bN)` placeholder expansion,
protected-content auto-append), magic-compact (cache-and-fetch tool I/O), lossless-hermes
(drill-back DAG). See `~/projects/clone/{magic-compact,opencode-context-compress,opencode-acp,ContextCompressionEngine,lossless-hermes-py}`.

## License

MIT
