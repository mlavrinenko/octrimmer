import type { MessagePart, WithParts } from "../lib/types"
import type { Logger } from "../lib/logger"
import { createSessionStore, type SessionState, type TrimRecord } from "../lib/state"

export const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
} as unknown as Logger

function makePart(id: string, sessionID: string, extra: Record<string, unknown>): MessagePart {
    return { id, sessionID, messageID: id, ...extra } as unknown as MessagePart
}

/** A store already holding one resolved session, bypassing the disk load. */
export function makeStore(sessionId: string, records: TrimRecord[] = []) {
    const state: SessionState = { sessionId, records }
    const store = createSessionStore()
    store.sessions.set(sessionId, Promise.resolve(state))
    return { store, state }
}

export function makeRecord(startRawId: string, endRawId: string, summary: string): TrimRecord {
    return {
        startRawId,
        endRawId,
        expandedSummary: summary,
        originMessageId: "origin",
        refs: [],
        createdAt: 1,
    }
}

export function makeTextMessage(
    id: string,
    role: "user" | "assistant",
    text: string,
    sessionID = "s1",
): WithParts {
    return {
        info: { id, sessionID, role, time: { created: 1 } },
        parts: [makePart(id, sessionID, { type: "text", text })],
    }
}

export function makeToolMessage(
    id: string,
    role: "user" | "assistant",
    tool: string,
    output: string,
    sessionID = "s1",
): WithParts {
    return {
        info: { id, sessionID, role, time: { created: 1 } },
        parts: [
            makePart(id, sessionID, {
                type: "tool",
                tool,
                callID: `call_${id}`,
                state: { status: "completed", output },
            }),
        ],
    }
}
