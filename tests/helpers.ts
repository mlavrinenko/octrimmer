import type { MessagePart, WithParts } from "../lib/types"
import type { Logger } from "../lib/logger"
import type { PluginConfig } from "../lib/config"

export const testConfig: PluginConfig = {
    enabled: true,
    permission: "allow",
    allowSubAgents: true,
    refMapSize: 20,
}

export const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
} as unknown as Logger

function makePart(id: string, sessionID: string, extra: Record<string, unknown>): MessagePart {
    return { id, sessionID, messageID: id, ...extra } as unknown as MessagePart
}

export function makeTextMessage(
    id: string,
    role: "user" | "assistant",
    text: string,
    sessionID = "s1",
): WithParts {
    return {
        info: { id, sessionID, role, time: { created: 1 } },
        parts: [makePart(id, sessionID, { type: "text", text })],
    }
}

export function makeToolMessage(
    id: string,
    role: "user" | "assistant",
    tool: string,
    output: string,
    sessionID = "s1",
): WithParts {
    return {
        info: { id, sessionID, role, time: { created: 1 } },
        parts: [
            makePart(id, sessionID, {
                type: "tool",
                tool,
                callID: `call_${id}`,
                state: { status: "completed", output },
            }),
        ],
    }
}
