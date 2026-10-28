import { tr } from './language.js';
// Capture and erase the capability before bootstrap or any network operation.
const fragment = new URLSearchParams(window.location.hash.slice(1));
const launchToken =
  window.location.pathname === '/admin' ? fragment.get('admin-launch') : null;
if (launchToken !== null) {
  fragment.delete('admin-launch');
  const remainder = fragment.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${remainder ? `#${remainder}` : ''}`,
  );
}

let pending: Promise<void> | undefined;
export function redeemAdminLaunch(): Promise<void> {
  if (!launchToken) return Promise.resolve();
  return (pending ??= fetch('/api/admin/launch', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: launchToken }),
  }).then((response) => {
    if (!response.ok)
      throw new Error(
        tr(
          'El acceso automático venció o no está disponible. Usá el código mostrado en la terminal.',
          'The automatic access expired or is not available. Use the code shown in the terminal.',
        ),
      );
  }));
}
