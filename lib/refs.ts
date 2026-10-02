import type { VisibleItem } from "./overlay"
import { renderMessage, summarize, type MessageSection } from "./render"

/** A list snippet leads with response/tool content; reasoning blocks stay out. */
const SNIPPET_DROP: ReadonlySet<MessageSection> = new Set(["reasoning"])

export interface RefEntry {
    position: number
    kind: string
    role: string
    snippet: string
    rawId?: string
}

/**
 * Ref map over the VISIBLE context (what the model sees, including earlier
 * trim summaries). Positions are context positions, 1-based and stable until
 * the next trim. `before` (a 1-based position) ends the slice just before it,
 * which is how the list pages backwards.
 */
export function buildRefMap(items: VisibleItem[], count: number, before?: number): RefEntry[] {
    const total = items.length
    const end = before === undefined ? total : Math.min(before - 1, total)
    const start = Math.max(0, end - count)
    const entries: RefEntry[] = []
    for (let i = start; i < end; i++) {
        const item = items[i]
        if (!item) {
            continue
        }
        entries.push({
            position: item.position,
            kind: item.kind,
            role: item.kind === "summary" ? "summary" : item.role,
            snippet: summarize(
                item.kind === "message" ? renderMessage(item.message, SNIPPET_DROP) : item.text,
            ),
            ...(item.kind === "message" ? { rawId: item.rawId } : {}),
        })
    }
    return entries
}

/** Parse "#N" or "N" into a 1-based position. */
export function parsePosition(ref: string): number | null {
    const digits = ref.trim().replace(/^#/u, "")
    if (!/^\d+$/u.test(digits)) {
        return null
    }
    const value = Number.parseInt(digits, 10)
    return value >= 1 ? value : null
}
