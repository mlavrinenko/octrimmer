import type { MessagePart, WithParts } from "./types"

/** A message section a reference can subtract. */
export type MessageSection = "response" | "reasoning" | "tool" | "output"

const REASONING_MARKER = "[reasoning]"

const NO_DROP: ReadonlySet<MessageSection> = new Set()

function toolName(part: MessagePart): string {
    return typeof part.tool === "string" && part.tool ? part.tool : "tool"
}

function toolPartResult(part: MessagePart): string {
    if (part.type !== "tool") {
        return ""
    }
    const state = part.state
    const output = typeof state?.output === "string" && state.output ? state.output : ""
    const error = typeof state?.error === "string" && state.error ? state.error : ""
    const body = output || error
    return body ? `[tool: ${toolName(part)}]\n${body}` : `[tool: ${toolName(part)}]`
}

/** A tool call without its result, with the tool's own one-line title if any. */
function toolPartCall(part: MessagePart): string {
    if (part.type !== "tool") {
        return ""
    }
    const title = part.state?.["title"]
    return typeof title === "string" && title.trim()
        ? `[tool: ${toolName(part)}] ${title.trim()}`
        : `[tool: ${toolName(part)}]`
}

/** One part as the whole message renders it, minus the dropped sections. */
export function renderPart(part: MessagePart, drop: ReadonlySet<MessageSection> = NO_DROP): string {
    if (part.type === "text" || part.type === "reasoning") {
        const body = typeof part.text === "string" ? part.text : ""
        const section: MessageSection = part.type === "text" ? "response" : "reasoning"
        if (drop.has(section) || !body.trim()) {
            return ""
        }
        return part.type === "reasoning" ? `${REASONING_MARKER}\n${body}` : body
    }
    if (part.type !== "tool" || drop.has("tool")) {
        return ""
    }
    return drop.has("output") ? toolPartCall(part) : toolPartResult(part)
}

/**
 * Text, reasoning and tool parts in order, minus the dropped sections; other
 * part types are not part of the plugin's view.
 */
export function renderMessage(
    message: WithParts,
    drop: ReadonlySet<MessageSection> = NO_DROP,
): string {
    const parts: string[] = []
    for (const part of message.parts) {
        const rendered = renderPart(part, drop)
        if (rendered) {
            parts.push(rendered)
        }
    }
    return parts.join("\n\n")
}

/** The parts a `#N.M` reference can address, in the numbering's render order. */
export function addressableParts(message: WithParts): MessagePart[] {
    return message.parts.filter((part) => renderPart(part) !== "")
}

/** The final non-empty text part of a message. */
export function renderMessageLastText(message: WithParts): string {
    for (const part of message.parts.toReversed()) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
            return part.text
        }
    }
    return ""
}
