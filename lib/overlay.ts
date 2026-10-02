import type { WithParts } from "./types"
import { renderMessage } from "./render"
import type { TrimRecord } from "./state"

/**
 * One entry in the conversation as the MODEL sees it after all trim records
 * are re-applied. Position is the visible (context) position — this is the
 * addressing space the tool advertises, never raw session positions.
 */
interface MessageItem {
    kind: "message"
    message: WithParts
    rawId: string
    rawIndex: number
    role: "user" | "assistant"
    text: string
    position: number
}

/** An earlier trim, standing in for the messages it replaced. */
interface SummaryItem {
    kind: "summary"
    text: string
    record: TrimRecord
    position: number
}

export type VisibleItem = MessageItem | SummaryItem

/** A record resolved against a concrete message list: 0-based, end inclusive. */
export interface TrimSpan {
    record: TrimRecord
    start: number
    end: number
}

function messageItem(message: WithParts, rawIndex: number, position: number): MessageItem {
    return {
        kind: "message",
        message,
        rawId: message.info.id,
        rawIndex,
        role: message.info.role,
        text: renderMessage(message),
        position,
    }
}

/** No records present: the visible list is exactly the raw message list. */
export function toVisibleItems(messages: WithParts[]): VisibleItem[] {
    return messages.map((message, index) => messageItem(message, index, index + 1))
}

/**
 * Resolve every record against THIS message list, by ID. A record whose start
 * or end anchor is gone (native compaction, a revert) resolves to nothing
 * rather than to a stale index range — the list shifts under a record, the
 * IDs in it do not. An unresolved record is skipped, never deleted: native
 * compaction hands the transform only the head, so its end anchor may merely be
 * out of sight.
 */
export function resolveSpans(messages: WithParts[], records: TrimRecord[]): TrimSpan[] {
    const indexById = new Map<string, number>()
    messages.forEach((message, index) => indexById.set(message.info.id, index))

    const spans: TrimSpan[] = []
    for (const record of records) {
        const start = indexById.get(record.startRawId)
        const end = indexById.get(record.endRawId)
        if (start === undefined || end === undefined || end < start) {
            continue
        }
        spans.push({ record, start, end })
    }
    return spans.toSorted((a, b) => a.start - b.start)
}

/**
 * Re-apply every trim record as an overlay: summaries are injected where each
 * record's start anchor sits, covered messages are skipped, newer messages
 * survive. Records that no longer resolve are ignored, and kept.
 */
export function computeVisible(messages: WithParts[], records: TrimRecord[]): VisibleItem[] {
    const spans = resolveSpans(messages, records)
    const covered = (index: number): boolean =>
        spans.some((span) => index >= span.start && index <= span.end)

    const items: VisibleItem[] = []
    messages.forEach((message, index) => {
        for (const span of spans) {
            if (span.start === index) {
                items.push({
                    kind: "summary",
                    text: span.record.expandedSummary,
                    record: span.record,
                    position: items.length + 1,
                })
            }
        }
        if (!covered(index)) {
            items.push(messageItem(message, index, items.length + 1))
        }
    })
    return items
}
