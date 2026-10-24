export async function copyInvitation(
  invitation: string,
  clipboard?: { writeText: (text: string) => Promise<void> },
): Promise<string> {
  if (!clipboard?.writeText)
    return 'Seleccioná el enlace y copialo manualmente.';
  try {
    await clipboard.writeText(invitation);
    return 'Invitación copiada.';
  } catch {
    return 'No se pudo copiar automáticamente. Seleccioná el enlace y copialo manualmente.';
  }
}
