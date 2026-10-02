import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { Logger } from "./lib/logger"
import { createSessionStore } from "./lib/state"
import { createTransformHandler } from "./lib/transform"
import { createTrimContextTool } from "./lib/trim-tool"

type TransformHook = NonNullable<Hooks["experimental.chat.messages.transform"]>

const server: Plugin = (ctx) => {
    const logger = new Logger()
    const store = createSessionStore()

    return Promise.resolve({
        // The handler works on the loose shapes of lib/types.ts, which the SDK's
        // message union does not structurally satisfy.
        "experimental.chat.messages.transform": createTransformHandler(
            store,
            logger,
        ) as TransformHook,
        tool: {
            "trim-context": createTrimContextTool({
                client: ctx.client,
                store,
                logger,
            }),
        },
    })
}

export default server
