import { renderMessageLastText, renderMessageText } from "./render"
import type { VisibleItem } from "./overlay"

type Picker = "whole" | "text" | "last-text"
type RoleKey = "first-user" | "last-user" | "first-assistant" | "last-assistant"

type ParsedRef = { ref: string; picker: Picker } & (
    | { kind: "position"; position: number }
    | { kind: "range"; position: number; rangeEnd: number }
    | { kind: "role"; role: RoleKey }
    | { kind: "pattern"; pattern: string }
)

export interface ExpansionResult {
    text: string
    refs: Array<{ ref: string; rawId: string }>
    errors: Array<{ ref: string; reason: string }>
}

type Token = { type: "literal"; text: string } | { type: "ref"; inner: string }

const ROLE_KEYS: RoleKey[] = ["first-user", "last-user", "first-assistant", "last-assistant"]

/**
 * Every reference form, as the model writes it and what it pulls. The tool
 * description and the README both render this list, so neither can drift.
 */
export const REFERENCE_SYNTAX: ReadonlyArray<readonly [write: string, get: string]> = [
    ["[[#12]]", "whole entry #12 (a message or a summary)"],
    ["[[#12:text]]", "only the text parts of message #12"],
    ["[[#12:last-text]]", "the final text part of message #12"],
    ["[[#8..#14]]", "every entry from #8 to #14"],
    ["[[last-assistant]]", "the latest assistant message before this call"],
    ["[[first-user]]", "the first user message; also last-user, first-assistant"],
    ['[["poem about rain"]]', "the one entry containing that phrase"],
]

/**
 * Does the text at `at` (just past a "[[") start a reference? Only a "#", a
 * quote or a role key does. Summaries of code quote TOML tables, bash tests
 * and wiki links; a free-text fallback turned each into a content search that
 * either refused the trim or silently inlined a whole message.
 */
function startsRef(template: string, at: number): boolean {
    const head = template[at]
    if (head === "#" || head === '"') {
        return true
    }
    return ROLE_KEYS.some(
        (key) => template.startsWith(key, at) && /^[\]:\s]/u.test(template[at + key.length] ?? ""),
    )
}

/**
 * Tokenize a template into literals and [[...]] reference groups.
 * `\[[` renders a literal "[[", `\\` renders a literal backslash.
 */
function tokenize(template: string): Token[] {
    const tokens: Token[] = []
    let literal = ""
    let i = 0
    while (i < template.length) {
        const ch = template[i]
        if (ch === "\\") {
            const next = template[i + 1]
            if (next === "[" && template[i + 2] === "[") {
                literal += "[["
                i += 3
                continue
            }
            if (next === "\\") {
                literal += "\\"
                i += 2
                continue
            }
            literal += ch
            i += 1
            continue
        }
        if (ch === "[" && template[i + 1] === "[") {
            const close = template.indexOf("]]", i + 2)
            if (close === -1 || !startsRef(template, i + 2)) {
                literal += "[["
                i += 2
                continue
            }
            if (literal) {
                tokens.push({ type: "literal", text: literal })
                literal = ""
            }
            tokens.push({ type: "ref", inner: template.slice(i + 2, close) })
            i = close + 2
            continue
        }
        literal += ch
        i += 1
    }
    if (literal) {
        tokens.push({ type: "literal", text: literal })
    }
    return tokens
}

/** Capture group `index` of a match that already succeeded: always present. */
function group(match: RegExpMatchArray, index: number): string {
    return match[index] ?? ""
}

