import type { Plugin } from "@opencode-ai/plugin"
import { Logger } from "./lib/logger"
import { createSessionStore } from "./lib/state"
import { createTransformHandler } from "./lib/transform"
import { createTrimContextTool } from "./lib/trim-tool"

const server: Plugin = (async (ctx) => {
    const logger = new Logger()
    const store = createSessionStore()

    return {
        "experimental.chat.messages.transform": createTransformHandler(store, logger) as any,
        tool: {
            "trim-context": createTrimContextTool({
                client: ctx.client,
                store,
                logger,
            }),
        },
    }
}) satisfies Plugin

export default server
