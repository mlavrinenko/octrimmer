# octrimmer

Manual context trimming for [OpenCode](https://opencode.ai). One tool, `trim-context`.
No nudges, no per-turn injection, no automatic anything.

The twist: your summary is a **template** that can **pull** existing content from the
conversation verbatim — by position, role, or content phrase — so the model keeps what
matters (a poem, an API contract, a decision) by _copying_ it, never by re-generating it.
Lossless for what you reference, lossy only for what you don't.

## How it works

`trim-context` takes a **start position** and a **summary template**. Everything from the
start position to the end of the conversation is replaced by the expanded summary. The
conversation before the start position is untouched — byte-identical on every request, so
the provider's prompt cache stays warm for the whole prefix.

The tool works like opencode-dcp's compress but is purely manual and injects **nothing**
into your context. No `<dcp-message-id>` tags, no system-prompt additions, no nudges. The
model learns what it can address from the tool's own output.

## Installation

```bash
opencode plugin octrimmer --global
```

Local development install (opencode 1.18+): plugins load as _files_, not
directories — build once (`npm run build`, dist is self-contained, no
node_modules needed) and drop the bundle into a project:

```
cp dist/index.js <project>/.opencode/plugins/octrimmer.js
```

Global trial install (reversible): `cp dist/index.js ~/.config/opencode/plugins/octrimmer.js`,
remove the file to uninstall.

## Smoke test (E2E recipe)

Proven harness (opencode 1.18+, cheap model `opencode/mimo-v2.5-free`):

```bash
cd ~/projects/home/octrimmer && direnv exec . npm run build
T=$(mktemp -d) && mkdir -p "$T/.opencode/plugins"
cp dist/index.js "$T/.opencode/plugins/octrimmer.js"
cd "$T"

# 1. Boot + registration. A comma-list probe, not conditional phrasing
#    ("say TRIM-PRESENT if...") — weak models hallucinate conditionals:
opencode run "List your available tools as a comma list." --model opencode/mimo-v2.5-free

# 2. Poem scenario:
opencode run 'Write a 4-line poem about rain. Then call trim-context with
  no args and read the list, then call trim-context with start pointing at
  your poem message and a summary that keeps the poem verbatim via [[#N]].
  Reply DONE.' --model opencode/mimo-v2.5-free
```

Verify: `~/.local/share/opencode/storage/plugin/octrimmer/<session>.json`
holds **exactly one** record whose `expandedSummary` contains the poem
byte-for-byte; the raw message store is untouched; a continuation turn
(`--session <id>`) shows **one** summary and re-trimming the same start is
rejected ("is a [summary] entry").

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
  summary: "## Poem (kept verbatim)\n[[#2]]\n\n## Original request (kept verbatim)\n[[first-user:text]]\n\nThen we refactored auth and got it green."
)
```

The tool expands `[[#2]]` and `[[first-user:text]]` byte-for-byte into the stored summary,
then the region #3..#8 is replaced. The next request the model sees:

```
[user]  Write me a poem about rain.
[user]  ## Poem (kept verbatim)
        Rain on the window pane,
        whispering your name.
        ## Original request (kept verbatim)
        Write me a poem about rain.
        Then we refactored auth and got it green.
```

The poem survives by copy, not reconstruction — zero tokens spent re-outputting it, no
paraphrase drift. Everything before #3 is cache-warm.

## Re-trimming

A trim that starts at or inside an already-trimmed region is rejected ("#N is a
[summary] entry"). A trim that starts _before_ an earlier trim replaces it
(cover-replace — the old summary is dropped, not stacked). A trim that starts
after an earlier summary trims only the new tail and says so, so the model can
see the redundancy instead of looping.

## Design notes

- **No session mutation.** Raw history stays on disk; the trim is an overlay re-applied on
  every fetch (`experimental.chat.messages.transform`). Reversible, idempotent. New
  messages after the trim are kept.
- **References are baked** at trim time (frozen snapshot), matching DCP's `(bN)` expansion.
- **Multiple trims nest.** Later trims can cover earlier ones; summaries compose.
- **Compaction safety.** If opencode's native compaction removes the anchor message, the
  record is invalidated rather than crashing.
- **Subagents** are allowed by default; state is per-session so nothing leaks across.
- **Cache**: the prefix before the start position is unchanged → cache-warm. The baked
  summary lives at the tail; it is re-sent per request but that is far cheaper than the
  trimmed tokens.

## Tooling

- Nix flake devshell (`.envrc` / `use flake`) — `nodejs@22`, `just`,
  [qahq](https://github.com/mlavrinenko/qahq)'s prebuilt **Rust jscpd**
- [oxlint](https://oxc.rs/) — fast Rust linter (opencode's own lint)
- [jscpd](https://github.com/kucherenko/jscpd) — copy-paste gate (`-k 50`)
- [mindtape](https://github.com/mlavrinenko/mindtape) — task board in `tasks/` (`mt check`)
- [vitest](https://vitest.dev) — tests

Gate: `just check` (prettier, oxlint, `tsc --noEmit`, vitest, jscpd, `mt check`).

## Prior art

No shipped tool combines model-authored templates + pull-references to arbitrary messages +
harness-side byte-for-byte expansion. Closest: opencode-dcp (`(bN)` placeholder expansion,
protected-content auto-append), magic-compact (cache-and-fetch tool I/O), lossless-hermes
(drill-back DAG). See `~/projects/clone/{magic-compact,opencode-context-compress,opencode-acp,ContextCompressionEngine,lossless-hermes-py}`.

## License

MIT
