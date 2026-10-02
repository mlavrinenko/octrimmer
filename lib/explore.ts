import type { VisibleItem } from "./overlay"
import { parsePosition, buildRefMap } from "./refs"
import { addressableParts, collapseWhitespace, partSection, renderPart, summarize } from "./render"
import type { MessagePart } from "./types"

/** Default page size for the list and query modes. */
const DEFAULT_PAGE = 20
/** Hard cap on a page in the list and query modes. */
const MAX_PAGE = 50
/** How much of a part a preview or query excerpt shows. */
const PREVIEW_CHARS = 120
/** How much of the line to keep before the first matching term of an excerpt. */
const EXCERPT_LEAD = 40
/** How many part lines a query entry may carry before they collapse into `+K`. */
const MAX_PART_LINES = 3

export interface ModeArgs {
    start?: string | undefined
    summary?: string | undefined
    actionRightAfterTrim?: string | undefined
    query?: string | undefined
    inspect?: string | undefined
    before?: string | undefined
    count?: number | undefined
}

function presentKeys(args: ModeArgs, keys: Array<keyof ModeArgs>): string[] {
    return keys.filter((key) => args[key] !== undefined).map(String)
}

/**
 * The one mode a call selects: trim (`start`), query, inspect, or list. A mix
 * of mode arguments is refused whole, naming every conflict.
 */
export function modeConflict(args: ModeArgs): string | undefined {
    if (args.start !== undefined && args.start !== "") {
        const mixed = presentKeys(args, ["query", "inspect", "before"])
        return mixed.length > 0
            ? `start (trim) cannot be combined with ${mixed.join(", ")} — one mode per call.`
            : undefined
    }
    if (args.query !== undefined) {
        const mixed = presentKeys(args, ["inspect", "before", "summary", "actionRightAfterTrim"])
        return mixed.length > 0
            ? `query cannot be combined with ${mixed.join(", ")} — one mode per call.`
            : undefined
    }
    if (args.inspect !== undefined) {
        const mixed = presentKeys(args, [
            "start",
            "query",
            "before",
            "count",
            "summary",
            "actionRightAfterTrim",
        ])
        return mixed.length > 0
            ? `inspect cannot be combined with ${mixed.join(", ")} — one mode per call.`
            : undefined
    }
    if (args.summary !== undefined || args.actionRightAfterTrim !== undefined) {
        return "summary/actionRightAfterTrim require start — a trim needs all three together."
    }
    return undefined
}

/** The read-only reply a call asks for, or undefined when the call is a trim. */
export function readOnlyReply(args: ModeArgs, items: VisibleItem[]): string | undefined {
    if (args.query !== undefined) {
        return queryReply(items, args.query, args.count)
    }
    if (args.inspect !== undefined) {
        return inspectReply(items, args.inspect)
    }
    if (args.start === undefined || args.start === "") {
        return listReply(items, args.count, args.before)
    }
    return undefined
}

/** A rendered length as `NB` under a thousand, else `n.nKB`. */
export function formatSize(length: number): string {
    return length < 1000 ? `${length}B` : `${(length / 1000).toFixed(1)}KB`
}

interface Page {
    count: number
    capped: boolean
}

/** A positive integer page size, default 20, everything above 50 clamped. */
function pageSize(requested: number | undefined): Page {
    const wanted =
        typeof requested === "number" && Number.isInteger(requested) && requested > 0
            ? requested
            : DEFAULT_PAGE
    return wanted > MAX_PAGE ? { count: MAX_PAGE, capped: true } : { count: wanted, capped: false }
}

function capNote(page: Page): string {
    return page.capped ? ` (capped at ${MAX_PAGE})` : ""
}

/** `before` as a validated position: in the list, or the first thing wrong. */
function parseBefore(raw: string, total: number): number {
    const position = parsePosition(raw)
    if (position === null) {
        throw new Error(`octrimmer: invalid before "${raw}". Use "#N" (a context position).`)
    }
    if (position === 1) {
        throw new Error("octrimmer: nothing before #1 — the list starts at #1.")
    }
    if (position > total) {
        throw new Error(
            `octrimmer: before #${position} is out of range — context has ${total} entries.`,
        )
    }
    return position
}

/**
 * The list reply: the newest `count` entries, or — with `before` — the `count`
 * ending just before that position, with a hint naming the next `before` while
 * older entries remain.
 */
export function listReply(items: VisibleItem[], requested?: number, before?: string): string {
    const page = pageSize(requested)
    const endBefore = before === undefined ? undefined : parseBefore(before, items.length)
    const refs = buildRefMap(items, page.count, endBefore)
    const header =
        endBefore === undefined
            ? `Context has ${items.length} entries. Last ${refs.length}${capNote(page)}:`
            : `Context has ${items.length} entries. ${refs.length} ending before #${endBefore}${capNote(page)}:`
    const lines = refs.map((entry) => `#${entry.position} [${entry.role}] ${entry.snippet}`)
    const oldest = refs[0]?.position
    const older =
        endBefore !== undefined && oldest !== undefined && oldest > 1
            ? `\nolder: before: "#${oldest}"`
            : ""
    return `${header}\n${lines.join("\n")}${older}`
}

interface TermHit {
    index: number
}

/** The earliest occurrence of any term in a one-line text, or undefined. */
function firstHit(line: string, terms: string[]): TermHit | undefined {
    const lower = line.toLowerCase()
    let hit: TermHit | undefined
    for (const term of terms) {
        const index = lower.indexOf(term.toLowerCase())
        if (index >= 0 && (hit === undefined || index < hit.index)) {
            hit = { index }
        }
    }
    return hit
}

