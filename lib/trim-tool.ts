import { tool } from "@opencode-ai/plugin"
import type { PluginConfig } from "./config"
import type { Logger } from "./logger"
import { computeVisible, resolveSpans } from "./overlay"
import { saveSessionState } from "./persistence"
import { buildRefMap, parsePosition } from "./refs"
import { fetchSessionMessages, getSessionState } from "./session"
import type { SessionStore, TrimRecord } from "./state"
import { expandTemplate } from "./template"
import type { WithParts } from "./types"

export interface TrimToolContext {
    client: unknown
    store: SessionStore
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
    actionRightAfterTrim?: string
    count?: number
}

const TOOL_DESCRIPTION = `Manual context trimmer for this session.

Two modes:

LIST — call with no arguments (optionally count=N). Returns a numbered map of
the conversation as YOU see it: #1..#N, 1-based context positions. Entries are
real messages ([user]/[assistant]) or [summary] — the text of an earlier trim.
Nothing is changed.

TRIM — call with start + summary + actionRightAfterTrim. Everything from start to the end of the
conversation is replaced by your summary. If the region was already trimmed,
the old summary is replaced, not stacked. A trim right after another — no
user message and no tool work in between — is refused: do your actionRightAfterTrim instead.

start: "#N" — a CONTEXT position from the ref list (the conversation as you
see it, including [summary] entries). Must point at a real message, not a
[summary] entry. The region from #N (inclusive) to the end is replaced.

actionRightAfterTrim: what you do IMMEDIATELY after this call — you keep going
in the same turn, before the user says anything. Usually "confirm the trim to
the user", "answer the user's question about X", or the next step of the task.
Never "wait for the user": you act first. The trim swallows the request that
asked for it and this call, so this is the only thing telling you what comes
after. It is rendered below your summary with a note that the trim is complete.

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
reference fails, nothing is trimmed and every failing reference is reported.`

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
            actionRightAfterTrim: tool.schema
                .string()
                .optional()
                .describe(
                    'Required with start. What you do immediately after this call, in the same turn (e.g. "confirm the trim to the user", "answer the user\'s question about X"). Never "wait for the user" — you act before they say anything. The trim hides the request and this call, so this is how you know what comes next.',
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

/**
 * The newest record, if nothing has happened since it: no user message and no
 * tool call other than trim-context. Text alone is not progress — "trim
 * complete" followed by another trim is the loop itself.
 */
function idleSinceLastTrim(raw: WithParts[], records: TrimRecord[]): TrimRecord | undefined {
    const spans = resolveSpans(raw, records)
    if (spans.length === 0) {
        return undefined
    }
    const latest = spans.reduce((a, b) => (b.end > a.end ? b : a))
    const progressed = raw
        .slice(latest.end + 1)
        .some(
            (message) =>
                message.info.role === "user" ||
                message.parts.some((part) => part.type === "tool" && part.tool !== "trim-context"),
        )
    return progressed ? undefined : latest.record
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
    const state = await getSessionState(ctx.client, ctx.store, sessionId, ctx.logger)

    const visible = computeVisible(raw, state.records)
    const count =
        typeof args.count === "number" && Number.isInteger(args.count) && args.count > 0
            ? args.count
            : ctx.config.refMapSize
    const refMap = buildRefMap(visible, count)

    if (args.start === undefined || args.start === "") {
        const lines = formatRefMap(refMap)
        return `Context has ${visible.length} entries (${raw.length} raw messages). Last ${refMap.length}:\n${lines}\n\n[summary] entries are earlier trims. To trim, call again with start: "#N" (a real message), a summary and actionRightAfterTrim.`
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
    if (args.actionRightAfterTrim === undefined || args.actionRightAfterTrim.trim() === "") {
        throw new Error(
            "octrimmer: actionRightAfterTrim is required when start is given — say what you do immediately after the trim.",
        )
    }

    const idle = idleSinceLastTrim(raw, state.records)
    if (idle) {
        const plan = idle.actionRightAfterTrim
            ? ` Do what you planned right after it: ${idle.actionRightAfterTrim}`
            : " Resume the task."
        throw new Error(
            `octrimmer: refusing to trim — you already trimmed and nothing has happened since (no user message, no tool work).${plan}`,
        )
    }

    const startItem = visible[startPos - 1]
    if (!startItem || startItem.kind !== "message" || !startItem.rawId) {
        throw new Error(
            `octrimmer: start #${startPos} is a [summary] entry from an earlier trim — pick a real message position (the ref list marks them [user]/[assistant]).`,
        )
    }
    const startRawId = startItem.rawId
    const startIndex = startItem.rawIndex ?? startPos - 1
    const endRawId = raw[raw.length - 1].info.id

    const expansion = expandTemplate(args.summary, visible)
    if (expansion.errors.length > 0) {
        throw new Error(
            `octrimmer: refusing to trim — ${expansion.errors.length} reference error(s):\n${expansion.errors
                .map((entry) => `  [${entry.ref}] ${entry.reason}`)
                .join("\n")}`,
        )
    }

    // Cover-replace: any earlier record that starts at/after the new start is
    // fully inside the new region — drop it so summaries never stack. Records
    // that no longer resolve are dropped here too.
    state.records = resolveSpans(raw, state.records)
        .filter((span) => span.start < startIndex)
        .map((span) => span.record)

    const record: TrimRecord = {
        startRawId,
        endRawId,
        expandedSummary: expansion.text,
        actionRightAfterTrim: args.actionRightAfterTrim.trim(),
        originMessageId: toolCtx.messageID,
        refs: expansion.refs,
        createdAt: Date.now(),
    }
    state.records.push(record)
    await saveSessionState(state, ctx.logger)

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
