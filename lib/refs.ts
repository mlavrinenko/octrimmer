import type { VisibleItem } from "./overlay"

export interface RefEntry {
    position: number
    kind: string
    role: string
    snippet: string
    rawId?: string
}

function summarize(text: string, max = 120): string {
    const oneLine = text.replace(/\s+/g, " ").trim()
    if (oneLine.length === 0) {
        return "(no text)"
    }
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

/**
 * Ref map over the VISIBLE context (what the model sees, including earlier
 * trim summaries). Positions are context positions, 1-based and stable until
 * the next trim.
 */
export function buildRefMap(items: VisibleItem[], count: number): RefEntry[] {
    const total = items.length
    const start = Math.max(0, total - count)
    const entries: RefEntry[] = []
    for (let i = start; i < total; i++) {
        const item = items[i]
        if (!item) {
            continue
        }
        entries.push({
            position: item.position,
            kind: item.kind,
            role: item.kind === "summary" ? "summary" : (item.role ?? "?"),
            snippet: summarize(item.text),
            rawId: item.rawId,
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
