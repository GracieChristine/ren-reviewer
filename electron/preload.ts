import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe, typed API to the renderer process.
// The renderer cannot access Node or Electron APIs directly.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true as const,
  getToken: (): Promise<string | null> => ipcRenderer.invoke('token:get'),
  setToken: (token: string): Promise<void> => ipcRenderer.invoke('token:set', token),
  clearToken: (): Promise<void> => ipcRenderer.invoke('token:clear'),
})
