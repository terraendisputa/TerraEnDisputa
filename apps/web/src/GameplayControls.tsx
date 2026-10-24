import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandPayload, PlayerGameView } from '@game/protocol';

import { objectiveText } from './objectives.js';
import { TERRITORIES, TERRITORY_LABELS } from './territories.js';
import { playerColorLabel } from './colors.js';
import { createCommandId } from './command-id.js';
import { ActionRoute } from './ActionRoute.js';
import { useAmountShortcut } from './shortcuts.js';
import { UiIcon } from './UiIcon.js';
import { ClassicCardArt } from './ClassicCardArt.js';
import { hasNewCombat } from './combat-events.js';

export function mapChoices(
  snapshot: PlayerGameView,
  selectedSource?: string,
): readonly string[] {
  if (snapshot.pendingAction) return [];
  if (snapshot.turn?.phase === 'attack')
    return selectedSource
      ? [
          ...new Set([
            ...snapshot.legalActions.attackChoices.map(({ from }) => from),
            ...(snapshot.legalActions.attackChoices.find(
              ({ from }) => from === selectedSource,
            )?.targets ?? []),
          ]),
        ]
      : snapshot.legalActions.attackChoices.map(({ from }) => from);
  if (snapshot.turn?.phase === 'regroup')
    return selectedSource
      ? snapshot.legalActions.regroupChoices
          .filter(({ from }) => from === selectedSource)
          .map(({ to }) => to)
      : [
          ...new Set(
            snapshot.legalActions.regroupChoices.map(({ from }) => from),
          ),
        ];
  return snapshot.legalActions.territoryChoices;
}

interface Props {
  readonly snapshot: PlayerGameView;
  readonly selected: string | undefined;
  readonly selectedSource: string | undefined;
  readonly placements?: Readonly<Record<string, number>>;
  readonly onPlacement?: (territoryId: string, amount: number) => void;
  readonly conquestTransfer?: number;
  readonly onConquestTransfer?: (armies: number) => void;
  readonly onSelected: (id: string | undefined) => void;
  readonly onSource: (id: string | undefined) => void;
  readonly submit: (command: CommandPayload) => void;
  readonly busy: boolean;
}

export function ActionTitle({
  title,
  required = false,
}: {
  readonly title: string;
  readonly required?: boolean;
}) {
  return (
    <div className="action-title">
      <span className="eyebrow">
        {required ? 'Acción obligatoria' : 'Acción actual'}
      </span>
      <h3>{title}</h3>
      {required && (
        <span
          className="panel-notification required-badge"
          aria-label="Acción obligatoria"
        >
          !
        </span>
      )}
    </div>
  );
}

// Digits typed anywhere outside a text field go to the amount on screen, so a
// player can tap a country and type 8. The newest
// enabled control owns the keyboard; a pause starts a new number.
const amountOwners: object[] = [];
const TYPING_PAUSE_MS = 1500;

export function Amount({
  value,
  minimum = 1,
  maximum,
  onChange,
  disabled = false,
  label = 'Cantidad de ejércitos',
}: {
  readonly value: number;
  readonly minimum?: number;
  readonly maximum: number;
  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
  /** Accessible name; Reconquista also counts missiles. */
  readonly label?: string;
}) {
  const clamp = (next: number) =>
    Math.max(
      minimum,
      Math.min(maximum, Number.isFinite(next) ? Math.trunc(next) : minimum),
    );
  const latest = useRef({ clamp, onChange });
  latest.current = { clamp, onChange };
  const control = useRef<HTMLDivElement>(null);
  useAmountShortcut(
    disabled
      ? undefined
      : {
          step: (direction) => {
            // Only the control on screen answers the keys.
            if (!control.current?.getClientRects().length) return false;
            onChange(clamp(value + direction));
            return true;
          },
        },
  );
  useEffect(() => {
    if (disabled) return;
    const owner = {};
    amountOwners.push(owner);
    let typed = '';
    let typedAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        amountOwners.at(-1) !== owner ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          // A select keeps working: country names have no digits, and the
          // origin and destination lists keep focus after a choice.
          event.target.closest('input, textarea, [contenteditable="true"]'))
      )
        return;
      const fresh = event.timeStamp - typedAt > TYPING_PAUSE_MS;
      if (/^[0-9]$/.test(event.key)) typed = (fresh ? '' : typed) + event.key;
      else if (event.key === 'Backspace' && !fresh) typed = typed.slice(0, -1);
      else return;
      event.preventDefault();
      typedAt = event.timeStamp;
      const { clamp, onChange } = latest.current;
      onChange(clamp(typed ? Number(typed) : 0));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      amountOwners.splice(amountOwners.indexOf(owner), 1);
    };
  }, [disabled]);
  return (
    <div
      className="amount-control"
      role="group"
      aria-label={label}
      ref={control}
    >
      <span>Cantidad</span>
      <div className="amount-stepper">
        <button
          type="button"
          className="secondary compact-button"
          disabled={disabled || value <= minimum}
          aria-label="Quitar un ejército"
          onClick={() => onChange(clamp(value - 1))}
        >
          −
        </button>
        <input
          aria-label={label}
          type="number"
          min={minimum}
          max={maximum}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
        />
        <button
          type="button"
          className="secondary compact-button"
          disabled={disabled || value >= maximum}
          aria-label="Agregar un ejército"
          onClick={() => onChange(clamp(value + 1))}
        >
          +
        </button>
      </div>
      <small>
        Permitido: {minimum}–{maximum}
      </small>
    </div>
  );
}

