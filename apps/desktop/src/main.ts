import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  session,
  shell,
  Tray,
  utilityProcess,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import { readFile } from 'node:fs/promises';
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

// The app opens on its own start page; the server only runs once someone
// chooses to host. It is served from inside the app, never from disk paths.
const startUrl = 'ted://app/start.html';
const startFiles: Readonly<Record<string, string>> = {
  '/start.html': 'text/html; charset=utf-8',
  '/start-icon.png': 'image/png',
};
protocol.registerSchemesAsPrivileged([
  { scheme: 'ted', privileges: { standard: true, secure: true } },
]);

/**
 * The one server each window may show: the app's own server, or the one in
 * the invitation link the player pasted. The start page has none.
 */
const allowedOrigins = new Map<number, string>();

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  devTools: false,
  // On Linux spell checking downloads dictionaries from Google.
  spellcheck: false,
} as const;

// Copying an invitation and full screen; nothing else.
const allowedPermissions = new Set(['clipboard-sanitized-write', 'fullscreen']);

const windowSize = {
  width: 1280,
  height: 860,
  minWidth: 360,
  minHeight: 480,
} as const;

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

const allowedFor = (contents: WebContents | null, url: string): boolean => {
  const allowed = contents ? allowedOrigins.get(contents.id) : undefined;
  return allowed !== undefined && originOf(url) === allowed;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An invitation is a game page on some server: http(s)://host/game/<id>. */
function invitation(value: string): URL | undefined {
  try {
    const url = new URL(value.trim());
    const id = /^\/game\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !id ||
      !uuid.test(id)
    )
      return undefined;
    return new URL(`/game/${id}`, url.origin);
  } catch {
    return undefined;
  }
}

const openExternal = (url: string): void => {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
};

