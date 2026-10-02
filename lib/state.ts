/**
 * One bounded trim: everything from the message `startRawId` to the message
 * `endRawId` (inclusive) is replaced by `expandedSummary`. Raw messages are
 * never removed from the session store; this record is re-applied as an
 * overlay on every fetch.
 *
 * The span is addressed by message ID, never by position: native compaction
 * and reverts drop messages ahead of the anchor, and an index recorded at trim
 * time would then silently point at a different message. IDs either resolve or
 * they do not.
 */
export interface TrimRecord {
    startRawId: string
    endRawId: string
    expandedSummary: string
    /** What the model does right after the trim, rendered under the summary. Absent on older records. */
    actionRightAfterTrim?: string
    createdAt: number
}

export interface SessionState {
    sessionId: string
    records: TrimRecord[]
    /**
     * IDs of the list the transform was last handed, in its order: what the
     * model sees before octrimmer's overlay. In memory only.
     */
    seen?: string[]
}

/**
 * Per-session state for the whole plugin process. One opencode server runs one
 * plugin instance for every session it serves — parent and subagents alike, in
 * parallel — so state cannot live in a single slot keyed by "the current
 * session": two interleaved turns would each overwrite the other's records.
 *
 * The map holds the in-flight PROMISE, not the resolved state, so concurrent
 * callers for one session share a single load instead of racing two.
 */
export interface SessionStore {
    sessions: Map<string, Promise<SessionState>>
}

export function createSessionStore(): SessionStore {
    return { sessions: new Map() }
}
