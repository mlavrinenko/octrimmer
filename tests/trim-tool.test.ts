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
                actionRightAfterTrim: "go on",
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

    it("blocks an immediate second trim from the same start", async () => {
        const { tool, state } = makeTool("s-nop", poem)
        const ctx = makeToolCtx("s-nop")
        await tool.execute(
            { start: "#3", summary: "poem [[#2]]", actionRightAfterTrim: "go on" },
            ctx,
        )

        await expect(
            tool.execute(
                { start: "#3", summary: "poem [[#2]] again", actionRightAfterTrim: "go on" },
                ctx,
            ),
        ).rejects.toThrow("nothing has happened since")
        expect(state.records).toHaveLength(1)
    })

    it("cover-replaces an earlier record when a new trim starts before it", async () => {
        let messages = [
            ...poemConversation,
            makeTextMessage("m9", "user", "new work"),
            makeTextMessage("m10", "assistant", "done more"),
            makeTextMessage("m11", "user", "next request"),
        ]
        const preloaded = [makeRecord("m3", "m10", "OLD SUMMARY")]
        const { tool, state } = makeTool("s-cover", () => messages, preloaded)
        const ctx = makeToolCtx("s-cover")
        void ctx

        // visible: m1, m2, summary, m11 -> #2 is m2 (a real message)
        const result = await tool.execute(
            {
                start: "#2",
                summary: "poem [[#2:last-text]] + fresh",
                actionRightAfterTrim: "go on",
            },
            ctx,
        )

        expect(result).toContain("Replaced everything from #2")
        expect(state.records).toHaveLength(1)
        expect(state.records[0].startRawId).toBe("m2")
        expect(state.records[0].endRawId).toBe("m11")
        expect(state.records[0].expandedSummary).toContain("whispering your name")
        expect(state.records[0].expandedSummary).not.toContain("OLD SUMMARY")
    })

    it("refuses a start that points at a summary entry from an earlier trim", async () => {
        const preloaded = [makeRecord("m3", "m8", "OLD SUMMARY")]
        const { tool } = makeTool(
            "s-summary",
            () => [...poemConversation, makeTextMessage("m9", "user", "more")],
            preloaded,
        )
        await expect(
            tool.execute(
                { start: "#3", summary: "x", actionRightAfterTrim: "go on" },
                makeToolCtx("s-summary"),
            ),
        ).rejects.toThrow("is a [summary] entry")
    })

    it("refuses to trim when a reference fails, leaving zero records", async () => {
        const { tool, state } = makeTool("s-abort", poem)
        await expect(
            tool.execute(
                { start: "#3", summary: "Poem: [[#99]]", actionRightAfterTrim: "go on" },
                makeToolCtx("s-abort"),
            ),
        ).rejects.toThrow("refusing to trim")
        expect(state.records).toHaveLength(0)
    })

    it("rejects an out-of-range start", async () => {
        const { tool } = makeTool("s-range", poem)
        await expect(
            tool.execute(
                { start: "#99", summary: "x", actionRightAfterTrim: "go on" },
                makeToolCtx("s-range"),
            ),
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
            { start: "#4", summary: "new tail work", actionRightAfterTrim: "go on" },
            makeToolCtx("s-overlap"),
        )

        expect(result).toContain("already summarized at #3")
        expect(state.records).toHaveLength(2)
    })

    it("requires actionRightAfterTrim when start is given", async () => {
        const { tool, state } = makeTool("s-nonext", poem)
        await expect(
            tool.execute({ start: "#3", summary: "x" }, makeToolCtx("s-nonext")),
        ).rejects.toThrow("actionRightAfterTrim is required")
        expect(state.records).toHaveLength(0)
    })

    it("stores actionRightAfterTrim on the record, outside the summary", async () => {
        const { tool, state } = makeTool("s-next", poem)
        await tool.execute(
            { start: "#3", summary: "auth green", actionRightAfterTrim: "Answer the CI question." },
            makeToolCtx("s-next"),
        )
        expect(state.records[0].actionRightAfterTrim).toBe("Answer the CI question.")
        expect(state.records[0].expandedSummary).toBe("auth green")
    })

    describe("right after a trim", () => {
        const justTrimmed = {
            ...makeRecord("m3", "m8", "OLD SUMMARY"),
            actionRightAfterTrim: "Answer the CI question.",
        }
        // visible: m1, m2, summary, m9 — #2 is m2, a real message before the summary
        const retrim = async (session: string, after: WithParts) => {
            const { tool, state } = makeTool(session, () => [...poemConversation, after], [
                justTrimmed,
            ])
            const run = tool.execute(
                { start: "#2", summary: "fresh", actionRightAfterTrim: "go on" },
                makeToolCtx(session),
            )
            return { run, state }
        }

        it("refuses a trim when nothing happened since, repeating actionRightAfterTrim", async () => {
            const { run, state } = await retrim(
                "s-again",
                makeToolMessage("m9", "assistant", "trim-context", "Context has 4 entries"),
            )
            await expect(run).rejects.toThrow(
                /nothing has happened since.*Answer the CI question\./s,
            )
            expect(state.records).toEqual([justTrimmed])
        })

        it("refuses even with text in between: text alone is not progress", async () => {
            const { run } = await retrim(
                "s-again-text",
                makeTextMessage("m9", "assistant", "Trim complete."),
            )
            await expect(run).rejects.toThrow("nothing has happened since")
        })

        it("allows it after tool work", async () => {
            const { run, state } = await retrim(
                "s-after-work",
                makeToolMessage("m9", "assistant", "bash", "npm test -> green"),
            )
            await expect(run).resolves.toContain("Replaced everything from #2")
            expect(state.records[0].startRawId).toBe("m2")
        })

        it("allows it after a new user message", async () => {
            const { run } = await retrim(
                "s-after-user",
                makeTextMessage("m9", "user", "trim harder"),
            )
            await expect(run).resolves.toContain("Replaced everything from #2")
        })
    })

    it("degrades to a plain lossy summary with no references", async () => {
        const { tool, state } = makeTool("s-plain", poem)
        const result = await tool.execute(
            {
                start: "#3",
                summary: "Refactored auth; tests green.",
                actionRightAfterTrim: "go on",
            },
            makeToolCtx("s-plain"),
        )
        expect(result).toContain("Replaced everything from #3")
        expect(state.records[0].expandedSummary).toBe("Refactored auth; tests green.")
        expect(state.records[0].refs).toEqual([])
    })
})
