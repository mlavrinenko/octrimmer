import { parseRef, resolveParsed, ROLE_KEYS } from "./reference"
import type { VisibleItem } from "./overlay"

export interface ExpansionResult {
    text: string
    refs: Array<{ ref: string; rawId: string }>
    errors: Array<{ ref: string; reason: string }>
}

type Token = { type: "literal"; text: string } | { type: "ref"; inner: string }

/**
 * Every reference form, as the model writes it and what it pulls. The tool
 * description and the README both render this list, so neither can drift.
 */
export const REFERENCE_SYNTAX: ReadonlyArray<readonly [write: string, get: string]> = [
    ["[[#12]]", "the whole entry #12 (a message or a summary)"],
    ["[[#12:-output]]", "entry #12 without tool results: text and calls stay"],
    ["[[#12:-tool]]", "entry #12 without tool calls: its text only"],
    ["[[#12:-response]]", "entry #12 without text: tool calls and results only"],
    ["[[#12:last-text]]", "only entry #12's last text block (often the text after its tool calls)"],
    ["[[#8..#14]]", "every entry from #8 to #14"],
    ["[[last-assistant]]", "the last assistant entry before this trim call"],
    ["[[first-user]]", "the first user entry; also last-user, first-assistant"],
    ['[["updatedAt"]]', "the one entry containing that phrase; the flags apply here too"],
    ['[["## Contract":"## Behaviour"]]', "the text between those two phrases inside one entry"],
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
