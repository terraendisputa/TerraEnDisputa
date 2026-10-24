import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export function defaultDataDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32')
    return resolve(environment.LOCALAPPDATA ?? homedir(), 'TED', 'data');
  return resolve(
    environment.XDG_DATA_HOME ?? resolve(homedir(), '.local', 'share'),
    'ted',
  );
}

export function resolveDataDirectory(configured?: string): string {
  if (!configured) return defaultDataDirectory();
  return isAbsolute(configured)
    ? resolve(configured)
    : resolve(process.cwd(), configured);
}
