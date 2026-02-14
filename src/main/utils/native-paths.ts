import path from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * Resolves paths to bundled native binaries.
 * In dev: native/<relative>
 * In prod: resources/<relative> (via extraResources in electron-builder)
 */
export function getNativePath(relativePath: string): string {
  if (is.dev) {
    return path.join(app.getAppPath(), 'native', relativePath)
  }
  return path.join(process.resourcesPath, relativePath)
}

export function getTemplatePath(relativePath: string): string {
  if (is.dev) {
    return path.join(app.getAppPath(), 'resources', 'templates', relativePath)
  }
  return path.join(process.resourcesPath, 'templates', relativePath)
}
