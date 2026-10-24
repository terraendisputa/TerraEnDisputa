import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts shared by Classic, Competitive and Reconquista (user
 * decisions 2026-10-24). Menus register what they can do; buttons opt in
 * with `data-shortcut`, so each mode keeps its own markup.
 */

/** Country choice in an open action menu. */
interface RouteShortcut {
  readonly hasSelection: () => boolean;
  readonly cancel: () => void;
  /** Moves to the previous (-1) or next (1) choice; false when there is none. */
  readonly step: (direction: 1 | -1) => boolean;
}
/** Armies in an open amount control. */
interface AmountShortcut {
  /** False when the control is not on screen. */
  readonly step: (direction: 1 | -1) => boolean;
}

const routes: { current: RouteShortcut }[] = [];
const amounts: { current: AmountShortcut }[] = [];
const zooms: { current: (direction: 1 | -1) => void }[] = [];

/** Letter → `data-shortcut` of the panel tab it toggles. */
const PANEL_KEYS: Readonly<Record<string, string>> = {
  o: 'objective',
  c: 'cards',
  p: 'pacts',
};

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('textarea, [contenteditable="true"]')) return true;
  const input = target.closest('input');
  return !!input && input.type !== 'number';
}

function enabled(selector: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(selector)].find(
    (button) => !button.disabled && button.getClientRects().length > 0,
  );
}

function handled(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/** Runs before the map and the panels see the key. */
function onCapture(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (editable(event.target)) return;
  if (event.key === 'Escape') {
    // A selection is cancelled first, then menus close.
    if (cancelSelection()) return handled(event);
    const open = enabled(
      '.player-roster button[aria-expanded="true"], .situation-indicator[aria-expanded="true"]',
    );
    if (open) {
      open.click();
      return handled(event);
    }
    return;
  }
  if (event.key === 'Enter') {
    // Enter confirms the open menu even when the last click left focus on a
    // button or a country; a list keeps it to choose an option.
    if (event.target instanceof HTMLSelectElement) return;
    const confirm = enabled('[data-shortcut="confirm"]');
    if (confirm) {
      confirm.click();
      handled(event);
    }
    return;
  }
  const inField = event.target instanceof HTMLInputElement;
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !inField) {
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    if (routes.toReversed().some(({ current }) => current.step(direction)))
      handled(event);
    return;
  }
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !inField) {
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    if (amounts.toReversed().some(({ current }) => current.step(direction)))
      handled(event);
  }
}

/** Runs after the amount control has had its say about digits and Backspace. */
function onBubble(event: KeyboardEvent) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)
    return;
  if (editable(event.target)) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'Delete' || key === 'Backspace') {
    if (cancelSelection()) event.preventDefault();
    return;
  }
  if (event.target instanceof HTMLInputElement) return;
  if (key === '+' || key === '=' || key === '-') {
    const zoom = zooms.at(-1)?.current;
    if (zoom) {
      zoom(key === '-' ? -1 : 1);
      event.preventDefault();
    }
    return;
  }
  const button =
    key === 'j'
      ? nextPlayer()
      : key === 's'
        ? enabled('.situation-indicator')
        : key === 'm'
          ? enabled('[data-shortcut="missile"]')
          : PANEL_KEYS[key]
            ? enabled(`.information-tabs [data-shortcut="${PANEL_KEYS[key]}"]`)
            : undefined;
  if (button) {
    button.click();
    event.preventDefault();
  }
}

function cancelSelection(): boolean {
  const route = routes
    .toReversed()
    .find(({ current }) => current.hasSelection())?.current;
  route?.cancel();
  return !!route;
}

/** J opens the leftmost player, then each next one; after the last, the first. */
function nextPlayer(): HTMLButtonElement | undefined {
  const players = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.player-roster .roster-player',
    ),
  ];
  const open = players.findIndex(
    (button) => button.getAttribute('aria-expanded') === 'true',
  );
  return players[(open + 1) % players.length];
}

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', onCapture, true);
  window.addEventListener('keydown', onBubble);
}

function useRegistration<T>(
  stack: { current: T }[],
  value: T | undefined,
): void {
  const latest = useRef(value);
  latest.current = value;
  const active = value !== undefined;
  useEffect(() => {
    if (!active) return;
    install();
    const entry = {
      get current() {
        return latest.current as T;
      },
    };
    stack.push(entry);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
    };
  }, [active, stack]);
}

/** ↑ ↓ walk the menu's choices; Escape, Supr and Retroceso cancel them. */
export function useRouteShortcut(route: RouteShortcut | undefined): void {
  useRegistration(routes, route);
}

/** ← → lower or raise the amount by one. */
export function useAmountShortcut(amount: AmountShortcut | undefined): void {
  useRegistration(amounts, amount);
}

/** + − zoom the map wherever the focus is. */
export function useZoomShortcut(zoom: (direction: 1 | -1) => void): void {
  useRegistration(zooms, zoom);
}

/** Next choice in a looping list; starts at the first going down, the last going up. */
export function stepChoice<T>(
  choices: readonly T[],
  current: number,
  direction: 1 | -1,
): T | undefined {
  if (choices.length === 0) return undefined;
  if (current < 0) return direction === 1 ? choices[0] : choices.at(-1);
  return choices[(current + direction + choices.length) % choices.length];
}
