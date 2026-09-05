import { tool } from "@opencode-ai/plugin"
import type { PluginConfig } from "./config"
import type { Logger } from "./logger"
import { computeVisible } from "./overlay"
import { saveSessionState } from "./persistence"
import { buildRefMap, parsePosition } from "./refs"
import { ensureSessionInitialized, fetchSessionMessages } from "./session"
import type { SessionState, TrimRecord } from "./state"
import { expandTemplate } from "./template"

export interface TrimToolContext {
    client: unknown
    state: SessionState
    logger: Logger
    config: PluginConfig
}

interface ToolRunContext {
    sessionID: string
    messageID: string
    callID?: string
}

interface TrimArgs {
    start?: string
    summary?: string
    count?: number
}

const TOOL_DESCRIPTION = `Manual context trimmer for this session.

Two modes:

LIST — call with no arguments (optionally count=N). Returns a numbered map of
the conversation as YOU see it: #1..#N, 1-based context positions. Entries are
real messages ([user]/[assistant]) or [summary] — the text of an earlier trim.
Nothing is changed.

TRIM — call with start + summary. Everything from start to the end of the
conversation is replaced by your summary. If the region was already trimmed,
the old summary is replaced, not stacked.

start: "#N" — a CONTEXT position from the ref list (the conversation as you
see it, including [summary] entries). Must point at a real message, not a
[summary] entry. The region from #N (inclusive) to the end is replaced.

summary: a template. It may PULL existing content verbatim instead of
re-generating it, using [[...]] references:

  [[#12]]              whole entry #12, verbatim (a message or a summary)
  [[#12:text]]         only the text parts of message #12
  [[#12:last-text]]    the final text part of message #12
  [[#8..#14]]          every entry from #8 to #14, verbatim
  [[last-assistant]]   the latest assistant message
  [[first-user]]       the first user message
  [[poem about rain]]  the single entry whose text contains that phrase
                       (must match exactly one; otherwise you get a candidate list)

Plain prose with no references also works — a normal lossy summary, like
built-in compaction. Content pulled by a reference is copied byte-for-byte:
do not paraphrase or re-output it. To write a literal "[[", escape it as "\\[[".

References resolve against the pre-trim context; a reference to an entry
inside the trimmed region survives only because it is copied first. If any
reference fails, nothing is trimmed and every failing reference is reported.
If everything from #N to the end was already trimmed, the call reports that
and changes nothing.`

export function createTrimContextTool(ctx: TrimToolContext): ReturnType<typeof tool> {
    return tool({
        description: TOOL_DESCRIPTION,
        args: {
            start: tool.schema
                .string()
                .optional()
                .describe(
                    "#N — context position from the ref list (what you see, [summary] entries included). Must be a real message. Everything from here to the end of the conversation is replaced by your summary. Omit to list refs only.",
                ),
            summary: tool.schema
                .string()
                .optional()
                .describe(
                    "Template replacing the trimmed region. May contain [[...]] references that pull existing content verbatim. See the tool description for the syntax.",
                ),
            count: tool.schema
                .number()
                .optional()
                .describe("How many recent entries to list in the ref map. Default 20."),
        },
        async execute(args, toolCtx) {
            return executeTrim(ctx, args as TrimArgs, toolCtx as unknown as ToolRunContext)
        },
    })
}

function formatRefMap(refMap: Array<{ position: number; role: string; snippet: string }>): string {
    return refMap.map((entry) => `#${entry.position} [${entry.role}] ${entry.snippet}`).join("\n")
}

async function executeTrim(
    ctx: TrimToolContext,
    args: TrimArgs,
    toolCtx: ToolRunContext,
): Promise<string> {
    const sessionId = toolCtx.sessionID
    if (!sessionId) {
        throw new Error("octrimmer: no session available.")
    }

    const raw = await fetchSessionMessages(ctx.client, sessionId)
    await ensureSessionInitialized(ctx.client, ctx.state, sessionId, ctx.logger, raw)

    const visible = computeVisible(raw, ctx.state.records)
    const count =
        typeof args.count === "number" && Number.isInteger(args.count) && args.count > 0
            ? args.count
            : ctx.config.refMapSize
    const refMap = buildRefMap(visible, count)

    if (args.start === undefined || args.start === "") {
        const lines = formatRefMap(refMap)
        return `Context has ${visible.length} entries (${raw.length} raw messages). Last ${refMap.length}:\n${lines}\n\n[summary] entries are earlier trims. To trim, call again with start: "#N" (a real message) and a summary.`
    }

    const startPos = parsePosition(args.start)
    if (startPos === null) {
        throw new Error(
            `octrimmer: invalid start "${args.start}". Use "#N" (a context position from the ref list).`,
        )
    }
    if (startPos > visible.length) {
        throw new Error(
            `octrimmer: start #${startPos} is out of range — context has ${visible.length} entries.`,
        )
    }
    if (args.summary === undefined || args.summary === "") {
        throw new Error("octrimmer: summary is required when start is given.")
    }

    const startItem = visible[startPos - 1]
    if (!startItem || startItem.kind !== "message" || !startItem.rawId) {
        throw new Error(
            `octrimmer: start #${startPos} is a [summary] entry from an earlier trim — pick a real message position (the ref list marks them [user]/[assistant]).`,
        )
    }
    const startRawId = startItem.rawId
    const startRawPosition = startItem.rawPosition ?? startPos
    const endPosition = raw.length

    // Already trimmed to the end from this exact message: nothing new to do.
    if (
        ctx.state.records.some(
            (record) => record.startRawId === startRawId && record.endPosition === endPosition,
        )
    ) {
        return `Already trimmed from #${startPos} to the end with this exact start — nothing new. Add new messages or pick a different start.`
    }

    const expansion = expandTemplate(args.summary, visible)
    if (expansion.errors.length > 0) {
        throw new Error(
            `octrimmer: refusing to trim — ${expansion.errors.length} reference error(s):\n${expansion.errors
                .map((entry) => `  [${entry.ref}] ${entry.reason}`)
                .join("\n")}`,
        )
    }

    // Cover-replace: any earlier record that starts at/after the new start is
    // fully inside the new region — drop it so summaries never stack.
    ctx.state.records = ctx.state.records.filter(
        (record) => record.startPosition < startRawPosition,
    )

    const record: TrimRecord = {
        startRawId,
        startPosition: startRawPosition,
        endPosition,
        expandedSummary: expansion.text,
        originMessageId: toolCtx.messageID,
        refs: expansion.refs,
        createdAt: Date.now(),
    }
    ctx.state.records.push(record)
    await saveSessionState(ctx.state, ctx.logger)

    const prefixNote =
        startPos > 1
            ? `Prefix #1..#${startPos - 1} unchanged (cache preserved).`
            : "No prefix remains."
    const refNote =
        expansion.refs.length > 0
            ? `\nPulled verbatim: ${expansion.refs.map((entry) => `[${entry.ref}]`).join(", ")}.`
            : ""
    const priorSummaries = visible.filter(
        (item) => item.kind === "summary" && item.position < startPos,
    )
    const overlapNote =
        priorSummaries.length > 0
            ? `\nNote: earlier content was already summarized at #${priorSummaries[priorSummaries.length - 1].position}; this trim covers only the messages after it.`
            : ""
    return `Replaced everything from #${startPos} to the end of the conversation with your summary. ${prefixNote}${refNote}${overlapNote}`
}
