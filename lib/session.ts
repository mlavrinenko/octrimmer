import type { Logger } from "./logger"
import type { SessionState, SessionStore } from "./state"
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

async function initSessionState(
    client: unknown,
    sessionId: string,
    logger: Logger,
): Promise<SessionState> {
    const [isSubAgent, records] = await Promise.all([
        isSubAgentSession(client, sessionId),
        loadSessionState(sessionId, logger),
    ])
    return { sessionId, isSubAgent, records: records ?? [] }
}

/**
 * The state for one session, loaded at most once. Every caller for the same
 * session awaits the same promise, so two concurrent turns cannot each start a
 * load and clobber one another. A failed load is evicted rather than cached,
 * so the next call retries instead of inheriting a poisoned entry.
 */
export function getSessionState(
    client: unknown,
    store: SessionStore,
    sessionId: string,
    logger: Logger,
): Promise<SessionState> {
    const existing = store.sessions.get(sessionId)
    if (existing) {
        return existing
    }
    const pending = initSessionState(client, sessionId, logger).catch((error: unknown) => {
        store.sessions.delete(sessionId)
        throw error
    })
    store.sessions.set(sessionId, pending)
    return pending
}
