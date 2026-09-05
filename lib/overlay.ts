import type { WithParts } from "./types"
import { renderMessage } from "./render"
import type { TrimRecord } from "./state"

/**
 * One entry in the conversation as the MODEL sees it after all trim records
 * are re-applied. Position is the visible (context) position — this is the
 * addressing space the tool advertises, never raw session positions.
 */
export interface VisibleItem {
    kind: "message" | "summary"
    message?: WithParts
    rawId?: string
    rawPosition?: number
    role?: "user" | "assistant"
    text: string
    record?: TrimRecord
    position: number
}

/** No records present: the visible list is exactly the raw message list. */
export function toVisibleItems(messages: WithParts[]): VisibleItem[] {
    return messages.map((message, index) => ({
        kind: "message",
        message,
        rawId: message.info.id,
        rawPosition: index + 1,
        role: message.info.role,
        text: renderMessage(message),
        position: index + 1,
    }))
}

/**
 * Re-apply every trim record as an overlay: summaries are injected at each
 * record's raw start position, covered raw messages are skipped, newer
 * messages survive. Records whose anchor message vanished are ignored
 * (the transform persists their removal).
 */
export function computeVisible(messages: WithParts[], records: TrimRecord[]): VisibleItem[] {
    const valid = records.filter((record) =>
        messages.some((message) => message.info.id === record.startRawId),
    )
    const sorted = [...valid].toSorted((a, b) => a.startPosition - b.startPosition)
    const covered = (position: number): boolean =>
        valid.some((record) => position >= record.startPosition && position <= record.endPosition)

    const items: Array<Omit<VisibleItem, "position">> = []
    for (let i = 0; i < messages.length; i++) {
        const position = i + 1
        for (const record of sorted) {
            if (record.startPosition === position) {
                items.push({ kind: "summary", text: record.expandedSummary, record })
            }
        }
        if (!covered(position)) {
            const message = messages[i]
            items.push({
                kind: "message",
                message,
                rawId: message.info.id,
                rawPosition: position,
                role: message.info.role,
                text: renderMessage(message),
            })
        }
    }
    return items.map((item, index) => ({ ...item, position: index + 1 }))
}
