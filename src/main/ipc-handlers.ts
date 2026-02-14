import { ipcMain, dialog, BrowserWindow } from 'electron'
import { runPipeline } from './pipeline/orchestrator'
import { detectBlender } from './utils/blender-detector'
import type { ConversionConfig } from './pipeline/mesh/types'

let currentAbortController: AbortController | null = null

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:select-output', async () => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select Output Folder'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-file', async () => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: 'Select 3D Model',
      filters: [
        { name: '3D Models', extensions: ['fbx', 'obj', 'blend', 'glb', 'gltf'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:get-blender-path', async () => {
    return detectBlender()
  })

  ipcMain.handle('convert:start', async (event, config: ConversionConfig) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found')

    currentAbortController = new AbortController()

    try {
      const result = await runPipeline(config, (progress) => {
        window.webContents.send('convert:progress', progress)
      }, currentAbortController.signal)

      window.webContents.send('convert:complete', result)
      return result
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      window.webContents.send('convert:error', { message: error })
      throw err
    } finally {
      currentAbortController = null
    }
  })

  ipcMain.handle('convert:cancel', () => {
    currentAbortController?.abort()
    currentAbortController = null
  })

  ipcMain.handle('shell:open-folder', async (_event, folderPath: string) => {
    const { shell } = await import('electron')
    shell.openPath(folderPath)
  })
}
