import { defineConfig } from "tsup"

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
})
