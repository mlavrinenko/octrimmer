import { existsSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"

// The slice of opencode's config this touches. The plugin SDK's Config type
// predates `skills`, which opencode itself already reads.
export interface SkillsConfig {
    skills?: { paths?: string[] }
}

// The skill ships in the package beside the bundle (`skills/` next to `dist/`),
// so every install route — npm, a nix store path, a local checkout — carries
// it. A bundle copied out on its own has none, and registers nothing.
export function bundledSkillDir(bundleUrl: string): string | undefined {
    const dir = fileURLToPath(new URL("../skills/octrimmer", bundleUrl))
    return existsSync(join(dir, "SKILL.md")) ? dir : undefined
}

export function addSkillPath(config: SkillsConfig, dir: string): void {
    const paths = config.skills?.paths ?? []
    if (paths.includes(dir)) return
    config.skills = { ...config.skills, paths: [...paths, dir] }
}
