#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "References only where the grammar matches",
  status: proposed(2026, 10, 2),
)

== Summary
Any `[[...]]` that is not a known form becomes a content search. A summary
mentioning a TOML table (`[[tasks.status]]`) silently inlines a whole message,
tool output included; a bash test (`[[ -f x ]]`) refuses the whole trim.

A more unusual wrapper only moves the collision; the free-text fallback is the
cause. A reference is recognised only when the text right after `[[` starts
one: `#` (position, range), a role key, or `"` (a quoted phrase). Anything else
is literal text. Bash needs a space after `[[`, TOML tables are bare words, so
neither parses.

Role keys stay, but resolve past the message making the trim call:
`last-assistant` meant that very message — the model's own "trimming from
\#14" line.
