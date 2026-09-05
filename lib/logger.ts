export class Logger {
    constructor(private readonly enabled = false) {}

    info(message: string, data?: unknown): void {
        if (this.enabled) {
            console.error(`[octrimmer] ${message}`, data ?? "")
        }
    }

    warn(message: string, data?: unknown): void {
        console.error(`[octrimmer][warn] ${message}`, data ?? "")
    }

    error(message: string, data?: unknown): void {
        console.error(`[octrimmer][error] ${message}`, data ?? "")
    }

    debug(message: string, data?: unknown): void {
        if (this.enabled) {
            console.error(`[octrimmer][debug] ${message}`, data ?? "")
        }
    }
}
