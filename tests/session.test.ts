import { mkdir, writeFile } from "fs/promises"
import { join } from "path"
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
        expect(a.records[0]?.expandedSummary).toBe("FROM A")
        expect(b.records[0]?.expandedSummary).toBe("FROM B")
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

    it("loads a file written with the fields since cut", async () => {
        // tests/setup.ts points XDG_DATA_HOME at a temp dir before anything loads.
        const dataHome = process.env["XDG_DATA_HOME"] as string
        const dir = join(dataHome, "opencode", "storage", "plugin", "octrimmer")
        await mkdir(dir, { recursive: true })
        const legacy = {
            ...makeRecord("m1", "m2", "OLD"),
            originMessageId: "m9",
            refs: [{ ref: "#1", rawId: "m1" }],
        }
        await writeFile(
            join(dir, "s-legacy.json"),
            JSON.stringify({ records: [legacy], lastUpdated: "2026-01-01T00:00:00.000Z" }),
        )

        const loaded = await loadSessionState("s-legacy", silentLogger)
        expect(loaded?.map((record) => record.expandedSummary)).toEqual(["OLD"])
    })

    it("drops a record with no createdAt: the summary message is stamped with it", async () => {
        const { createdAt: _dropped, ...undated } = makeRecord("m1", "m2", "UNDATED")
        await saveSessionState(
            { sessionId: "s-undated", records: [undated as never] },
            silentLogger,
        )
        expect(await loadSessionState("s-undated", silentLogger)).toEqual([])
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
