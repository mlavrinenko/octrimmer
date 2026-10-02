import { createHash } from "node:crypto"
import type { PluginConfig } from "./config"
import type { Logger } from "./logger"
import { computeVisible, resolveSpans } from "./overlay"
import { saveSessionState } from "./persistence"
import { getSessionId, getSessionState } from "./session"
import type { SessionStore, TrimRecord } from "./state"
import type { WithParts } from "./types"

function generateStableId(prefix: string, seed: string): string {
    const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16)
    return `${prefix}_${hash}`
}

/**
 * The region runs to the end of the conversation, so it swallows the request
 * to trim, the trim-context call and its reply. Without this note the next step
 * sees only a user-role summary — no trace the trim happened — and a summary
 * that mentions the request reads as a fresh one.
 */
function trimNote(record: TrimRecord): string {
    const done =
        "[octrimmer] The summary above replaced the conversation up to and including the trim-context call that wrote it. That trim is complete — do not trim again for it."
    return record.next ? `${done}\nNext step, as planned at trim time: ${record.next}` : done
}

function createSyntheticSummary(base: WithParts, record: TrimRecord): WithParts {
    const seed = record.startRawId
    const messageId = generateStableId("msg_octrimmer_summary", seed)
    const partId = generateStableId("prt_octrimmer_summary", seed)
    const notePartId = generateStableId("prt_octrimmer_note", seed)
    return {
        info: {
            id: messageId,
            sessionID: base.info.sessionID,
            role: "user",
            agent: base.info.agent,
            model: base.info.model,
            time: { created: record.createdAt },
        },
        parts: [
            {
                id: partId,
                sessionID: base.info.sessionID,
                messageID: messageId,
                type: "text",
                text: record.expandedSummary,
            },
            {
                id: notePartId,
                sessionID: base.info.sessionID,
                messageID: messageId,
                type: "text",
                text: trimNote(record),
            },
        ],
    }
}

/**
 * Re-apply every trim record as an overlay on each outgoing fetch.
 * Raw session history is never modified: summaries are injected at each
 * record's start anchor and covered messages are skipped. New messages
 * appended after a record's end anchor are always kept. Idempotent by
 * construction — records are re-applied from the same raw list every time.
 */
export function createTransformHandler(
    client: unknown,
    store: SessionStore,
    logger: Logger,
    config: PluginConfig,
) {
    return async (_input: unknown, output: { messages: WithParts[] }) => {
        const messages = output.messages
        if (!Array.isArray(messages) || messages.length === 0) {
            return
        }

        const sessionId = getSessionId(messages)
        if (!sessionId) {
            return
        }
        const state = await getSessionState(client, store, sessionId, logger)
        if (state.isSubAgent && !config.allowSubAgents) {
            return
        }
        if (state.records.length === 0) {
            return
        }

        // Drop records that no longer resolve against this list (e.g. native
        // compaction took an anchor with it).
        const spans = resolveSpans(messages, state.records)
        if (spans.length !== state.records.length) {
            state.records = spans.map((span) => span.record)
            await saveSessionState(state, logger)
        }
        if (state.records.length === 0) {
            return
        }

        const items = computeVisible(messages, state.records)
        const result: WithParts[] = []
        for (const item of items) {
            if (item.kind === "message" && item.message) {
                result.push(item.message)
            } else if (item.kind === "summary" && item.record) {
                result.push(createSyntheticSummary(messages[0], item.record))
            }
        }

        output.messages.length = 0
        output.messages.push(...result)
    }
}
