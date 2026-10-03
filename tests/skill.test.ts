import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { pathToFileURL } from "url"
import { describe, expect, it } from "vitest"
import { addSkillPath, bundledSkillDir } from "../lib/skill"

describe("bundledSkillDir", () => {
    it("finds skills/octrimmer next to the dist bundle", () => {
        const bundle = new URL("../dist/index.js", import.meta.url).href
        expect(bundledSkillDir(bundle)).toBe(join(import.meta.dirname, "..", "skills", "octrimmer"))
    })

    it("is undefined for a bundle with no skill beside it", () => {
        const lone = pathToFileURL(join(mkdtempSync(join(tmpdir(), "octrimmer-")), "x.js"))
        expect(bundledSkillDir(lone.href)).toBeUndefined()
    })
})

describe("addSkillPath", () => {
    it("appends after the user's own paths, once", () => {
        const config: { skills?: { paths?: string[] } } = { skills: { paths: ["/mine"] } }
        addSkillPath(config, "/pkg/skills/octrimmer")
        addSkillPath(config, "/pkg/skills/octrimmer")
        expect(config.skills?.paths).toEqual(["/mine", "/pkg/skills/octrimmer"])
    })

    it("creates the section when the config has none", () => {
        const config: { skills?: { paths?: string[] } } = {}
        addSkillPath(config, "/pkg/skills/octrimmer")
        expect(config.skills?.paths).toEqual(["/pkg/skills/octrimmer"])
    })
})
