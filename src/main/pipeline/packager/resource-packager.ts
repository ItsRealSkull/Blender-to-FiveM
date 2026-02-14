import fs from 'fs'
import path from 'path'
import { generateFxManifest } from './manifest-generator'

export interface PackagerInput {
  propName: string
  outputFolder: string
  tempDir: string
  ydrPath?: string
  ytdPath?: string
  ybnPath?: string
  ytypPath?: string
  ydrXmlPath: string
  ytdXmlPath: string
  ybnXmlPath: string
  ytypXmlPath: string
}

export interface PackagerResult {
  resourcePath: string
  files: { name: string; size: number; path: string }[]
}

export function packageResource(input: PackagerInput): PackagerResult {
  const resourceDir = path.join(input.outputFolder, input.propName)
  const streamDir = path.join(resourceDir, 'stream')

  // Create directories
  fs.mkdirSync(streamDir, { recursive: true })

  const files: PackagerResult['files'] = []

  // Generate and write fxmanifest.lua
  const manifest = generateFxManifest(input.propName)
  const manifestPath = path.join(resourceDir, 'fxmanifest.lua')
  fs.writeFileSync(manifestPath, manifest, 'utf-8')
  files.push({
    name: 'fxmanifest.lua',
    size: Buffer.byteLength(manifest),
    path: manifestPath
  })

  // Copy binary files to stream/ if they exist (from CodeWalker conversion)
  const binaryFiles = [
    { src: input.ydrPath, name: `${input.propName}.ydr` },
    { src: input.ytdPath, name: `${input.propName}.ytd` },
    { src: input.ybnPath, name: `${input.propName}.ybn` },
    { src: input.ytypPath, name: `${input.propName}.ytyp` }
  ]

  for (const bf of binaryFiles) {
    if (bf.src && fs.existsSync(bf.src)) {
      const destPath = path.join(streamDir, bf.name)
      fs.copyFileSync(bf.src, destPath)
      const stat = fs.statSync(destPath)
      files.push({
        name: `stream/${bf.name}`,
        size: stat.size,
        path: destPath
      })
    }
  }

  // If no binary files were produced (no CodeWalker), copy XML files instead
  // These can be manually converted with CodeWalker later
  const xmlFallbacks = [
    { src: input.ydrXmlPath, name: `${input.propName}.ydr.xml` },
    { src: input.ytdXmlPath, name: `${input.propName}.ytd.xml` },
    { src: input.ybnXmlPath, name: `${input.propName}.ybn.xml` },
    { src: input.ytypXmlPath, name: `${input.propName}.ytyp.xml` }
  ]

  const hasBinaryFiles = binaryFiles.some(bf => bf.src && fs.existsSync(bf.src))

  if (!hasBinaryFiles) {
    for (const xf of xmlFallbacks) {
      if (fs.existsSync(xf.src)) {
        const destPath = path.join(streamDir, xf.name)
        fs.copyFileSync(xf.src, destPath)
        const stat = fs.statSync(destPath)
        files.push({
          name: `stream/${xf.name}`,
          size: stat.size,
          path: destPath
        })
      }
    }

    // Copy DDS textures as well for later conversion
    const ddsFiles = fs.readdirSync(input.tempDir).filter(f => f.endsWith('.dds'))
    for (const ddsFile of ddsFiles) {
      const srcPath = path.join(input.tempDir, ddsFile)
      const destPath = path.join(streamDir, ddsFile)
      fs.copyFileSync(srcPath, destPath)
      const stat = fs.statSync(destPath)
      files.push({
        name: `stream/${ddsFile}`,
        size: stat.size,
        path: destPath
      })
    }
  }

  return { resourcePath: resourceDir, files }
}
