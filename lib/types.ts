/** Loose message shapes, decoupled from SDK version churn. */

export interface TextPart {
    type: "text"
    text: string
    [key: string]: unknown
}

export interface ToolPart {
    type: "tool"
    tool?: string
    callID?: string
    state?: { status?: string; output?: unknown; error?: unknown; [key: string]: unknown }
    [key: string]: unknown
}

export type MessagePart = TextPart | ToolPart

export interface MessageInfo {
    id: string
    sessionID: string
    role: "user" | "assistant"
    time: { created: number }
    [key: string]: unknown
}

export interface WithParts {
    info: MessageInfo
    parts: MessagePart[]
}

export function isMessageWithInfo(message: unknown): message is WithParts {
    if (!message || typeof message !== "object") {
        return false
    }
    const info = (message as { info?: unknown }).info
    const parts = (message as { parts?: unknown }).parts
    if (!info || typeof info !== "object") {
        return false
    }
    const infoObj = info as Record<string, unknown>
    return (
        typeof infoObj.id === "string" &&
        infoObj.id.length > 0 &&
        typeof infoObj.sessionID === "string" &&
        infoObj.sessionID.length > 0 &&
        (infoObj.role === "user" || infoObj.role === "assistant") &&
        typeof infoObj.time === "object" &&
        infoObj.time !== null &&
        typeof (infoObj.time as { created?: unknown }).created === "number" &&
        Array.isArray(parts)
    )
}

export function filterMessages(messages: unknown): WithParts[] {
    if (!Array.isArray(messages)) {
        return []
    }
    return messages.filter(isMessageWithInfo)
}
