import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
  Tray,
  utilityProcess,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from 'electron';
import { join } from 'node:path';

/** What the server sends once it is listening (see apps/server/src/main.ts). */
interface ServerReady {
  readonly type: 'ready';
  readonly origin: string;
  readonly launchUrl: string;
  readonly adminAccessCode: string;
  readonly dataDirectory: string;
}

// Packaged builds keep the server next to the app; development runs point
// TED_RESOURCES at a release stage such as release/ted-<version>-linux-x64.
const resources = app.isPackaged
  ? process.resourcesPath
  : (process.env['TED_RESOURCES'] ?? process.resourcesPath);
const icon = nativeImage.createFromPath(join(resources, 'icon.png'));

let spanish = false;
const tr = (es: string, en: string): string => (spanish ? es : en);

let server: UtilityProcess | undefined;
let ready: ServerReady | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let trayNoticeShown = false;
let launched = false;

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  devTools: false,
  // On Linux spell checking downloads dictionaries from Google.
  spellcheck: false,
} as const;

// Copying an invitation and full screen; nothing else, and only for the game.
const allowedPermissions = new Set(['clipboard-sanitized-write', 'fullscreen']);

const windowSize = {
  width: 1280,
  height: 860,
  minWidth: 360,
  minHeight: 480,
} as const;

const sameOrigin = (url: string): boolean => {
  try {
    return ready !== undefined && new URL(url).origin === ready.origin;
  } catch {
    return false;
  }
};

const openExternal = (url: string): void => {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
};

/** Keeps game pages inside the app and sends every other link to the browser. */
function guard(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url))
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...windowSize,
          icon,
          autoHideMenuBar: true,
          webPreferences,
        },
      };
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.on('did-create-window', guard);
}

function showMainWindow(): void {
  if (!ready) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    ...windowSize,
    show: false,
    icon,
    title: 'Terra en disputa',
    webPreferences,
  });
  guard(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // Closing the window leaves the server running in the tray.
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
    if (!trayNoticeShown && Notification.isSupported()) {
      trayNoticeShown = true;
      new Notification({
        title: 'Terra en disputa',
        body: tr(
          'El servidor sigue funcionando en la bandeja del sistema. Para cerrarlo, elegí «Apagar servidor y salir».',
          'The server keeps running in the system tray. To stop it, choose “Stop server and quit”.',
        ),
        icon,
      }).show();
    }
  });
  mainWindow.on('closed', () => (mainWindow = undefined));
  // The launch link signs the admin in once; later windows reuse the session.
  void mainWindow.loadURL(launched ? `${ready.origin}/admin` : ready.launchUrl);
  launched = true;
}

function actions(): MenuItemConstructorOptions[] {
  return [
    {
      label: tr('Abrir Terra en disputa', 'Open Terra en disputa'),
      click: showMainWindow,
    },
    {
      label: tr('Abrir en el navegador', 'Open in the browser'),
      click: () => {
        if (ready) void shell.openExternal(`${ready.origin}/admin`);
      },
    },
    {
      label: tr(
        'Copiar código de administrador',
        'Copy administrator access code',
      ),
      click: () => {
        if (ready) void clipboard.writeText(ready.adminAccessCode);
      },
    },
    {
      label: tr('Abrir carpeta de partidas', 'Open games folder'),
      click: () => {
        if (ready) void shell.openPath(ready.dataDirectory);
      },
    },
    { type: 'separator' },
    {
      label: tr('Apagar servidor y salir', 'Stop server and quit'),
      click: () => app.quit(),
    },
  ];
}

function buildMenus(): void {
  // The window menu repeats the tray actions for desktops without a tray.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Terra en disputa', submenu: actions() },
      { role: 'editMenu', label: tr('Edición', 'Edit') },
      // The standard View menu without the developer tools.
      {
        label: tr('Ver', 'View'),
        submenu: [
          { role: 'reload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
    ]),
  );
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip('Terra en disputa');
  tray.setContextMenu(Menu.buildFromTemplate(actions()));
  tray.on('click', showMainWindow);
}

function fail(message: string): void {
  const busy = /EADDRINUSE/.test(message);
  dialog.showErrorBox(
    tr('Terra en disputa no pudo arrancar', 'Terra en disputa could not start'),
    busy
      ? tr(
          `El puerto ya está en uso. ¿Hay otro servidor de Terra en disputa funcionando?\n\n${message}`,
          `The port is already in use. Is another Terra en disputa server running?\n\n${message}`,
        )
      : message,
  );
  quitting = true;
  app.exit(1);
}

function startServer(): void {
  server = utilityProcess.fork(join(resources, 'server', 'server.mjs'), [], {
    env: { ...process.env, GAME_WEB_ROOT: join(resources, 'web') },
    serviceName: 'Terra en disputa server',
    stdio: 'pipe',
  });
  server.stdout?.pipe(process.stdout);
  server.stderr?.pipe(process.stderr);
  server.on('message', (message: { type?: string; message?: string }) => {
    if (message.type === 'ready') {
      ready = message as ServerReady;
      buildMenus();
      showMainWindow();
    } else if (message.type === 'error') fail(message.message ?? '');
  });
  server.on('exit', (code) => {
    server = undefined;
    if (quitting) app.exit(0);
    else
      fail(
        tr(
          `El servidor se detuvo (código ${code}).`,
          `The server stopped (code ${code}).`,
        ),
      );
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMainWindow);
  // Stay in the tray when the last window closes.
  app.on('window-all-closed', () => undefined);
  app.on('before-quit', (event) => {
    quitting = true;
    if (!server) return;
    // Let the server save and close its games before the app exits.
    event.preventDefault();
    server.postMessage({ type: 'shutdown' });
    setTimeout(() => server?.kill(), 10_000).unref();
  });
  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, permission, callback, details) =>
        callback(
          allowedPermissions.has(permission) &&
            sameOrigin(details.requestingUrl),
        ),
    );
    session.defaultSession.setPermissionCheckHandler(
      (_contents, permission, requestingOrigin) =>
        allowedPermissions.has(permission) && sameOrigin(requestingOrigin),
    );
    session.defaultSession.setDevicePermissionHandler(() => false);
    // No languages also means no dictionary to fetch at startup.
    session.defaultSession.setSpellCheckerLanguages([]);
    session.defaultSession.setSpellCheckerEnabled(false);
    spanish = /^es(?:$|-)/i.test(app.getLocale());
    startServer();
  });
}
