import { tool } from "@opencode-ai/plugin"
import type { Logger } from "./logger"
import { computeVisible, resolveSpans } from "./overlay"
import { saveSessionState } from "./persistence"
import { buildRefMap, parsePosition } from "./refs"
import { fetchSessionMessages, getSessionState, modelView } from "./session"
import type { SessionStore, TrimRecord } from "./state"
import { expandTemplate } from "./template"
import type { WithParts } from "./types"

/** How many recent entries the ref map lists when `count` is not given. */
const DEFAULT_LIST_SIZE = 20

export interface TrimToolContext {
    client: unknown
    store: SessionStore
    logger: Logger
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

const TOOL_DESCRIPTION = `Trim this session's context: everything from a start message to the end of
the conversation is replaced by a summary you write. Nothing before start
changes.

Call with no arguments first: you get the conversation as you see it,
numbered #1..#N — real messages ([user]/[assistant]) and [summary] entries
from earlier trims. Nothing changes.

Then call with start, summary and actionRightAfterTrim. A trim covering an
earlier summary replaces it. A trim right after another, with no user message
and no tool work in between, is refused.

The summary can pull entries verbatim instead of re-writing them:

  [[#12]]                whole entry #12 (a message or a summary)
  [[#12:text]]           only the text parts of message #12
  [[#12:last-text]]      the final text part of message #12
  [[#8..#14]]            every entry from #8 to #14
  [[last-assistant]]     the latest assistant message before this call
  [[first-user]]         the first user message; also last-user, first-assistant
  [["poem about rain"]]  the one entry containing that phrase

Pulled content is copied byte-for-byte: do not re-output it. A summary with no
references is a plain lossy one. References resolve before the trim, so an
entry inside the trimmed region survives only by being pulled. Any failing
reference refuses the whole trim, and every failure is reported. "[["
followed by anything else is literal text; write a literal "[[#" as "\\[[#".`

export function createTrimContextTool(ctx: TrimToolContext): ReturnType<typeof tool> {
    return tool({
        description: TOOL_DESCRIPTION,
        args: {
            start: tool.schema
                .string()
                .optional()
                .describe(
                    "#N from the list; a real message, not a [summary]. Everything from here to the end of the conversation is replaced. Omit to list.",
                ),
            summary: tool.schema
                .string()
                .optional()
                .describe("What replaces the region. May pull entries with [[...]] references."),
            actionRightAfterTrim: tool.schema
                .string()
                .optional()
                .describe(
                    'Required with start. What you do immediately after this call, in the same turn, before the user says anything: "confirm the trim to the user", "answer the user\'s question about X", the next step of the task — never "wait for the user". The trim swallows the request for it and this call; this line, shown under your summary, is all you will have to go on.',
                ),
            count: tool.schema
                .number()
                .optional()
                .describe(`How many recent entries to list. Default ${DEFAULT_LIST_SIZE}.`),
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
    const state = await getSessionState(ctx.store, sessionId, ctx.logger)

    const shown = modelView(raw, state.seen)
    const visible = computeVisible(shown, state.records)
    const count =
        typeof args.count === "number" && Number.isInteger(args.count) && args.count > 0
            ? args.count
            : DEFAULT_LIST_SIZE
    const refMap = buildRefMap(visible, count)

    if (args.start === undefined || args.start === "") {
        const lines = formatRefMap(refMap)
        return `Context has ${visible.length} entries. Last ${refMap.length}:\n${lines}`
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
    const endRawId = shown[shown.length - 1].info.id

    const expansion = expandTemplate(args.summary, visible, toolCtx.messageID)
    if (expansion.errors.length > 0) {
        throw new Error(
            `octrimmer: refusing to trim — ${expansion.errors.length} reference error(s):\n${expansion.errors
                .map((entry) => `  [${entry.ref}] ${entry.reason}`)
                .join("\n")}`,
        )
    }

    // Cover-replace: any earlier record that starts at/after the new start is
    // fully inside the new region — drop it so summaries never stack. A record
    // that does not resolve here is out of sight, not gone: keep it.
    const covered = new Set(
        resolveSpans(shown, state.records)
            .filter((span) => span.start >= startIndex)
            .map((span) => span.record),
    )
    state.records = state.records.filter((record) => !covered.has(record))

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
