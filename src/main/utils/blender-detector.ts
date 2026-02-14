import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

const BLENDER_PATHS_WIN = [
  'C:\\Program Files\\Blender Foundation',
  'C:\\Program Files (x86)\\Blender Foundation'
]

let cachedPath: string | null = null

export async function detectBlender(): Promise<string | null> {
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath

  // Check PATH first
  try {
    const { stdout } = await execFileAsync('where', ['blender'], { timeout: 5000 })
    const found = stdout.trim().split('\n')[0]?.trim()
    if (found && fs.existsSync(found)) {
      cachedPath = found
      return found
    }
  } catch {
    // not in PATH
  }

  // Check common installation paths on Windows
  for (const basePath of BLENDER_PATHS_WIN) {
    if (!fs.existsSync(basePath)) continue

    try {
      const dirs = fs.readdirSync(basePath).sort().reverse()
      for (const dir of dirs) {
        const blenderExe = path.join(basePath, dir, 'blender.exe')
        if (fs.existsSync(blenderExe)) {
          cachedPath = blenderExe
          return blenderExe
        }
      }
    } catch {
      // permission issue, skip
    }
  }

  return null
}

export function setBlenderPath(blenderPath: string): void {
  cachedPath = blenderPath
}
