import { describe, expect, it } from "vitest"
import { formatSize, inspectReply, listReply, queryReply } from "../lib/explore"
import { toVisibleItems, type VisibleItem } from "../lib/overlay"
import type { WithParts } from "../lib/types"
import { makeRecord, makeTextMessage } from "./helpers"

function multiPartMessage(
    id: string,
    role: "user" | "assistant",
    parts: Array<Record<string, unknown>>,
): WithParts {
    return {
        info: { id, sessionID: "s1", role, time: { created: 1 } },
        parts,
    } as unknown as WithParts
}

const auth: VisibleItem[] = toVisibleItems([
    makeTextMessage("u1", "user", "The token request is failing in CI."),
    multiPartMessage("a1", "assistant", [
        { type: "text", text: "Let me reproduce it." },
        { type: "reasoning", text: "A 401 usually means the clock is skewed." },
        {
            type: "tool",
            tool: "bash",
            state: { status: "completed", output: "curl /token -> HTTP 401 Unauthorized" },
        },
    ]),
    multiPartMessage("a2", "assistant", [
        { type: "text", text: "The 401 is clock skew; retry after NTP sync." },
        { type: "tool", tool: "edit", state: { status: "completed", output: "patched token.ts" } },
    ]),
    makeTextMessage("u2", "user", "Ship it once the clock is fixed."),
])

const summaryText = "Earlier trim: fixed the 401 clock skew."
const withSummary: VisibleItem[] = [
    ...toVisibleItems([makeTextMessage("s1", "assistant", "tail work")]),
    {
        kind: "summary",
        text: summaryText,
        record: makeRecord("old1", "old2", summaryText),
        position: 2,
    },
]

const numbered = (count: number): VisibleItem[] =>
    toVisibleItems(
        Array.from({ length: count }, (_, index) =>
            makeTextMessage(
                `m${index + 1}`,
                index % 2 === 0 ? "user" : "assistant",
                `alpha ${index + 1}`,
            ),
        ),
    )

describe("formatSize", () => {
    it("renders bytes under a thousand and kilobytes above", () => {
        expect(formatSize(0)).toBe("0B")
        expect(formatSize(999)).toBe("999B")
        expect(formatSize(1000)).toBe("1.0KB")
        expect(formatSize(2400)).toBe("2.4KB")
    })
})

describe("listReply paging", () => {
    const items = numbered(87)

    it("keeps the tail header when no before is given", () => {
        const reply = listReply(items)
        expect(reply.split("\n")[0]).toBe("Context has 87 entries. Last 20:")
        expect(reply).not.toContain("older:")
        expect(reply).toContain("#68")
        expect(reply).toContain("#87")
    })

    it("lists the window ending before a position and hints at the next before", () => {
        const reply = listReply(items, 20, "#40")
        expect(reply.split("\n")[0]).toBe("Context has 87 entries. 20 ending before #40:")
        expect(reply).toContain("#20 [assistant] alpha 20")
        expect(reply).toContain("#39 [user] alpha 39")
        expect(reply).not.toContain("#19 [")
        expect(reply).not.toContain("#40 [")
        expect(reply.endsWith('older: before: "#20"')).toBe(true)
    })

    it("omits the hint once the window reaches the first entry", () => {
        const reply = listReply(items, 20, "#21")
        expect(reply.split("\n")[0]).toBe("Context has 87 entries. 20 ending before #21:")
        expect(reply).toContain("#1 [user] alpha 1")
        expect(reply).not.toContain("older:")
    })

    it("notes a clamped count in the header", () => {
        expect(listReply(items, 100).split("\n")[0]).toBe(
            "Context has 87 entries. Last 50 (capped at 50):",
        )
        expect(listReply(items, 100, "#60").split("\n")[0]).toBe(
            "Context has 87 entries. 50 ending before #60 (capped at 50):",
        )
    })

    it("refuses a garbage, below-one or out-of-range before", () => {
        expect(() => listReply(items, 20, "abc")).toThrow('invalid before "abc"')
        expect(() => listReply(items, 20, "#0")).toThrow('invalid before "#0"')
        expect(() => listReply(items, 20, "#1")).toThrow(
            "nothing before #1 — the list starts at #1.",
        )
        expect(() => listReply(items, 20, "#88")).toThrow("context has 87 entries")
    })
})

