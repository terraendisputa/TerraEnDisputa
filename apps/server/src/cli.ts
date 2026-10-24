import { resolveDataDirectory } from './persistence/data-directory.js';

export interface ServeCommand {
  readonly kind: 'serve';
  readonly bind: string;
  readonly port: number;
  readonly dataDirectory: string;
  readonly openBrowser: boolean;
}

export interface BackupCommand {
  readonly kind: 'backup';
  readonly dataDirectory: string;
  readonly output: string;
}

export interface RestoreCommand {
  readonly kind: 'restore';
  readonly dataDirectory: string;
  readonly input: string;
}

export type CliCommand =
  | ServeCommand
  | BackupCommand
  | RestoreCommand
  | { readonly kind: 'help' }
  | { readonly kind: 'version' };

const valueAfter = (arguments_: readonly string[], index: number) => {
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${arguments_[index]} requires a value`);
  return value;
};

export function parseCli(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): CliCommand {
  if (arguments_.includes('--help') || arguments_.includes('-h')) {
    if (arguments_.length !== 1) throw new Error('--help cannot be combined');
    return { kind: 'help' };
  }
  if (arguments_.includes('--version') || arguments_.includes('-v')) {
    if (arguments_.length !== 1)
      throw new Error('--version cannot be combined');
    return { kind: 'version' };
  }

  const backup = arguments_[0] === 'backup';
  const restore = arguments_[0] === 'restore';
  const offline = backup || restore;
  const options = offline ? arguments_.slice(1) : arguments_;
  let dataDirectory: string | undefined;
  let bind = environment['GAME_HOST'] ?? '0.0.0.0';
  let portText = environment['GAME_PORT'] ?? '3000';
  let openBrowser = true;
  let output: string | undefined;
  let input: string | undefined;
  let confirmed = false;
  for (let index = 0; index < options.length; index++) {
    const option = options[index]!;
    switch (option) {
      case '--data-dir':
        if (dataDirectory !== undefined)
          throw new Error('--data-dir may be specified only once');
        dataDirectory = valueAfter(options, index++);
        break;
      case '--bind':
        if (offline)
          throw new Error('--bind is not valid for offline commands');
        bind = valueAfter(options, index++);
        break;
      case '--port':
        if (offline)
          throw new Error('--port is not valid for offline commands');
        portText = valueAfter(options, index++);
        break;
      case '--no-open':
        if (offline)
          throw new Error('--no-open is not valid for offline commands');
        openBrowser = false;
        break;
      case '--output':
        if (!backup) throw new Error('--output is only valid for backup');
        if (output !== undefined)
          throw new Error('--output may be specified only once');
        output = valueAfter(options, index++);
        break;
      case '--input':
        if (!restore) throw new Error('--input is only valid for restore');
        if (input !== undefined)
          throw new Error('--input may be specified only once');
        input = valueAfter(options, index++);
        break;
      case '--confirm':
        if (!restore) throw new Error('--confirm is only valid for restore');
        confirmed = true;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }
  const resolvedDataDirectory = resolveDataDirectory(dataDirectory);
  if (backup) {
    if (!output) throw new Error('backup requires --output <file>');
    return {
      kind: 'backup',
      dataDirectory: resolvedDataDirectory,
      output: resolveDataDirectory(output),
    };
  }
  if (restore) {
    if (!input) throw new Error('restore requires --input <file>');
    if (!confirmed) throw new Error('restore requires --confirm');
    return {
      kind: 'restore',
      dataDirectory: resolvedDataDirectory,
      input: resolveDataDirectory(input),
    };
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('--port must be an integer from 1 to 65535');
  if (!bind.trim()) throw new Error('--bind must not be empty');
  return {
    kind: 'serve',
    bind,
    port,
    dataDirectory: resolvedDataDirectory,
    openBrowser,
  };
}

export const helpText = `Usage: ted [options]
       ted backup --output <file> [--data-dir <path>]
       ted restore --input <file> --confirm [--data-dir <path>]

Options:
  --bind <address>   Listen address (default: 0.0.0.0)
  --port <number>    Listen port (default: 3000)
  --data-dir <path>  Persistent data directory
  --no-open          Do not open the administrator page
  -h, --help         Show this help
  -v, --version      Show version information
`;
