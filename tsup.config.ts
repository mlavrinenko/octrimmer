import { defineConfig } from "tsup"

export default defineConfig({
    entry: ["index.ts"],
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    // Self-contained dist: the plugin API is a peer dep that a plugins-dir /
    // local install has no node_modules to resolve — an unresolvable import
    // makes opencode hang silently on boot. Bundle it (and the zod it pulls).
    noExternal: ["@opencode-ai/plugin", "zod"],
})
