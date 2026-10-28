/** Menu and text scale for people who need bigger letters; the map keeps its size. */
export const TEXT_SIZES = ['normal', 'large', 'larger'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

const STORAGE_KEY = 'ted-text-size';

export function readTextSize(storage: Pick<Storage, 'getItem'>): TextSize {
  const saved = storage.getItem(STORAGE_KEY);
  return (TEXT_SIZES as readonly string[]).includes(saved ?? '')
    ? (saved as TextSize)
    : 'normal';
}

/** Writes the size on the root element, where the CSS zooms the menus. */
export function applyTextSize(next?: TextSize): TextSize {
  let size: TextSize = next ?? 'normal';
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else size = readTextSize(localStorage);
  } catch {
    /* Without storage the size lasts until the page reloads. */
  }
  if (size === 'normal') delete document.documentElement.dataset.textSize;
  else document.documentElement.dataset.textSize = size;
  return size;
}
