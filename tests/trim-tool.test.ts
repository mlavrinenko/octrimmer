import { describe, expect, it } from "vitest"
import { createTrimContextTool } from "../lib/trim-tool"
import type { TrimRecord } from "../lib/state"
import {
    makeRecord,
    makeStore,
    makeTextMessage,
    makeToolMessage,
    silentLogger,
    testConfig,
} from "./helpers"
import type { WithParts } from "../lib/types"

function fakeClient(getMessages: () => unknown) {
    return {
        session: {
            messages: async () => ({ data: getMessages() }),
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

function makeTool(sessionID: string, messages: () => unknown, records: TrimRecord[] = []) {
    const { store, state } = makeStore(sessionID, records)
    const tool = createTrimContextTool({
        client: fakeClient(messages),
        store,
        logger: silentLogger,
        config: testConfig,
    })
    return { tool, state }
}

const poemConversation: WithParts[] = [
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

const poem = () => poemConversation

describe("trim-context tool", () => {
    it("lists refs when start is omitted, changing nothing", async () => {
        const { tool, state } = makeTool("s-list", poem)
        const ctx = makeToolCtx("s-list")
        const result = await tool.execute({ count: 3 }, ctx)
        expect(result).toContain("Context has 8 entries")
        expect(result).toContain("#6")
        expect(result).toContain("[tool: edit]")
        expect(state.records).toHaveLength(0)
    })

    it("trims a region and preserves the poem by reference (the flagship case)", async () => {
        const { tool, state } = makeTool("s-poem", poem)
        const result = await tool.execute(
            {
                start: "#3",
                summary:
                    "## Poem (kept verbatim)\n[[#2]]\n\n## Original request (kept verbatim)\n[[first-user:text]]\n\nThen we refactored auth and got it green.",
            },
            makeToolCtx("s-poem"),
        )

        expect(result).toContain("Replaced everything from #3 to the end")
        expect(result).toContain("[#2]")
        expect(state.records).toHaveLength(1)
        const record = state.records[0]
        expect(record.startRawId).toBe("m3")
        expect(record.endRawId).toBe("m8")
        expect(record.expandedSummary).toContain("whispering your name")
        expect(record.expandedSummary).toContain("Write me a poem about rain.")
        expect(record.expandedSummary).toContain("Then we refactored auth")
    })

    it("blocks a second trim from the same start (the position is now a summary)", async () => {
        const { tool, state } = makeTool("s-nop", poem)
        const ctx = makeToolCtx("s-nop")
        await tool.execute({ start: "#3", summary: "poem [[#2]]" }, ctx)

        await expect(
            tool.execute({ start: "#3", summary: "poem [[#2]] again" }, ctx),
        ).rejects.toThrow("is a [summary] entry")
        expect(state.records).toHaveLength(1)
    })

    it("cover-replaces an earlier record when a new trim starts before it", async () => {
        let messages = [
            ...poemConversation,
            makeTextMessage("m9", "user", "new work"),
            makeTextMessage("m10", "assistant", "done more"),
        ]
        const preloaded = [makeRecord("m3", "m10", "OLD SUMMARY")]
        const { tool, state } = makeTool("s-cover", () => messages, preloaded)
        const ctx = makeToolCtx("s-cover")
        void ctx

        // visible: m1, m2, summary, m9, m10 -> #2 is m2 (a real message)
        const result = await tool.execute(
            { start: "#2", summary: "poem [[#2:last-text]] + fresh" },
            ctx,
        )

        expect(result).toContain("Replaced everything from #2")
        expect(state.records).toHaveLength(1)
        expect(state.records[0].startRawId).toBe("m2")
        expect(state.records[0].endRawId).toBe("m10")
        expect(state.records[0].expandedSummary).toContain("whispering your name")
        expect(state.records[0].expandedSummary).not.toContain("OLD SUMMARY")
    })

    it("refuses a start that points at a summary entry from an earlier trim", async () => {
        const preloaded = [makeRecord("m3", "m8", "OLD SUMMARY")]
        const { tool } = makeTool("s-summary", poem, preloaded)
        await expect(
            tool.execute({ start: "#3", summary: "x" }, makeToolCtx("s-summary")),
        ).rejects.toThrow("is a [summary] entry")
    })

    it("refuses to trim when a reference fails, leaving zero records", async () => {
        const { tool, state } = makeTool("s-abort", poem)
        await expect(
            tool.execute({ start: "#3", summary: "Poem: [[#99]]" }, makeToolCtx("s-abort")),
        ).rejects.toThrow("refusing to trim")
        expect(state.records).toHaveLength(0)
    })

    it("rejects an out-of-range start", async () => {
        const { tool } = makeTool("s-range", poem)
        await expect(
            tool.execute({ start: "#99", summary: "x" }, makeToolCtx("s-range")),
        ).rejects.toThrow("out of range")
    })

    it("requires summary when start is given", async () => {
        const { tool } = makeTool("s-nosummary", poem)
        await expect(tool.execute({ start: "#3" }, makeToolCtx("s-nosummary"))).rejects.toThrow(
            "summary is required",
        )
    })

    it("notes redundancy when the new trim starts after an earlier summary", async () => {
        const messages = [
            ...poemConversation,
            makeTextMessage("m9", "user", "new work"),
            makeTextMessage("m10", "assistant", "done more"),
        ]
        const preloaded = [makeRecord("m3", "m8", "OLD SUMMARY")]
        const { tool, state } = makeTool("s-overlap", () => messages, preloaded)

        // visible: m1, m2, summary, m9, m10 -> #4 is m9 (a real message after the summary)
        const result = await tool.execute(
            { start: "#4", summary: "new tail work" },
            makeToolCtx("s-overlap"),
        )

        expect(result).toContain("already summarized at #3")
        expect(state.records).toHaveLength(2)
    })

    it("degrades to a plain lossy summary with no references", async () => {
        const { tool, state } = makeTool("s-plain", poem)
        const result = await tool.execute(
            { start: "#3", summary: "Refactored auth; tests green." },
            makeToolCtx("s-plain"),
        )
        expect(result).toContain("Replaced everything from #3")
        expect(state.records[0].expandedSummary).toBe("Refactored auth; tests green.")
        expect(state.records[0].refs).toEqual([])
    })
})
