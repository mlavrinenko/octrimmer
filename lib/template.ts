import type { WithParts } from "./types"
import { renderMessage, renderMessageLastText, renderMessageText } from "./render"

export type Picker = "whole" | "text" | "last-text"
export type RefKind = "position" | "range" | "role" | "pattern"
export type RoleKey = "first-user" | "last-user" | "first-assistant" | "last-assistant"

export interface ParsedRef {
    ref: string
    kind: RefKind
    position?: number
    rangeEnd?: number
    role?: RoleKey
    pattern?: string
    picker: Picker
}

export interface ExpansionResult {
    text: string
    refs: Array<{ ref: string; rawId: string }>
    errors: Array<{ ref: string; reason: string }>
}

type Token = { type: "literal"; text: string } | { type: "ref"; inner: string }

const ROLE_KEYS: RoleKey[] = ["first-user", "last-user", "first-assistant", "last-assistant"]

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
            if (close === -1) {
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

function parseRef(inner: string): { parsed: ParsedRef | null; error?: string } {
    const trimmed = inner.trim()
    if (!trimmed) {
        return { parsed: null }
    }

    let target = trimmed
    let picker: Picker = "whole"
    const pickerMatch = trimmed.match(/^(.*?)\s*:\s*(text|last-text)\s*$/)
    if (pickerMatch) {
        target = pickerMatch[1].trim()
        picker = pickerMatch[2] as "text" | "last-text"
    }
    if (!target) {
        return { parsed: null }
    }

    const rangeMatch = target.match(/^#(\d+)\s*\.\.\s*#(\d+)$/)
    if (rangeMatch) {
        const start = Number.parseInt(rangeMatch[1], 10)
        const end = Number.parseInt(rangeMatch[2], 10)
        if (start < 1 || end < 1 || start > end) {
            return {
                parsed: null,
                error: `invalid range "${target}": endpoints must be ascending positive positions`,
            }
        }
        return { parsed: { ref: inner, kind: "range", position: start, rangeEnd: end, picker } }
    }

    const positionMatch = target.match(/^#(\d+)$/)
    if (positionMatch) {
        const position = Number.parseInt(positionMatch[1], 10)
        if (position < 1) {
            return { parsed: null, error: `invalid position "${target}"` }
        }
        return { parsed: { ref: inner, kind: "position", position, picker } }
    }

    const role = ROLE_KEYS.find((key) => key === target)
    if (role) {
        return { parsed: { ref: inner, kind: "role", role, picker } }
    }

    if (/^m\d+$/.test(target) || /^b\d+$/.test(target)) {
        return {
            parsed: null,
            error: `"${target}" is not addressable: octrimmer does not inject message IDs. Use "#N" positions from the ref list or a content phrase.`,
        }
    }

    if (/^#|^first-|^last-/.test(target)) {
        return { parsed: null, error: `unsupported reference "${target}"` }
    }

    return { parsed: { ref: inner, kind: "pattern", pattern: target, picker } }
}

function renderWithPicker(message: WithParts, picker: Picker): string {
    switch (picker) {
        case "text":
            return renderMessageText(message)
        case "last-text":
            return renderMessageLastText(message)
        default:
            return renderMessage(message)
    }
}

function resolveAt(
    position: number,
    picker: Picker,
    messages: WithParts[],
): { text: string; rawIds: string[]; error?: string } {
    const message = messages[position - 1]
    if (!message) {
        return {
            text: "",
            rawIds: [],
            error: `no message at #${position} (session has ${messages.length})`,
        }
    }
    return { text: renderWithPicker(message, picker), rawIds: [message.info.id] }
}

function resolveRole(
    role: RoleKey,
    picker: Picker,
    messages: WithParts[],
): { text: string; rawIds: string[]; error?: string } {
    const wantRole = role.endsWith("user") ? "user" : "assistant"
    const wantLast = role.startsWith("last")
    let found: WithParts | undefined
    if (wantLast) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]?.info.role === wantRole) {
                found = messages[i]
                break
            }
        }
    } else {
        for (const message of messages) {
            if (message.info.role === wantRole) {
                found = message
                break
            }
        }
    }
    if (!found) {
        return { text: "", rawIds: [], error: `no ${wantRole} message found` }
    }
    return { text: renderWithPicker(found, picker), rawIds: [found.info.id] }
}

function resolvePattern(
    pattern: string,
    picker: Picker,
    messages: WithParts[],
): { text: string; rawIds: string[]; error?: string } {
    const needle = pattern.toLowerCase()
    const matches: Array<{ position: number; message: WithParts }> = []
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i]
        if (message && renderMessage(message).toLowerCase().includes(needle)) {
            matches.push({ position: i + 1, message })
        }
    }
    if (matches.length === 0) {
        return { text: "", rawIds: [], error: `no message contains "${pattern}"` }
    }
    if (matches.length > 1) {
        return {
            text: "",
            rawIds: [],
            error: `"${pattern}" matches ${matches.length} messages: ${matches
                .map((match) => `#${match.position}`)
                .join(", ")} — use #N instead`,
        }
    }
    return {
        text: renderWithPicker(matches[0].message, picker),
        rawIds: [matches[0].message.info.id],
    }
}

function resolveParsed(
    parsed: ParsedRef,
    messages: WithParts[],
): { text: string; rawIds: string[]; error?: string } {
    switch (parsed.kind) {
        case "position":
            return resolveAt(parsed.position ?? 0, parsed.picker, messages)
        case "range": {
            const chunks: string[] = []
            const rawIds: string[] = []
            for (
                let position = parsed.position ?? 0;
                position <= (parsed.rangeEnd ?? 0);
                position++
            ) {
                const resolved = resolveAt(position, parsed.picker, messages)
                if (resolved.error) {
                    return resolved
                }
                chunks.push(resolved.text)
                rawIds.push(...resolved.rawIds)
            }
            return { text: chunks.join("\n\n"), rawIds }
        }
        case "role":
            return resolveRole(parsed.role ?? "last-assistant", parsed.picker, messages)
        case "pattern":
            return resolvePattern(parsed.pattern ?? "", parsed.picker, messages)
    }
}

/**
 * Expand a template against a snapshot of messages. Pure and deterministic:
 * a fixed template and snapshot always produce the same result. Pulled content
 * is never rescanned (no nesting, no cycles). Errors abort the whole expansion.
 */
export function expandTemplate(template: string, messages: WithParts[]): ExpansionResult {
    const tokens = tokenize(template)
    const refs: Array<{ ref: string; rawId: string }> = []
    const errors: Array<{ ref: string; reason: string }> = []
    const out: string[] = []
    for (const token of tokens) {
        if (token.type === "literal") {
            out.push(token.text)
            continue
        }
        const { parsed, error } = parseRef(token.inner)
        if (error) {
            errors.push({ ref: token.inner, reason: error })
            continue
        }
        if (!parsed) {
            out.push(`[[${token.inner}]]`)
            continue
        }
        const resolved = resolveParsed(parsed, messages)
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