/** Armies a card gives on its own country (territory-card bonus). */
const TERRITORY_BONUS = 2;

/** Mirrors the engine's rule: three of one symbol or three different, wildcards filling in. */
function validExchangeSymbols(symbols: readonly string[]): boolean {
  if (symbols.length !== 3) return false;
  const wild = symbols.filter((s) => s === 'wildcard').length;
  const ordinary = symbols.filter((s) => s !== 'wildcard');
  const most = Math.max(
    0,
    ...ordinary.map((s) => ordinary.filter((x) => x === s).length),
  );
  return most + wild === 3 || new Set(ordinary).size + wild === 3;
}

function toggleExchangeCardSelection(
  selected: readonly string[],
  cardId: string,
): string[] {
  return selected.includes(cardId)
    ? selected.filter((id) => id !== cardId)
    : selected.length < 3
      ? [...selected, cardId]
      : [...selected];
}

const symbolLabel = (
  symbol: PlayerGameView['private']['cards'][number]['symbol'],
) =>
  symbol === 'wildcard'
    ? 'Comodín'
    : symbol === 'galleon'
      ? 'Galeón'
      : symbol === 'balloon'
        ? 'Globo'
        : 'Cañón';

const symbolIcon = (
  symbol: PlayerGameView['private']['cards'][number]['symbol'],
) => <ClassicCardArt symbol={symbol} />;

/**
 * The hand with every card action, as in Reconquista:
 * claim a card (+1), the +2 of a card's territory and the exchange.
 */
