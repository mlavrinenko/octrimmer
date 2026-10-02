import { describe, expect, it } from "vitest"
import { expandTemplate } from "../lib/template"
import { toVisibleItems } from "../lib/overlay"
import type { WithParts } from "../lib/types"
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

// #2 is a1: two addressable reasoning/text/tool parts, plus empty and
// non-rendered parts that must not take a number.
const partsItems = toVisibleItems([
    makeTextMessage("u1", "user", "Fix the failing test."),
    {
        info: { id: "a1", sessionID: "s1", role: "assistant", time: { created: 1 } },
        parts: [
            { id: "p0", type: "step-start" },
            { id: "p1", type: "reasoning", text: "Check the suite first." },
            { id: "p2", type: "text", text: "Running the suite." },
            {
                id: "p3",
                type: "tool",
                tool: "bash",
                callID: "c1",
                state: { status: "completed", output: "FAIL: 2 tests" },
            },
            { id: "p4", type: "reasoning", text: "   " },
            { id: "p5", type: "file", file: "a.ts" },
            { id: "p6", type: "text", text: "Two tests fail." },
        ],
    } as unknown as WithParts,
])

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
        const result = expandTemplate("[[#2:-bogus]]", items)
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

    it("cuts between two phrases in one entry, markers included", () => {
        const result = expandTemplate('[["poem:":"whispering"]]', items)
        expect(result.errors).toEqual([])
        expect(result.text).toBe("poem:\nRain on the window pane,\nwhispering")
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

describe("expandTemplate part references", () => {
    it("pulls one part, numbered in render order", () => {
        expect(expandTemplate("[[#2.1]]", partsItems).text).toBe(
            "[reasoning]\nCheck the suite first.",
        )
        expect(expandTemplate("[[#2.2]]", partsItems).text).toBe("Running the suite.")
        expect(expandTemplate("[[#2.3]]", partsItems).text).toBe("[tool: bash]\nFAIL: 2 tests")
        expect(expandTemplate("[[#2.4]]", partsItems).text).toBe("Two tests fail.")
    })

    it("applies flags to a part", () => {
        expect(expandTemplate("[[#2.3:-output]]", partsItems).text).toBe("[tool: bash]")
        expect(expandTemplate("[[#2.2:-output]]", partsItems).text).toBe("Running the suite.")
    })

    it("refuses a flag that drops the addressed part", () => {
        for (const [ref, section] of [
            ["[[#2.1:-reasoning]]", "-reasoning"],
            ["[[#2.2:-response]]", "-response"],
            ["[[#2.3:-tool]]", "-tool"],
        ] as const) {
            const result = expandTemplate(ref, partsItems)
            expect(result.errors.length).toBe(1)
            expect(result.errors[0]?.reason).toContain(`${section} drops the addressed part`)
        }
    })

    it("reports the entry's rawId for a part pull", () => {
        const result = expandTemplate("[[#2.2]]", partsItems)
        expect(result.errors).toEqual([])
        expect(result.refs).toEqual([{ ref: "#2.2", rawId: "a1" }])
    })

    it("includes reasoning by default and drops it on request", () => {
        expect(expandTemplate("[[#2.1]]", partsItems).text).toContain("[reasoning]")
        expect(expandTemplate("[[#2:-reasoning]]", partsItems).text).toBe(
            "Running the suite.\n\n[tool: bash]\nFAIL: 2 tests\n\nTwo tests fail.",
        )
    })

    it("combines flags on a part in any order", () => {
        expect(expandTemplate("[[#2.2:-output-reasoning]]", partsItems).text).toBe(
            "Running the suite.",
        )
        expect(expandTemplate("[[#2.2:-reasoning-output]]", partsItems).text).toBe(
            "Running the suite.",
        )
        expect(expandTemplate("[[#2.1:-response-output]]", partsItems).text).toBe(
            "[reasoning]\nCheck the suite first.",
        )
    })

    it("refuses last-text on a part", () => {
        const result = expandTemplate("[[#2.2:last-text]]", partsItems)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("last-text")
        expect(result.errors[0]?.reason).toContain("part")
    })

    it("reports a part beyond the count, naming the candidate count", () => {
        const result = expandTemplate("[[#2.9]]", partsItems)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("#2 has 4 parts, no .9")
    })

    it("reports a summary as having no parts", () => {
        const withSummary = [
            ...partsItems.slice(0, 1),
            {
                kind: "summary" as const,
                text: "SUMMARY TEXT",
                record: makeRecord("u1", "u1", "SUMMARY TEXT"),
                position: 2,
            },
        ]
        const result = expandTemplate("[[#2.1]]", withSummary)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("#2 is a summary and has no parts")
    })

    it("reports no entry at a part position, naming the candidate count", () => {
        const result = expandTemplate("[[#99.1]]", partsItems)
        expect(result.errors.length).toBe(1)
        expect(result.errors[0]?.reason).toContain("no entry at #99")
        expect(result.errors[0]?.reason).toContain("context has 2")
    })
})
