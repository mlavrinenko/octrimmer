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
    message(
        "m1",
        "user",
        "GET /pieces/:id returns {id, title, updatedAt}, and an unknown id returns 404.",
    ),
    message("m2", "assistant", "Got it: those fields on success, 404 when the row is missing."),
    message("m3", "user", "Now debug the failing contract test."),
    toolCall("m4", "bash", "npm test -- pieces.contract\n  FAIL: unknown id returns 404 (got 200)"),
    toolCall("m5", "edit", "src/api/pieces.ts: return 404 when the row is missing"),
    message("m6", "assistant", "The handler returned an empty piece. Fixed; contract test green."),
    message("m7", "user", "Trim the debug loop; keep the contract."),
    message("m8", "assistant", "Trimming from #3, keeping the contract at #1."),
]

const call = {
    start: "#3",
    summary:
        "## Contract\n[[#1]]\n\nFixed the pieces API: an unknown id now returns 404; contract test green.",
    actionRightAfterTrim: "Tell the user the 404 bug is fixed.",
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
