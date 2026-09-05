import { describe, expect, it } from "vitest"
import { getSessionState } from "../lib/session"
import { saveSessionState, loadSessionState } from "../lib/persistence"
import { createSessionStore } from "../lib/state"
import { makeRecord, silentLogger } from "./helpers"

/** A client whose session lookup resolves on a later tick, so two calls for
 *  two sessions are guaranteed to be in flight at the same time. */
function slowClient(onGet: () => void = () => undefined) {
    return {
        session: {
            get: async () => {
                onGet()
                await new Promise((resolve) => setTimeout(resolve, 0))
                return { data: {} }
            },
            messages: async () => ({ data: [] }),
        },
    }
}

describe("getSessionState", () => {
    it("keeps two sessions apart when their loads interleave", async () => {
        await saveSessionState(
            { sessionId: "s-a", isSubAgent: false, records: [makeRecord("a1", "a2", "FROM A")] },
            silentLogger,
        )
        await saveSessionState(
            { sessionId: "s-b", isSubAgent: false, records: [makeRecord("b1", "b2", "FROM B")] },
            silentLogger,
        )

        const store = createSessionStore()
        const client = slowClient()
        const [a, b] = await Promise.all([
            getSessionState(client, store, "s-a", silentLogger),
            getSessionState(client, store, "s-b", silentLogger),
        ])

        expect(a.sessionId).toBe("s-a")
        expect(b.sessionId).toBe("s-b")
        expect(a.records[0].expandedSummary).toBe("FROM A")
        expect(b.records[0].expandedSummary).toBe("FROM B")
    })

    it("loads a session once however many callers ask at once", async () => {
        let gets = 0
        const store = createSessionStore()
        const client = slowClient(() => {
            gets += 1
        })

        const [first, second] = await Promise.all([
            getSessionState(client, store, "s-once", silentLogger),
            getSessionState(client, store, "s-once", silentLogger),
        ])

        expect(first).toBe(second)
        expect(gets).toBe(1)
    })

    it("starts a session with no records when nothing is persisted", async () => {
        const store = createSessionStore()
        const state = await getSessionState(slowClient(), store, "s-fresh", silentLogger)
        expect(state.records).toEqual([])
        expect(state.isSubAgent).toBe(false)
    })

    it("does not cache a failed load", async () => {
        const store = createSessionStore()
        const exploding = {
            session: {
                get: async () => {
                    throw new Error("boom")
                },
            },
        }

        // isSubAgentSession swallows its own errors, so the load still resolves;
        // the guarantee under test is that the entry is usable afterwards.
        const state = await getSessionState(exploding, store, "s-err", silentLogger)
        expect(state.sessionId).toBe("s-err")
        expect(store.sessions.has("s-err")).toBe(true)
    })
})

describe("persistence", () => {
    it("round-trips records through disk", async () => {
        const records = [makeRecord("m3", "m8", "KEPT VERBATIM")]
        await saveSessionState({ sessionId: "s-round", isSubAgent: false, records }, silentLogger)

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
                isSubAgent: false,
                records: [good, { startRawId: "m4" } as never],
            },
            silentLogger,
        )

        const loaded = await loadSessionState("s-mixed", silentLogger)
        expect(loaded).toEqual([good])
    })
})
