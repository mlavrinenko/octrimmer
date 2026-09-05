import type { Logger } from "./logger"
import { resetSessionState, type SessionState } from "./state"
import { filterMessages, type WithParts } from "./types"
import { loadSessionState } from "./persistence"

export async function fetchSessionMessages(
    client: unknown,
    sessionId: string,
): Promise<WithParts[]> {
    const response = await (
        client as {
            session: { messages(args: { path: { id: string } }): Promise<{ data?: unknown }> }
        }
    ).session.messages({ path: { id: sessionId } })
    return filterMessages(response?.data)
}

export async function isSubAgentSession(client: unknown, sessionId: string): Promise<boolean> {
    try {
        const result = await (
            client as {
                session: {
                    get(args: { path: { id: string } }): Promise<{ data?: { parentID?: string } }>
                }
            }
        ).session.get({ path: { id: sessionId } })
        return Boolean(result?.data?.parentID)
    } catch {
        return false
    }
}

export function getSessionId(messages: WithParts[]): string | null {
    for (const message of messages) {
        if (typeof message.info.sessionID === "string" && message.info.sessionID.length > 0) {
            return message.info.sessionID
        }
    }
    return null
}

export async function ensureSessionInitialized(
    client: unknown,
    state: SessionState,
    sessionId: string,
    logger: Logger,
    _messages: WithParts[],
): Promise<void> {
    if (state.sessionId === sessionId) {
        return
    }
    resetSessionState(state)
    state.sessionId = sessionId
    state.isSubAgent = await isSubAgentSession(client, sessionId)
    const records = await loadSessionState(sessionId, logger)
    if (records) {
        state.records = records
    }
}
