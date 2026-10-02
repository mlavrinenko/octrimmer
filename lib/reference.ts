import {
    addressableParts,
    renderMessage,
    renderMessageLastText,
    renderPart,
    type MessageSection,
} from "./render"
import type { VisibleItem } from "./overlay"

/** How a reference narrows an entry: whole, its last text block, or a subtraction. */
type Selection =
    { kind: "whole" } | { kind: "last-text" } | { kind: "drop"; drop: ReadonlySet<MessageSection> }

type RoleKey = "first-user" | "last-user" | "first-assistant" | "last-assistant"

export type ParsedRef = { ref: string; selection: Selection } & (
    | { kind: "position"; position: number }
    | { kind: "part"; position: number; part: number }
    | { kind: "range"; position: number; rangeEnd: number }
    | { kind: "role"; role: RoleKey }
    | { kind: "pattern"; pattern: string }
    | { kind: "cut"; from: string; to: string }
)

export interface Resolution {
    text: string
    rawIds: string[]
    error?: string
}

/** A pull that failed: every resolution error has the same empty shape. */
function refused(error: string): Resolution {
    return { text: "", rawIds: [], error }
}

export const ROLE_KEYS: RoleKey[] = ["first-user", "last-user", "first-assistant", "last-assistant"]
const DROP_FLAGS: readonly MessageSection[] = ["response", "reasoning", "tool", "output"]

/** Capture group `index` of a match that already succeeded: always present. */
function group(match: RegExpMatchArray, index: number): string {
    return match[index] ?? ""
}

/** Flags after the colon: `-tool`, `-output`, `-response`, combined freely. */
function parseSelection(modifier: string | undefined): Selection | string {
    if (modifier === undefined) {
        return { kind: "whole" }
    }
    if (modifier === "last-text") {
        return { kind: "last-text" }
    }
    if (!modifier.startsWith("-")) {
        return `unsupported modifier "${modifier}"`
    }
    const drop = new Set<MessageSection>()
    for (const flag of modifier.slice(1).split("-")) {
        const section = DROP_FLAGS.find((candidate) => candidate === flag)
        if (!section) {
            return `unsupported flag "${flag}"; flags are ${DROP_FLAGS.map((f) => `-${f}`).join(", ")}`
        }
        drop.add(section)
    }
    return { kind: "drop", drop }
}

