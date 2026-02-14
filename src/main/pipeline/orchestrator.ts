import fs from 'fs'
import path from 'path'
import type { ConversionConfig, ConversionResult } from './mesh/types'
import type { ProgressCallback } from './progress-emitter'
import { emitProgress } from './progress-emitter'
import { createParser } from './parsers/parser-factory'
import { normalizeMesh, computeBoundingBox, computeBoundingSphere } from './mesh/normalizer'
import { generateDrawableXml } from './xml-generators/drawable-xml'
import { generateTextureDictXml, generatePlaceholderTextureDictXml } from './xml-generators/texture-dict-xml'
import { generateBoundsXml } from './xml-generators/bounds-xml'
import { generateYtypXml } from './xml-generators/ytyp-xml'
import { processTextures } from './texture/texture-processor'
import { CodeWalkerBridge } from './codewalker-service/codewalker-bridge'
import { packageResource } from './packager/resource-packager'
import { exportAsZip } from './packager/zip-exporter'
import { createTempDir, cleanTempDir } from '../utils/temp-manager'

export async function runPipeline(
  config: ConversionConfig,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<ConversionResult> {
  const tempDir = createTempDir()

  try {
    // Step 0: Parse 3D model
    emitProgress(onProgress, 0, `Loading ${path.basename(config.inputFile)}...`)
    checkAbort(signal)

    const parser = createParser(config.inputFile)
    let mesh = await parser.parse(config.inputFile)
    mesh = normalizeMesh(mesh)

    emitProgress(onProgress, 0, `Parsed: ${countVertices(mesh)} vertices, ${countFaces(mesh)} faces`)

    // Step 1: Process textures
    emitProgress(onProgress, 1, 'Converting textures to DDS...')
    checkAbort(signal)

    const textures = await processTextures(
      mesh.materials,
      config.propName,
      config.textureQuality,
      tempDir
    )

    emitProgress(onProgress, 1, `Processed ${textures.length} texture(s)`)

    // Step 2: Generate drawable XML
    emitProgress(onProgress, 2, 'Generating drawable definition...')
    checkAbort(signal)

    const ydrXml = generateDrawableXml(mesh, config)
    const ydrXmlPath = path.join(tempDir, `${config.propName}.ydr.xml`)
    fs.writeFileSync(ydrXmlPath, ydrXml, 'utf-8')

    const ytdXml = textures.length > 0
      ? generateTextureDictXml(config.propName, textures)
      : generatePlaceholderTextureDictXml(config.propName)
    const ytdXmlPath = path.join(tempDir, `${config.propName}.ytd.xml`)
    fs.writeFileSync(ytdXmlPath, ytdXml, 'utf-8')

    const ytypXml = generateYtypXml(mesh, config)
    const ytypXmlPath = path.join(tempDir, `${config.propName}.ytyp.xml`)
    fs.writeFileSync(ytypXmlPath, ytypXml, 'utf-8')

    // Step 3: Generate collision
    emitProgress(onProgress, 3, `Generating ${config.collisionType} collision...`)
    checkAbort(signal)

    const ybnXml = generateBoundsXml(mesh, config.collisionType)
    const ybnXmlPath = path.join(tempDir, `${config.propName}.ybn.xml`)
    fs.writeFileSync(ybnXmlPath, ybnXml, 'utf-8')

    // Step 4: Convert to binary using CodeWalker (if available)
    emitProgress(onProgress, 4, 'Converting XML to GTA V binary format...')
    checkAbort(signal)

    let ydrBinaryPath: string | undefined
    let ytdBinaryPath: string | undefined
    let ybnBinaryPath: string | undefined
    let ytypBinaryPath: string | undefined

    const bridge = CodeWalkerBridge.getInstance()
    if (bridge.isAvailable()) {
      try {
        ydrBinaryPath = path.join(tempDir, `${config.propName}.ydr`)
        await bridge.convertYdr(ydrXmlPath, tempDir, ydrBinaryPath)

        ytdBinaryPath = path.join(tempDir, `${config.propName}.ytd`)
        await bridge.convertYtd(ytdXmlPath, tempDir, ytdBinaryPath)

        ybnBinaryPath = path.join(tempDir, `${config.propName}.ybn`)
        await bridge.convertYbn(ybnXmlPath, ybnBinaryPath)

        ytypBinaryPath = path.join(tempDir, `${config.propName}.ytyp`)
        await bridge.convertYtyp(ytypXmlPath, ytypBinaryPath)

        emitProgress(onProgress, 4, 'Binary conversion complete')
      } catch (err) {
        console.error('CodeWalker conversion error:', err)
        emitProgress(onProgress, 4, 'Binary conversion failed, using XML output. Convert manually with CodeWalker.')
        ydrBinaryPath = undefined
        ytdBinaryPath = undefined
        ybnBinaryPath = undefined
        ytypBinaryPath = undefined
      }
    } else {
      emitProgress(onProgress, 4, 'CodeWalker not available - XML files will be exported for manual conversion')
    }

    // Step 5: Package FiveM resource
    emitProgress(onProgress, 5, 'Packaging FiveM resource...')
    checkAbort(signal)

    // Default output folder to Desktop if not specified
    const outputFolder = config.outputFolder || path.join(
      process.env.USERPROFILE || process.env.HOME || '.',
      'Desktop'
    )

    const result = packageResource({
      propName: config.propName,
      outputFolder,
      tempDir,
      ydrPath: ydrBinaryPath,
      ytdPath: ytdBinaryPath,
      ybnPath: ybnBinaryPath,
      ytypPath: ytypBinaryPath,
      ydrXmlPath,
      ytdXmlPath,
      ybnXmlPath,
      ytypXmlPath
    })

    // Optional ZIP export
    if (config.generateZip) {
      await exportAsZip(result.resourcePath)
    }

    emitProgress(onProgress, 5, 'Resource packaged successfully!')

    return {
      success: true,
      resourcePath: result.resourcePath,
      files: result.files
    }

  } finally {
    cleanTempDir(tempDir)
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Conversion cancelled')
  }
}

function countVertices(mesh: { geometries: { vertices: unknown[] }[] }): number {
  return mesh.geometries.reduce((sum, g) => sum + g.vertices.length, 0)
}

function countFaces(mesh: { geometries: { indices: unknown[] }[] }): number {
  return mesh.geometries.reduce((sum, g) => sum + Math.floor(g.indices.length / 3), 0)
}
