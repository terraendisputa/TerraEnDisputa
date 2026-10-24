import { GAME_NAME, GAME_SHORT_NAME, COMPETITIVE_NAME } from './identity.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TERRITORIES, type TerritoryId } from '@game/game-engine';
import type { CommandPayload, PlayerGameView } from '@game/protocol';

import { errorMessage } from './errors.js';
import { GameMap } from './GameMap.js';
import {
  ActionTitle,
  Amount,
  CombatResult,
  FinishedPanel,
  InheritanceControls,
  GameplayControls,
  PactsPanel,
  PrivateHand,
  mapChoices,
} from './GameplayControls.js';
import { objectiveText } from './objectives.js';
import { useLiveGame } from './use-live-game.js';
import { playerColorLabel } from './colors.js';
import { api, ApiError } from './api.js';
import { ThemeToggle } from './ThemeToggle.js';
import { GamePanels, DicePanel } from './GamePanels.js';
import type { GamePanel } from './GamePanels.js';
import { gamePresentation } from './game-presentation.js';
import { TurnSummary } from './TurnSummary.js';
import type { LiveGameState } from './live-game.js';
import { usePanelNotifications } from './use-panel-notifications.js';
import { PlayerRoster } from './PlayerRoster.js';
import { UiIcon } from './UiIcon.js';
import { ActionRoute } from './ActionRoute.js';

function PrivateInformation({
  snapshot,
}: {
  readonly snapshot: PlayerGameView;
}) {
  const targetColor = snapshot.private.effectiveDestructionTargetPlayerId
    ? snapshot.players.find(
        ({ id }) => id === snapshot.private.effectiveDestructionTargetPlayerId,
      )?.color
    : undefined;
  return (
    <section className="panel private-panel">
      <span className="privacy-badge">INFORMACIÓN PRIVADA</span>
      <details open>
        <summary className="objective-heading">
          <h2>Tu objetivo</h2>
        </summary>
        <div className="objective-box">
          {snapshot.configuredPlayerCount <= 3 ? (
            <p>Conquistá los 50 territorios.</p>
          ) : snapshot.private.secretObjectiveId ? (
            <p>
              {snapshot.private.secretObjectiveId.startsWith('destroy_') &&
              !snapshot.private.effectiveDestructionTargetPlayerId
                ? 'Conquistá 30 territorios. Otro jugador eliminó tu objetivo.'
                : objectiveText(
                    snapshot.private.secretObjectiveId,
                    targetColor,
                  )}
            </p>
          ) : (
            <p>El servidor todavía está asignando objetivos.</p>
          )}
        </div>
      </details>
    </section>
  );
}

function PrivateCards({
  snapshot,
  submit,
  busy = false,
  newCardIds = [],
}: {
  readonly snapshot: PlayerGameView;
  readonly submit?: (command: CommandPayload) => void;
  readonly busy?: boolean;
  readonly newCardIds?: readonly string[];
}) {
  return (
    <section className="panel cards-panel" aria-label="Tus cartas">
      <PrivateHand
        snapshot={snapshot}
        submit={submit}
        busy={busy}
        newCardIds={newCardIds}
      />
    </section>
  );
}

const statusLabels = {
  connecting: 'Conectando',
  connected: 'Conectado',
  reconnecting: 'Reconectando',
  disconnected: 'Desconectado',
  unauthorized: 'Sesión revocada',
  unavailable: 'Partida no disponible',
  incompatible: 'Versión incompatible',
} as const;

interface SetupControlsProps {
  readonly snapshot: PlayerGameView;
  readonly selected: string | undefined;
  readonly placements: Readonly<Record<string, number>>;
  readonly onPlacement: (territoryId: string, amount: number) => void;
  readonly onSubmit: (command: CommandPayload) => void;
  readonly busy: boolean;
  readonly onSelected: (id: string | undefined) => void;
}

