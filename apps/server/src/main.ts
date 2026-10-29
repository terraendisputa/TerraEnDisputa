import { buildServer } from './app.js';
import { FileGameStore } from './persistence/index.js';
import { AuthenticationService } from './auth/index.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { parseCli, helpText } from './cli.js';
import { tr } from './console-language.js';
import { APPLICATION_NAME, APPLICATION_VERSION } from './version.js';
import { AdminLaunch, browserOrigin, isLoopback } from './admin-launch.js';
import {
  loadReconquistaAssets,
  registerReconquista,
} from './reconquista/routes.js';
import { ReconquistaStore } from './reconquista/store.js';

/** Present when the desktop app runs the server as an Electron utility process. */
interface DesktopPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}
const desktop = (process as { parentPort?: DesktopPort }).parentPort;

async function main(): Promise<void> {
  const command = parseCli(process.argv.slice(2));
  if (command.kind === 'help') {
    process.stdout.write(helpText);
    process.exit(0);
  }
  if (command.kind === 'version') {
    process.stdout.write(`${APPLICATION_NAME} ${APPLICATION_VERSION}\n`);
    process.exit(0);
  }
  const packagedWebRoot = process.env['GAME_WEB_ROOT'];
  if (packagedWebRoot && !existsSync(packagedWebRoot))
    throw new Error(
      tr(
        `Faltan los archivos de la aplicación web: ${packagedWebRoot}`,
        `Browser application assets are missing: ${packagedWebRoot}`,
      ),
    );
  if (command.kind === 'restore') {
    const { catalog } = await loadReconquistaAssets();
    const preserved = await FileGameStore.restoreBackup(
      command.dataDirectory,
      command.input,
      {
        reconquista: (directory, games) =>
          ReconquistaStore.stage(directory, catalog, games),
      },
    );
    process.stdout.write(
      tr(
        `Copia restaurada en: ${command.dataDirectory}\nDatos anteriores conservados en: ${preserved}\n`,
        `Backup restored into: ${command.dataDirectory}\nPrevious data preserved at: ${preserved}\n`,
      ),
    );
    return;
  }
  const gameStore = await FileGameStore.open(command.dataDirectory, {
    serverVersion: APPLICATION_VERSION,
  });
  if (command.kind === 'backup') {
    const reconquistaStore = await ReconquistaStore.open(
      join(command.dataDirectory, 'reconquista'),
      (await loadReconquistaAssets()).catalog,
    );
    let manifest;
    try {
      manifest = await gameStore.createBackup(
        command.output,
        await reconquistaStore.snapshot(),
      );
    } finally {
      await reconquistaStore.close();
      await gameStore.close();
    }
    process.stdout.write(
      tr(
        `Copia creada: ${command.output}\nPartidas: ${manifest.gameCount}\nPartidas de Reconquista: ${manifest.reconquistaGameCount}\n`,
        `Backup created: ${command.output}\nGames: ${manifest.gameCount}\nRetake games: ${manifest.reconquistaGameCount}\n`,
      ),
    );
    process.exit(0);
  }
  const discovery = await gameStore.discoverGames();
  const authentication = new AuthenticationService(gameStore);
  const adminAccessCode = (await gameStore.loadAdminAuth())
    ? await authentication.resetAdmin()
    : await authentication.initializeAdmin();
  process.stdout.write(
    tr(
      `Código de acceso del administrador: ${adminAccessCode}\nSe muestra un código nuevo cada vez que arranca el servidor. Los códigos y sesiones anteriores quedan revocados.\n`,
      `Administrator access code: ${adminAccessCode}\nA fresh code is printed on every server start. Previous admin codes and sessions are revoked.\n`,
    ),
  );
  const origin = browserOrigin(command.bind, command.port);
  const supportsLocal =
    ['0.0.0.0', 'localhost', '::'].includes(command.bind) ||
    isLoopback(command.bind);
  const adminLaunch =
    (command.openBrowser || desktop) &&
    supportsLocal &&
    !process.env['GAME_PUBLIC_ORIGIN'] &&
    !process.env['GAME_TRUSTED_PROXY']
      ? new AdminLaunch(origin, adminAccessCode)
      : undefined;
  const server = buildServer({
    connectionBind: command.bind,
    connectionPort: command.port,
    ...(adminLaunch ? { adminLaunch } : {}),
    store: gameStore,
    onClose: async () => gameStore.close(),
    ...(process.env['GAME_WEB_ROOT']
      ? { webRoot: process.env['GAME_WEB_ROOT'] }
      : {}),
    ...(process.env['GAME_PUBLIC_ORIGIN']
      ? { publicOrigin: process.env['GAME_PUBLIC_ORIGIN'] }
      : {}),
    ...(process.env['GAME_TRUSTED_PROXY']
      ? {
          trustedProxy: process.env['GAME_TRUSTED_PROXY']
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : {}),
  });

  try {
    await registerReconquista(server, {
      dataDirectory: command.dataDirectory,
      classicStore: gameStore,
      ...(process.env['GAME_PUBLIC_ORIGIN']
        ? { publicOrigin: process.env['GAME_PUBLIC_ORIGIN'] }
        : {}),
    });
  } catch (error) {
    await server.close();
    throw error;
  }

  server.log.info(
    { dataDirectory: command.dataDirectory },
    'Using persistent data directory',
  );
  server.log.info(
    { gameCount: discovery.games.size },
    'Loaded persisted games',
  );
  for (const failure of discovery.failures)
    server.log.error({ ...failure }, 'Persisted game is unavailable');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch (error) {
      server.log.error(error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  desktop?.on('message', ({ data }) => {
    if ((data as { type?: unknown } | null)?.type === 'shutdown')
      void shutdown().finally(() => process.exit());
  });

  try {
    await server.listen({
      host: command.bind,
      port: command.port,
    });
    const localUrl = `${origin}/admin`;
    process.stdout.write(
      `\n${APPLICATION_NAME} ${APPLICATION_VERSION}\n${tr('Datos', 'Data')}: ${command.dataDirectory}\nLocal: ${localUrl}\n`,
    );
    if (command.bind === '0.0.0.0') {
      const addresses = Object.values(networkInterfaces())
        .flat()
        .filter(
          (address): address is NonNullable<typeof address> =>
            address !== undefined &&
            address.family === 'IPv4' &&
            !address.internal,
        )
        .map((address) => `http://${address.address}:${command.port}`);
      for (const address of [...new Set(addresses)])
        process.stdout.write(`${tr('Red', 'Network')}: ${address}\n`);
    }
    if (process.env['GAME_PUBLIC_ORIGIN']?.startsWith('https://'))
      process.stdout.write(
        tr(
          `Pública: ${process.env['GAME_PUBLIC_ORIGIN']} (proxy HTTPS administrado por vos)\n`,
          `Public: ${process.env['GAME_PUBLIC_ORIGIN']} (user-managed HTTPS proxy)\n`,
        ),
      );
    else
      process.stdout.write(
        tr(
          'Seguridad: HTTP no está cifrado; usalo solo en una red local de confianza o una VPN privada.\n',
          'Security: HTTP is unencrypted; use only a trusted LAN or private VPN.\n',
        ),
      );
    const launchUrl = adminLaunch
      ? `${localUrl}#admin-launch=${adminLaunch.token}`
      : localUrl;
    if (desktop)
      desktop.postMessage({
        type: 'ready',
        origin,
        launchUrl,
        adminAccessCode,
        dataDirectory: command.dataDirectory,
      });
    else if (command.openBrowser) {
      const [program, arguments_] =
        process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', launchUrl]]
          : ['xdg-open', [launchUrl]];
      const browser = spawn(program, arguments_, {
        detached: true,
        stdio: 'ignore',
      });
      const fallback = () =>
        process.stderr.write(
          tr(
            `No se pudo abrir el navegador. Abrí ${localUrl} e ingresá el código de acceso del administrador mostrado arriba.\n`,
            `Could not open the browser. Open ${localUrl} and enter the administrator access code shown above.\n`,
          ),
        );
      browser.on('error', fallback);
      browser.on('exit', (code) => {
        if (code !== null && code !== 0) fallback();
      });
      browser.unref();
    }
  } catch (error) {
    server.log.error(error);
    desktop?.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    await server.close();
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    tr(
      `${APPLICATION_NAME} no pudo arrancar: ${message}\n`,
      `${APPLICATION_NAME} failed to start: ${message}\n`,
    ),
  );
  desktop?.postMessage({ type: 'error', message });
  process.exitCode = 1;
});