/** Keeps each window on its one server and sends every other link to the browser. */
function guard(window: BrowserWindow, origin?: string): void {
  const contents = window.webContents;
  if (origin) allowedOrigins.set(contents.id, origin);
  contents.once('destroyed', () => allowedOrigins.delete(contents.id));
  contents.setWindowOpenHandler(({ url }) => {
    if (allowedFor(contents, url))
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
  contents.on('will-navigate', (event, url) => {
    if (allowedFor(contents, url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (allowedFor(contents, url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on('did-create-window', (child) =>
    guard(child, allowedOrigins.get(contents.id)),
  );
}

/** Shows a page of one server, or the start page, in the main window. */
function show(url: string, origin?: string): Promise<void> {
  const window = mainWindow ?? createMainWindow();
  if (origin) allowedOrigins.set(window.webContents.id, origin);
  else allowedOrigins.delete(window.webContents.id);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window.loadURL(url);
}

function showStart(error?: string): void {
  void show(
    error ? `${startUrl}?error=${encodeURIComponent(error)}` : startUrl,
  ).catch(() => undefined);
}

function showHostPanel(): void {
  if (!ready) return;
  // The launch link signs the admin in once; later visits reuse the session.
  void show(
    launched ? `${ready.origin}/admin` : ready.launchUrl,
    ready.origin,
  ).catch(() => undefined);
  launched = true;
}

function showMainWindow(): void {
  if (!mainWindow) {
    showStart();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...windowSize,
    show: false,
    icon,
    title: 'Terra en disputa',
    webPreferences: {
      ...webPreferences,
      // Only acts on start.html; see start-preload.ts.
      preload: join(__dirname, 'start-preload.cjs'),
    },
  });
  mainWindow = window;
  guard(window);
  // With the server running, closing the window leaves it in the tray;
  // without it there is nothing to keep, so the app quits.
  window.on('close', (event) => {
    if (quitting || !server) return;
    event.preventDefault();
    window.hide();
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
  window.on('closed', () => (mainWindow = undefined));
  return window;
}

function actions(): MenuItemConstructorOptions[] {
  const home: MenuItemConstructorOptions = {
    label: tr('Volver al inicio', 'Back to start'),
    click: () => showStart(),
  };
  if (!ready)
    return [
      home,
      { type: 'separator' },
      { label: tr('Salir', 'Quit'), click: () => app.quit() },
    ];
  const { origin, adminAccessCode, dataDirectory } = ready;
  return [
    home,
    {
      label: tr('Abrir panel del anfitrión', 'Open the host panel'),
      click: showHostPanel,
    },
    {
      label: tr('Abrir en el navegador', 'Open in the browser'),
      click: () => void shell.openExternal(`${origin}/admin`),
    },
    {
      label: tr(
        'Copiar código de administrador',
        'Copy administrator access code',
      ),
      click: () => void clipboard.writeText(adminAccessCode),
    },
    {
      label: tr('Abrir carpeta de partidas', 'Open games folder'),
      click: () => void shell.openPath(dataDirectory),
    },
    { type: 'separator' },
    {
      label: tr('Apagar servidor y salir', 'Stop server and quit'),
      click: () => app.quit(),
    },
  ];
}

/** The window menu always; the tray only while the server runs. */
function buildMenus(): void {
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
  if (!ready) {
    tray?.destroy();
    tray = undefined;
    return;
  }
  tray ??= new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip('Terra en disputa');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: tr('Abrir Terra en disputa', 'Open Terra en disputa'),
        click: showMainWindow,
      },
      { type: 'separator' },
      ...actions(),
    ]),
  );
  tray.removeAllListeners('click');
  tray.on('click', showMainWindow);
}

/** The server could not start or stopped: say why and go back to the start page. */
function fail(message: string): void {
  const busy = /EADDRINUSE/.test(message);
  const options = {
    type: 'error' as const,
    title: 'Terra en disputa',
    message: tr(
      'El servidor de Terra en disputa no pudo funcionar',
      'The Terra en disputa server could not run',
    ),
    detail: busy
      ? tr(
          `El puerto ya está en uso. ¿Hay otro servidor de Terra en disputa funcionando?\n\n${message}`,
          `The port is already in use. Is another Terra en disputa server running?\n\n${message}`,
        )
      : message,
  };
  // Without blocking the app: the start page comes back behind the message.
  void (mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options));
  const running = server;
  server = undefined;
  ready = undefined;
  launched = false;
  running?.kill();
  buildMenus();
  showStart();
}

function startServer(): void {
  if (server) {
    showHostPanel();
    return;
  }
  const child = utilityProcess.fork(
    join(resources, 'server', 'server.mjs'),
    [],
    {
      env: { ...process.env, GAME_WEB_ROOT: join(resources, 'web') },
      serviceName: 'Terra en disputa server',
      stdio: 'pipe',
    },
  );
  server = child;
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.on('message', (message: { type?: string; message?: string }) => {
    if (server !== child) return;
    if (message.type === 'ready') {
      ready = message as ServerReady;
      buildMenus();
      showHostPanel();
    } else if (message.type === 'error') fail(message.message ?? '');
  });
  child.on('exit', (code) => {
    if (server !== child) return;
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

/** Only the start page itself may ask for these. */
const fromStartPage = (event: IpcMainInvokeEvent): boolean =>
  event.senderFrame?.url.split('?')[0] === startUrl;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMainWindow);
  // Closing the window quits, unless the server keeps running in the tray.
  app.on('window-all-closed', () => {
    if (!server) app.quit();
  });
  app.on('before-quit', (event) => {
    quitting = true;
    if (!server) return;
    // Let the server save and close its games before the app exits.
    event.preventDefault();
    server.postMessage({ type: 'shutdown' });
    setTimeout(() => server?.kill(), 10_000).unref();
  });
  ipcMain.handle('start:state', (event) => {
    if (!fromStartPage(event)) return undefined;
    const error = new URL(event.senderFrame!.url).searchParams.get('error');
    return {
      spanish,
      serverRunning: server !== undefined,
      ...(error === 'unreachable'
        ? {
            error: tr(
              'No se pudo abrir la partida. Revisá que el enlace sea correcto y que el servidor del anfitrión esté funcionando.',
              "The game could not be opened. Check that the link is right and that the host's server is running.",
            ),
          }
        : {}),
    };
  });
  ipcMain.handle('start:join', (event, value: unknown) => {
    if (!fromStartPage(event)) return '';
    const url = typeof value === 'string' ? invitation(value) : undefined;
    if (!url)
      return tr(
        'Pegá el enlace completo de la partida, por ejemplo http://192.168.0.10:3000/game/…',
        'Paste the full game link, for example http://192.168.0.10:3000/game/…',
      );
    void show(url.href, url.origin).catch(() => showStart('unreachable'));
    return '';
  });
  ipcMain.handle('start:server', (event) => {
    if (fromStartPage(event)) startServer();
  });
  void app.whenReady().then(() => {
    protocol.handle('ted', async (request) => {
      const { host, pathname } = new URL(request.url);
      const type = host === 'app' ? startFiles[pathname] : undefined;
      if (!type) return new Response(null, { status: 404 });
      const body = await readFile(join(__dirname, pathname.slice(1)));
      return new Response(new Uint8Array(body), {
        headers: { 'content-type': type },
      });
    });
    // Copying and full screen, only for the server the window is showing.
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) =>
        callback(
          allowedPermissions.has(permission) &&
            allowedFor(contents, details.requestingUrl),
        ),
    );
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, requestingOrigin) =>
        allowedPermissions.has(permission) &&
        allowedFor(contents, requestingOrigin),
    );
    session.defaultSession.setDevicePermissionHandler(() => false);
    // No languages also means no dictionary to fetch at startup.
    session.defaultSession.setSpellCheckerLanguages([]);
    session.defaultSession.setSpellCheckerEnabled(false);
    spanish = /^es(?:$|-)/i.test(app.getLocale());
    buildMenus();
    showStart();
  });
}
