import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import * as gitService from './services/git.service'
import { askpass } from './services/askpass.service'
import { history } from './services/history.service'
import { repoService } from './services/repo.service'
import { settingsService } from './services/settings.service'
import type { AskpassRequest, IpcResult, OpenTabs, PullMode } from '../src/types/git'

// Layout after build:
// ├─ dist/            renderer (index.html)
// └─ dist-electron/   main.js, preload.js
process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
// Files in public/ are copied to dist/ at build time
const PUBLIC_DIR = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Development gets its own data folder (~/.config/Gitfy-dev) so recent repos, UI prefs and
// caches from `bun run dev` never leak into the installed/released app (~/.config/Gitfy).
// Must run before the app is ready.
if (VITE_DEV_SERVER_URL) {
  app.setPath('userData', path.join(app.getPath('appData'), `${app.getName()}-dev`))
}

let win: BrowserWindow | null = null

// ---------------------------------------------------------------------------
// Splash screen
// ---------------------------------------------------------------------------

/** Keep the splash up at least this long so it doesn't just flash */
const MIN_SPLASH_MS = 1200
/** Show the app anyway if the renderer never reports ready */
const SPLASH_TIMEOUT_MS = 15000

let splash: BrowserWindow | null = null
let splashShownAt = 0
let startupDone = false

function createSplash() {
  splash = new BrowserWindow({
    width: 660,
    height: 360,
    center: true,
    show: false,
    // No title bar and no window buttons: the splash can't be closed, minimised or resized
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Gitfy',
    icon: path.join(PUBLIC_DIR, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  splash.once('ready-to-show', () => {
    splash?.show()
    splashShownAt = Date.now()
    setSplashProgress(15)
  })
  // The splash page is static and local; it never navigates or opens windows
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  splash.webContents.on('will-navigate', (e) => e.preventDefault())
  splash.loadFile(path.join(PUBLIC_DIR, 'splash.html'))
}

function setSplashProgress(percent: number) {
  if (!splash || splash.isDestroyed()) return
  splash.webContents.executeJavaScript(`window.setProgress && window.setProgress(${Number(percent)})`).catch(() => {})
}

/** Fill the bar, then swap the splash for the main window (runs once) */
function finishStartup() {
  if (startupDone) return
  startupDone = true
  setSplashProgress(100)
  const wait = Math.max(350, MIN_SPLASH_MS - (Date.now() - splashShownAt))
  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      // Briefly pin on top so window managers with focus-stealing prevention still raise it
      win.setAlwaysOnTop(true)
      win.show()
      win.focus()
      win.moveTop()
      win.setAlwaysOnTop(false)
    }
    // destroy() bypasses `closable: false`
    if (splash && !splash.isDestroyed()) splash.destroy()
    splash = null
  }, wait)
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    show: false, // revealed by finishStartup() once the UI has restored its tabs
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Gitfy',
    icon: path.join(PUBLIC_DIR, 'icon.png'),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Open external links in the OS browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return
    if (url === win?.webContents.getURL()) return // reload
    e.preventDefault()
  })

  win.webContents.once('did-finish-load', () => setSplashProgress(70))
  // If the UI fails to load or never reports ready, still show the window instead of hanging on the splash
  win.webContents.once('did-fail-load', () => finishStartup())
  setTimeout(finishStartup, SPLASH_TIMEOUT_MS)
  setSplashProgress(40)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function applyCsp() {
  if (VITE_DEV_SERVER_URL) return // Vite HMR needs inline scripts in dev
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; worker-src 'self' blob:",
        ],
      },
    })
  })
}

/** Register an IPC handler whose errors are returned as values instead of rejected promises */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) {
  ipcMain.handle(channel, async (_e: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<R>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: cleanError(err) }
    }
  })
}

function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^(fatal|error):\s*/gim, '').trim() || 'Unknown error'
}

