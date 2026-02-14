import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { getNativePath } from '../../utils/native-paths'

const execFileAsync = promisify(execFile)

export interface TextureConvertOptions {
  format: string       // BC1_UNORM, BC3_UNORM, BC7_UNORM
  maxWidth: number
  maxHeight: number
  mipLevels: number
  outputName?: string
}

let texconvAvailable: boolean | null = null

async function checkTexconv(): Promise<boolean> {
  if (texconvAvailable !== null) return texconvAvailable

  const texconvPath = getNativePath('texconv/texconv.exe')
  texconvAvailable = fs.existsSync(texconvPath)
  return texconvAvailable
}

export async function convertToDDS(
  inputPath: string,
  outputDir: string,
  options: TextureConvertOptions
): Promise<string> {
  const hasTexconv = await checkTexconv()

  if (!hasTexconv) {
    // Fallback: copy the file as-is and return a placeholder path
    console.warn('texconv.exe not found, using fallback DDS generation')
    return fallbackConvert(inputPath, outputDir, options)
  }

  const texconvPath = getNativePath('texconv/texconv.exe')
  const outputName = options.outputName || path.basename(inputPath, path.extname(inputPath))

  const args = [
    '-f', options.format,
    '-m', String(options.mipLevels),
    '-w', String(options.maxWidth),
    '-h', String(options.maxHeight),
    '-o', outputDir,
    '-y', // overwrite existing
    '-sepalpha', // preserve alpha
    inputPath
  ]

  try {
    await execFileAsync(texconvPath, args, { timeout: 60000 })
  } catch (err) {
    console.error('texconv failed:', err)
    return fallbackConvert(inputPath, outputDir, options)
  }

  // texconv outputs with original filename + .dds extension
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const generatedPath = path.join(outputDir, `${baseName}.dds`)

  // Rename to desired output name if different
  const finalPath = path.join(outputDir, `${outputName}.dds`)
  if (generatedPath !== finalPath && fs.existsSync(generatedPath)) {
    fs.renameSync(generatedPath, finalPath)
  }

  return finalPath
}

/**
 * Fallback: creates a minimal white DDS placeholder when texconv is not available.
 */
async function fallbackConvert(
  inputPath: string,
  outputDir: string,
  options: TextureConvertOptions
): Promise<string> {
  const outputName = options.outputName || path.basename(inputPath, path.extname(inputPath))
  const outputPath = path.join(outputDir, `${outputName}.dds`)

  // Create minimal 64x64 DXT1 white DDS
  const width = 64
  const height = 64
  const headerSize = 128
  const dataSize = (width * height) / 2

  const buffer = Buffer.alloc(headerSize + dataSize)
  buffer.write('DDS ', 0)
  buffer.writeUInt32LE(124, 4)
  buffer.writeUInt32LE(0x000A1007, 8)
  buffer.writeUInt32LE(height, 12)
  buffer.writeUInt32LE(width, 16)
  buffer.writeUInt32LE(dataSize, 20)
  buffer.writeUInt32LE(1, 28)
  buffer.writeUInt32LE(32, 76)
  buffer.writeUInt32LE(0x04, 80)
  buffer.write('DXT1', 84)
  buffer.writeUInt32LE(0x1000, 108)

  for (let i = headerSize; i < buffer.length; i += 8) {
    buffer.writeUInt16LE(0xFFFF, i)
    buffer.writeUInt16LE(0xFFFF, i + 2)
    buffer.writeUInt32LE(0x00000000, i + 4)
  }

  fs.writeFileSync(outputPath, buffer)
  return outputPath
}
