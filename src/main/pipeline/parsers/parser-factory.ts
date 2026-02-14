import path from 'path'
import type { ModelParser } from '../mesh/types'
import { ObjModelParser } from './obj-parser'
import { GltfModelParser } from './gltf-parser'
import { FbxModelParser } from './fbx-parser'
import { BlendHandler } from './blend-handler'

const PARSERS: Record<string, () => ModelParser> = {
  '.obj': () => new ObjModelParser(),
  '.gltf': () => new GltfModelParser(),
  '.glb': () => new GltfModelParser(),
  '.fbx': () => new FbxModelParser(),
  '.blend': () => new BlendHandler()
}

export function createParser(filePath: string): ModelParser {
  const ext = path.extname(filePath).toLowerCase()
  const factory = PARSERS[ext]

  if (!factory) {
    throw new Error(`Unsupported file format: ${ext}. Supported: ${Object.keys(PARSERS).join(', ')}`)
  }

  return factory()
}

export function isSupportedFormat(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext in PARSERS
}
