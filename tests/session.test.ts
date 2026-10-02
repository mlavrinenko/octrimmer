import { describe, expect, it } from "vitest"
import { getSessionState } from "../lib/session"
import { saveSessionState, loadSessionState } from "../lib/persistence"
import { createSessionStore } from "../lib/state"
import { makeRecord, silentLogger } from "./helpers"

describe("getSessionState", () => {
    it("keeps two sessions apart when their loads interleave", async () => {
        await saveSessionState(
            { sessionId: "s-a", records: [makeRecord("a1", "a2", "FROM A")] },
            silentLogger,
        )
        await saveSessionState(
            { sessionId: "s-b", records: [makeRecord("b1", "b2", "FROM B")] },
            silentLogger,
        )

        const store = createSessionStore()
        const [a, b] = await Promise.all([
            getSessionState(store, "s-a", silentLogger),
            getSessionState(store, "s-b", silentLogger),
        ])

        expect(a.sessionId).toBe("s-a")
        expect(b.sessionId).toBe("s-b")
        expect(a.records[0].expandedSummary).toBe("FROM A")
        expect(b.records[0].expandedSummary).toBe("FROM B")
    })

    it("loads a session once however many callers ask at once", async () => {
        const store = createSessionStore()

        const [first, second] = await Promise.all([
            getSessionState(store, "s-once", silentLogger),
            getSessionState(store, "s-once", silentLogger),
        ])

        expect(first).toBe(second)
    })

    it("starts a session with no records when nothing is persisted", async () => {
        const store = createSessionStore()
        const state = await getSessionState(store, "s-fresh", silentLogger)
        expect(state.records).toEqual([])
    })
})

describe("persistence", () => {
    it("round-trips records through disk", async () => {
        const records = [makeRecord("m3", "m8", "KEPT VERBATIM")]
        await saveSessionState({ sessionId: "s-round", records }, silentLogger)

        const loaded = await loadSessionState("s-round", silentLogger)
        expect(loaded).toEqual(records)
    })

    it("returns null for a session that was never saved", async () => {
        expect(await loadSessionState("s-never", silentLogger)).toBeNull()
    })

    it("drops records that lost a field, keeping the rest", async () => {
        const good = makeRecord("m1", "m2", "GOOD")
        await saveSessionState(
            {
                sessionId: "s-mixed",
                records: [good, { startRawId: "m4" } as never],
            },
            silentLogger,
        )

        const loaded = await loadSessionState("s-mixed", silentLogger)
        expect(loaded).toEqual([good])
    })
})