function registerIpc() {
  // Dialogs
  handle('dialog:selectDirectory', async (title?: string) => {
    const res = await dialog.showOpenDialog(win!, {
      title: title ?? 'Select folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // Repository management
  handle('repo:open', (dir: string, remember?: boolean) => repoService.open(dir, remember !== false))
  handle('repo:init', (dir: string) => repoService.init(dir))
  handle('repo:clone', (url: string, parent: string, name?: string) => repoService.clone(url, parent, name))
  handle('repo:close', (repo: string) => {
    repoService.close(repo)
    history.clear(repo)
  })
  handle('repo:recent', () => repoService.getRecent())
  handle('tabs:get', () => repoService.getOpenTabs())
  handle('tabs:save', (tabs: OpenTabs) => repoService.saveOpenTabs(tabs))
  handle('repo:removeRecent', (p: string) => repoService.removeRecent(p))
  handle('repo:reveal', (repo: string) => shell.openPath(repoService.require(repo).path))

  // Every git channel takes the repository root path (one per tab) as its first argument
  // Status & staging
  handle('git:status', (repo: string) => gitService.getStatus(repo))
  handle('git:stage', (repo: string, files: string[]) => gitService.stage(repo, files))
  handle('git:stageAll', (repo: string) => gitService.stageAll(repo))
  handle('git:unstage', (repo: string, files: string[]) => gitService.unstage(repo, files))
  handle('git:unstageAll', (repo: string) => gitService.unstageAll(repo))
  handle('git:fileDiff', (repo: string, file: string, staged: boolean, from?: string) =>
    gitService.getFileDiff(repo, file, staged, from),
  )

  // Commit & history
  handle('git:commit', (repo: string, summary: string, description?: string, newBranch?: string) =>
    gitService.commit(repo, summary, description, typeof newBranch === 'string' ? newBranch : undefined),
  )
  handle('git:log', (repo: string, limit?: number) => gitService.getLog(repo, limit))
  handle('git:getCommit', (repo: string, hash: string) => gitService.getCommit(repo, hash))
  handle('git:commitFiles', (repo: string, hash: string) => gitService.getCommitFiles(repo, hash))
  handle('git:commitFileDiff', (repo: string, hash: string, file: string, from?: string) =>
    gitService.getCommitFileDiff(repo, hash, file, from),
  )

  // Branches
  handle('git:branches', (repo: string) => gitService.getBranches(repo))
  handle('git:checkout', (repo: string, name: string, remote?: boolean) => gitService.checkoutBranch(repo, name, remote))
  handle('git:createBranch', (repo: string, name: string, checkout?: boolean) =>
    gitService.createBranch(repo, name, checkout),
  )
  handle('git:deleteBranch', (repo: string, name: string, force?: boolean) => gitService.deleteBranch(repo, name, force))

  // Remote
  handle('git:fetchAll', (repo: string) => gitService.fetchAll(repo))
  handle('git:pull', (repo: string, mode?: PullMode) => gitService.pull(repo, mode === 'ff-only' ? 'ff-only' : 'ff'))
  handle('git:push', (repo: string) => gitService.push(repo))

  // Undo / redo
  handle('git:history', (repo: string) => gitService.getHistory(repo))
  handle('git:undo', (repo: string) => gitService.undo(repo))
  handle('git:redo', (repo: string) => gitService.redo(repo))

  // Settings (global)
  handle('settings:get', () => settingsService.get())
  handle('settings:sshKeyInfo', () => settingsService.keyInfo())
  handle('settings:setSshAgent', (useAgent: boolean) => settingsService.setUseAgent(useAgent))
  handle('settings:browseSshKey', (kind: 'private' | 'public') =>
    settingsService.browseKey(win, kind === 'public' ? 'public' : 'private'),
  )
  handle('settings:generateSshKey', () => settingsService.generateKey())
  handle('settings:readSshPublicKey', () => settingsService.readPublicKey())
  handle('settings:testSsh', (host?: string) =>
    settingsService.testSsh(host === 'gitlab.com' || host === 'bitbucket.org' ? host : 'github.com'),
  )

  // App
  handle('app:version', () => app.getVersion())
  // The renderer finished its start-up work (tabs restored) — time to leave the splash
  ipcMain.on('app:ready', () => finishStartup())
}

/** Show ssh / git credential prompts (e.g. an SSH key passphrase) as a dialog in the window */
function registerAskpass() {
  const pending = new Map<number, (r: { value: string | null; remember: boolean }) => void>()
  askpass.setAsker(
    (req: AskpassRequest) =>
      new Promise((resolve) => {
        if (!win || win.isDestroyed()) return resolve({ value: null, remember: false })
        pending.set(req.id, resolve)
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        win.webContents.send('askpass:request', req)
      }),
  )
  ipcMain.on('askpass:reply', (e, reply: { id?: unknown; value?: unknown; remember?: unknown }) => {
    if (!win || e.sender !== win.webContents) return
    const resolve = typeof reply?.id === 'number' ? pending.get(reply.id) : undefined
    if (!resolve) return
    pending.delete(reply.id as number)
    resolve({
      value: typeof reply.value === 'string' ? reply.value : null,
      remember: reply.remember === true,
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  win = null
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(async () => {
  applyCsp()
  // Settings (e.g. the SSH key) must be loaded before any git network command runs
  await settingsService.load()
  await askpass.start().catch((err) => console.error('askpass unavailable:', err))
  registerIpc()
  registerAskpass()
  createSplash()
  createWindow()
})
