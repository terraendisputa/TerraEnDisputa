import { useRef } from 'react';
import { TERRITORY_LABELS } from './territories.js';
import { stepChoice, useRouteShortcut } from './shortcuts.js';

export function ActionRoute({
  source,
  target,
  sources,
  targets,
  onSource,
  onTarget,
  routes,
  reserve,
  disabled = false,
  labelOf = (id) => TERRITORY_LABELS[id] ?? id,
}: {
  readonly source?: string | undefined;
  readonly target?: string | undefined;
  readonly sources?: readonly string[] | undefined;
  readonly targets: readonly string[];
  readonly onSource?: ((id: string | undefined) => void) | undefined;
  readonly onTarget: (id: string | undefined) => void;
  /** Every origin → destination pair, which ↑ ↓ walk through. */
  readonly routes?: readonly (readonly [string, string])[] | undefined;
  readonly reserve?: number | undefined;
  readonly disabled?: boolean;
  /** Reconquista passes its own board names. */
  readonly labelOf?: (id: string) => string;
}) {
  // Two-country menus step through pairs; one-country menus through targets.
  const choices: readonly (readonly [string | undefined, string])[] = routes
    ? [...new Map(routes.map((r) => [r.join('→'), r])).values()]
    : sources
      ? []
      : targets.map((id) => [undefined, id] as const);
  // Only the menu on screen answers the keys.
  const fields = useRef<HTMLDivElement>(null);
  const shown = () => !!fields.current?.getClientRects().length;
  useRouteShortcut(
    disabled
      ? undefined
      : {
          hasSelection: () => shown() && !!(source || target),
          cancel: () => {
            onSource?.(undefined);
            onTarget(undefined);
          },
          step: (direction) => {
            if (!shown()) return false;
            const next = stepChoice(
              choices,
              choices.findIndex(
                ([from, to]) =>
                  (from === undefined || from === source) && to === target,
              ),
              direction,
            );
            if (!next) return false;
            if (next[0] !== undefined) onSource?.(next[0]);
            onTarget(next[1]);
            return true;
          },
        },
  );
  return (
    <div className="action-route-fields" ref={fields}>
      <label>
        <small>{reserve === undefined ? 'Origen' : 'Refuerzos'}</small>
        {reserve !== undefined ? (
          <strong>Reserva · {reserve}</strong>
        ) : (
          <select
            aria-label="Origen de la acción"
            disabled={disabled || !sources?.length}
            value={source ?? ''}
            onChange={(e) => onSource?.(e.target.value || undefined)}
          >
            <option value="">Elegí origen</option>
            {sources?.map((id) => (
              <option key={id} value={id}>
                {labelOf(id)}
              </option>
            ))}
          </select>
        )}
      </label>
      <span aria-hidden="true">→</span>
      <label>
        <small>Destino</small>
        <select
          aria-label="Destino de la acción"
          value={target ?? ''}
          disabled={disabled || targets.length === 0}
          onChange={(e) => onTarget(e.target.value || undefined)}
        >
          <option value="">Elegí destino</option>
          {targets.map((id) => (
            <option key={id} value={id}>
              {labelOf(id)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
