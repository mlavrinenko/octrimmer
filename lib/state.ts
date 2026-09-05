export interface TrimRef {
    ref: string
    rawId: string
}

/**
 * One bounded trim: everything from `startPosition` to `endPosition`
 * (1-based, inclusive, positions at trim time) is replaced by
 * `expandedSummary`. Raw messages are never removed from the session store;
 * this record is re-applied as an overlay on every fetch.
 */
export interface TrimRecord {
    startRawId: string
    startPosition: number
    endPosition: number
    expandedSummary: string
    originMessageId: string
    refs: TrimRef[]
    createdAt: number
}

export interface SessionState {
    sessionId: string | null
    isSubAgent: boolean
    records: TrimRecord[]
}

export function createSessionState(): SessionState {
    return { sessionId: null, isSubAgent: false, records: [] }
}

export function resetSessionState(state: SessionState): void {
    state.sessionId = null
    state.isSubAgent = false
    state.records = []
}