/** `#12.2`: one part of an entry, counted in render order. */
function parsePartTarget(
    target: string,
    selection: Selection,
    ref: string,
): ParsedRef | string | undefined {
    const match = target.match(/^#(\d+)\.(\d+)$/u)
    if (!match) {
        return undefined
    }
    const position = Number.parseInt(group(match, 1), 10)
    const part = Number.parseInt(group(match, 2), 10)
    if (position < 1 || part < 1) {
        return `invalid part "${target}"`
    }
    if (selection.kind === "last-text") {
        return `last-text selects a whole entry's last text block; it cannot address part "${target}"`
    }
    return { ref, kind: "part", position, part, selection }
}

/** The target half of a reference: position, part, role, quoted phrase, or cut. */
function parseTarget(target: string, selection: Selection, ref: string): ParsedRef | string {
    const part = parsePartTarget(target, selection, ref)
    if (part !== undefined) {
        return part
    }

    const rangeMatch = target.match(/^#(\d+)\s*\.\.\s*#(\d+)$/u)
    if (rangeMatch) {
        const start = Number.parseInt(group(rangeMatch, 1), 10)
        const end = Number.parseInt(group(rangeMatch, 2), 10)
        if (start < 1 || end < 1 || start > end) {
            return `invalid range "${target}": endpoints must be ascending positive positions`
        }
        return { ref, kind: "range", position: start, rangeEnd: end, selection }
    }

    const positionMatch = target.match(/^#(\d+)$/u)
    if (positionMatch) {
        const position = Number.parseInt(group(positionMatch, 1), 10)
        if (position < 1) {
            return `invalid position "${target}"`
        }
        return { ref, kind: "position", position, selection }
    }

    const role = ROLE_KEYS.find((key) => key === target)
    if (role) {
        return { ref, kind: "role", role, selection }
    }

    const cutMatch = target.match(/^"([^"]+)"\s*:\s*"([^"]+)"$/u)
    if (cutMatch) {
        if (selection.kind !== "whole") {
            return `a cut selects its own text; it takes no modifier`
        }
        return { ref, kind: "cut", from: group(cutMatch, 1), to: group(cutMatch, 2), selection }
    }

    const phraseMatch = target.match(/^"([^"]+)"$/u)
    if (phraseMatch) {
        return { ref, kind: "pattern", pattern: group(phraseMatch, 1), selection }
    }

    return `unsupported reference "${target}"`
}

/** A parsed reference, or the reason it is malformed. */
export function parseRef(inner: string): ParsedRef | string {
    const trimmed = inner.trim()
    // Only `last-text` and `-flag` tails are modifiers, so a colon inside a
    // phrase or a cut is never mistaken for one.
    const modifierMatch = trimmed.match(/^(.*?)\s*:\s*(-[a-z-]+|last-text)\s*$/u)
    const target = (modifierMatch ? group(modifierMatch, 1) : trimmed).trim()
    const selection = parseSelection(modifierMatch ? group(modifierMatch, 2) : undefined)
    if (typeof selection === "string") {
        return selection
    }
    return parseTarget(target, selection, inner)
}

function renderItem(item: VisibleItem, selection: Selection): string {
    if (item.kind === "summary") {
        return item.text
    }
    if (selection.kind === "whole") {
        return item.text
    }
    if (selection.kind === "last-text") {
        return renderMessageLastText(item.message)
    }
    return renderMessage(item.message, selection.drop)
}

/** A summary has no raw message behind it, so nothing to report as pulled. */
function rawIdsOf(item: VisibleItem): string[] {
    return item.kind === "message" ? [item.rawId] : []
}

function noEntry(position: number, items: VisibleItem[]): Resolution {
    return refused(`no entry at #${position} (context has ${items.length})`)
}

function resolveAt(position: number, selection: Selection, items: VisibleItem[]): Resolution {
    const item = items[position - 1]
    if (!item) {
        return noEntry(position, items)
    }
    return { text: renderItem(item, selection), rawIds: rawIdsOf(item) }
}

/** One addressed part of an entry, rendered as the whole entry renders it. */
function resolvePart(
    position: number,
    part: number,
    selection: Selection,
    items: VisibleItem[],
): Resolution {
    const item = items[position - 1]
    if (!item) {
        return noEntry(position, items)
    }
    if (item.kind === "summary") {
        return refused(`#${position} is a summary and has no parts`)
    }
    const parts = addressableParts(item.message)
    const found = parts[part - 1]
    if (!found) {
        return refused(`#${position} has ${parts.length} parts, no .${part}`)
    }
    const drop = selection.kind === "drop" ? selection.drop : undefined
    return { text: renderPart(found, drop), rawIds: [item.rawId] }
}

function resolveRole(
    role: RoleKey,
    selection: Selection,
    items: VisibleItem[],
    callerRawId: string | undefined,
): Resolution {
    const wantRole = role.endsWith("user") ? "user" : "assistant"
    const candidates = items.filter(
        (item) => item.kind === "message" && item.role === wantRole && item.rawId !== callerRawId,
    )
    const found = role.startsWith("last") ? candidates.at(-1) : candidates[0]
    if (!found) {
        return refused(`no ${wantRole} message found`)
    }
    return { text: renderItem(found, selection), rawIds: rawIdsOf(found) }
}

function resolvePattern(pattern: string, selection: Selection, items: VisibleItem[]): Resolution {
    const needle = pattern.toLowerCase()
    const matches = items.filter((item) => item.text.toLowerCase().includes(needle))
    const [item, second] = matches
    if (!item) {
        return refused(`no entry contains "${pattern}"`)
    }
    if (second) {
        const positions = matches.map((match) => `#${match.position}`).join(", ")
        return refused(
            `"${pattern}" matches ${matches.length} entries: ${positions} — use #N instead`,
        )
    }
    return { text: renderItem(item, selection), rawIds: rawIdsOf(item) }
}

/** From `from` through the next `to` after it, markers included, in one entry. */
function resolveCut(from: string, to: string, items: VisibleItem[]): Resolution {
    const needleFrom = from.toLowerCase()
    const needleTo = to.toLowerCase()
    const cuts: Array<{ item: VisibleItem; text: string }> = []
    for (const item of items) {
        const lower = item.text.toLowerCase()
        const start = lower.indexOf(needleFrom)
        if (start < 0) {
            continue
        }
        const end = lower.indexOf(needleTo, start + needleFrom.length)
        if (end < 0) {
            continue
        }
        cuts.push({ item, text: item.text.slice(start, end + to.length) })
    }
    if (cuts.length === 0) {
        return refused(`no entry contains "${from}" followed by "${to}"`)
    }
    if (cuts.length > 1) {
        const positions = cuts.map((cut) => `#${cut.item.position}`).join(", ")
        return refused(
            `"${from}".."${to}" matches ${cuts.length} entries: ${positions} — narrow the phrases`,
        )
    }
    const cut = cuts[0]!
    return { text: cut.text, rawIds: rawIdsOf(cut.item) }
}

export function resolveParsed(
    parsed: ParsedRef,
    items: VisibleItem[],
    callerRawId: string | undefined,
): Resolution {
    switch (parsed.kind) {
        case "position":
            return resolveAt(parsed.position, parsed.selection, items)
        case "part":
            return resolvePart(parsed.position, parsed.part, parsed.selection, items)
        case "range": {
            const chunks: string[] = []
            const rawIds: string[] = []
            for (let position = parsed.position; position <= parsed.rangeEnd; position++) {
                const resolved = resolveAt(position, parsed.selection, items)
                if (resolved.error) {
                    return resolved
                }
                chunks.push(resolved.text)
                rawIds.push(...resolved.rawIds)
            }
            return { text: chunks.join("\n\n"), rawIds }
        }
        case "role":
            return resolveRole(parsed.role, parsed.selection, items, callerRawId)
        case "pattern":
            return resolvePattern(parsed.pattern, parsed.selection, items)
        case "cut":
            return resolveCut(parsed.from, parsed.to, items)
    }
}
