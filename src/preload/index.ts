import { contextBridge, ipcRenderer } from 'electron'

export type ConversionProgress = {
  step: number
  totalSteps: number
  stepName: string
  message: string
  percent: number
}

export type ConversionResult = {
  success: boolean
  resourcePath: string
  files: { name: string; size: number; path: string }[]
}

export type ConversionError = {
  message: string
}

const electronAPI = {
  convert: {
    start: (config: unknown) => ipcRenderer.invoke('convert:start', config),
    cancel: () => ipcRenderer.invoke('convert:cancel'),
    onProgress: (callback: (progress: ConversionProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ConversionProgress) => callback(progress)
      ipcRenderer.on('convert:progress', handler)
      return () => ipcRenderer.removeListener('convert:progress', handler)
    },
    onComplete: (callback: (result: ConversionResult) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: ConversionResult) => callback(result)
      ipcRenderer.on('convert:complete', handler)
      return () => ipcRenderer.removeListener('convert:complete', handler)
    },
    onError: (callback: (error: ConversionError) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: ConversionError) => callback(error)
      ipcRenderer.on('convert:error', handler)
      return () => ipcRenderer.removeListener('convert:error', handler)
    }
  },
  dialog: {
    selectOutputFolder: () => ipcRenderer.invoke('dialog:select-output'),
    selectFile: () => ipcRenderer.invoke('dialog:select-file')
  },
  app: {
    getBlenderPath: () => ipcRenderer.invoke('app:get-blender-path')
  },
  shell: {
    openFolder: (path: string) => ipcRenderer.invoke('shell:open-folder', path)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
