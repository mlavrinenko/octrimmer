import * as fs from "fs/promises"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { Logger } from "./logger"
import type { SessionState, TrimRecord } from "./state"

const STORAGE_DIR = join(
    process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share"),
    "opencode",
    "storage",
    "plugin",
    "octrimmer",
)

function getSessionFilePath(sessionId: string): string {
    return join(STORAGE_DIR, `${sessionId}.json`)
}

export async function saveSessionState(state: SessionState, logger: Logger): Promise<void> {
    try {
        if (!existsSync(STORAGE_DIR)) {
            await fs.mkdir(STORAGE_DIR, { recursive: true })
        }
        await fs.writeFile(
            getSessionFilePath(state.sessionId),
            JSON.stringify({ records: state.records }, null, 2),
            "utf-8",
        )
    } catch (error: unknown) {
        logger.warn("Failed to save session state", {
            sessionId: state.sessionId,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}

export async function loadSessionState(
    sessionId: string,
    logger: Logger,
): Promise<TrimRecord[] | null> {
    try {
        const filePath = getSessionFilePath(sessionId)
        if (!existsSync(filePath)) {
            return null
        }
        const content = await fs.readFile(filePath, "utf-8")
        const parsed = JSON.parse(content) as { records?: unknown }
        if (!Array.isArray(parsed.records)) {
            return null
        }
        const valid = parsed.records.filter(isTrimRecord)
        if (valid.length !== parsed.records.length) {
            logger.warn("Filtered malformed trim records", {
                sessionId,
                original: parsed.records.length,
                valid: valid.length,
            })
        }
        return valid
    } catch (error: unknown) {
        logger.warn("Failed to load session state", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        })
        return null
    }
}

function isTrimRecord(value: unknown): value is TrimRecord {
    if (!value || typeof value !== "object") {
        return false
    }
    const record = value as Partial<Record<keyof TrimRecord, unknown>>
    return (
        typeof record.startRawId === "string" &&
        typeof record.endRawId === "string" &&
        typeof record.expandedSummary === "string" &&
        typeof record.createdAt === "number" &&
        (record.actionRightAfterTrim === undefined ||
            typeof record.actionRightAfterTrim === "string")
    )
}
