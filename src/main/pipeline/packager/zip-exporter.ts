import fs from 'fs'
import path from 'path'
import archiver from 'archiver'

export async function exportAsZip(resourceDir: string): Promise<string> {
  const zipPath = `${resourceDir}.zip`
  const output = fs.createWriteStream(zipPath)
  const archive = archiver('zip', { zlib: { level: 9 } })

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(zipPath))
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(resourceDir, path.basename(resourceDir))
    archive.finalize()
  })
}
