export function readThemePreference(
  storage: Pick<Storage, 'getItem'>,
): 'light' | 'dark' {
  return storage.getItem('ted-theme') === 'dark' ? 'dark' : 'light';
}
