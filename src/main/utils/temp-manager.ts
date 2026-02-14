import fs from 'fs'
import path from 'path'
import os from 'os'

const PREFIX = 'b2fivem_'

export function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `${PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function cleanTempDir(dir: string): void {
  try {
    if (dir.includes(PREFIX)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // ignore cleanup errors
  }
}

export function cleanAllTempDirs(): void {
  try {
    const tmpDir = os.tmpdir()
    const entries = fs.readdirSync(tmpDir)
    for (const entry of entries) {
      if (entry.startsWith(PREFIX)) {
        const fullPath = path.join(tmpDir, entry)
        try {
          fs.rmSync(fullPath, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}
