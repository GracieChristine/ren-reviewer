import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import path from 'path'
import fs from 'fs'

const isDev = !app.isPackaged
const PORT = Number(process.env.PORT ?? 3000)
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

// ── Token storage (OS-level encryption via safeStorage) ──────────────────────

function readConfig(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) }
  catch { return {} }
}

function writeConfig(data: Record<string, string>) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

ipcMain.handle('token:get', (): string | null => {
  const { token } = readConfig()
  if (!token || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(token, 'base64'))
  } catch {
    return null
  }
})

ipcMain.handle('token:set', (_e, token: string): void => {
  if (!safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(token).toString('base64')
  writeConfig({ ...readConfig(), token: encrypted, savedAt: new Date().toISOString() })
})

ipcMain.handle('token:clear', (): void => {
  const config = readConfig()
  delete config.token
  delete config.savedAt
  writeConfig(config)
})

// ── Express server (runs in-process) ─────────────────────────────────────────

async function startExpressServer() {
  // Tell the changelog cache where to write its file (must be set before first require of the cache module)
  process.env.CHANGELOG_CACHE_DIR = app.getPath('userData')

  // Dynamically import to allow tree-shaking and avoid issues during Electron startup
  const { startServer } = isDev
    ? await import('../server/index')           // dev: ts-node compiles on the fly
    : await import('../server/index' as string) // prod: pre-compiled JS in dist/server/

  const staticPath = isDev
    ? null
    : path.join(process.resourcesPath, 'client')

  await startServer(PORT, staticPath)
}

// ── Single-instance lock ─────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // Another instance is already running — quit immediately
  app.quit()
  process.exit(0)
}

// ── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 820,
    minHeight: 560,
    title: 'Ren, the Reviewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = win

  // Open GitLab MR links in the system browser, not Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => { mainWindow = null })

  // In dev: load from Vite (run `npm run dev` separately)
  // In prod: Express serves the built React app
  const url = isDev ? 'http://localhost:8000' : `http://localhost:${PORT}`
  win.loadURL(url)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await startExpressServer()
  createWindow()

  // If a second instance tries to open, focus the existing window instead
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Force-exit the Node process when Electron quits so no background processes linger
app.on('quit', () => process.exit(0))
