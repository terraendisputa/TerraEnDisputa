/** Dark is the default; only a saved «light» choice keeps the light theme. */
export function readThemePreference(
  storage: Pick<Storage, 'getItem'>,
): 'light' | 'dark' {
  return storage.getItem('ted-theme') === 'light' ? 'light' : 'dark';
}
