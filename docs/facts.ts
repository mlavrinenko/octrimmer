/**
 * Facts the README shows, produced by running the plugin rather than typed:
 * the reference syntax, a real list reply, a real trim, and the messages the
 * model gets on its next request. Writes JSON to the path in argv[2].
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Trims persist under XDG_DATA_HOME; keep this run's out of the real profile.
// Set before the plugin modules load, since persistence reads it at import.
const dataHome = mkdtempSync(join(tmpdir(), "octrimmer-facts-"))
process.env["XDG_DATA_HOME"] = dataHome

const { createSessionStore } = await import("../lib/state")
const { createTransformHandler } = await import("../lib/transform")
const { createTrimContextTool } = await import("../lib/trim-tool")
const { REFERENCE_SYNTAX } = await import("../lib/template")
const { Logger } = await import("../lib/logger")
import type { WithParts } from "../lib/types"

const sessionID = "ses_readme"

function message(id: string, role: "user" | "assistant", text: string): WithParts {
    return {
        info: { id, sessionID, role, time: { created: 1 } },
        parts: [{ type: "text", text }],
    }
}

function toolCall(id: string, tool: string, output: string): WithParts {
    return {
        info: { id, sessionID, role: "assistant", time: { created: 1 } },
        parts: [{ type: "tool", tool, state: { status: "completed", output } }],
    }
}

const conversation: WithParts[] = [
    message("m1", "user", "Write me a poem about rain."),
    message("m2", "assistant", "Rain on the window pane,\nwhispering your name."),
    message("m3", "user", "Now fix the 401 in the auth module."),
    toolCall("m4", "bash", "npm test\n  2 failing: token rejected (401)"),
    toolCall("m5", "edit", "auth.ts: compare token expiry against the server clock"),
    message("m6", "assistant", "Fixed: the token check used a stale clock. Tests green."),
    message("m7", "user", "Great. Trim the context, keep the poem."),
    message("m8", "assistant", "Trimming from #3, keeping the poem at #2."),
]

const call = {
    start: "#3",
    summary:
        "## Poem\n[[#2]]\n\nFixed the 401: the token check used a stale clock; auth.ts patched, tests green.",
    actionRightAfterTrim: "Confirm the trim to the user.",
}

const store = createSessionStore()
const logger = new Logger()
const client = { session: { messages: () => Promise.resolve({ data: conversation }) } }
const tool = createTrimContextTool({ client, store, logger })
const ctx = { sessionID, messageID: "m8" } as never

const list = await tool.execute({}, ctx)
await tool.execute(call, ctx)

const next = { messages: [...conversation] }
await createTransformHandler(store, logger)({}, next)
const seen = next.messages.map((entry) => {
    const text = entry.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
    return `[${entry.info.role}] ${text.join("\n")}`
})

writeFileSync(
    process.argv[2] ?? "facts.json",
    JSON.stringify({ syntax: REFERENCE_SYNTAX, list, call, seen }, null, 2),
)
rmSync(dataHome, { recursive: true, force: true })