function SetupControls({
  snapshot,
  selected,
  placements,
  onPlacement,
  onSubmit,
  busy,
  onSelected,
}: SetupControlsProps) {
  const setup = snapshot.setup!;
  const [capReached, setCapReached] = useState(false);
  useEffect(() => setCapReached(false), [selected]);
  const isActor = setup.currentPlayerId === snapshot.selfPlayerId;
  const canPlace = snapshot.legalActions.actions.includes('place_setup_armies');
  const due =
    setup.kind === 'card_deal_4_to_6'
      ? setup.armiesRemainingInActivation
      : (setup.additionalArmiesRemainingByPlayer[snapshot.selfPlayerId] ?? 0);
  const allocated = Object.values(placements).reduce(
    (sum, value) => sum + value,
    0,
  );
  const continent = selected
    ? TERRITORIES[selected as TerritoryId]?.continentId
    : undefined;
  const used =
    continent && setup.kind === 'card_deal_4_to_6'
      ? (setup.additionalArmiesByPlayerContinent[snapshot.selfPlayerId]?.[
          continent
        ] ?? 0)
      : 0;
  const drafted = continent
    ? Object.entries(placements)
        .filter(
          ([id]) => TERRITORIES[id as TerritoryId]?.continentId === continent,
        )
        .reduce((sum, [, amount]) => sum + amount, 0)
    : 0;
  const continentRemaining =
    snapshot.mode === 'competitive' ? Math.max(0, 4 - used - drafted) : due;
  if (!isActor)
    return (
      <div className="turn-notice">
        <span>
          Esperando a{' '}
          <strong>
            {snapshot.players.find(({ id }) => id === setup.currentPlayerId)
              ?.nickname ?? 'otro jugador'}
          </strong>
          .
        </span>
      </div>
    );
  if (canPlace)
    return (
      <div className="action-card action-layout setup-card">
        <ActionTitle title="Distribución" />
        <ActionRoute
          reserve={due - allocated}
          target={selected}
          targets={snapshot.legalActions.territoryChoices}
          onTarget={onSelected}
          disabled={busy}
        />
        {selected && (
          <Amount
            value={placements[selected] ?? 0}
            minimum={0}
            maximum={Math.max(0, due - allocated + (placements[selected] ?? 0))}
            onChange={(amount) => {
              // Competitive caps each continent; going past it is refused
              // with a notice.
              const current = placements[selected] ?? 0;
              if (amount > current + continentRemaining) {
                setCapReached(true);
                return;
              }
              setCapReached(false);
              onPlacement(selected, amount);
            }}
            disabled={busy}
          />
        )}
        {capReached && (
          <p className="muted-copy cap-notice" role="status">
            Alcanzaste el máximo de tropas para este continente. Elegí otro
            país.
          </p>
        )}
        <button
          type="button"
          className="confirm-distribution completion-action"
          aria-label="Confirmar distribución"
          title="Confirmar distribución (Enter)"
          data-shortcut="confirm"
          disabled={allocated !== due || busy}
          onClick={() => onSubmit({ type: 'place_setup_armies', placements })}
        >
          <UiIcon name="check" />
        </button>
      </div>
    );
  return <p>El servidor está resolviendo la preparación.</p>;
}

export function GameScreen({ gameId }: { readonly gameId: string }) {
  const { client, state } = useLiveGame(gameId);
  return (
    <GameView
      gameId={gameId}
      state={state}
      submit={(command) => client.submit(command)}
    />
  );
}