export function PrivateHand({
  snapshot,
  submit,
  busy = false,
  newCardIds = [],
}: {
  readonly snapshot: PlayerGameView;
  readonly submit?: Props['submit'] | undefined;
  readonly busy?: boolean;
  readonly newCardIds?: readonly string[];
}) {
  const cards = snapshot.private.cards;
  const actions = snapshot.legalActions.actions;
  const turn = snapshot.turn;
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [refused, setRefused] = useState<string>();
  const cardKey = cards.map((c) => c.cardId).join(',');
  useEffect(() => {
    const valid = new Set(cardKey.split(','));
    setSelectedCardIds((current) => current.filter((id) => valid.has(id)));
  }, [cardKey]);
  // The refusal stays a few seconds and leaves when the game moves on.
  useEffect(() => {
    if (!refused) return;
    const timeout = window.setTimeout(() => setRefused(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [refused, snapshot.revision]);
  const myTurn =
    Boolean(submit) &&
    snapshot.status === 'ACTIVE' &&
    turn?.playerId === snapshot.selfPlayerId &&
    !snapshot.pendingAction &&
    !snapshot.legalActions.readOnly;
  const canExchange = myTurn && actions.includes('exchange_cards');
  const mandatory =
    canExchange &&
    turn?.phase === 'ordinary_exchange' &&
    snapshot.mode === 'classic' &&
    cards.length > 5;
  const choices = snapshot.legalActions.exchangeChoices;
  const choice = choices.find(
    ({ cardIds }) =>
      cardIds.length === selectedCardIds.length &&
      cardIds.every((cardId) => selectedCardIds.includes(cardId)),
  );
  const selectedCards = cards.filter(({ cardId }) =>
    selectedCardIds.includes(cardId),
  );
  // Three cards of one symbol or of three symbols, wildcards filling in.
  const validSet = validExchangeSymbols(selectedCards.map((c) => c.symbol));
  const bonusIds = myTurn ? snapshot.legalActions.territoryBonusCardIds : [];
  // A single selected card of a country one controls, with its bonus unused,
  // shows the bonus button, as in Reconquista.
  const bonusCard =
    selectedCards.length === 1 &&
    !selectedCards[0]!.territoryBonusClaimed &&
    snapshot.territories?.[selectedCards[0]!.cardId]?.ownerId ===
      snapshot.selfPlayerId
      ? selectedCards[0]
      : undefined;
  const reward = choice?.rewardArmies ?? choices[0]?.rewardArmies;
  return (
    <>
      <details className="private-hand" open>
        <summary>Cartas · {cards.length}</summary>
        {cards.length === 0 && <p>Todavía no tenés cartas.</p>}
        {mandatory && (
          <p className="action-help">
            Superaste el límite: el canje es obligatorio.
          </p>
        )}
        <div className="exchange-card-selection" aria-label="Tus cartas">
          {cards.map(({ cardId, symbol, territoryBonusClaimed }) => {
            const selected = selectedCardIds.includes(cardId);
            const name = TERRITORY_LABELS[cardId] ?? cardId;
            return (
              <button
                key={cardId}
                type="button"
                className={`territory-card hand-card ${territoryBonusClaimed ? 'bonus-used' : 'bonus-available'} ${selected ? 'selected' : ''} ${newCardIds.includes(cardId) ? 'new-card' : ''}`}
                aria-pressed={myTurn ? selected : undefined}
                aria-label={`${name}, ${symbolLabel(symbol)}, bonificación ${territoryBonusClaimed ? 'usada' : 'disponible'}${selected ? ', seleccionada' : ''}`}
                title={`${symbolLabel(symbol)} · bonificación ${territoryBonusClaimed ? 'usada' : 'disponible'}`}
                disabled={busy || !myTurn}
                onClick={() =>
                  setSelectedCardIds((current) =>
                    toggleExchangeCardSelection(current, cardId),
                  )
                }
              >
                <span
                  className={`card-symbol symbol-${symbol}`}
                  aria-hidden="true"
                >
                  {symbolIcon(symbol)}
                </span>
                <span className="card-copy">
                  <strong>{name}</strong>
                </span>
                <span className="card-badges">
                  {selected && (
                    <strong className="selected-check" aria-hidden="true">
                      ✓
                    </strong>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </details>
      {myTurn && submit && (
        // Every card button at the bottom right: +1, +2 with its territory and exchange.
        <div className="action-card card-actions">
          <button
            type="button"
            className="icon-button text-icon claim-card"
            title="Pedir carta"
            aria-label="Pedir carta"
            disabled={busy}
            onClick={() => {
              if (actions.includes('claim_card'))
                submit({ type: 'claim_card' });
              else
                setRefused(
                  turn?.cardClaimEligible && cards.length >= 5
                    ? 'No podés pedir carta: tenés la mano completa.'
                    : turn?.phase === 'end_of_turn_cards'
                      ? 'Solo podés pedir una carta por turno, si conquistaste un país.'
                      : 'Podés pedir carta al terminar el traslado, si conquistaste un país.',
                );
            }}
          >
            <UiIcon name="cards" />
            <span>+1</span>
          </button>
          {bonusCard && (
            <button
              type="button"
              className="icon-button text-icon claim-bonus"
              title={`Cobrar +${TERRITORY_BONUS} en ${TERRITORY_LABELS[bonusCard.cardId]}`}
              aria-label={`Cobrar +${TERRITORY_BONUS} en ${TERRITORY_LABELS[bonusCard.cardId]}`}
              disabled={busy}
              onClick={() => {
                if (!bonusIds.includes(bonusCard.cardId)) {
                  setRefused(
                    `Los +${TERRITORY_BONUS} se cobran al final del turno, después del traslado.`,
                  );
                  return;
                }
                submit({
                  type: 'claim_territory_bonus',
                  cardId: bonusCard.cardId,
                });
                setSelectedCardIds([]);
              }}
            >
              +{TERRITORY_BONUS} {TERRITORY_LABELS[bonusCard.cardId]}
            </button>
          )}
          {/* Always shown on one's turn; usable with three cards of one symbol
              or of three symbols. */}
          <button
            type="button"
            className="icon-button exchange-submit"
            title={reward ? `Canjear por ${reward} ejércitos` : 'Canjear'}
            aria-label={reward ? `Canjear por ${reward} ejércitos` : 'Canjear'}
            disabled={busy || !validSet}
            onClick={() => {
              if (!choice) {
                setRefused(
                  'El canje se hace al comienzo de tu turno, antes de incorporar ejércitos.',
                );
                return;
              }
              submit({ type: 'exchange_cards', cardIds: [...choice.cardIds] });
              setSelectedCardIds([]);
            }}
          >
            <UiIcon name="exchange" />
          </button>
        </div>
      )}
      {refused && (
        <p className="muted-copy card-refusal" role="status">
          {refused}
        </p>
      )}
    </>
  );
}

export function GameplayControls({
  snapshot,
  selected,
  selectedSource,
  placements = {},
  onPlacement = () => undefined,
  conquestTransfer = 1,
  onConquestTransfer = () => undefined,
  onSelected,
  onSource,
  submit,
  busy,
}: Props) {
  const [amount, setAmount] = useState(1);
  const actions = snapshot.legalActions.actions;
  const turn = snapshot.turn!;
  const actor = snapshot.players.find(({ id }) => id === turn.playerId);
  const isActor = turn.playerId === snapshot.selfPlayerId;
  const pending = snapshot.pendingAction;
  const regroup = snapshot.legalActions.regroupChoices.find(
    ({ from, to }) => from === selectedSource && to === selected,
  );
  const selectedChoice = selected
    ? snapshot.legalActions.reinforcementChoices.find(
        ({ territoryId }) => territoryId === selected,
      )
    : undefined;
  const allocated = Object.values(placements).reduce(
    (sum, armies) => sum + armies,
    0,
  );
  const placementDue =
    turn.phase === 'ordinary_exchange' ||
    turn.phase === 'territory_reinforcement'
      ? (turn.reinforcementArmiesRemaining ?? 0)
      : Object.values(turn.continentReinforcementsRemaining ?? {}).reduce(
          (sum: number, armies) => sum + (armies ?? 0),
          0,
        );
  const remainingPlacement = placementDue - allocated;
  const selectedContinent = TERRITORIES.find(
    ({ id }) => id === selected,
  )?.continent;
  const allocatedInSelectedPool = Object.entries(placements).reduce(
    (sum, [territoryId, armies]) =>
      turn.phase !== 'continent_reinforcement' ||
      TERRITORIES.find(({ id }) => id === territoryId)?.continent ===
        selectedContinent
        ? sum + armies
        : sum,
    0,
  );
  const reinforcementMaximum = Math.max(
    0,
    (selectedChoice?.maximumArmies ?? 0) -
      allocatedInSelectedPool +
      (selected ? (placements[selected] ?? 0) : 0),
  );

  useEffect(() => {
    setAmount(1);
  }, [turn.playerId, turn.phase, selected, selectedSource]);

  if (pending)
    return pending.playerId === snapshot.selfPlayerId ? (
      (() => {
        const sourceBefore =
          snapshot.territories?.[pending.fromTerritoryId]?.armies ?? 0;
        const targetBefore =
          snapshot.territories?.[pending.conqueredTerritoryId]?.armies ?? 0;
        const transfer = Math.max(
          1,
          Math.min(conquestTransfer, pending.maximumArmies),
        );
        return (
          <div
            className="action-card action-layout pending-action conquest-transfer"
            role="status"
          >
            <div className="action-selection transfer-route" aria-live="polite">
              <small>Origen</small>
              <span className="transfer-route-arrow" aria-hidden="true">
                →
              </span>
              <small>Destino</small>
              <strong>
                {TERRITORY_LABELS[pending.fromTerritoryId]}:{' '}
                {sourceBefore - transfer}
              </strong>
              <span className="transfer-route-arrow" aria-hidden="true">
                →
              </span>
              <strong>
                {TERRITORY_LABELS[pending.conqueredTerritoryId]}:{' '}
                {targetBefore + transfer}
              </strong>
            </div>
            <Amount
              value={Math.min(conquestTransfer, pending.maximumArmies)}
              minimum={1}
              maximum={pending.maximumArmies}
              onChange={onConquestTransfer}
              disabled={busy}
            />
            <button
              type="button"
              className="confirm-transfer completion-action"
              aria-label="Confirmar traslado"
              title="Confirmar traslado (Enter)"
              data-shortcut="confirm"
              disabled={busy}
              onClick={() =>
                submit({
                  type: 'complete_conquest_transfer',
                  armies: Math.max(
                    1,
                    Math.min(conquestTransfer, pending.maximumArmies),
                  ) as 1 | 2 | 3,
                })
              }
            >
              <UiIcon name="check" />
            </button>
          </div>
        );
      })()
    ) : (
      <p className="turn-notice">
        {actor?.nickname} está completando una conquista.
      </p>
    );

  if (!isActor)
    return (
      <p className="turn-notice">
        Observando el turno de <strong>{actor?.nickname}</strong>.
      </p>
    );
  if (snapshot.legalActions.readOnly)
    return (
      <p className="turn-notice">Tu asiento está en modo de observación.</p>
    );

  return (
    <div className="gameplay-actions">
      {((turn.phase === 'ordinary_exchange' &&
        snapshot.legalActions.actions.includes('place_reinforcements')) ||
        turn.phase === 'territory_reinforcement' ||
        turn.phase === 'continent_reinforcement') && (
        <div className="action-card action-layout primary-action-card reinforcement-card">
          <ActionTitle
            title={
              turn.phase === 'continent_reinforcement'
                ? 'Refuerzos continentales'
                : 'Refuerzos'
            }
          />
          <ActionRoute
            reserve={remainingPlacement}
            target={selected}
            targets={snapshot.legalActions.reinforcementChoices.map(
              (c) => c.territoryId,
            )}
            onTarget={onSelected}
            disabled={busy}
          />
          {selected && reinforcementMaximum > 0 && (
            <Amount
              value={placements[selected] ?? 0}
              minimum={0}
              maximum={reinforcementMaximum}
              onChange={(value) => onPlacement(selected, value)}
              disabled={busy}
            />
          )}
          {turn.phase === 'continent_reinforcement' && (
            <div className="action-footer">
              <ul className="reinforcement-pools">
                {Object.entries(
                  turn.continentReinforcementsRemaining ?? {},
                ).map(([id, n]) => (
                  <li key={id}>
                    {continentLabel(id)}: {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className="confirm-placement completion-action"
            aria-label="Confirmar colocación"
            title="Confirmar colocación (Enter)"
            data-shortcut="confirm"
            disabled={busy || placementDue === 0 || remainingPlacement !== 0}
            onClick={() => submit({ type: 'place_reinforcements', placements })}
          >
            <UiIcon name="check" />
          </button>
        </div>
      )}
      {turn.phase === 'attack' && (
        <div className="action-card action-layout primary-action-card attack-card">
          {snapshot.legalActions.attackChoices.length === 0 && (
            <p className="muted-copy">No hay ataques disponibles.</p>
          )}
          <ActionRoute
            source={selectedSource}
            target={selected}
            sources={snapshot.legalActions.attackChoices.map((c) => c.from)}
            routes={snapshot.legalActions.attackChoices.flatMap((c) =>
              c.targets.map((to) => [c.from, to] as const),
            )}
            targets={
              snapshot.legalActions.attackChoices.find(
                (c) => c.from === selectedSource,
              )?.targets ?? []
            }
            onSource={(id) => {
              onSource(id);
              onSelected(undefined);
            }}
            onTarget={onSelected}
            disabled={busy}
          />
          <button
            type="button"
            className="icon-button attack-button"
            disabled={!selectedSource || !selected || busy}
            aria-label="Atacar"
            title="Atacar (Enter)"
            data-shortcut="confirm"
            onClick={() =>
              selectedSource &&
              selected &&
              submit({ type: 'attack', from: selectedSource, to: selected })
            }
          >
            <UiIcon name="sword" />
          </button>
          {actions.includes('advance_phase') && (
            <button
              type="button"
              className="secondary end-attack"
              title="Terminar ataques"
              aria-label="Terminar ataques"
              disabled={busy}
              onClick={() => submit({ type: 'advance_phase' })}
            >
              <UiIcon name="finish" />
            </button>
          )}
        </div>
      )}
      {turn.phase === 'regroup' && (
        <div className="action-card action-layout primary-action-card regroup-card">
          {snapshot.legalActions.regroupChoices.length === 0 && (
            <p className="muted-copy">No hay traslados disponibles.</p>
          )}
          <ActionRoute
            source={selectedSource}
            target={selected}
            sources={[
              ...new Set(
                snapshot.legalActions.regroupChoices.map((c) => c.from),
              ),
            ]}
            targets={snapshot.legalActions.regroupChoices
              .filter((c) => c.from === selectedSource)
              .map((c) => c.to)}
            routes={snapshot.legalActions.regroupChoices.map(
              (c) => [c.from, c.to] as const,
            )}
            onSource={(id) => {
              onSource(id);
              onSelected(undefined);
            }}
            onTarget={onSelected}
            disabled={busy}
          />
          {regroup && (
            <Amount
              value={Math.min(amount, regroup.maximumArmies)}
              minimum={1}
              maximum={regroup.maximumArmies}
              onChange={setAmount}
              disabled={busy}
            />
          )}
          <button
            type="button"
            className="icon-button confirm-regroup"
            title="Confirmar traslado (Enter)"
            data-shortcut="confirm"
            aria-label="Confirmar traslado"
            disabled={
              !regroup || amount < 1 || busy || regroup.maximumArmies < 1
            }
            onClick={() => {
              if (!regroup) return;
              submit({
                type: 'regroup',
                from: regroup.from,
                to: regroup.to,
                armies: Math.min(amount, regroup.maximumArmies),
              });
              setAmount(1);
            }}
          >
            <UiIcon name="check" />
          </button>
          <button
            type="button"
            className="secondary icon-button"
            title="Cancelar selección (Escape)"
            aria-label="Cancelar selección"
            disabled={busy || (!selectedSource && !selected)}
            onClick={() => {
              onSource(undefined);
              onSelected(undefined);
              setAmount(1);
            }}
          >
            <UiIcon name="close" />
          </button>
          {actions.includes('advance_phase') && (
            <button
              type="button"
              className="secondary finish-regroup"
              title="Terminar reagrupamiento"
              aria-label="Terminar reagrupamiento"
              disabled={busy}
              onClick={() => submit({ type: 'advance_phase' })}
            >
              <UiIcon name="endRegroup" />
            </button>
          )}
        </div>
      )}
      {turn.phase === 'end_of_turn_cards' && (
        // Cards are claimed from the Cartas menu and the turn ends with the
        // flag beside the menu buttons, as in Reconquista.
        <p className="muted-copy end-turn-hint">
          {actions.includes('claim_card') ||
          snapshot.legalActions.territoryBonusCardIds.length > 0
            ? 'Pedí tu carta o cobrá los +2 en el menú Cartas. Terminá el turno con la bandera.'
            : 'Terminá el turno con la bandera.'}
        </p>
      )}
      <div className="button-row action-footer phase-actions">
        {actions.includes('advance_phase') &&
          turn.phase !== 'attack' &&
          turn.phase !== 'regroup' && (
            <button
              type="button"
              title="Continuar"
              aria-label="Continuar"
              disabled={busy}
              onClick={() => submit({ type: 'advance_phase' })}
            >
              <UiIcon name="arrow" />
            </button>
          )}
      </div>
    </div>
  );
}

const continents: Record<string, { label: string; ids: readonly string[] }> = {
  north_america: {
    label: 'América del Norte',
    ids: [
      'alaska',
      'yukon',
      'canada',
      'oregon',
      'california',
      'mexico',
      'new_york',
      'newfoundland',
      'labrador',
      'greenland',
    ],
  },
  south_america: {
    label: 'América del Sur',
    ids: ['colombia', 'peru', 'brazil', 'chile', 'argentina', 'uruguay'],
  },
  europe: {
    label: 'Europa',
    ids: [
      'iceland',
      'great_britain',
      'spain',
      'france',
      'germany',
      'italy',
      'poland',
      'sweden',
      'russia',
    ],
  },
  africa: {
    label: 'África',
    ids: ['sahara', 'egypt', 'ethiopia', 'zaire', 'south_africa', 'madagascar'],
  },
  asia: {
    label: 'Asia',
    ids: [
      'turkey',
      'israel',
      'arabia',
      'iran',
      'india',
      'china',
      'gobi',
      'mongolia',
      'siberia',
      'aral',
      'tartary',
      'taymyr',
      'kamchatka',
      'japan',
      'malaysia',
    ],
  },
  oceania: {
    label: 'Oceanía',
    ids: ['sumatra', 'borneo', 'java', 'australia'],
  },
};
const continentLabel = (id: string) => continents[id]?.label ?? id;

function CombatDie({
  value,
  rolling,
  defender = false,
}: {
  readonly value: number;
  readonly rolling: boolean;
  readonly defender?: boolean;
}) {
  const faces: Record<number, readonly number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return (
    <strong
      className={`die pip-die${defender ? ' defender-die' : ''}${rolling ? ' die-rolling' : ''}`}
      aria-label={rolling ? 'Lanzando dado' : `Dado ${value}`}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <i
          key={index}
          className={
            !rolling && faces[value]?.includes(index) ? 'pip on' : 'pip'
          }
          aria-hidden="true"
        />
      ))}
    </strong>
  );
}

export function CombatResult({
  snapshot,
}: {
  readonly snapshot: PlayerGameView;
}) {
  const previous = useRef(snapshot);
  const [shown, setShown] = useState({
    result: snapshot.turn?.lastCombat,
    key: snapshot.turn?.lastCombat ? String(snapshot.revision) : '',
  });
  useEffect(() => {
    const before = previous.current;
    previous.current = snapshot;
    if (before.gameId !== snapshot.gameId || hasNewCombat(before, snapshot))
      setShown({
        result: snapshot.turn?.lastCombat,
        key: snapshot.turn?.lastCombat ? String(snapshot.revision) : '',
      });
  }, [snapshot]);
  return <CombatDice result={shown.result} resultKey={shown.key} />;
}

/** Dice view shared by Classic and Reconquista; a new resultKey replays the roll. */
export function CombatDice({
  result,
  resultKey,
}: {
  readonly result:
    | {
        readonly attackerDice: readonly number[];
        readonly defenderDice: readonly number[];
        readonly conquered: boolean;
      }
    | undefined;
  readonly resultKey: string;
}) {
  // Existing results appear immediately when joining; only new rolls pause.
  const [revealedKey, setRevealedKey] = useState(resultKey);
  useEffect(() => {
    if (!resultKey) {
      setRevealedKey('');
      return;
    }
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : 2_000;
    const timeout = window.setTimeout(() => setRevealedKey(resultKey), delay);
    return () => window.clearTimeout(timeout);
  }, [resultKey]);
  if (!result) return null;
  const rolling = revealedKey !== resultKey;
  return (
    <section
      className={`panel combat-result ${!rolling && result.conquered ? 'combat-conquest' : ''}`}
      aria-live="polite"
      aria-busy={rolling}
    >
      <div className="panel-heading-row">
        <div>
          <p className="eyebrow">Último combate</p>
          <h2>
            {rolling
              ? 'Lanzando dados…'
              : result.conquered
                ? 'Territorio conquistado'
                : 'Resultado del combate'}
          </h2>
        </div>
        <span
          className={`result-badge ${!rolling && result.conquered ? 'success-badge' : ''}`}
        >
          {rolling
            ? 'En combate'
            : result.conquered
              ? 'Conquista'
              : 'Sin conquista'}
        </span>
      </div>
      <div className="dice-results">
        <div>
          <span role="img" aria-label="Atacante" title="Atacante">
            <UiIcon name="sword" />
          </span>
          <div>
            {result.attackerDice.map((die, index) => (
              <CombatDie key={`a-${index}`} value={die} rolling={rolling} />
            ))}
          </div>
        </div>
        <div>
          <span role="img" aria-label="Defensor" title="Defensor">
            <UiIcon name="shield" />
          </span>
          <div>
            {result.defenderDice.map((die, index) => (
              <CombatDie
                key={`d-${index}`}
                value={die}
                rolling={rolling}
                defender
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinishedPanel({
  snapshot,
}: {
  readonly snapshot: PlayerGameView;
}) {
  const winner = snapshot.players.find(
    ({ id }) => id === snapshot.result?.winnerId,
  );
  const reason = snapshot.result?.victoryReason;
  return (
    <section
      className="finished-panel objective-box"
      aria-labelledby="finished-title"
    >
      <div className="finished-summary">
        <p className="eyebrow">Partida finalizada</p>
        <h1 id="finished-title">
          {winner ? `Ganó ${winner.nickname}` : 'Partida cerrada'}
        </h1>
        {snapshot.result?.scoringEligible === false && (
          <p>
            Sin puntuación oficial. El administrador puede consultar el motivo
            en los resultados.
          </p>
        )}
        {winner && (
          <p className="winner-color">
            <span
              className={`color-dot color-${winner.color}`}
              aria-hidden="true"
            />
            {playerColorLabel(winner.color)}
          </p>
        )}
      </div>
      <p className="winning-objective">
        <span>
          {reason?.kind === 'control_all_territories'
            ? 'Conquistó los 50 territorios.'
            : reason?.kind === 'control_territories'
              ? 'Controló 30 territorios.'
              : reason?.kind === 'time_limit'
                ? 'Se completaron las dos rondas finales. El administrador puede consultar la clasificación.'
                : reason?.kind === 'no_competitors'
                  ? 'No quedan jugadores habilitados para continuar.'
                  : reason?.kind === 'secret_objective'
                    ? objectiveText(
                        reason.objectiveId,
                        reason.effectiveDestructionTargetColor,
                      )
                    : 'Cumplió su objetivo secreto.'}
        </span>
        <svg className="victory-crest" aria-hidden="true" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="20" />
          <path d="M32 8v48M8 32h48M18 18l28 28M46 18 18 46" />
          <path
            className="crest-point"
            d="m32 14 5 13 13 5-13 5-5 13-5-13-13-5 13-5Z"
          />
        </svg>
      </p>
    </section>
  );
}

export function PactsPanel({
  snapshot,
  submit,
  busy,
}: {
  readonly snapshot: PlayerGameView;
  readonly submit: Props['submit'];
  readonly busy: boolean;
}) {
  const [selectedChoiceKey, setSelectedChoiceKey] = useState<string>();
  const choices = snapshot.legalActions.pactProposalChoices;
  const choice = currentPactProposalChoice(choices, selectedChoiceKey);
  const names = useMemo(
    () => new Map(snapshot.players.map((p) => [p.id, p.nickname])),
    [snapshot.players],
  );
  const players = useMemo(
    () => new Map(snapshot.players.map((player) => [player.id, player])),
    [snapshot.players],
  );
  const participant = (id: string) => {
    const p = players.get(id);
    return (
      <span className="pact-participant">
        {p?.nickname ?? 'Jugador'}
        {p && (
          <span
            className={`color-dot color-${p.color}`}
            role="img"
            aria-label={playerColorLabel(p.color)}
            title={playerColorLabel(p.color)}
          />
        )}
      </span>
    );
  };
  const borderSides = (territoryIds: readonly [string, string]) => (
    <span className="pact-border-sides">
      {territoryIds.map((territoryId) => {
        const ownerId = snapshot.territories?.[territoryId]?.ownerId;
        const owner = ownerId ? players.get(ownerId) : undefined;
        return (
          <span key={territoryId} className="pact-border-side">
            <span
              className={`color-dot color-${owner?.color ?? 'unknown'}`}
              role="img"
              aria-label={
                owner ? playerColorLabel(owner.color) : 'Sin propietario'
              }
            />
            <span>
              {owner?.nickname ?? 'Sin propietario'} ·{' '}
              {TERRITORY_LABELS[territoryId] ?? territoryId}
            </span>
          </span>
        );
      })}
    </span>
  );
  const terms = (
    value: NonNullable<PlayerGameView['pacts']>['proposals'][number]['terms'],
  ) =>
    value.kind === 'general_non_aggression'
      ? 'No agresión general'
      : value.kind === 'border_non_aggression'
        ? `Frontera ${value.territoryIds.map((id) => TERRITORY_LABELS[id]).join(' / ')}`
        : `Zona internacional: ${TERRITORY_LABELS[value.territoryId]}`;
  if (snapshot.mode === 'competitive' && snapshot.configuredPlayerCount === 4)
    return (
      <section className="panel pacts-panel">
        <h2>Pactos</h2>
        <p>Competitivo de cuatro jugadores se juega sin pactos.</p>
      </section>
    );
  return (
    <section className="panel pacts-panel">
      <details open>
        <summary className="pacts-heading">
          <div>
            <h2>Pactos</h2>
          </div>
          <span className="count-badge">
            {(snapshot.pacts?.active.length ?? 0) +
              (snapshot.pacts?.proposals.length ?? 0)}
          </span>
        </summary>
        {(snapshot.pacts?.active.length ?? 0) === 0 && (
          <p className="muted-copy">No hay pactos activos.</p>
        )}
        {(snapshot.pacts?.active ?? []).map((pact) => (
          <div key={pact.id} className="pact-row">
            <span className="pact-copy">
              <small>
                {'withdrawal' in pact && pact.withdrawal.kind === 'announced'
                  ? 'Retiro anunciado · aún vigente'
                  : 'Activo'}
              </small>
              <strong>
                {pact.terms.kind === 'border_non_aggression'
                  ? 'Frontera'
                  : terms(pact.terms)}
              </strong>
              {pact.terms.kind === 'border_non_aggression' &&
                borderSides(pact.terms.territoryIds)}
              {pact.terms.kind !== 'border_non_aggression' && (
                <span>
                  {participant(pact.parties[0])} ↔{' '}
                  {participant(pact.parties[1])}
                </span>
              )}
              {'withdrawal' in pact && pact.withdrawal.kind === 'announced' && (
                <span>
                  Espera las activaciones de:{' '}
                  {pact.withdrawal.waitingForPlayerIds.map((id, index) => (
                    <span key={id}>
                      {index > 0 && ', '}
                      {participant(id)}
                    </span>
                  ))}
                </span>
              )}
            </span>
            {snapshot.legalActions.pactIdsToWithdraw.includes(pact.id) && (
              <button
                type="button"
                className="danger-quiet"
                disabled={busy}
                onClick={() =>
                  window.confirm(
                    snapshot.mode === 'competitive'
                      ? 'El otro jugador queda libre inmediatamente. Debés esperar dos incorporaciones completas suyas para atacar en el alcance del pacto. ¿Romper?'
                      : pact.kind === 'international_zone'
                        ? 'La zona seguirá vigente hasta que los demás jugadores supervivientes completen una fase de hostilidad. Durante la espera se mantienen sus obligaciones. ¿Anunciar la ruptura?'
                        : 'Retirarte anuncia la ruptura y conserva temporalmente tu obligación. ¿Continuar?',
                  ) && submit({ type: 'withdraw_pact', pactId: pact.id })
                }
              >
                {pact.kind === 'international_zone'
                  ? 'Romper zona'
                  : 'Retirarme'}
              </button>
            )}
          </div>
        ))}
        {(snapshot.pacts?.competitiveWithdrawals ?? []).map((wait) => (
          <div key={wait.id} className="pact-row">
            <span className="pact-copy">
              <strong>Ruptura: {terms(wait.terms)}</strong>
              <small>
                {participant(wait.withdrawingPlayerId)} debe esperar{' '}
                {wait.incorporationsRemaining} incorporaciones completas de{' '}
                {participant(wait.recipientId)} para atacar en el alcance del
                pacto. El destinatario ya está libre de este acuerdo.
              </small>
            </span>
          </div>
        ))}
        {(snapshot.pacts?.proposals ?? []).map((proposal) => (
          <div key={proposal.id} className="pact-row">
            <span className="pact-copy">
              <small>Propuesta pendiente</small>
              <strong>{terms(proposal.terms)}</strong>
              {proposal.terms.kind === 'border_non_aggression' &&
                borderSides(proposal.terms.territoryIds)}
              {proposal.terms.kind !== 'border_non_aggression' && (
                <span>
                  {participant(proposal.proposerId)} →{' '}
                  {participant(proposal.recipientId)}
                </span>
              )}
            </span>
            {snapshot.legalActions.pactProposalIdsToAnswer.includes(
              proposal.id,
            ) && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    submit({
                      type: 'accept_pact',
                      proposalId: proposal.id,
                      pactId: createCommandId(),
                    })
                  }
                >
                  Aceptar
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    submit({ type: 'reject_pact', proposalId: proposal.id })
                  }
                >
                  Rechazar
                </button>
              </>
            )}
            {snapshot.legalActions.pactProposalIdsToCancel.includes(
              proposal.id,
            ) && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  submit({ type: 'cancel_pact', proposalId: proposal.id })
                }
              >
                Cancelar
              </button>
            )}
          </div>
        ))}
        {choices.length > 0 && (
          <div className="pact-proposal-form">
            <label>
              Proponer a
              <select
                value={choice ? pactProposalChoiceKey(choice) : ''}
                disabled={busy}
                onChange={(e) => setSelectedChoiceKey(e.target.value)}
              >
                <option value="">Elegí jugador y acuerdo</option>
                {choices.map((item) => (
                  <option
                    key={pactProposalChoiceKey(item)}
                    value={pactProposalChoiceKey(item)}
                  >
                    {names.get(item.recipientId)} ·{' '}
                    {item.terms.kind === 'border_non_aggression'
                      ? item.terms.territoryIds
                          .map((id) => TERRITORY_LABELS[id])
                          .join(' ↔ ')
                      : terms(item.terms)}
                  </option>
                ))}
              </select>
            </label>
            {choice && (
              <p className="pact-summary">
                <small>Vista previa · todavía no enviada</small>
                <strong>
                  {choice.terms.kind === 'general_non_aggression'
                    ? 'No agresión general'
                    : choice.terms.kind === 'border_non_aggression'
                      ? 'No agresión'
                      : terms(choice.terms)}
                </strong>
                {choice.terms.kind === 'border_non_aggression' &&
                  borderSides(choice.terms.territoryIds)}
                {choice.terms.kind !== 'border_non_aggression' && (
                  <span>con {participant(choice.recipientId)}</span>
                )}
              </p>
            )}
            <button
              type="button"
              disabled={busy || !choice}
              onClick={() => {
                if (!choice) return;
                submit(pactProposalCommand(choice, createCommandId()));
                setSelectedChoiceKey(undefined);
              }}
            >
              Proponer pacto
            </button>
          </div>
        )}
      </details>
    </section>
  );
}

type PactProposalChoice =
  PlayerGameView['legalActions']['pactProposalChoices'][number];

function pactProposalChoiceKey(choice: PactProposalChoice): string {
  const terms = choice.terms;
  return terms.kind === 'general_non_aggression'
    ? `${choice.recipientId}:general`
    : terms.kind === 'border_non_aggression'
      ? `${choice.recipientId}:border:${terms.territoryIds.join(':')}`
      : `${choice.recipientId}:zone:${terms.territoryId}:${terms.firstExpectedConquerorId}`;
}

function currentPactProposalChoice(
  choices: readonly PactProposalChoice[],
  selectedKey: string | undefined,
): PactProposalChoice | undefined {
  return choices.find(
    (choice) => pactProposalChoiceKey(choice) === selectedKey,
  );
}

function pactProposalCommand(
  choice: PactProposalChoice,
  proposalId: string,
): Extract<CommandPayload, { type: 'propose_pact' }> {
  return {
    type: 'propose_pact',
    proposalId,
    recipientId: choice.recipientId,
    terms:
      choice.terms.kind === 'border_non_aggression'
        ? {
            ...choice.terms,
            territoryIds: [...choice.terms.territoryIds],
          }
        : choice.terms,
  };
}

export function InheritanceControls({
  snapshot,
  submit,
  busy,
}: {
  readonly snapshot: PlayerGameView;
  readonly submit: Props['submit'];
  readonly busy: boolean;
}) {
  const pending = snapshot.pendingInheritance;
  const cards = snapshot.private.inheritedCards ?? [];
  const [chosen, setChosen] = useState<readonly string[]>([]);
  useEffect(() => {
    setChosen([]);
  }, [pending?.playerId, cards.map((c) => c.cardId).join(',')]);
  if (!pending) return null;
  if (pending.playerId !== snapshot.selfPlayerId)
    return (
      <p className="muted-copy">
        El conquistador está eligiendo cartas heredadas.
      </p>
    );
  return (
    <section className="panel">
      <h2>Cartas heredadas</h2>
      <p>
        Elegí {pending.takeCount} para completar tu mano hasta cinco. Si vence
        tu tiempo o estás ausente, el servidor elige al azar. El excedente se
        descarta.
      </p>
      {cards.map((card) => (
        <label key={card.cardId} className="inline-control">
          <input
            type="checkbox"
            checked={chosen.includes(card.cardId)}
            disabled={
              busy ||
              !!snapshot.competitiveClock?.pauseReason ||
              (!chosen.includes(card.cardId) &&
                chosen.length >= pending.takeCount)
            }
            onChange={(event) =>
              setChosen((previous) =>
                event.target.checked
                  ? [...previous, card.cardId]
                  : previous.filter((id) => id !== card.cardId),
              )
            }
          />
          {TERRITORY_LABELS[card.cardId]} ·{' '}
          {
            {
              galleon: 'Galeón',
              balloon: 'Globo',
              cannon: 'Cañón',
              wildcard: 'Comodín',
            }[card.symbol]
          }
        </label>
      ))}
      <button
        type="button"
        disabled={
          busy ||
          chosen.length !== pending.takeCount ||
          !snapshot.legalActions.actions.includes('select_inherited_cards')
        }
        onClick={() =>
          submit({ type: 'select_inherited_cards', cardIds: [...chosen] })
        }
      >
        Conservar cartas elegidas
      </button>
    </section>
  );
}
