// Type declarations for the API exposed by electron/preload.ts via contextBridge.
// Only present when the app is running inside Electron.
export {}

declare global {
  interface Window {
    electronAPI?: {
      readonly isElectron: true
      getToken: () => Promise<string | null>
      setToken: (token: string) => Promise<void>
      clearToken: () => Promise<void>
    }
  }
}
