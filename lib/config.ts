export interface PluginConfig {
    enabled: boolean
    permission: "allow" | "ask" | "deny"
    allowSubAgents: boolean
    refMapSize: number
}

/** v1: code defaults only, no config file. */
export function getConfig(): PluginConfig {
    return {
        enabled: true,
        permission: "allow",
        allowSubAgents: true,
        refMapSize: 20,
    }
}
