import type { VisibleItem } from "./overlay"
import { renderMessage, type MessageSection } from "./render"

/** A list snippet leads with response/tool content; reasoning blocks stay out. */
const SNIPPET_DROP: ReadonlySet<MessageSection> = new Set(["reasoning"])

export interface RefEntry {
    position: number
    kind: string
    role: string
    snippet: string
    rawId?: string
}

function summarize(text: string, max = 120): string {
    const oneLine = text.replaceAll(/\s+/gu, " ").trim()
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
