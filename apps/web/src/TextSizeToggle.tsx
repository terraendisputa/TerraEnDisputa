import { useState } from 'react';
import { tr } from './language.js';
import {
  applyTextSize,
  readTextSize,
  TEXT_SIZES,
  type TextSize,
} from './text-size.js';
import { UiIcon } from './UiIcon.js';

const labels: Record<TextSize, string> = {
  normal: tr('Tamaño de letra: normal', 'Text size: normal'),
  large: tr('Tamaño de letra: grande', 'Text size: large'),
  larger: tr('Tamaño de letra: muy grande', 'Text size: larger'),
};

/** Cycles normal → large → larger → normal. */
export function TextSizeToggle() {
  const [size, setSize] = useState<TextSize>(() => {
    try {
      return readTextSize(localStorage);
    } catch {
      return 'normal';
    }
  });
  const next = TEXT_SIZES[(TEXT_SIZES.indexOf(size) + 1) % TEXT_SIZES.length]!;
  return (
    <button
      type="button"
      className="text-size-toggle secondary"
      data-size={size}
      title={`${labels[size]}. ${tr('Cambiar', 'Change')}`}
      aria-label={`${labels[size]}. ${tr('Cambiar', 'Change')}`}
      onClick={() => setSize(applyTextSize(next))}
    >
      <UiIcon name="textSize" />
    </button>
  );
}
