import { networkInterfaces } from 'node:os';
import { readFileSync } from 'node:fs';
import { isLoopback } from './admin-launch.js';
import type { AdminConnectionResponse } from '@game/protocol';

export function connectionOptions(
  bind: string,
  port: number,
  publicOrigin?: string,
): AdminConnectionResponse {
  if (publicOrigin)
    return {
      choices: [
        {
          origin: new URL(publicOrigin).origin,
          label: 'Dirección configurada del servidor',
        },
      ],
    };
  // Loopback still offers its own link: it opens only on this computer.
  if (bind === 'localhost' || isLoopback(bind))
    return {
      choices: [
        {
          origin: `http://${bind.includes(':') ? `[${bind}]` : bind}:${port}`,
          label: 'Este equipo (solo abre en esta computadora)',
        },
      ],
      reason:
        'El servidor solo acepta conexiones de este equipo. Para invitar amigos, reinicialo escuchando en la red.',
    };
  const choices: {
    origin: string;
    label: string;
    requiresSelection?: boolean;
  }[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (process.platform === 'linux') {
      try {
        const state = readFileSync(
          `/sys/class/net/${name}/operstate`,
          'utf8',
        ).trim();
        if (
          state === 'down' ||
          state === 'lowerlayerdown' ||
          state === 'notpresent'
        )
          continue;
      } catch {
        // Other platforms and restricted environments still offer explicit selection.
      }
    }
    for (const entry of entries ?? []) {
      if (
        entry.internal ||
        entry.address.includes('%') ||
        entry.address.startsWith('fe80:')
      )
        continue;
      if (bind !== '0.0.0.0' && bind !== '::' && bind !== entry.address)
        continue;
      if (bind === '0.0.0.0' && entry.family !== 'IPv4') continue;
      const host =
        entry.family === 'IPv6' ? `[${entry.address}]` : entry.address;
      const virtual =
        /^(docker|veth|br-|virbr|vmnet|vbox|tun|tap|wg|tailscale)/i.test(name);
      const origin = `http://${host}:${port}`;
      if (choices.some((choice) => choice.origin === origin)) continue;
      choices.push({
        origin,
        label: `${entry.address} · ${name}${virtual ? ' (red virtual o privada)' : ''}`,
        ...(virtual ? { requiresSelection: true } : {}),
      });
    }
  }
  return {
    choices,
    ...(choices.length === 0
      ? {
          reason:
            'No se detectó una dirección de red para compartir. Conectá el equipo a tu red y reiniciá Terra en disputa.',
        }
      : {}),
  };
}