function GameView({
  gameId,
  state,
  submit,
}: {
  readonly gameId: string;
  readonly state: LiveGameState;
  readonly submit: (command: CommandPayload) => void;
}) {
  const client = { submit };
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string>();
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [newCardIds, setNewCardIds] = useState<readonly string[]>([]);
  const [queuedCards, setQueuedCards] = useState<{
    readonly gameId: string;
    readonly playerId: string;
    readonly ids: readonly string[];
  }>();
  const previousHand = useRef<PlayerGameView | undefined>(undefined);
  const [informationPanel, setInformationPanel] = useState<string | null>(null);
  useEffect(() => {
    if (
      informationPanel &&
      window.matchMedia('(max-width:500px), (max-height:420px)').matches
    )
      setToolbarCollapsed(true);
  }, [informationPanel]);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  function revealMobileActions() {
    setInformationPanel('actions');
  }
  const [selected, setSelected] = useState<string>();
  const [selectedSource, setSelectedSource] = useState<string>();
  const [placements, setPlacements] = useState<Record<string, number>>({});
  const [conquestTransfer, setConquestTransfer] = useState(1);
  const snapshot = state.snapshot;
  const turnMine =
    snapshot?.status === 'ACTIVE' &&
    snapshot.turn?.playerId === snapshot.selfPlayerId &&
    !snapshot.legalActions.readOnly;
  const closingMine =
    turnMine &&
    !snapshot.pendingAction &&
    snapshot.turn?.phase === 'end_of_turn_cards';
  // The end-turn flag shows a reminder after 5 seconds in the last step of the turn.
  const [endTurnReminder, setEndTurnReminder] = useState(false);
  useEffect(() => {
    setEndTurnReminder(false);
    if (!closingMine) return;
    const timeout = window.setTimeout(() => setEndTurnReminder(true), 5_000);
    return () => window.clearTimeout(timeout);
  }, [closingMine, snapshot?.revision]);
  // From Ataque or Traslado the flag finishes each remaining step, then the turn.
  const [endingTurn, setEndingTurn] = useState(false);
  const advancedAt = useRef<number>(undefined);
  useEffect(() => {
    if (!endingTurn || !snapshot || state.inFlight) return;
    const actions = snapshot.legalActions.actions;
    const phase = snapshot.turn?.phase;
    if (!turnMine || snapshot.pendingAction || state.error) {
      setEndingTurn(false);
      return;
    }
    if (
      (phase === 'attack' || phase === 'regroup') &&
      actions.includes('advance_phase')
    ) {
      if (advancedAt.current === snapshot.revision) return;
      advancedAt.current = snapshot.revision;
      submit({ type: 'advance_phase' });
      return;
    }
    setEndingTurn(false);
    if (phase !== 'end_of_turn_cards' || !actions.includes('end_turn')) return;
    if (
      (actions.includes('claim_card') ||
        snapshot.legalActions.territoryBonusCardIds.length > 0) &&
      !window.confirm(
        'Todavía podés pedir cartas o cobrar los +2. ¿Terminar el turno igual?',
      )
    ) {
      setInformationPanel('cards');
      return;
    }
    submit({ type: 'end_turn' });
  }, [endingTurn, snapshot, state.inFlight, state.error, turnMine]);
  useEffect(() => {
    document.title =
      snapshot?.mode === 'competitive'
        ? COMPETITIVE_NAME
        : snapshot?.mode === 'classic'
          ? `${GAME_NAME} — Clásico`
          : GAME_NAME;
    return () => {
      document.title = GAME_NAME;
    };
  }, [snapshot?.mode]);
  // Phone menus use type under 16px, as in Reconquista; without a scale limit
  // iPhones zoom the page when a list opens. The map zooms by itself.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]',
    );
    if (!meta) return;
    const previous = meta.content;
    meta.content = `${previous}, maximum-scale=1`;
    return () => {
      meta.content = previous;
    };
  }, []);
  const { notifications, markRead } = usePanelNotifications(snapshot);
  useEffect(() => {
    const before = previousHand.current;
    previousHand.current = snapshot;
    if (!snapshot) return;
    if (
      !before ||
      before.gameId !== snapshot.gameId ||
      before.selfPlayerId !== snapshot.selfPlayerId
    ) {
      setNewCardIds([]);
      setQueuedCards(undefined);
      return;
    }
    const oldIds = new Set(before.private.cards.map((c) => c.cardId));
    const gained = snapshot.private.cards
      .filter((c) => !oldIds.has(c.cardId))
      .map((c) => c.cardId);
    if (gained.length && state.connection === 'connected')
      setQueuedCards((queued) => ({
        gameId: snapshot.gameId,
        playerId: snapshot.selfPlayerId,
        ids: [
          ...new Set([
            ...(queued?.gameId === snapshot.gameId &&
            queued.playerId === snapshot.selfPlayerId
              ? queued.ids
              : []),
            ...gained,
          ]),
        ],
      }));
  }, [snapshot, state.connection]);
  useEffect(() => {
    if (!snapshot || !queuedCards) return;
    if (
      queuedCards.gameId !== snapshot.gameId ||
      queuedCards.playerId !== snapshot.selfPlayerId
    ) {
      setQueuedCards(undefined);
      return;
    }
    if (gamePresentation(snapshot).required) return;
    const visibleCards = queuedCards.ids.filter((id) =>
      snapshot.private.cards.some((c) => c.cardId === id),
    );
    setQueuedCards(undefined);
    if (!visibleCards.length) return;
    setNewCardIds(visibleCards);
    setInformationPanel('cards');
    setMobileActionsOpen(false);
    markRead('cards');
  }, [snapshot, queuedCards]);
  function selectInformationPanel(id: string | null) {
    setInformationPanel(id);
    if (id) {
      setMobileActionsOpen(false);
      if (window.matchMedia('(max-height:420px)').matches)
        setToolbarCollapsed(true);
      markRead(id);
    }
  }
  useEffect(() => {
    if (
      !snapshot?.competitiveClock ||
      !selected ||
      state.inFlight ||
      snapshot.competitiveClock.pauseReason ||
      snapshot.competitiveClock.selectedTerritoryId === selected ||
      snapshot.territories?.[selected]?.ownerId !== snapshot.selfPlayerId
    )
      return;
    const incorporates =
      snapshot.status === 'SETUP' ||
      (snapshot.status === 'ACTIVE' &&
        [
          'ordinary_exchange',
          'territory_reinforcement',
          'continent_reinforcement',
        ].includes(snapshot.turn?.phase ?? ''));
    if (
      incorporates &&
      (snapshot.setup?.currentPlayerId ?? snapshot.turn?.playerId) ===
        snapshot.selfPlayerId
    )
      submit({ type: 'select_reinforcement_country', territoryId: selected });
  }, [snapshot, selected, state.inFlight, submit]);
  const previousSnapshot = useRef(snapshot);
  useEffect(() => {
    const previous = previousSnapshot.current;
    previousSnapshot.current = snapshot;
    if (!snapshot) return;
    const context = (view: PlayerGameView | undefined) =>
      JSON.stringify([
        view?.gameId,
        view?.selfPlayerId,
        view?.status,
        view?.setup?.currentPlayerId,
        view?.setup?.kind === 'card_deal_4_to_6'
          ? view.setup.reinforcementRound
          : undefined,
        view?.turn?.playerId,
        view?.turn?.turnNumber,
        view?.turn?.phase,
        view?.pendingAction,
      ]);
    const changedPhase = context(previous) !== context(snapshot);
    if (changedPhase) {
      setSelected(undefined);
      setSelectedSource(undefined);
      setPlacements({});
      setConquestTransfer(1);
    } else {
      const legalSources =
        snapshot.turn?.phase === 'attack'
          ? snapshot.legalActions.attackChoices.map((c) => c.from)
          : snapshot.turn?.phase === 'regroup'
            ? snapshot.legalActions.regroupChoices.map((c) => c.from)
            : [];
      const source =
        selectedSource && legalSources.includes(selectedSource)
          ? selectedSource
          : undefined;
      if (source !== selectedSource) setSelectedSource(source);
      const targets =
        snapshot.turn?.phase === 'attack'
          ? (snapshot.legalActions.attackChoices.find((c) => c.from === source)
              ?.targets ?? [])
          : snapshot.turn?.phase === 'regroup'
            ? snapshot.legalActions.regroupChoices
                .filter((c) => c.from === source)
                .map((c) => c.to)
            : snapshot.legalActions.territoryChoices;
      if (selected && !targets.includes(selected)) setSelected(undefined);
      // A committed placement consumes the pool. Pact/presence updates do not.
      if (
        JSON.stringify(previous?.territories) !==
          JSON.stringify(snapshot.territories) ||
        JSON.stringify(previous?.turn?.continentReinforcementsRemaining) !==
          JSON.stringify(snapshot.turn?.continentReinforcementsRemaining) ||
        previous?.turn?.reinforcementArmiesRemaining !==
          snapshot.turn?.reinforcementArmiesRemaining
      )
        setPlacements({});
    }
    const presentation = gamePresentation(snapshot);
    if (
      changedPhase &&
      presentation.mine &&
      snapshot.turn?.phase === 'end_of_turn_cards' &&
      !snapshot.pendingAction &&
      (snapshot.legalActions.actions.includes('claim_card') ||
        snapshot.legalActions.territoryBonusCardIds.length > 0)
    )
      setInformationPanel('cards');
    else if (
      changedPhase &&
      (presentation.required ||
        (presentation.mine &&
          (snapshot.status === 'SETUP' || snapshot.turn?.phase === 'regroup')))
    ) {
      setInformationPanel(
        snapshot.turn?.phase === 'ordinary_exchange' ? 'cards' : 'actions',
      );
    }
  }, [selected, selectedSource, snapshot]);

  const legalTerritories = snapshot
    ? snapshot.status === 'ACTIVE'
      ? mapChoices(snapshot, selectedSource)
      : snapshot.legalActions.territoryChoices
    : [];
  const self = snapshot?.players.find(({ id }) => id === snapshot.selfPlayerId);
  const pendingMapPreview = { ...placements };
  if (snapshot?.pendingAction?.kind === 'conquest_transfer') {
    pendingMapPreview[snapshot.pendingAction.fromTerritoryId] =
      -conquestTransfer;
    pendingMapPreview[snapshot.pendingAction.conqueredTerritoryId] =
      conquestTransfer;
  }
  if (state.connection === 'unavailable' && state.error === 'GAME_NOT_FOUND')
    return <DeletedGameNotice />;
  if (state.connection === 'unauthorized')
    return <RevokedSessionNotice gameId={gameId} error={state.error} />;
  if (!snapshot)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel" aria-live="polite">
          <p className={`connection ${state.connection}`}>
            {statusLabels[state.connection]}
          </p>
          <h1>Abriendo la partida</h1>
          <p>
            {state.error
              ? errorMessage(state.error)
              : 'Buscando tu sesión guardada en este navegador…'}
          </p>
        </section>
      </main>
    );

  const ready =
    snapshot.readyPlayerIds?.includes(snapshot.selfPlayerId) ?? false;
  const presentation = gamePresentation(
    snapshot,
    state.connection,
    Boolean(state.inFlight),
  );
  // End-turn flag after the panel buttons, as in Reconquista.
  const turnActions = snapshot.legalActions.actions;
  const canEndTurn =
    !snapshot.pendingAction &&
    (turnActions.includes('end_turn') ||
      (['attack', 'regroup'].includes(snapshot.turn?.phase ?? '') &&
        turnActions.includes('advance_phase')));
  const endTurn = () => {
    if (turnActions.includes('end_turn')) {
      setEndingTurn(true);
      return;
    }
    advancedAt.current = snapshot.revision;
    submit({ type: 'advance_phase' });
    setEndingTurn(true);
  };
  const endTurnButton = turnMine ? (
    <button
      type="button"
      className="end-turn-tab"
      title={
        canEndTurn
          ? 'Terminar turno'
          : 'Colocá todos tus ejércitos para terminar el turno'
      }
      aria-label="Terminar turno"
      disabled={Boolean(state.inFlight) || endingTurn || !canEndTurn}
      onClick={endTurn}
    >
      <span className="panel-tab-icon">
        <UiIcon name="finish" />
      </span>
      {endTurnReminder && canEndTurn && (
        <span
          className="panel-notification"
          title="No te olvides de terminar el turno"
          aria-hidden="true"
        >
          !
        </span>
      )}
    </button>
  ) : null;
  return (
    <main
      className={`game-shell ${snapshot.status === 'LOBBY' ? 'lobby-shell' : 'playing-shell'}`}
    >
      <header
        className={`topbar${toolbarCollapsed && snapshot.status !== 'LOBBY' ? ' toolbar-collapsed' : ''}`}
        id={snapshot.status === 'LOBBY' ? undefined : 'game-toolbar'}
      >
        {snapshot.status !== 'LOBBY' && (
          <button
            className="toolbar-toggle"
            type="button"
            aria-expanded={!toolbarCollapsed}
            aria-label={
              toolbarCollapsed
                ? 'Desplegar herramientas'
                : 'Colapsar herramientas'
            }
            title={
              toolbarCollapsed
                ? 'Desplegar herramientas'
                : 'Colapsar herramientas'
            }
            onClick={() => {
              if (
                toolbarCollapsed &&
                window.matchMedia('(max-width:500px), (max-height:420px)')
                  .matches
              )
                setInformationPanel(null);
              setToolbarCollapsed(!toolbarCollapsed);
            }}
          >
            <UiIcon name={toolbarCollapsed ? 'expand' : 'collapse'} />
          </button>
        )}
        <a
          className="brand"
          href="/"
          title={snapshot.mode === 'competitive' ? COMPETITIVE_NAME : GAME_NAME}
          aria-label={
            snapshot.mode === 'competitive' ? COMPETITIVE_NAME : GAME_NAME
          }
        >
          <span>{GAME_SHORT_NAME}</span>
          <small className="mode-label">
            {snapshot.mode === 'competitive' ? 'Competitivo' : 'Clásico'}
          </small>
        </a>
        {snapshot.status === 'LOBBY' ? (
          <div>
            <strong>{self?.nickname}</strong>
            <span>{self ? playerColorLabel(self.color) : ''}</span>
          </div>
        ) : null}
        <p className={`connection ${state.connection}`} aria-live="polite">
          {statusLabels[state.connection]}
        </p>
        <div className="seat-exit-bar">
          <button
            type="button"
            className="secondary seat-exit-button"
            aria-label="Salir de la partida"
            title="Salir de la partida"
            disabled={leaving || Boolean(state.inFlight)}
            onClick={() => {
              if (
                !window.confirm(
                  '¿Salir de la partida? Tu sesión se cerrará y cualquier persona con el enlace podrá ocupar tu asiento. Cerrar el navegador no lo libera.',
                )
              )
                return;
              setLeaving(true);
              void api
                .leave(gameId)
                .then(() => window.location.assign(`/game/${gameId}?entry=1`))
                .catch((caught: unknown) => {
                  setLeaveError(
                    errorMessage(
                      caught instanceof ApiError ? caught.code : 'SERVER_ERROR',
                    ),
                  );
                  setLeaving(false);
                });
            }}
          >
            <UiIcon name="leave" />
          </button>
          <ThemeToggle />
          {leaveError && <span role="alert">{leaveError}</span>}
        </div>
      </header>
      {snapshot.status !== 'LOBBY' && <PlayerRoster snapshot={snapshot} />}
      {snapshot.status === 'LOBBY' &&
        state.error &&
        state.error !== 'DUPLICATE_COMMAND' && (
          <p className="error-banner global-error" role="alert">
            {errorMessage(state.error)}
          </p>
        )}
      {snapshot.status === 'LOBBY' ? (
        <div className="lobby-layout">
          <section className="panel lobby-main">
            <p className="eyebrow">Sala de espera</p>
            <h1>
              {snapshot.players.length} de {snapshot.configuredPlayerCount}{' '}
              jugadores
            </h1>
            <ul className="player-list">
              {snapshot.players.map((player) => (
                <li
                  key={player.id}
                  className={
                    player.id === snapshot.selfPlayerId ? 'self-player' : ''
                  }
                >
                  <span
                    className={`color-dot color-${player.color}`}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>
                      {player.nickname}
                      {player.id === snapshot.selfPlayerId ? ' (vos)' : ''}
                    </strong>
                    <small>Asiento {player.seatIndex + 1}</small>
                    <small>{playerColorLabel(player.color)}</small>
                  </span>
                  <span
                    className={
                      snapshot.readyPlayerIds?.includes(player.id)
                        ? 'ready'
                        : 'waiting'
                    }
                  >
                    {snapshot.readyPlayerIds?.includes(player.id)
                      ? 'Listo'
                      : 'Esperando'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <aside className="panel lobby-actions">
            <h2>Tu estado</h2>
            <p>
              El servidor iniciará la preparación cuando estén todos los
              asientos ocupados y listos.
            </p>
            <button
              type="button"
              disabled={Boolean(state.inFlight)}
              onClick={() =>
                client.submit({ type: 'set_ready', ready: !ready })
              }
            >
              {ready ? 'Dejar de estar listo' : 'Estoy listo'}
            </button>
            <dl>
              <dt>ID del jugador</dt>
              <dd>
                <code>{snapshot.selfPlayerId}</code>
              </dd>
            </dl>
          </aside>
        </div>
      ) : (
        <div className="gameplay-stage">
          <div className="board-layout">
            <div className="board-main">
              <GameMap
                snapshot={snapshot}
                legalTerritoryIds={
                  snapshot.status === 'FINISHED' ? [] : legalTerritories
                }
                selectedTerritoryId={selected ?? selectedSource}
                selectedSourceId={selectedSource}
                selectedTargetId={selected}
                pendingPlacements={pendingMapPreview}
                onClearSelection={() => {
                  setSelected(undefined);
                  setSelectedSource(undefined);
                }}
                onSelect={
                  state.connection !== 'connected' || state.inFlight
                    ? undefined
                    : snapshot.status === 'SETUP'
                      ? (id) => {
                          setSelected(id);
                          revealMobileActions();
                        }
                      : snapshot.status === 'ACTIVE'
                        ? (id) => {
                            revealMobileActions();
                            if (snapshot.turn?.phase === 'attack') {
                              const isLegalSource =
                                snapshot.legalActions.attackChoices.some(
                                  ({ from }) => from === id,
                                );
                              if (isLegalSource) {
                                setSelectedSource(id);
                                setSelected(undefined);
                              } else setSelected(id);
                            } else if (
                              snapshot.turn?.phase === 'regroup' &&
                              !selectedSource
                            ) {
                              setSelectedSource(id);
                              setSelected(undefined);
                            } else setSelected(id);
                          }
                        : undefined
                }
              />
              <div
                id="game-actions"
                className={`action-cluster${mobileActionsOpen ? ' mobile-actions-open' : ''}`}
              >
                {state.error && state.error !== 'DUPLICATE_COMMAND' && (
                  <p className="error-banner global-error" role="alert">
                    {errorMessage(state.error)}
                  </p>
                )}
                <DicePanel key={snapshot.gameId} snapshot={snapshot}>
                  <CombatResult snapshot={snapshot} />
                </DicePanel>
                <button
                  type="button"
                  className="mobile-action-toggle"
                  aria-expanded={mobileActionsOpen}
                  aria-controls="contextual-actions"
                  onClick={() => {
                    setInformationPanel(null);
                    setMobileActionsOpen(!mobileActionsOpen);
                  }}
                >
                  <span className="compact-action-copy">
                    <strong>{presentation.title}</strong>
                    <small>
                      {presentation.lock ||
                        (presentation.mine ? '' : presentation.status)}
                    </small>
                  </span>
                  {presentation.mine && (
                    <span
                      className="panel-notification"
                      aria-label={presentation.status}
                    >
                      !
                    </span>
                  )}
                  {mobileActionsOpen ? (
                    <UiIcon name="close" />
                  ) : (
                    <UiIcon name="plus" />
                  )}
                </button>
                <div className="phase-row">
                  <TurnSummary
                    snapshot={snapshot}
                    presentation={presentation}
                  />
                </div>
                {actionHost &&
                  createPortal(
                    <section
                      className="panel phase-panel action-dock"
                      id="contextual-actions"
                      aria-label="Acciones contextuales"
                      data-layout-region="action-area"
                    >
                      <InheritanceControls
                        snapshot={snapshot}
                        submit={submit}
                        busy={Boolean(state.inFlight)}
                      />
                      {snapshot.status === 'SETUP' && snapshot.setup && (
                        <SetupControls
                          snapshot={snapshot}
                          onSelected={setSelected}
                          selected={selected}
                          placements={placements}
                          onPlacement={(id, amount) =>
                            setPlacements((current) => {
                              const next = { ...current };
                              if (amount === 0) delete next[id];
                              else next[id] = amount;
                              return next;
                            })
                          }
                          onSubmit={(command) => client.submit(command)}
                          busy={
                            Boolean(state.inFlight) ||
                            state.connection !== 'connected'
                          }
                        />
                      )}
                      {snapshot.status === 'ACTIVE' && snapshot.turn && (
                        <>
                          {snapshot.turn.phase === 'ordinary_exchange' &&
                            snapshot.legalActions.actions.includes(
                              'exchange_cards',
                            ) && (
                              <div className="action-card action-layout exchange-prompt">
                                <ActionTitle
                                  title={
                                    snapshot.mode === 'classic' &&
                                    snapshot.private.cards.length > 5
                                      ? 'Canje obligatorio'
                                      : 'Canje'
                                  }
                                  required={
                                    snapshot.mode === 'classic' &&
                                    snapshot.private.cards.length > 5
                                  }
                                />
                                <div className="action-selection">
                                  <small>
                                    {snapshot.private.cards.length} cartas en tu
                                    mano
                                  </small>
                                  <strong>Seleccioná tres cartas</strong>
                                </div>
                                <button
                                  type="button"
                                  className="icon-button open-exchange"
                                  title="Abrir cartas para canjear"
                                  aria-label="Abrir cartas para canjear"
                                  onClick={() =>
                                    selectInformationPanel('cards')
                                  }
                                >
                                  <UiIcon name="exchange" />
                                </button>
                              </div>
                            )}
                          {self?.eliminated && (
                            <p className="warning">
                              Fuiste eliminado. Podés seguir observando la
                              partida.
                            </p>
                          )}
                          <GameplayControls
                            key={`${snapshot.turn.playerId}:${snapshot.turn.phase}`}
                            snapshot={snapshot}
                            selected={selected}
                            selectedSource={selectedSource}
                            placements={placements}
                            conquestTransfer={conquestTransfer}
                            onConquestTransfer={setConquestTransfer}
                            onPlacement={(id, amount) =>
                              setPlacements((current) => {
                                const next = { ...current };
                                if (amount === 0) delete next[id];
                                else next[id] = amount;
                                return next;
                              })
                            }
                            onSelected={setSelected}
                            onSource={setSelectedSource}
                            submit={(command) => client.submit(command)}
                            busy={
                              Boolean(state.inFlight) ||
                              state.connection !== 'connected'
                            }
                          />
                        </>
                      )}
                      {snapshot.status === 'FINISHED' && (
                        <FinishedPanel snapshot={snapshot} />
                      )}
                    </section>,
                    actionHost,
                  )}
              </div>
            </div>
            <GamePanels
              selected={informationPanel}
              onSelect={selectInformationPanel}
              notifications={{
                ...notifications,
                ...(presentation.mine &&
                snapshot.status !== 'FINISHED' &&
                !closingMine
                  ? {
                      [snapshot.pendingAction ||
                      snapshot.turn?.phase === 'regroup'
                        ? 'transfer'
                        : snapshot.turn?.phase === 'attack'
                          ? 'attack'
                          : 'reinforcement']: { message: 'Tu turno', count: 1 },
                    }
                  : {}),
                ...(closingMine &&
                (snapshot.legalActions.actions.includes('claim_card') ||
                  snapshot.legalActions.territoryBonusCardIds.length > 0)
                  ? { cards: { message: 'Podés pedir cartas', count: 1 } }
                  : {}),
              }}
              onRead={markRead}
              trailing={endTurnButton}
              panels={[
                {
                  id: 'objective',
                  label: 'Objetivo',
                  content: <PrivateInformation snapshot={snapshot} />,
                },
                {
                  id: 'cards',
                  label: `Cartas · ${snapshot.private.cards.length}`,
                  content: (
                    <PrivateCards
                      snapshot={snapshot}
                      newCardIds={newCardIds}
                      submit={(command) => client.submit(command)}
                      busy={
                        Boolean(state.inFlight) ||
                        state.connection !== 'connected'
                      }
                    />
                  ),
                },
                {
                  id: 'pacts',
                  label: 'Pactos',
                  content: snapshot.pacts ? (
                    <PactsPanel
                      snapshot={snapshot}
                      submit={(command) => client.submit(command)}
                      busy={
                        Boolean(state.inFlight) ||
                        state.connection !== 'connected'
                      }
                    />
                  ) : (
                    <p>
                      No hay acciones de pactos disponibles en este momento.
                    </p>
                  ),
                },
                {
                  id: 'actions',
                  label: presentation.title,
                  navigation: false,
                  icon:
                    snapshot.pendingAction || snapshot.turn?.phase === 'regroup'
                      ? 'arrow'
                      : snapshot.turn?.phase === 'attack'
                        ? 'sword'
                        : 'plus',
                  content: (
                    <div
                      ref={setActionHost}
                      className="contextual-panel-host"
                    />
                  ),
                },
                // Off turn the play buttons are hidden, as in Reconquista.
                ...(presentation.mine || snapshot.status === 'FINISHED'
                  ? (['reinforcement', 'attack', 'transfer'] as const)
                  : []
                ).map((kind): GamePanel => {
                  const isTransfer =
                    Boolean(snapshot.pendingAction) ||
                    snapshot.turn?.phase === 'regroup';
                  const isAttack =
                    !snapshot.pendingAction &&
                    snapshot.turn?.phase === 'attack';
                  const current =
                    kind === 'transfer'
                      ? isTransfer
                      : kind === 'attack'
                        ? isAttack
                        : !isTransfer && !isAttack;
                  const isResult =
                    snapshot.status === 'FINISHED' && kind === 'reinforcement';
                  const enabled =
                    isResult ||
                    (current &&
                      presentation.actorId === snapshot.selfPlayerId &&
                      !snapshot.legalActions.readOnly &&
                      !['FINISHED', 'LOBBY'].includes(snapshot.status));
                  return {
                    id: kind,
                    targetId: 'actions',
                    label: isResult
                      ? 'Resultado'
                      : kind === 'transfer'
                        ? 'Traslado / Reagrupamiento'
                        : kind === 'attack'
                          ? 'Ataque'
                          : current
                            ? presentation.title
                            : 'Refuerzos / Distribución',
                    icon: isResult
                      ? 'objective'
                      : kind === 'transfer'
                        ? 'movement'
                        : kind === 'attack'
                          ? 'sword'
                          : 'reinforcement',
                    disabled: !enabled,
                    disabledReason:
                      'Disponible en la fase correspondiente de tu turno',
                    content: null,
                  };
                }),
              ]}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function DeletedGameNotice() {
  return (
    <main className="entry-layout">
      <section className="panel entry-panel">
        <h1>La partida fue eliminada</h1>
        <p>Esta partida ya no existe o dejó de estar disponible.</p>
        <a className="button-link" href="/">
          Volver al inicio
        </a>
      </section>
    </main>
  );
}

function RevokedSessionNotice({
  gameId,
  error,
}: {
  readonly gameId: string;
  readonly error: Parameters<typeof errorMessage>[0] | undefined;
}) {
  return (
    <main className="entry-layout">
      <section className="panel entry-panel">
        <h1>El asiento necesita identificación</h1>
        <p>{error ? errorMessage(error) : 'La sesión dejó de ser válida.'}</p>
        <a className="button-link" href={`/game/${gameId}?entry=1`}>
          Ver asientos disponibles
        </a>
      </section>
    </main>
  );
}
