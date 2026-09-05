import { createHash } from "node:crypto"
import type { PluginConfig } from "./config"
import type { Logger } from "./logger"
import { computeVisible } from "./overlay"
import { saveSessionState } from "./persistence"
import { ensureSessionInitialized, getSessionId } from "./session"
import type { SessionState, TrimRecord } from "./state"
import type { WithParts } from "./types"

function generateStableId(prefix: string, seed: string): string {
    const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16)
    return `${prefix}_${hash}`
}

function createSyntheticSummary(base: WithParts, record: TrimRecord): WithParts {
    const seed = record.startRawId
    const messageId = generateStableId("msg_octrimmer_summary", seed)
    const partId = generateStableId("prt_octrimmer_summary", seed)
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
        ],
    }
}

/**
 * Re-apply every trim record as an overlay on each outgoing fetch.
 * Raw session history is never modified: summaries are injected at each
 * record's start position and covered messages are skipped. New messages
 * appended after a record's end position are always kept. Idempotent by
 * construction — records are re-applied from the same raw list every time.
 */
export function createTransformHandler(
    client: unknown,
    state: SessionState,
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
        await ensureSessionInitialized(client, state, sessionId, logger, messages)
        if (state.isSubAgent && !config.allowSubAgents) {
            return
        }
        if (state.records.length === 0) {
            return
        }

        // Drop records whose anchor message vanished (e.g. native compaction).
        const presentIds = new Set(messages.map((message) => message.info.id))
        const before = state.records.length
        state.records = state.records.filter((record) => presentIds.has(record.startRawId))
        if (state.records.length !== before) {
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
