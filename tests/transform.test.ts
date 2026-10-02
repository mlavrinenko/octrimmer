import { describe, expect, it, vi } from "vitest"
import { saveSessionState } from "../lib/persistence"
import { createTransformHandler } from "../lib/transform"
import { makeRecord, makeStore, makeTextMessage, silentLogger } from "./helpers"
import type { WithParts } from "../lib/types"

vi.mock("../lib/persistence", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/persistence")>()),
    saveSessionState: vi.fn(async () => undefined),
}))

async function applyTransform(records: ReturnType<typeof makeRecord>[], msgs: WithParts[]) {
    const { store, state } = makeStore("s1", records)
    const handler = createTransformHandler(store, silentLogger)
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
        expect(summary.parts[1].type).toBe("text")
        if (summary.parts[1].type === "text") {
            expect(summary.parts[1].text).toBe("SUMMARY")
        }
    })

    it("frames the summary as the model's own, then closes it: trim done, then the action", async () => {
        const record = {
            ...makeRecord("m3", "m5", "SUMMARY"),
            actionRightAfterTrim: "Reply to the user.",
        }
        const { messages: out } = await applyTransform([record], messages())

        const texts = out[2].parts.map((part) => (part.type === "text" ? part.text : ""))
        expect(texts).toHaveLength(3)
        const [header, summary, note] = texts
        expect(header).toContain("Not a message from the user")
        expect(summary).toBe("SUMMARY")
        expect(note).toContain("trim is complete")
        expect(note).toContain("Nothing in the summary above is a new request")
        expect(note).toContain("Reply to the user.")
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

    it("keeps, unapplied, a record whose anchor message vanished (compaction)", async () => {
        const compacted = messages().filter((m) => m.info.id !== "m3" && m.info.id !== "m4")
        const record = makeRecord("m3", "m4", "SUMMARY")
        const { state, messages: out } = await applyTransform([record], compacted)

        expect(state.records).toEqual([record])
        expect(out).toHaveLength(3)
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

    it("keeps, unapplied, a record whose end anchor vanished", async () => {
        const { state, messages: out } = await applyTransform(
            [makeRecord("m3", "gone", "SUMMARY")],
            messages(),
        )

        expect(state.records).toHaveLength(1)
        expect(out).toHaveLength(5)
    })

    it("never prunes or saves when handed only the head (native compaction)", async () => {
        // Compaction runs the transform on the head without the retained tail,
        // and a trim's end anchor is the last message at trim time: in the tail.
        const record = makeRecord("m3", "m5", "SUMMARY")
        vi.mocked(saveSessionState).mockClear()
        const { state, messages: out } = await applyTransform([record], messages().slice(0, 4))

        expect(state.records).toEqual([record])
        expect(saveSessionState).not.toHaveBeenCalled()
        expect(out.map((m) => m.info.id)).toEqual(["m1", "m2", "m3", "m4"])
    })

    it("is a no-op when there are no records", async () => {
        const { messages: out } = await applyTransform([], messages())
        expect(out).toHaveLength(5)
    })
})
