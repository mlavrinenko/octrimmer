import type { Plugin } from "@opencode-ai/plugin"
import { getConfig } from "./lib/config"
import { Logger } from "./lib/logger"
import { createSessionState } from "./lib/state"
import { createTransformHandler } from "./lib/transform"
import { createTrimContextTool } from "./lib/trim-tool"

const server: Plugin = (async (ctx) => {
    const config = getConfig()
    if (!config.enabled) {
        return {}
    }

    const logger = new Logger()
    const state = createSessionState()

    return {
        "experimental.chat.messages.transform": createTransformHandler(
            ctx.client,
            state,
            logger,
            config,
        ) as any,
        tool: {
            "trim-context": createTrimContextTool({
                client: ctx.client,
                state,
                logger,
                config,
            }),
        },
        config: async (opencodeConfig) => {
            if (config.permission !== "deny") {
                const permission = opencodeConfig.permission ?? {}
                opencodeConfig.permission = {
                    ...permission,
                    "trim-context": config.permission,
                } as typeof permission
            }
        },
    }
}) satisfies Plugin

export default server
