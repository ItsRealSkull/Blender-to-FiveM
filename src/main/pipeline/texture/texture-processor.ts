import fs from 'fs'
import path from 'path'
import type { InternalMaterial, TextureQuality } from '../mesh/types'
import type { TextureEntry } from '../xml-generators/texture-dict-xml'
import { convertToDDS } from './texconv-bridge'
import { extractEmbeddedTextures } from './texture-extractor'

interface TextureQualityConfig {
  format: string
  formatName: string
  maxSize: number
  mipLevels: number
}

const QUALITY_PRESETS: Record<TextureQuality, TextureQualityConfig> = {
  high: { format: 'BC7_UNORM', formatName: 'D3DFMT_A8B8G8R8', maxSize: 1024, mipLevels: 11 },
  medium: { format: 'BC3_UNORM', formatName: 'D3DFMT_DXT5', maxSize: 512, mipLevels: 10 },
  low: { format: 'BC1_UNORM', formatName: 'D3DFMT_DXT1', maxSize: 256, mipLevels: 9 }
}

export async function processTextures(
  materials: InternalMaterial[],
  propName: string,
  quality: TextureQuality,
  tempDir: string
): Promise<TextureEntry[]> {
  const preset = QUALITY_PRESETS[quality]
  const textures: TextureEntry[] = []
  const processedPaths = new Set<string>()

  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i]

    // Process diffuse texture
    const diffusePath = mat.diffuseTexturePath
    if (diffusePath && fs.existsSync(diffusePath) && !processedPaths.has(diffusePath)) {
      processedPaths.add(diffusePath)

      const texName = `${propName}_diff`
      try {
        const ddsPath = await convertToDDS(diffusePath, tempDir, {
          format: preset.format,
          maxWidth: preset.maxSize,
          maxHeight: preset.maxSize,
          mipLevels: preset.mipLevels,
          outputName: texName
        })

        textures.push({
          name: texName,
          ddsFileName: path.basename(ddsPath),
          width: preset.maxSize,
          height: preset.maxSize,
          mipLevels: preset.mipLevels,
          format: preset.formatName
        })
      } catch (err) {
        console.warn(`Failed to convert texture ${diffusePath}:`, err)
        // Create a placeholder entry
        textures.push(createPlaceholderEntry(texName, preset))
      }
    } else if (!diffusePath || !fs.existsSync(diffusePath || '')) {
      // No texture: create placeholder
      const texName = `${propName}_diff`
      if (!textures.some(t => t.name === texName)) {
        await createPlaceholderDDS(texName, tempDir, preset)
        textures.push(createPlaceholderEntry(texName, preset))
      }
    }

    // Process normal map
    if (mat.normalTexturePath && fs.existsSync(mat.normalTexturePath) && !processedPaths.has(mat.normalTexturePath)) {
      processedPaths.add(mat.normalTexturePath)

      const texName = `${propName}_n`
      try {
        const ddsPath = await convertToDDS(mat.normalTexturePath, tempDir, {
          format: preset.format,
          maxWidth: preset.maxSize,
          maxHeight: preset.maxSize,
          mipLevels: preset.mipLevels,
          outputName: texName
        })

        textures.push({
          name: texName,
          ddsFileName: path.basename(ddsPath),
          width: preset.maxSize,
          height: preset.maxSize,
          mipLevels: preset.mipLevels,
          format: preset.formatName
        })
      } catch (err) {
        console.warn(`Failed to convert normal map:`, err)
      }
    }

    // Process specular map
    if (mat.specularTexturePath && fs.existsSync(mat.specularTexturePath) && !processedPaths.has(mat.specularTexturePath)) {
      processedPaths.add(mat.specularTexturePath)

      const texName = `${propName}_s`
      try {
        const ddsPath = await convertToDDS(mat.specularTexturePath, tempDir, {
          format: preset.format,
          maxWidth: preset.maxSize,
          maxHeight: preset.maxSize,
          mipLevels: preset.mipLevels,
          outputName: texName
        })

        textures.push({
          name: texName,
          ddsFileName: path.basename(ddsPath),
          width: preset.maxSize,
          height: preset.maxSize,
          mipLevels: preset.mipLevels,
          format: preset.formatName
        })
      } catch (err) {
        console.warn(`Failed to convert specular map:`, err)
      }
    }
  }

  // Ensure at least one diffuse texture exists
  if (textures.length === 0) {
    const texName = `${propName}_diff`
    await createPlaceholderDDS(texName, tempDir, preset)
    textures.push(createPlaceholderEntry(texName, preset))
  }

  return textures
}

function createPlaceholderEntry(name: string, preset: TextureQualityConfig): TextureEntry {
  return {
    name,
    ddsFileName: `${name}.dds`,
    width: 64,
    height: 64,
    mipLevels: 7,
    format: 'D3DFMT_DXT1'
  }
}

/**
 * Creates a minimal 64x64 white DDS file as a placeholder.
 * Uses DXT1 format (simplest, smallest).
 */
async function createPlaceholderDDS(name: string, outputDir: string, preset: TextureQualityConfig): Promise<void> {
  // DDS header for a 64x64 DXT1 texture
  const width = 64
  const height = 64
  const headerSize = 128
  const dataSize = (width * height) / 2 // DXT1: 0.5 bytes per pixel

  const buffer = Buffer.alloc(headerSize + dataSize)

  // DDS magic
  buffer.write('DDS ', 0)
  // Header size
  buffer.writeUInt32LE(124, 4)
  // Flags: CAPS | HEIGHT | WIDTH | PIXELFORMAT | MIPMAPCOUNT | LINEARSIZE
  buffer.writeUInt32LE(0x000A1007, 8)
  // Height
  buffer.writeUInt32LE(height, 12)
  // Width
  buffer.writeUInt32LE(width, 16)
  // Linear size
  buffer.writeUInt32LE(dataSize, 20)
  // Mipmap count
  buffer.writeUInt32LE(1, 28)
  // Pixel format size
  buffer.writeUInt32LE(32, 76)
  // Pixel format flags (FOURCC)
  buffer.writeUInt32LE(0x04, 80)
  // FourCC: DXT1
  buffer.write('DXT1', 84)
  // Caps
  buffer.writeUInt32LE(0x1000, 108)

  // Fill DDS data with white (DXT1 white block)
  for (let i = headerSize; i < buffer.length; i += 8) {
    buffer.writeUInt16LE(0xFFFF, i)     // color0 = white
    buffer.writeUInt16LE(0xFFFF, i + 2) // color1 = white
    buffer.writeUInt32LE(0x00000000, i + 4) // all pixels use color0
  }

  const outPath = path.join(outputDir, `${name}.dds`)
  fs.writeFileSync(outPath, buffer)
}
