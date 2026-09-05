import type { WithParts } from "./types"
import { renderMessage } from "./render"

export interface RefEntry {
    position: number
    role: string
    snippet: string
    rawId: string
}

function summarize(text: string, max = 120): string {
    const oneLine = text.replace(/\s+/g, " ").trim()
    if (oneLine.length === 0) {
        return "(no text)"
    }
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

/** Ref map for the tail of the session. Positions are 1-based and stable. */
export function buildRefMap(messages: WithParts[], count: number): RefEntry[] {
    const total = messages.length
    const start = Math.max(0, total - count)
    const entries: RefEntry[] = []
    for (let i = start; i < total; i++) {
        const message = messages[i]
        if (!message) {
            continue
        }
        entries.push({
            position: i + 1,
            role: message.info.role,
            snippet: summarize(renderMessage(message)),
            rawId: message.info.id,
        })
    }
    return entries
}

/** Parse "#N" or "N" into a 1-based position. */
export function parsePosition(ref: string): number | null {
    const match = ref.trim().match(/^#?(\d+)$/)
    if (!match) {
        return null
    }
    const value = Number.parseInt(match[1], 10)
    return Number.isInteger(value) && value >= 1 ? value : null
}
