/**
 * Copies with the textarea selection, the only way a page served over plain
 * HTTP from a network address can reach the clipboard.
 */
function copyBySelection(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'offscreen-copy';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export async function copyInvitation(
  invitation: string,
  clipboard?: { writeText: (text: string) => Promise<void> },
): Promise<string> {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(invitation);
      return 'Invitación copiada.';
    }
  } catch {
    // Without permission, fall back to the selection below.
  }
  return copyBySelection(invitation)
    ? 'Invitación copiada.'
    : 'No se pudo copiar automáticamente. Seleccioná el enlace y copialo manualmente.';
}
