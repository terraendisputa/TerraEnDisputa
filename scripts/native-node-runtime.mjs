import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export async function resolveNativeNodeRuntime({
  platform,
  architecture,
  execPath,
}) {
  if (!['linux', 'win32'].includes(platform) || architecture !== 'x64')
    throw new Error('Release builds require native Linux x64 or Windows x64');

  const executableName = platform === 'win32' ? 'node.exe' : 'node';
  const executablePath = resolve(execPath);
  if (basename(executablePath).toLowerCase() !== executableName)
    throw new Error(
      `Malformed native Node distribution for ${platform}-${architecture}: expected runtime executable ${executableName}`,
    );

  const rootLayout =
    platform === 'win32' ? 'executable-directory' : 'executable-parent';
  const distributionRoot =
    rootLayout === 'executable-directory'
      ? dirname(executablePath)
      : dirname(dirname(executablePath));
  const licensePath = join(distributionRoot, 'LICENSE');

  await stat(executablePath).catch(() => {
    throw new Error(
      `Malformed native Node distribution for ${platform}-${architecture}: runtime executable is missing`,
    );
  });
  const license = await readFile(licensePath, 'utf8').catch(() => {
    process.stderr.write(
      `Native Node runtime layout: platform=${platform}-${architecture}, executable=${executableName}, distributionRoot=${rootLayout}, requiredResource=LICENSE\n`,
    );
    throw new Error('The native Node distribution LICENSE file is missing');
  });

  return { distributionRoot, executablePath, license, licensePath };
}
