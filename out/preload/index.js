"use strict";
const electron = require("electron");
const electronAPI = {
  convert: {
    start: (config) => electron.ipcRenderer.invoke("convert:start", config),
    cancel: () => electron.ipcRenderer.invoke("convert:cancel"),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron.ipcRenderer.on("convert:progress", handler);
      return () => electron.ipcRenderer.removeListener("convert:progress", handler);
    },
    onComplete: (callback) => {
      const handler = (_event, result) => callback(result);
      electron.ipcRenderer.on("convert:complete", handler);
      return () => electron.ipcRenderer.removeListener("convert:complete", handler);
    },
    onError: (callback) => {
      const handler = (_event, error) => callback(error);
      electron.ipcRenderer.on("convert:error", handler);
      return () => electron.ipcRenderer.removeListener("convert:error", handler);
    }
  },
  dialog: {
    selectOutputFolder: () => electron.ipcRenderer.invoke("dialog:select-output"),
    selectFile: () => electron.ipcRenderer.invoke("dialog:select-file")
  },
  app: {
    getBlenderPath: () => electron.ipcRenderer.invoke("app:get-blender-path")
  },
  shell: {
    openFolder: (path) => electron.ipcRenderer.invoke("shell:open-folder", path)
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
