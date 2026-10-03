import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { defineConfig, type Options } from "tsup"

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number]

/** The node_modules packages among a bundle's inputs, sorted. */
export function bundledPackages(inputs: string[]): string[] {
    const names = inputs.flatMap(
        (input) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(input)?.[1] ?? [],
    )
    return [...new Set(names)].toSorted()
}

/** Each package's own licence file, or its declared licence when it ships none. */
export function thirdPartyNotices(packages: string[]): string {
    const sections = packages.map((name) => {
        const dir = join("node_modules", name)
        const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
            version: string
            license: string
        }
        const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/iu.test(f))
        const body = file
            ? readFileSync(join(dir, file), "utf8").trim()
            : `Licensed ${meta.license}; the package ships no licence file.`
        return `## ${name}@${meta.version}\n\n${body}\n`
    })
    return `# Third-party notices\n\ndist/index.js bundles the following packages.\n\n${sections.join("\n")}`
}

// Bundling copies their code, and MIT asks its notice to travel with copies.
const notices: EsbuildPlugin = {
    name: "third-party-notices",
    setup(build) {
        build.initialOptions.metafile = true
        build.onEnd(({ metafile }) => {
            if (!metafile) return
            const outdir = build.initialOptions.outdir ?? "dist"
            mkdirSync(outdir, { recursive: true })
            writeFileSync(
                join(outdir, "THIRD-PARTY-NOTICES.md"),
                thirdPartyNotices(bundledPackages(Object.keys(metafile.inputs))),
            )
        })
    },
}

export default defineConfig({
    entry: ["index.ts"],
    format: ["esm"],
    clean: true,
    // No source map: the bundle is not minified, so a stack trace already
    // names readable code, and the map would be most of the package.
    //
    // Self-contained dist: a plugins-dir or store-path install has no
    // node_modules to resolve the plugin API from — an unresolvable import
    // makes opencode hang silently on boot. Bundle it (and the zod it pulls),
    // which is also why the package declares no runtime dependency on it.
    noExternal: ["@opencode-ai/plugin", "zod"],
    esbuildPlugins: [notices],
})
