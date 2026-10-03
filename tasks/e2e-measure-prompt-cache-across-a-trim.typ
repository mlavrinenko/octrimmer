#import "@local/mindtape:0.2.0": *

#show: task.with(
  title: "E2E: measure prompt cache across a trim",
  status: done(
    2026,
    10,
    3,
  )[Haiku 4.5: prefix read 21396/21396, next turn 99% cached, trim cost 103 tokens],
)

== Summary
A separate sandboxed script drives one session through warm-up, trim and
follow-up turns and reads `tokens.cache` from each `step_finish` event. It
asserts the trim's promise: the prefix before the start is still read from
cache, and the trimmed context is stable enough that the next turn hits it.
Reports what the trim cost in cache writes and what each later step saves.
