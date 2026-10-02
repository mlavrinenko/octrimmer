import { describe, expect, it } from "vitest"
import { renderMessage, renderMessageNoOutput } from "../lib/render"
import type { WithParts } from "../lib/types"

function toolMessage(state: Record<string, unknown>): WithParts {
    return {
        info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 } },
        parts: [{ id: "p1", type: "tool", tool: "edit", callID: "c1", state }],
    } as unknown as WithParts
}

describe("renderMessage tool parts", () => {
    it("renders a completed tool from its output", () => {
        const msg = toolMessage({ status: "completed", input: { filePath: "a.ts" }, output: "ok" })
        expect(renderMessage(msg)).toBe("[tool: edit]\nok")
    })

    it("keeps the error text of a failed tool", () => {
        const msg = toolMessage({
            status: "error",
            input: { filePath: "a.ts" },
            error: "oldString not found",
        })
        expect(renderMessage(msg)).toBe("[tool: edit]\noldString not found")
    })

    it("renders a bare header for a tool with neither output nor error", () => {
        const msg = toolMessage({ status: "running", input: { filePath: "a.ts" } })
        expect(renderMessage(msg)).toBe("[tool: edit]")
    })
})

describe("renderMessageNoOutput", () => {
    it("keeps text and a titled call, drops the result", () => {
        const msg = {
            info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 } },
            parts: [
                { id: "p1", type: "text", text: "Checking the failure." },
                {
                    id: "p2",
                    type: "tool",
                    tool: "bash",
                    callID: "c1",
                    state: { status: "completed", title: "npm test", output: "FAIL: 2 tests" },
                },
            ],
        } as unknown as WithParts
        expect(renderMessageNoOutput(msg)).toBe("Checking the failure.\n\n[tool: bash] npm test")
    })

    it("renders a bare call when the tool carries no title", () => {
        const msg = toolMessage({ status: "completed", output: "ok" })
        expect(renderMessageNoOutput(msg)).toBe("[tool: edit]")
    })

    it("drops an error body like any other result", () => {
        const msg = toolMessage({ status: "error", error: "oldString not found" })
        expect(renderMessageNoOutput(msg)).toBe("[tool: edit]")
    })
})