describe("queryReply", () => {
    it("searches reasoning and tool output, not just text", () => {
        expect(queryReply(auth, "skewed")).toContain("#2 [assistant]")
        expect(queryReply(auth, "Unauthorized")).toContain(".3 [tool: bash]")
    })

    it("reports parts with sizes and excerpts, with no +K when all matching parts fit", () => {
        const reply = queryReply(auth, "401")
        expect(reply.split("\n")[0]).toBe(
            'query "401" — 2 of 4 entries (reasoning and tool output searched)',
        )
        expect(reply).toContain("#2 [assistant] 3 parts,")
        expect(reply).toContain(".2 [reasoning]")
        expect(reply).toContain(".3 [tool: bash]")
        expect(reply).toMatch(/\.3 \[tool: bash\][^\n]*HTTP 401 Unauthorized$/mu)
        expect(reply).toContain("#3 [assistant] 2 parts,")
        expect(reply).toMatch(/\.1 \[text\][^\n]*401 is clock skew/u)
        expect(reply).not.toMatch(/ \+\d/u)
    })

    it("caps part lines at three and counts only matching parts left off", () => {
        const many = toVisibleItems([
            multiPartMessage("a1", "assistant", [
                { type: "text", text: "alpha one" },
                { type: "reasoning", text: "alpha two" },
                {
                    type: "tool",
                    tool: "bash",
                    state: { status: "completed", output: "alpha three" },
                },
                {
                    type: "tool",
                    tool: "edit",
                    state: { status: "completed", output: "alpha four" },
                },
                { type: "text", text: "beta noise, no term here" },
            ]),
        ])
        const reply = queryReply(many, "alpha")
        const partLines = reply.split("\n").filter((line) => line.startsWith("  ."))
        expect(reply).toContain("#1 [assistant] 5 parts,")
        expect(partLines).toHaveLength(3)
        expect(partLines[2]).toMatch(/ \+1$/u)
    })

    it("adds a cut line only when the first and last terms each occur once, in order", () => {
        const reply = queryReply(auth, "401 clock")
        const cuts = reply.split("\n").filter((line) => line.includes("cut:"))
        expect(cuts).toEqual(['  cut: [["401":"clock"]]'])
        expect(reply).toContain("#3 [assistant]")
    })

    it("skips the cut when a term repeats or contains a double quote", () => {
        expect(queryReply(auth, "401 401")).not.toContain("cut:")
        expect(queryReply(auth, '401 "clock')).not.toContain("cut:")
    })

    it("reports a summary entry without part numbers", () => {
        const reply = queryReply(withSummary, "clock")
        expect(reply).toContain(`#2 [summary] ${formatSize(summaryText.length)}`)
        expect(reply).toContain("Earlier trim: fixed the 401 clock skew.")
        expect(reply).not.toContain(".1")
    })

    it("caps results and names how many are shown", () => {
        const reply = queryReply(numbered(60), "alpha", 99)
        expect(reply.split("\n")[0]).toBe(
            'query "alpha" — 60 of 60 entries, first 50 shown (reasoning and tool output searched)',
        )
        const entries = reply.split("\n").filter((line) => /^#\d+ /u.test(line))
        expect(entries).toHaveLength(50)
    })

    it("refuses an empty query and reports an empty result", () => {
        expect(() => queryReply(auth, "   ")).toThrow("query is empty")
        expect(queryReply(auth, "zebra")).toBe(
            'No entry matches "zebra" (searched 4 entries; reasoning and tool output included).',
        )
    })
})

describe("inspectReply", () => {
    it("maps a message part by part with sizes and previews", () => {
        const reply = inspectReply(auth, "#2")
        const [header, ...lines] = reply.split("\n")
        expect(header).toMatch(/^#2 \[assistant\] 3 parts, \d+B$/u)
        expect(lines[0]).toMatch(/^  \.1 \[text\] \d+B — Let me reproduce it\.$/u)
        expect(lines[1]).toMatch(/^  \.2 \[reasoning\] \d+B — \[reasoning\] A 401/u)
        expect(lines[2]).toMatch(/^  \.3 \[tool: bash\] \d+B — \[tool: bash\] curl/u)
    })

    it("prints a summary as one line", () => {
        expect(inspectReply(withSummary, "2")).toBe(
            `#2 [summary] ${formatSize(summaryText.length)} — ${summaryText}`,
        )
    })

    it("says 1 part, not 1 parts", () => {
        expect(queryReply(withSummary, "tail")).toContain("#1 [assistant] 1 part,")
        expect(inspectReply(withSummary, "1")).toContain("#1 [assistant] 1 part,")
    })

    it("refuses garbage and an out-of-range position", () => {
        expect(() => inspectReply(auth, "abc")).toThrow('invalid inspect "abc"')
        expect(() => inspectReply(auth, "#9")).toThrow(
            "inspect #9 is out of range — context has 4 entries",
        )
    })
})
