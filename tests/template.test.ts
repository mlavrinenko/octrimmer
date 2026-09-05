import { describe, expect, it } from "vitest"
import { expandTemplate } from "../lib/template"
import { toVisibleItems } from "../lib/overlay"
import { makeTextMessage } from "./helpers"

const messages = [
    makeTextMessage("m1", "user", "Write me a poem about rain."),
    makeTextMessage(
        "m2",
        "assistant",
        "Here is your poem:\nRain on the window pane,\nwhispering your name.",
    ),
    makeTextMessage("m3", "user", "Now refactor the auth module."),
    makeTextMessage("m4", "assistant", "Extracted OAuth helper."),
]

const items = toVisibleItems(messages)

describe("expandTemplate", () => {
    it("pulls a whole message verbatim by position", () => {
        const result = expandTemplate("Poem:\n[[#2]]", items)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("Here is your poem")
        expect(result.text).toContain("whispering your name")
        expect(result.refs).toEqual([{ ref: "#2", rawId: "m2" }])
    })

    it("pulls only text parts", () => {
        const result = expandTemplate("[[#2:text]]", items)
        expect(result.errors).toEqual([])
        expect(result.text).toBe(
            "Here is your poem:\nRain on the window pane,\nwhispering your name.",
        )
    })

    it("pulls the last text part", () => {
        const result = expandTemplate("[[#4:last-text]]", items)
        expect(result.text).toBe("Extracted OAuth helper.")
    })

    it("pulls a contiguous range", () => {
        const result = expandTemplate("[[#3..#4:text]]", items)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("Now refactor")
        expect(result.text).toContain("Extracted OAuth")
        expect(result.refs.map((entry) => entry.rawId)).toEqual(["m3", "m4"])
    })

    it("pulls role keys", () => {
        expect(expandTemplate("[[first-user:text]]", items).text).toBe(
            "Write me a poem about rain.",
        )
        expect(expandTemplate("[[last-assistant:last-text]]", items).text).toBe(
            "Extracted OAuth helper.",
        )
        expect(expandTemplate("[[first-assistant:last-text]]", items).text).toContain(
            "Here is your poem",
        )
    })

    it("pulls by content pattern when it matches exactly one message", () => {
        const result = expandTemplate("[[Here is your poem]]", items)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("whispering your name")
    })

    it("reports ambiguous patterns with candidate positions", () => {
        const result = expandTemplate("[[poem]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0].reason).toContain("matches 2 entries")
        expect(result.errors[0].reason).toContain("#1")
        expect(result.errors[0].reason).toContain("#2")
    })

    it("reports patterns that match nothing", () => {
        const result = expandTemplate("[[nonexistent unicorn]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0].reason).toContain("no entry contains")
    })

    it("reports out-of-range positions", () => {
        const result = expandTemplate("[[#99]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0].reason).toContain("#99")
    })

    it("rejects legacy message IDs loudly", () => {
        const result = expandTemplate("[[m0002]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0].reason).toContain("does not inject message IDs")
    })

    it("treats empty brackets as literal text", () => {
        const result = expandTemplate("See [[]] or [[ ]] here", items)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("[[]]")
        expect(result.text).toContain("[[ ]]")
    })

    it("treats any non-empty bracket group as a reference attempt", () => {
        // `[[wiki note]]` looks like a reference, so it is one: pattern not
        // found -> hard error. Literal brackets must be escaped (`\[[`).
        const result = expandTemplate("See [[wiki note]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0].reason).toContain("no entry contains")
    })

    it("honors escapes", () => {
        const result = expandTemplate("Literal \\[[#2]] stays", items)
        expect(result.errors).toEqual([])
        expect(result.text).toBe("Literal [[#2]] stays")
    })

    it("degrades to plain prose with no references", () => {
        const result = expandTemplate("Shipped the fix; reran the suite green.", items)
        expect(result.errors).toEqual([])
        expect(result.refs).toEqual([])
        expect(result.text).toBe("Shipped the fix; reran the suite green.")
    })

    it("pulls a summary entry from an earlier trim", () => {
        const withSummary = [
            ...items.slice(0, 2),
            {
                kind: "summary" as const,
                text: "SUMMARY TEXT",
                position: 3,
            },
            ...items.slice(2),
        ]
        const result = expandTemplate("Kept: [[#3]]", withSummary)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("SUMMARY TEXT")
    })

    it("is deterministic", () => {
        const template = "[[#2:text]] and [[first-user:text]] and [[poem about rain:last-text]]"
        const a = expandTemplate(template, items)
        const b = expandTemplate(template, items)
        expect(a.text).toBe(b.text)
        expect(a.errors).toEqual(b.errors)
    })
})
