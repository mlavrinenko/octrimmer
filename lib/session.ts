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

/**
 * The conversation as the model last saw it: the list opencode handed the
 * transform, then whatever the raw history holds after that list's newest
 * message — the turn in progress, trim call included. After native compaction
 * opencode drops everything before the compaction and moves the retained tail
 * behind the compaction summary, so raw history is the wrong space to address.
 * Before any transform has run, raw history is all there is.
 */
export function modelView(raw: WithParts[], seen: string[] | undefined): WithParts[] {
    const seenIds = new Set(seen)
    const newest = raw.findLastIndex((message) => seenIds.has(message.info.id))
    if (newest === -1) {
        return raw
    }
    const byId = new Map(raw.map((message) => [message.info.id, message]))
    const shown = (seen ?? []).flatMap((id) => byId.get(id) ?? [])
    return [...shown, ...raw.slice(newest + 1)]
}

export function getSessionId(messages: WithParts[]): string | null {
    for (const message of messages) {
        if (typeof message.info.sessionID === "string" && message.info.sessionID.length > 0) {
            return message.info.sessionID
        }
    }
    return null
}

async function initSessionState(sessionId: string, logger: Logger): Promise<SessionState> {
    const records = await loadSessionState(sessionId, logger)
    return { sessionId, records: records ?? [] }
}

/**
 * The state for one session, loaded at most once. Every caller for the same
 * session awaits the same promise, so two concurrent turns cannot each start a
 * load and clobber one another.
 */
export function getSessionState(
    store: SessionStore,
    sessionId: string,
    logger: Logger,
): Promise<SessionState> {
    const existing = store.sessions.get(sessionId)
    if (existing) {
        return existing
    }
    const pending = initSessionState(sessionId, logger)
    store.sessions.set(sessionId, pending)
    return pending
}
