import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// Redirect plugin persistence to a temp dir so tests never touch the real
// opencode storage. Must run before any module that computes STORAGE_DIR.
process.env["XDG_DATA_HOME"] = mkdtempSync(join(tmpdir(), "octrimmer-test-"))
