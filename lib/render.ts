import type { MessagePart, WithParts } from "./types"

function toolName(part: MessagePart): string {
    return typeof part.tool === "string" && part.tool ? part.tool : "tool"
}

function toolPartText(part: MessagePart): string {
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
function toolPartNoOutput(part: MessagePart): string {
    if (part.type !== "tool") {
        return ""
    }
    const title = part.state?.["title"]
    return typeof title === "string" && title.trim()
        ? `[tool: ${toolName(part)}] ${title.trim()}`
        : `[tool: ${toolName(part)}]`
}

/** Text parts verbatim, tool parts through the given renderer. */
function renderParts(message: WithParts, renderTool: (part: MessagePart) => string): string {
    const parts: string[] = []
    for (const part of message.parts) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
            parts.push(part.text)
        } else if (part.type === "tool") {
            parts.push(renderTool(part))
        }
    }
    return parts.join("\n\n")
}

/** Render a message to plain text: text parts verbatim, tool parts as blocks. */
export function renderMessage(message: WithParts): string {
    return renderParts(message, toolPartText)
}

/** Only the text parts of a message, concatenated. */
export function renderMessageText(message: WithParts): string {
    return message.parts
        .flatMap((part) =>
            part.type === "text" && typeof part.text === "string" && part.text.trim()
                ? [part.text]
                : [],
        )
        .join("\n\n")
}

/** Text and tool calls, with every tool result and error dropped. */
export function renderMessageNoOutput(message: WithParts): string {
    return renderParts(message, toolPartNoOutput)
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
