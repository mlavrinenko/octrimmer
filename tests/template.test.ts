import { describe, expect, it } from "vitest"
import { expandTemplate } from "../lib/template"
import { toVisibleItems } from "../lib/overlay"
import { makeRecord, makeTextMessage, makeToolMessage } from "./helpers"

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

    it("drops tool calls with -tool", () => {
        const result = expandTemplate("[[#2:-tool]]", items)
        expect(result.errors).toEqual([])
        expect(result.text).toBe(
            "Here is your poem:\nRain on the window pane,\nwhispering your name.",
        )
    })

    it("pulls the last text part", () => {
        const result = expandTemplate("[[#4:last-text]]", items)
        expect(result.text).toBe("Extracted OAuth helper.")
    })

    it("drops a tool result but keeps the call", () => {
        const withTool = toVisibleItems([
            makeTextMessage("m1", "user", "Run the suite."),
            makeToolMessage("m2", "assistant", "bash", "FAIL: 2 tests"),
        ])
        const result = expandTemplate("Ran [[#2:-output]]", withTool)
        expect(result.errors).toEqual([])
        expect(result.text).toBe("Ran [tool: bash]")
        expect(result.refs).toEqual([{ ref: "#2:-output", rawId: "m2" }])
    })

    it("combines flags", () => {
        const withTool = toVisibleItems([
            makeTextMessage("m1", "user", "Run the suite."),
            makeToolMessage("m2", "assistant", "bash", "FAIL: 2 tests"),
        ])
        expect(expandTemplate("[[#2:-tool-output]]", withTool).text).toBe("")
        expect(expandTemplate("[[#2:-response]]", withTool).text).toBe(
            "[tool: bash]\nFAIL: 2 tests",
        )
    })

    it("rejects an unknown flag", () => {
        const result = expandTemplate("[[#2:-reasoning]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("unsupported flag")
    })

    it("applies a flag to a quoted phrase", () => {
        const withTool = toVisibleItems([
            makeTextMessage("m1", "user", "Run the suite."),
            makeToolMessage("m2", "assistant", "bash", "FAIL: 2 tests"),
        ])
        const result = expandTemplate('[["FAIL":-output]]', withTool)
        expect(result.errors).toEqual([])
        expect(result.text).toBe("[tool: bash]")
    })

    it("cuts between two phrases in one entry", () => {
        const result = expandTemplate('[["poem:":"whispering"]]', items)
        expect(result.errors).toEqual([])
        expect(result.text).toBe("\nRain on the window pane,\n")
        expect(result.refs).toEqual([{ ref: '"poem:":"whispering"', rawId: "m2" }])
    })

    it("keeps a colon inside a phrase", () => {
        const withColon = toVisibleItems([makeTextMessage("m1", "user", "Spec: GET /x:y is 200")])
        const result = expandTemplate('[["GET /x:y"]]', withColon)
        expect(result.errors).toEqual([])
        expect(result.text).toBe("Spec: GET /x:y is 200")
    })

    it("reports a cut whose end phrase never follows", () => {
        const result = expandTemplate('[["poem:":"unicorn"]]', items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain('followed by "unicorn"')
    })

    it("reports a cut matching more than one entry", () => {
        const result = expandTemplate('[["a":"e"]]', items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("matches 4 entries")
    })

    it("refuses a modifier on a cut", () => {
        const result = expandTemplate('[["poem:":"whispering":-tool]]', items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("takes no modifier")
    })

    it("pulls a contiguous range", () => {
        const result = expandTemplate("[[#3..#4:-tool]]", items)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("Now refactor")
        expect(result.text).toContain("Extracted OAuth")
        expect(result.refs.map((entry) => entry.rawId)).toEqual(["m3", "m4"])
    })

    it("pulls role keys", () => {
        expect(expandTemplate("[[first-user:-tool]]", items).text).toBe(
            "Write me a poem about rain.",
        )
        expect(expandTemplate("[[last-assistant:last-text]]", items).text).toBe(
            "Extracted OAuth helper.",
        )
        expect(expandTemplate("[[first-assistant:last-text]]", items).text).toContain(
            "Here is your poem",
        )
    })

    it("pulls by quoted phrase when it matches exactly one message", () => {
        const result = expandTemplate('[["Here is your poem"]]', items)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("whispering your name")
    })

    it("reports ambiguous patterns with candidate positions", () => {
        const result = expandTemplate('[["poem"]]', items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("matches 2 entries")
        expect(result.errors[0]?.reason).toContain("#1")
        expect(result.errors[0]?.reason).toContain("#2")
    })

    it("reports patterns that match nothing", () => {
        const result = expandTemplate('[["nonexistent unicorn"]]', items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("no entry contains")
    })

    it("reports out-of-range positions", () => {
        const result = expandTemplate("[[#99]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("#99")
    })

    it("rejects a malformed position instead of leaving it literal", () => {
        const result = expandTemplate("[[#two]]", items)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("#two")
    })

    it("treats empty brackets as literal text", () => {
        const result = expandTemplate("See [[]] or [[ ]] here", items)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("[[]]")
        expect(result.text).toContain("[[ ]]")
    })

    it("leaves brackets that do not start a reference as literal text", () => {
        // Summaries of code quote TOML tables, bash tests and wiki links; a
        // reference starts only with #, a quote or a role key.
        const template =
            "Added a [[tasks.status]] table, guarded by [[ -f x ]], see [[wiki note]] and [[m0002]]."
        const result = expandTemplate(template, items)
        expect(result.errors).toEqual([])
        expect(result.refs).toEqual([])
        expect(result.text).toBe(template)
    })

    it("resolves role keys past the message making the trim call", () => {
        // The caller is the newest assistant message: the one saying "trimming
        // from #N". `last-assistant` means the reply before it.
        expect(expandTemplate("[[last-assistant:-tool]]", items, "m4").text).toContain(
            "Here is your poem",
        )
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
                record: makeRecord("m1", "m2", "SUMMARY TEXT"),
                position: 3,
            },
            ...items.slice(2),
        ]
        const result = expandTemplate("Kept: [[#3]]", withSummary)
        expect(result.errors).toEqual([])
        expect(result.text).toContain("SUMMARY TEXT")
    })

    it("is deterministic", () => {
        const template = '[[#2:-tool]] and [[first-user:-tool]] and [["poem about rain":last-text]]'
        const a = expandTemplate(template, items)
        const b = expandTemplate(template, items)
        expect(a.text).toBe(b.text)
        expect(a.errors).toEqual(b.errors)
    })
})
