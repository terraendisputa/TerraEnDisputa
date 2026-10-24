import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PanelNotification } from './use-panel-notifications.js';
import { UiIcon } from './UiIcon.js';
import type { IconName } from './UiIcon.js';
import type { PlayerGameView } from '@game/protocol';
import { hasNewCombat } from './combat-events.js';

export interface GamePanel {
  id: string;
  label: string;
  content: ReactNode;
  icon?: IconName;
  targetId?: string;
  disabled?: boolean;
  disabledReason?: string;
  navigation?: boolean;
}
/** Keys that toggle each panel; see shortcuts.ts. */
const PANEL_KEYS: Readonly<Record<string, string>> = {
  objective: 'O',
  cards: 'C',
  pacts: 'P',
};

export function GamePanels({
  panels,
  selected,
  onSelect,
  notifications = {},
  onRead,
  trailing,
}: {
  panels: readonly GamePanel[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  notifications?: Readonly<Record<string, PanelNotification>>;
  onRead?: (id: string) => void;
  /** Extra controls after the panel buttons (Reconquista's end-turn flag). */
  trailing?: ReactNode;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  function close() {
    const activePanel = panels.find(
      (p) =>
        !p.disabled &&
        p.navigation !== false &&
        (p.targetId ?? p.id) === selected,
    );
    const button = activePanel
      ? buttons.current.get(activePanel.id)
      : undefined;
    onSelect(null);
    button?.focus();
  }
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest('.player-popover'))
      )
        return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected, onSelect]);
  const navigation = panels.filter((p) => p.navigation !== false);
  const badge = (id: string) =>
    notifications[id] ? (
      <span
        className="panel-notification"
        title={notifications[id]?.message}
        aria-hidden="true"
      >
        !
      </span>
    ) : null;
  const content = (
    <div className="information-content" hidden={!selected}>
      <header className="mobile-panel-heading">
        <strong>{panels.find((p) => p.id === selected)?.label}</strong>
        <button type="button" aria-label="Cerrar panel" onClick={close}>
          <UiIcon name="close" />
        </button>
      </header>
      {panels.map((p) => (
        <div key={p.id} hidden={selected !== p.id}>
          {p.content}
        </div>
      ))}
    </div>
  );
  return (
    <>
      <aside
        className={`floating-information${selected ? ' is-open' : ''}`}
        aria-label="Información de la partida"
      >
        <nav className="information-tabs" aria-label="Paneles de la partida">
          {navigation.map((p) => (
            <button
              key={p.id}
              ref={(node) => {
                if (node) buttons.current.set(p.id, node);
                else buttons.current.delete(p.id);
              }}
              type="button"
              title={
                PANEL_KEYS[p.id] ? `${p.label} (${PANEL_KEYS[p.id]})` : p.label
              }
              data-shortcut={PANEL_KEYS[p.id] ? p.id : undefined}
              disabled={p.disabled}
              aria-pressed={!p.disabled && selected === (p.targetId ?? p.id)}
              aria-label={`${p.label}${notifications[p.id] ? `, ${notifications[p.id]?.message}` : ''}`}
              onClick={() => {
                const target = p.targetId ?? p.id;
                onSelect(selected === target ? null : target);
                onRead?.(p.id);
              }}
            >
              <span className="panel-tab-icon">
                <UiIcon
                  name={
                    p.icon ??
                    (p.id === 'objective'
                      ? 'objective'
                      : p.id === 'cards'
                        ? 'cards'
                        : 'pact')
                  }
                />
              </span>
              {badge(p.id)}
            </button>
          ))}
          {trailing}
        </nav>
        {content}
      </aside>
    </>
  );
}

export function DicePanel({
  children,
  snapshot,
}: {
  readonly children: ReactNode;
  readonly snapshot: PlayerGameView;
}) {
  const [open, setOpen] = useState(Boolean(snapshot.turn?.lastCombat));
  const seenCombat = useRef(Boolean(snapshot.turn?.lastCombat));
  const previousSnapshot = useRef(snapshot);
  useEffect(() => {
    if (
      !seenCombat.current &&
      hasNewCombat(previousSnapshot.current, snapshot)
    ) {
      seenCombat.current = true;
      setOpen(true);
    }
    previousSnapshot.current = snapshot;
  }, [snapshot]);
  return (
    <section className="floating-dice" aria-label="Última tirada">
      <button
        className="dice-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="floating-dice-content"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <UiIcon name="dice" /> Dados
        <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      <div id="floating-dice-content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
