import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let serverHandle = null;
let isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function resolveIconPath() {
  const packagedIcon = path.join(process.resourcesPath, 'icon.png');
  if (app.isPackaged && fs.existsSync(packagedIcon)) {
    return packagedIcon;
  }
  const devIcon = path.resolve(__dirname, '..', 'build', 'icon.png');
  return fs.existsSync(devIcon) ? devIcon : undefined;
}

function isLocalOrigin(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

async function createWindow() {
  process.env.NODE_ENV = 'production';
  process.env.JITA_APP_VERSION = app.getVersion();
  process.env.JITA_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.JITA_CLIENT_DIST_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'client-dist')
    : path.resolve(__dirname, '..', 'client', 'dist');

  const serverEntry = path.resolve(__dirname, '..', 'server', 'dist', 'index.js');
  const { startServer } = await import(pathToFileURL(serverEntry).href);
  serverHandle = await startServer(3001);

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'JITA IV // MONOLITH',
    backgroundColor: '#08090D',
    autoHideMenuBar: true,
    icon: resolveIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalOrigin(url) && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://localhost:${serverHandle.port}`);
}

app.setName('JITA IV Monolith');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nldf.jitamonolith');
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  try {
    await createWindow();
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    dialog.showErrorBox('JITA IV // MONOLITH — Startup Error', message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      mainWindow = new BrowserWindow({
        width: 1480,
        height: 920,
        minWidth: 1024,
        minHeight: 680,
        title: 'JITA IV // MONOLITH',
        backgroundColor: '#08090D',
        autoHideMenuBar: true,
        icon: resolveIconPath(),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!isLocalOrigin(url) && /^https?:\/\//i.test(url)) {
          void shell.openExternal(url);
          return { action: 'deny' };
        }
        return { action: 'allow' };
      });
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
      void mainWindow.loadURL(`http://localhost:${serverHandle.port}`);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (!serverHandle || isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  const handle = serverHandle;
  serverHandle = null;
  void handle.close().finally(() => {
    app.exit(0);
  });
});
