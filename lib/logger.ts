export class Logger {
    warn(message: string, data?: unknown): void {
        console.error(`[octrimmer][warn] ${message}`, data ?? "")
    }
}
