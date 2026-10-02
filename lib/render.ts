import type { MessagePart, WithParts } from "./types"

/** A message section a reference can subtract; reasoning parts are not rendered. */
export type MessageSection = "response" | "tool" | "output"

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

/**
 * Text and tool parts in order, minus the dropped sections; other part types,
 * reasoning included, are not part of the plugin's view.
 */
export function renderMessage(
    message: WithParts,
    drop: ReadonlySet<MessageSection> = NO_DROP,
): string {
    const parts: string[] = []
    for (const part of message.parts) {
        if (part.type === "text") {
            if (!drop.has("response") && typeof part.text === "string" && part.text.trim()) {
                parts.push(part.text)
            }
        } else if (part.type === "tool" && !drop.has("tool")) {
            parts.push(drop.has("output") ? toolPartCall(part) : toolPartResult(part))
        }
    }
    return parts.join("\n\n")
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
