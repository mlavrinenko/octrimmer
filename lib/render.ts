import type { MessagePart, WithParts } from "./types"

function toolPartText(part: MessagePart): string {
    if (part.type !== "tool") {
        return ""
    }
    const tool = typeof part.tool === "string" && part.tool ? part.tool : "tool"
    const state = part.state
    const output = typeof state?.output === "string" && state.output ? state.output : ""
    const error = typeof state?.error === "string" && state.error ? state.error : ""
    const body = output || error
    return body ? `[tool: ${tool}]\n${body}` : `[tool: ${tool}]`
}

/** Render a message to plain text: text parts verbatim, tool parts as blocks. */
export function renderMessage(message: WithParts): string {
    const parts: string[] = []
    for (const part of message.parts) {
        if (part.type === "text" && typeof part.text === "string") {
            if (part.text.trim()) {
                parts.push(part.text)
            }
        } else if (part.type === "tool") {
            parts.push(toolPartText(part))
        }
    }
    return parts.join("\n\n")
}

/** Only the text parts of a message, concatenated. */
export function renderMessageText(message: WithParts): string {
    const parts: string[] = []
    for (const part of message.parts) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
            parts.push(part.text)
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
