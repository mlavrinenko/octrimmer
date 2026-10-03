import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { bundledPackages, thirdPartyNotices } from "../tsup.config"

describe("bundledPackages", () => {
    it("names each package the bundle pulled from node_modules, once", () => {
        const inputs = [
            "index.ts",
            "lib/trim.ts",
            "node_modules/zod/v4/core/core.js",
            "node_modules/zod/v4/classic/schemas.js",
            "node_modules/@opencode-ai/plugin/dist/tool.js",
        ]
        expect(bundledPackages(inputs)).toEqual(["@opencode-ai/plugin", "zod"])
    })
})

describe("thirdPartyNotices", () => {
    const notices = thirdPartyNotices(["@opencode-ai/plugin", "zod"])

    it("carries a package's own licence text", () => {
        expect(notices).toContain(readFileSync("node_modules/zod/LICENSE", "utf8").trim())
    })

    it("falls back to the declared licence when the package ships no file", () => {
        expect(notices).toMatch(/## @opencode-ai\/plugin@\S+\n\nLicensed MIT/u)
    })
})
