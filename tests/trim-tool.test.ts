import { describe, expect, it } from "vitest"
import { createTrimContextTool } from "../lib/trim-tool"
import { createSessionState } from "../lib/state"
import { makeTextMessage, makeToolMessage, silentLogger, testConfig } from "./helpers"

function fakeClient(messages: unknown) {
    return {
        session: {
            messages: async () => ({ data: messages }),
            get: async () => ({ data: {} }),
        },
    }
}

function makeToolCtx(sessionID: string) {
    return {
        sessionID,
        messageID: "m_trim_call",
        agent: "primary",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
    } as never
}

function makeTool() {
    const client = fakeClient(poemConversation)
    const state = createSessionState()
    const tool = createTrimContextTool({ client, state, logger: silentLogger, config: testConfig })
    return { tool, state }
}

const poemConversation = [
    makeTextMessage("m1", "user", "Write me a poem about rain."),
    makeTextMessage(
        "m2",
        "assistant",
        "Here is your poem:\nRain on the window pane,\nwhispering your name.",
    ),
    makeTextMessage("m3", "user", "Now refactor the auth module."),
    makeToolMessage("m4", "assistant", "bash", "npm test  -> 3 passing"),
    makeTextMessage("m5", "user", "it failed on CI"),
    makeToolMessage("m6", "assistant", "edit", "patched auth.ts"),
    makeTextMessage("m7", "user", "still red"),
    makeTextMessage("m8", "assistant", "fixed it"),
]

describe("trim-context tool", () => {
    it("lists refs when start is omitted, changing nothing", async () => {
        const { tool, state } = makeTool()
        const result = await tool.execute({ count: 3 }, makeToolCtx("s-list"))
        expect(result).toContain("Session has 8 messages")
        expect(result).toContain("#6")
        expect(result).toContain("[tool: edit]")
        expect(state.records).toHaveLength(0)
    })

    it("trims a region and preserves the poem by reference (the flagship case)", async () => {
        const { tool, state } = makeTool()
        const result = await tool.execute(
            {
                start: "#3",
                summary:
                    "## Poem (kept verbatim)\n[[#2]]\n\n## Original request (kept verbatim)\n[[first-user:text]]\n\nThen we refactored auth and got it green.",
            },
            makeToolCtx("s-poem"),
        )

        expect(result).toContain("Trimmed 6 message(s): #3..#8")
        expect(result).toContain("[#2]")
        expect(state.records).toHaveLength(1)
        const record = state.records[0]
        expect(record.startRawId).toBe("m3")
        expect(record.startPosition).toBe(3)
        expect(record.endPosition).toBe(8)
        expect(record.originMessageId).toBe("m_trim_call")
        expect(record.expandedSummary).toContain("whispering your name")
        expect(record.expandedSummary).toContain("Write me a poem about rain.")
        expect(record.expandedSummary).toContain("Then we refactored auth")
    })

    it("refuses to trim when a reference fails, leaving zero records", async () => {
        const { tool, state } = makeTool()
        await expect(
            tool.execute({ start: "#3", summary: "Poem: [[#99]]" }, makeToolCtx("s-abort")),
        ).rejects.toThrow("refusing to trim")
        expect(state.records).toHaveLength(0)
    })

    it("rejects an out-of-range start", async () => {
        const { tool } = makeTool()
        await expect(
            tool.execute({ start: "#99", summary: "x" }, makeToolCtx("s-range")),
        ).rejects.toThrow("out of range")
    })

    it("requires summary when start is given", async () => {
        const { tool } = makeTool()
        await expect(tool.execute({ start: "#3" }, makeToolCtx("s-nosummary"))).rejects.toThrow(
            "summary is required",
        )
    })

    it("degrades to a plain lossy summary with no references", async () => {
        const { tool, state } = makeTool()
        const result = await tool.execute(
            { start: "#3", summary: "Refactored auth; tests green." },
            makeToolCtx("s-plain"),
        )
        expect(result).toContain("Trimmed 6 message(s)")
        expect(state.records[0].expandedSummary).toBe("Refactored auth; tests green.")
        expect(state.records[0].refs).toEqual([])
    })
})
