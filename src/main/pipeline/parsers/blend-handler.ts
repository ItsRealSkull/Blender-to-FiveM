import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { ModelParser, InternalMesh } from '../mesh/types'
import { GltfModelParser } from './gltf-parser'
import { detectBlender } from '../../utils/blender-detector'
import { getNativePath } from '../../utils/native-paths'

const execFileAsync = promisify(execFile)

export class BlendHandler implements ModelParser {
  async parse(filePath: string): Promise<InternalMesh> {
    const blenderPath = await detectBlender()
    if (!blenderPath) {
      throw new Error(
        'Blender not found. Please install Blender to convert .blend files, ' +
        'or export your model as .fbx, .obj, or .glb from Blender first.'
      )
    }

    // Create temp directory for glTF output
    const tempDir = path.join(os.tmpdir(), `b2fivem_${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })

    const outputGlb = path.join(tempDir, 'export.glb')
    const scriptPath = getNativePath('blender-scripts/export_to_gltf.py')

    try {
      await execFileAsync(blenderPath, [
        '--background',
        filePath,
        '--python', scriptPath,
        '--',
        outputGlb
      ], {
        timeout: 120000 // 2 minute timeout
      })

      if (!fs.existsSync(outputGlb)) {
        throw new Error('Blender export failed: no output file generated')
      }

      // Parse the exported glTF
      const gltfParser = new GltfModelParser()
      const mesh = await gltfParser.parse(outputGlb)

      // Use original blend filename as mesh name
      mesh.name = path.basename(filePath, '.blend')

      return mesh
    } finally {
      // Clean up temp files
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