/** A one-line window around a hit, ellipsized on whichever side it cut. */
function excerptAt(line: string, index: number): string {
    const start = Math.max(0, Math.min(index - EXCERPT_LEAD, line.length - PREVIEW_CHARS))
    const window = line.slice(start, start + PREVIEW_CHARS)
    return `${start > 0 ? "…" : ""}${window}${start + PREVIEW_CHARS < line.length ? "…" : ""}`
}

/** The render section a part line names: text, reasoning, or tool: <name>. */
function sectionLabel(part: MessagePart): string {
    const section = partSection(part)
    if (section === "tool") {
        return `tool: ${typeof part.tool === "string" && part.tool ? part.tool : "tool"}`
    }
    if (section === "response") {
        return "text"
    }
    return section ?? "other"
}

function partLine(index: number, part: MessagePart, body: string): string {
    return `  .${index} [${sectionLabel(part)}] ${formatSize(renderPart(part).length)} — ${body}`
}

function messageHeader(position: number, role: string, parts: number, size: number): string {
    const noun = parts === 1 ? "part" : "parts"
    return `#${position} [${role}] ${parts} ${noun}, ${formatSize(size)}`
}

/** One line per matching part, capped, with `+K` for matching parts left off. */
function messagePartLines(item: VisibleItem & { kind: "message" }, terms: string[]): string[] {
    const hits = addressableParts(item.message)
        .map((part, index) => {
            const text = collapseWhitespace(renderPart(part))
            return { part, index, text, hit: firstHit(text, terms) }
        })
        .filter((entry) => entry.hit !== undefined)
    const lines = hits
        .slice(0, MAX_PART_LINES)
        .map((entry) =>
            partLine(entry.index + 1, entry.part, excerptAt(entry.text, entry.hit?.index ?? 0)),
        )
    const hidden = hits.length - lines.length
    if (hidden > 0) {
        lines[lines.length - 1] += ` +${hidden}`
    }
    return lines
}

/** The `[[from:to]]` pull when the first and last term each occur once, in order. */
function cutLine(item: VisibleItem, terms: string[]): string | undefined {
    if (new Set(terms).size < 2 || terms.some((term) => term.includes('"'))) {
        return undefined
    }
    const first = terms[0]
    const last = terms.at(-1)
    if (first === undefined || last === undefined || first === last) {
        return undefined
    }
    const lower = item.text.toLowerCase()
    const from = lower.indexOf(first.toLowerCase())
    const to = lower.indexOf(last.toLowerCase())
    if (from < 0 || to <= from) {
        return undefined
    }
    if (
        from !== lower.lastIndexOf(first.toLowerCase()) ||
        to !== lower.lastIndexOf(last.toLowerCase())
    ) {
        return undefined
    }
    return `  cut: [["${first}":"${last}"]]`
}

function queryEntry(item: VisibleItem, terms: string[]): string {
    const header =
        item.kind === "summary"
            ? `#${item.position} [summary] ${formatSize(item.text.length)}`
            : messageHeader(
                  item.position,
                  item.role,
                  addressableParts(item.message).length,
                  item.text.length,
              )
    const body =
        item.kind === "summary" ? [summaryExcerpt(item.text, terms)] : messagePartLines(item, terms)
    const cut = cutLine(item, terms)
    return [header, ...body, ...(cut === undefined ? [] : [cut])].join("\n")
}

function summaryExcerpt(text: string, terms: string[]): string {
    const line = collapseWhitespace(text)
    const hit = firstHit(line, terms)
    return hit === undefined ? `  ${summarize(text)}` : `  ${excerptAt(line, hit.index)}`
}

/**
 * Search every entry's full render — response, reasoning, tool calls and
 * results, summaries — for all the whitespace-separated terms, and report
 * each matching entry's parts with sizes and an excerpt around the first hit.
 */
export function queryReply(items: VisibleItem[], query: string, requested?: number): string {
    const terms = query.split(/\s+/u).filter((term) => term.length > 0)
    if (terms.length === 0) {
        throw new Error("octrimmer: query is empty — give at least one term.")
    }
    const matches = items.filter((item) => {
        const lower = item.text.toLowerCase()
        return terms.every((term) => lower.includes(term.toLowerCase()))
    })
    if (matches.length === 0) {
        return `No entry matches "${query}" (searched ${items.length} entries; reasoning and tool output included).`
    }
    const page = pageSize(requested)
    const shown = matches.slice(0, page.count)
    const cap = matches.length > shown.length ? `, first ${shown.length} shown` : ""
    const header = `query "${query}" — ${matches.length} of ${items.length} entries${cap} (reasoning and tool output searched)`
    const body = shown.map((item) => queryEntry(item, terms))
    return [header, ...body].join("\n")
}

/** One entry, part by part: sizes and one-line previews, nothing changed. */
export function inspectReply(items: VisibleItem[], raw: string): string {
    const position = parsePosition(raw)
    if (position === null) {
        throw new Error(`octrimmer: invalid inspect "${raw}". Use "#N" (a context position).`)
    }
    const item = items[position - 1]
    if (item === undefined) {
        throw new Error(
            `octrimmer: inspect #${position} is out of range — context has ${items.length} entries.`,
        )
    }
    if (item.kind === "summary") {
        return `#${position} [summary] ${formatSize(item.text.length)} — ${summarize(item.text)}`
    }
    const parts = addressableParts(item.message)
    const lines = parts.map((part, index) => partLine(index + 1, part, summarize(renderPart(part))))
    return [messageHeader(position, item.role, parts.length, item.text.length), ...lines].join("\n")
}