/** A parsed reference, or the reason it is malformed. */
function parseRef(inner: string): ParsedRef | string {
    const trimmed = inner.trim()
    let target = trimmed
    let picker: Picker = "whole"
    const pickerMatch = trimmed.match(/^(.*?)\s*:\s*(text|last-text)\s*$/u)
    if (pickerMatch) {
        target = group(pickerMatch, 1).trim()
        picker = group(pickerMatch, 2) as "text" | "last-text"
    }
    const rangeMatch = target.match(/^#(\d+)\s*\.\.\s*#(\d+)$/u)
    if (rangeMatch) {
        const start = Number.parseInt(group(rangeMatch, 1), 10)
        const end = Number.parseInt(group(rangeMatch, 2), 10)
        if (start < 1 || end < 1 || start > end) {
            return `invalid range "${target}": endpoints must be ascending positive positions`
        }
        return { ref: inner, kind: "range", position: start, rangeEnd: end, picker }
    }

    const positionMatch = target.match(/^#(\d+)$/u)
    if (positionMatch) {
        const position = Number.parseInt(group(positionMatch, 1), 10)
        if (position < 1) {
            return `invalid position "${target}"`
        }
        return { ref: inner, kind: "position", position, picker }
    }

    const role = ROLE_KEYS.find((key) => key === target)
    if (role) {
        return { ref: inner, kind: "role", role, picker }
    }

    const phraseMatch = target.match(/^"([^"]+)"$/u)
    if (phraseMatch) {
        return { ref: inner, kind: "pattern", pattern: group(phraseMatch, 1), picker }
    }

    return `unsupported reference "${target}"`
}

function renderItem(item: VisibleItem, picker: Picker): string {
    if (item.kind === "summary") {
        return item.text
    }
    switch (picker) {
        case "text":
            return renderMessageText(item.message)
        case "last-text":
            return renderMessageLastText(item.message)
        default:
            return item.text
    }
}

/** A summary has no raw message behind it, so nothing to report as pulled. */
function rawIdsOf(item: VisibleItem): string[] {
    return item.kind === "message" ? [item.rawId] : []
}

function resolveAt(
    position: number,
    picker: Picker,
    items: VisibleItem[],
): { text: string; rawIds: string[]; error?: string } {
    const item = items[position - 1]
    if (!item) {
        return {
            text: "",
            rawIds: [],
            error: `no entry at #${position} (context has ${items.length})`,
        }
    }
    return { text: renderItem(item, picker), rawIds: rawIdsOf(item) }
}

function resolveRole(
    role: RoleKey,
    picker: Picker,
    items: VisibleItem[],
    callerRawId: string | undefined,
): { text: string; rawIds: string[]; error?: string } {
    const wantRole = role.endsWith("user") ? "user" : "assistant"
    const candidates = items.filter(
        (item) => item.kind === "message" && item.role === wantRole && item.rawId !== callerRawId,
    )
    const found = role.startsWith("last") ? candidates.at(-1) : candidates[0]
    if (!found) {
        return { text: "", rawIds: [], error: `no ${wantRole} message found` }
    }
    return { text: renderItem(found, picker), rawIds: rawIdsOf(found) }
}

function resolvePattern(
    pattern: string,
    picker: Picker,
    items: VisibleItem[],
): { text: string; rawIds: string[]; error?: string } {
    const needle = pattern.toLowerCase()
    const matches = items.filter((item) => item.text.toLowerCase().includes(needle))
    const [item, second] = matches
    if (!item) {
        return { text: "", rawIds: [], error: `no entry contains "${pattern}"` }
    }
    if (second) {
        return {
            text: "",
            rawIds: [],
            error: `"${pattern}" matches ${matches.length} entries: ${matches
                .map((match) => `#${match.position}`)
                .join(", ")} — use #N instead`,
        }
    }
    return { text: renderItem(item, picker), rawIds: rawIdsOf(item) }
}

function resolveParsed(
    parsed: ParsedRef,
    items: VisibleItem[],
    callerRawId: string | undefined,
): { text: string; rawIds: string[]; error?: string } {
    switch (parsed.kind) {
        case "position":
            return resolveAt(parsed.position, parsed.picker, items)
        case "range": {
            const chunks: string[] = []
            const rawIds: string[] = []
            for (let position = parsed.position; position <= parsed.rangeEnd; position++) {
                const resolved = resolveAt(position, parsed.picker, items)
                if (resolved.error) {
                    return resolved
                }
                chunks.push(resolved.text)
                rawIds.push(...resolved.rawIds)
            }
            return { text: chunks.join("\n\n"), rawIds }
        }
        case "role":
            return resolveRole(parsed.role, parsed.picker, items, callerRawId)
        case "pattern":
            return resolvePattern(parsed.pattern, parsed.picker, items)
    }
}

/**
 * Expand a template against the visible context (the conversation as the
 * model sees it, including earlier trim summaries). Pure and deterministic:
 * a fixed template and context always produce the same result. Pulled content
 * is never rescanned (no nesting, no cycles). Errors abort the whole expansion.
 *
 * `callerRawId` is the message making the trim call. Role keys look past it:
 * `last-assistant` would otherwise be the model's own "trimming from #N" line.
 */
export function expandTemplate(
    template: string,
    items: VisibleItem[],
    callerRawId?: string,
): ExpansionResult {
    const tokens = tokenize(template)
    const refs: Array<{ ref: string; rawId: string }> = []
    const errors: Array<{ ref: string; reason: string }> = []
    const out: string[] = []
    for (const token of tokens) {
        if (token.type === "literal") {
            out.push(token.text)
            continue
        }
        const parsed = parseRef(token.inner)
        if (typeof parsed === "string") {
            errors.push({ ref: token.inner, reason: parsed })
            continue
        }
        const resolved = resolveParsed(parsed, items, callerRawId)
        if (resolved.error) {
            errors.push({ ref: token.inner, reason: resolved.error })
            continue
        }
        out.push(resolved.text)
        for (const rawId of resolved.rawIds) {
            refs.push({ ref: token.inner, rawId })
        }
    }
    return { text: out.join(""), refs, errors }
}
