import { createHash } from "node:crypto"
import type { PluginConfig } from "./config"
import type { Logger } from "./logger"
import { computeVisible } from "./overlay"
import { getSessionId, getSessionState } from "./session"
import type { SessionStore, TrimRecord } from "./state"
import type { WithParts } from "./types"

function generateStableId(prefix: string, seed: string): string {
    const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16)
    return `${prefix}_${hash}`
}

/**
 * The summary rides in a user-role message — an assistant one at the tail reads
 * as a prefill, which some providers reject — so it says outright that it is
 * the model's own words, not the user's.
 */
const SUMMARY_HEADER =
    "[octrimmer] Not a message from the user: this is your own summary, written by you with trim-context. It replaces the conversation from here up to and including that call."

/**
 * The region runs to the end of the conversation, so it swallows the request
 * to trim, the trim-context call and its reply. Without this note the next step
 * sees only the summary — no trace the trim happened — and takes it for the
 * user's next request.
 */
function trimNote(record: TrimRecord): string {
    const done =
        "[octrimmer] End of your summary. That trim is complete — do not trim again for it. Nothing in the summary above is a new request from the user."
    return record.actionRightAfterTrim
        ? `${done}\nWhat you planned to do right after the trim: ${record.actionRightAfterTrim}`
        : done
}

function createSyntheticSummary(base: WithParts, record: TrimRecord): WithParts {
    const seed = record.startRawId
    const sessionID = base.info.sessionID
    const messageId = generateStableId("msg_octrimmer_summary", seed)
    const textPart = (kind: string, text: string) => ({
        id: generateStableId(`prt_octrimmer_${kind}`, seed),
        sessionID,
        messageID: messageId,
        type: "text" as const,
        text,
    })
    return {
        info: {
            id: messageId,
            sessionID,
            role: "user",
            agent: base.info.agent,
            model: base.info.model,
            time: { created: record.createdAt },
        },
        parts: [
            textPart("header", SUMMARY_HEADER),
            textPart("summary", record.expandedSummary),
            textPart("note", trimNote(record)),
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
