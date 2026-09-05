import { tool } from "@opencode-ai/plugin"
import type { PluginConfig } from "./config"
import type { Logger } from "./logger"
import { saveSessionState } from "./persistence"
import { buildRefMap, parsePosition } from "./refs"
import { expandTemplate } from "./template"
import { ensureSessionInitialized, fetchSessionMessages } from "./session"
import type { SessionState, TrimRecord } from "./state"

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

LIST — call with no arguments (optionally count=N). Returns a numbered map of the
most recent messages: #1..#N, stable session positions. Nothing is changed.

TRIM — call with start + summary. Everything from start to the end of the
conversation is replaced by your summary. The summary becomes the live context
from that point on.

start: "#N" — a session position from the ref list. The region from #N (inclusive)
to the end is replaced.

summary: a template. It may PULL existing content verbatim instead of re-generating
it, using [[...]] references:

  [[#12]]              whole message #12, verbatim
  [[#12:text]]         only the text parts of #12
  [[#12:last-text]]    the final text part of #12
  [[#8..#14]]          every message from #8 to #14, verbatim
  [[last-assistant]]   the latest assistant message
  [[first-user]]       the first user message
  [[poem about rain]]  the single message whose text contains that phrase
                       (must match exactly one; otherwise you get a candidate list)

Plain prose with no references also works — a normal lossy summary, like
built-in compaction. Content pulled by a reference is copied byte-for-byte:
do not paraphrase or re-output it. To write a literal "[[", escape it as "\\[[".

References resolve against the pre-trim conversation; a reference to a message
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
                    "#N — session position from the ref list. Everything from here to the end of the conversation is replaced by your summary. Omit to list refs only.",
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
                .describe("How many recent messages to list in the ref map. Default 20."),
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

    const count =
        typeof args.count === "number" && Number.isInteger(args.count) && args.count > 0
            ? args.count
            : ctx.config.refMapSize
    const refMap = buildRefMap(raw, count)

    if (args.start === undefined || args.start === "") {
        const lines = formatRefMap(refMap)
        return `Session has ${raw.length} messages. Last ${refMap.length}:\n${lines}\n\nTo trim, call again with start: "#N" and a summary.`
    }

    const startPos = parsePosition(args.start)
    if (startPos === null) {
        throw new Error(
            `octrimmer: invalid start "${args.start}". Use "#N" (a position from the ref list).`,
        )
    }
    if (startPos > raw.length) {
        throw new Error(
            `octrimmer: start #${startPos} is out of range — session has ${raw.length} messages.`,
        )
    }
    if (args.summary === undefined || args.summary === "") {
        throw new Error("octrimmer: summary is required when start is given.")
    }

    const endPosition = raw.length
    const expansion = expandTemplate(args.summary, raw)
    if (expansion.errors.length > 0) {
        throw new Error(
            `octrimmer: refusing to trim — ${expansion.errors.length} reference error(s):\n${expansion.errors
                .map((entry) => `  [${entry.ref}] ${entry.reason}`)
                .join("\n")}`,
        )
    }

    const startMessage = raw[startPos - 1]
    if (!startMessage) {
        throw new Error(`octrimmer: start #${startPos} resolved to no message.`)
    }

    const record: TrimRecord = {
        startRawId: startMessage.info.id,
        startPosition: startPos,
        endPosition,
        expandedSummary: expansion.text,
        originMessageId: toolCtx.messageID,
        refs: expansion.refs,
        createdAt: Date.now(),
    }
    ctx.state.records.push(record)
    await saveSessionState(ctx.state, ctx.logger)

    const trimmedCount = endPosition - startPos + 1
    const prefixNote =
        startPos > 1
            ? `Prefix #1..#${startPos - 1} unchanged (cache preserved).`
            : "No prefix remains."
    const refNote =
        expansion.refs.length > 0
            ? `\nPulled verbatim: ${expansion.refs.map((entry) => `[${entry.ref}]`).join(", ")}.`
            : ""
    return `Trimmed ${trimmedCount} message(s): #${startPos}..#${endPosition} replaced by your summary. ${prefixNote}${refNote}`
}
