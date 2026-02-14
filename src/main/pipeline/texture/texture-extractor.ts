import fs from 'fs'
import path from 'path'

/**
 * Extracts embedded textures from 3D model files to the temp directory.
 * This handles cases where textures are embedded in FBX or glTF files.
 */
export function extractEmbeddedTextures(
  texturePaths: (string | null)[],
  sourceDir: string,
  tempDir: string
): Map<string, string> {
  const resolved = new Map<string, string>()

  for (const texPath of texturePaths) {
    if (!texPath) continue

    // Already absolute and exists
    if (path.isAbsolute(texPath) && fs.existsSync(texPath)) {
      resolved.set(texPath, texPath)
      continue
    }

    // Try relative to source
    const relPath = path.resolve(sourceDir, texPath)
    if (fs.existsSync(relPath)) {
      resolved.set(texPath, relPath)
      continue
    }

    // Try just the filename in source dir
    const baseName = path.basename(texPath)
    const inSourceDir = path.join(sourceDir, baseName)
    if (fs.existsSync(inSourceDir)) {
      resolved.set(texPath, inSourceDir)
      continue
    }

    // Try in temp dir (glTF parser may have written here)
    const inTempDir = path.join(tempDir, baseName)
    if (fs.existsSync(inTempDir)) {
      resolved.set(texPath, inTempDir)
      continue
    }
  }

  return resolved
}
