import { describe, expect, it } from "vitest"
import { createTransformHandler } from "../lib/transform"
import { makeRecord, makeStore, makeTextMessage, silentLogger, testConfig } from "./helpers"
import type { WithParts } from "../lib/types"

async function applyTransform(records: ReturnType<typeof makeRecord>[], msgs: WithParts[]) {
    const { store, state } = makeStore("s1", records)
    const handler = createTransformHandler({}, store, silentLogger, testConfig)
    const output = { messages: msgs }
    await handler({}, output)
    return { state, messages: output.messages }
}

const messages = () => [
    makeTextMessage("m1", "user", "request"),
    makeTextMessage("m2", "assistant", "poem"),
    makeTextMessage("m3", "user", "refactor"),
    makeTextMessage("m4", "assistant", "done"),
    makeTextMessage("m5", "assistant", "continue"),
]

describe("transform overlay", () => {
    it("replaces a region with the summary, keeps prefix and tail", async () => {
        const { messages: out } = await applyTransform(
            [makeRecord("m3", "m4", "SUMMARY")],
            messages(),
        )

        expect(out.map((m) => m.info.id)).toEqual([
            "m1",
            "m2",
            expect.stringContaining("msg_octrimmer_summary"),
            "m5",
        ])
        const summary = out[2]
        expect(summary.parts[0].type).toBe("text")
        if (summary.parts[0].type === "text") {
            expect(summary.parts[0].text).toBe("SUMMARY")
        }
    })

    it("keeps messages appended after the end position", async () => {
        const { messages: out } = await applyTransform(
            [makeRecord("m3", "m4", "SUMMARY")],
            [...messages(), makeTextMessage("m6", "user", "new")],
        )

        expect(out.map((m) => m.info.id)).toEqual([
            "m1",
            "m2",
            expect.stringContaining("msg_octrimmer_summary"),
            "m5",
            "m6",
        ])
    })

    it("handles nested records", async () => {
        const { messages: out } = await applyTransform(
            [makeRecord("m2", "m5", "SUMMARY_A"), makeRecord("m4", "m6", "SUMMARY_B")],
            [...messages(), makeTextMessage("m6", "user", "new")],
        )

        expect(out.map((m) => m.info.id)).toEqual([
            "m1",
            expect.stringContaining("msg_octrimmer_summary"),
            expect.stringContaining("msg_octrimmer_summary"),
        ])
    })

    it("invalidates a record whose anchor message vanished (compaction)", async () => {
        const compacted = [
            makeTextMessage("m1", "user", "request"),
            makeTextMessage("m2", "assistant", "poem"),
            makeTextMessage("c1", "assistant", "compacted summary"),
            makeTextMessage("m5", "assistant", "continue"),
        ]
        const { state, messages: out } = await applyTransform(
            [makeRecord("m3", "m4", "SUMMARY")],
            compacted,
        )

        expect(state.records).toEqual([])
        expect(out).toHaveLength(4)
    })

    it("keeps the span on its own messages when earlier ones are compacted away", async () => {
        // Native compaction replaced m1+m2 with c1: every index shifted by one,
        // but the record's anchors did not move. A position-based record would
        // now cover m4+m5 and inject the summary over m4.
        const compacted = [
            makeTextMessage("c1", "assistant", "compacted summary"),
            makeTextMessage("m3", "user", "refactor"),
            makeTextMessage("m4", "assistant", "done"),
            makeTextMessage("m5", "assistant", "continue"),
        ]
        const { state, messages: out } = await applyTransform(
            [makeRecord("m3", "m4", "SUMMARY")],
            compacted,
        )

        expect(state.records).toHaveLength(1)
        expect(out.map((m) => m.info.id)).toEqual([
            "c1",
            expect.stringContaining("msg_octrimmer_summary"),
            "m5",
        ])
    })

    it("invalidates a record whose end anchor vanished", async () => {
        const { state, messages: out } = await applyTransform(
            [makeRecord("m3", "gone", "SUMMARY")],
            messages(),
        )

        expect(state.records).toEqual([])
        expect(out).toHaveLength(5)
    })

    it("is a no-op when there are no records", async () => {
        const { messages: out } = await applyTransform([], messages())
        expect(out).toHaveLength(5)
    })
})
