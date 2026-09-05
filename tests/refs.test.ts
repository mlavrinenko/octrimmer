import { describe, expect, it } from "vitest"
import { buildRefMap, parsePosition } from "../lib/refs"
import { makeTextMessage } from "./helpers"

describe("buildRefMap", () => {
    it("lists the tail with stable positions", () => {
        const messages = [
            makeTextMessage("m1", "user", "a"),
            makeTextMessage("m2", "assistant", "b"),
            makeTextMessage("m3", "user", "c"),
        ]
        const map = buildRefMap(messages, 2)
        expect(map).toHaveLength(2)
        expect(map[0]).toMatchObject({ position: 2, role: "assistant", rawId: "m2" })
        expect(map[1]).toMatchObject({ position: 3, role: "user", rawId: "m3" })
    })

    it("caps at the session size", () => {
        const messages = [makeTextMessage("m1", "user", "a")]
        const map = buildRefMap(messages, 20)
        expect(map).toHaveLength(1)
        expect(map[0].position).toBe(1)
    })

    it("summarizes long messages", () => {
        const messages = [makeTextMessage("m1", "user", "x".repeat(500))]
        const map = buildRefMap(messages, 1)
        expect(map[0].snippet.length).toBeLessThan(200)
        expect(map[0].snippet.endsWith("…")).toBe(true)
    })
})

describe("parsePosition", () => {
    it("accepts #N and bare N", () => {
        expect(parsePosition("#12")).toBe(12)
        expect(parsePosition("12")).toBe(12)
    })
    it("rejects garbage", () => {
        expect(parsePosition("abc")).toBeNull()
        expect(parsePosition("#0")).toBeNull()
        expect(parsePosition("#")).toBeNull()
        expect(parsePosition("")).toBeNull()
    })
})
