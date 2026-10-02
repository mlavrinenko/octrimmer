import { tool } from "@opencode-ai/plugin"
import { modeConflict, readOnlyReply, type ModeArgs } from "./explore"
import type { Logger } from "./logger"
import { computeVisible, resolveSpans, type VisibleItem } from "./overlay"
import { saveSessionState } from "./persistence"
import { parsePosition } from "./refs"
import { fetchSessionMessages, getSessionState, modelView } from "./session"
import type { SessionState, SessionStore, TrimRecord } from "./state"
import { expandTemplate, REFERENCE_SYNTAX, type ExpansionResult } from "./template"
import type { WithParts } from "./types"

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

interface TrimArgs extends ModeArgs {
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

${REFERENCE_SYNTAX.map(([write, get]) => `  ${write.padEnd(23)}${get}`).join("\n")}

Pulled content is copied byte-for-byte: do not re-output it. A summary with no
references is a plain lossy one. References resolve before the trim, so an
entry inside the trimmed region survives only by being pulled. Any failing
reference refuses the whole trim, and every failure is reported. "[["
followed by anything else is literal text; write a literal "[[#" as "\\[[#".

Three read-only modes answer without changing anything, one per call: "query"
searches every entry's full render (reasoning and tool output included) for
all the whitespace-separated terms and reports the matching parts; "inspect"
shows one entry part by part, with sizes and previews; a call with no start,
query or inspect lists the newest entries, and "before" pages older ones.
Read-only modes are refused when mixed with a trim.`

export function createTrimContextTool(ctx: TrimToolContext): ReturnType<typeof tool> {
    return tool({
        description: TOOL_DESCRIPTION,
        args: {
            start: tool.schema
                .string()
                .optional()
                .describe(
                    "#N from the list; a real message, not a [summary]. Everything from here to the end of the conversation is replaced. Omit for the read-only modes.",
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
                .describe("Page size for the list and query modes. Default 20, max 50."),
            query: tool.schema
                .string()
                .optional()
                .describe(
                    "Search terms: all must appear, case-insensitively, in one entry's full render (reasoning and tool output included). Reports matching #N and parts. One mode per call.",
                ),
            inspect: tool.schema
                .string()
                .optional()
                .describe(
                    "#N of one entry to show part by part, with sizes and one-line previews. One mode per call.",
                ),
            before: tool.schema
                .string()
                .optional()
                .describe(
                    'With the plain list: the #N the page ends just before, e.g. before: "#40" lists up to count entries #20..#39 and hints the next before. One mode per call.',
                ),
        },
        execute(args, toolCtx) {
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

/** The arguments of a trim call, or the first thing wrong with them. */
function checkTrimArgs(
    args: TrimArgs,
    start: string,
    visibleCount: number,
): { startPos: number; summary: string; action: string } {
    const startPos = parsePosition(start)
    if (startPos === null) {
        throw new Error(
            `octrimmer: invalid start "${start}". Use "#N" (a context position from the ref list).`,
        )
    }
    if (startPos > visibleCount) {
        throw new Error(
            `octrimmer: start #${startPos} is out of range — context has ${visibleCount} entries.`,
        )
    }
    if (args.summary === undefined || args.summary === "") {
        throw new Error("octrimmer: summary is required when start is given.")
    }
    const action = args.actionRightAfterTrim?.trim() ?? ""
    if (action === "") {
        throw new Error(
            "octrimmer: actionRightAfterTrim is required when start is given — say what you do immediately after the trim.",
        )
    }
    return { startPos, summary: args.summary, action }
}

function refuseIfIdle(raw: WithParts[], records: TrimRecord[]): void {
    const idle = idleSinceLastTrim(raw, records)
    if (idle) {
        const plan = idle.actionRightAfterTrim
            ? ` Do what you planned right after it: ${idle.actionRightAfterTrim}`
            : " Resume the task."
        throw new Error(
            `octrimmer: refusing to trim — you already trimmed and nothing has happened since (no user message, no tool work).${plan}`,
        )
    }
}

function expandOrThrow(
    summary: string,
    visible: VisibleItem[],
    callerRawId: string,
): ExpansionResult {
    const expansion = expandTemplate(summary, visible, callerRawId)
    if (expansion.errors.length > 0) {
        throw new Error(
            `octrimmer: refusing to trim — ${expansion.errors.length} reference error(s):\n${expansion.errors
                .map((entry) => `  [${entry.ref}] ${entry.reason}`)
                .join("\n")}`,
        )
    }
    return expansion
}

/** Where the trimmed region starts and ends in the list the model sees. */
function anchorsOf(
    shown: WithParts[],
    visible: VisibleItem[],
    startPos: number,
): { startRawId: string; startIndex: number; endRawId: string } {
    const startItem = visible[startPos - 1]
    if (startItem?.kind !== "message") {
        throw new Error(
            `octrimmer: start #${startPos} is a [summary] entry from an earlier trim — pick a real message position (the ref list marks them [user]/[assistant]).`,
        )
    }
    const endRawId = shown.at(-1)?.info.id
    if (endRawId === undefined) {
        throw new Error("octrimmer: the session has no messages to trim.")
    }
    return { startRawId: startItem.rawId, startIndex: startItem.rawIndex, endRawId }
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

    const conflict = modeConflict(args)
    if (conflict !== undefined) {
        throw new Error(`octrimmer: ${conflict}`)
    }

    const raw = await fetchSessionMessages(ctx.client, sessionId)
    const state = await getSessionState(ctx.store, sessionId, ctx.logger)
    const shown = modelView(raw, state.seen)
    const visible = computeVisible(shown, state.records)

    const readOnly = readOnlyReply(args, visible)
    if (readOnly !== undefined) {
        return readOnly
    }
    return applyTrim(ctx, args, toolCtx, { raw, state, shown, visible })
}

async function applyTrim(
    ctx: TrimToolContext,
    args: TrimArgs,
    toolCtx: ToolRunContext,
    session: { raw: WithParts[]; state: SessionState; shown: WithParts[]; visible: VisibleItem[] },
): Promise<string> {
    const { raw, state, shown, visible } = session
    const { startPos, summary, action } = checkTrimArgs(args, args.start ?? "", visible.length)
    refuseIfIdle(raw, state.records)

    const { startRawId, startIndex, endRawId } = anchorsOf(shown, visible, startPos)
    const expansion = expandOrThrow(summary, visible, toolCtx.messageID)

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
        actionRightAfterTrim: action,
        createdAt: Date.now(),
    }
    state.records.push(record)
    await saveSessionState(state, ctx.logger)

    return trimReply(startPos, visible, expansion.refs)
}

function trimReply(
    startPos: number,
    visible: VisibleItem[],
    refs: ExpansionResult["refs"],
): string {
    const prefixNote =
        startPos > 1
            ? `Prefix #1..#${startPos - 1} unchanged (cache preserved).`
            : "No prefix remains."
    const refNote =
        refs.length > 0
            ? `\nPulled verbatim: ${refs.map((entry) => `[${entry.ref}]`).join(", ")}.`
            : ""
    const priorSummary = visible.findLast(
        (item) => item.kind === "summary" && item.position < startPos,
    )
    const overlapNote = priorSummary
        ? `\nNote: earlier content was already summarized at #${priorSummary.position}; this trim covers only the messages after it.`
        : ""
    return `Replaced everything from #${startPos} to the end of the conversation with your summary. ${prefixNote}${refNote}${overlapNote}`
}
