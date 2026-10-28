import { useEffect, useRef, useState } from 'react';
import type { PlayerGameView } from '@game/protocol';

import { resolveBoardPresentation } from './territories.js';
import { SPECIAL_ROUTE_SEGMENTS } from './map-routes.js';
import { MapViewport } from './MapViewport.js';
import { MapArtwork } from './MapArtwork.js';
import { hasNewCombat } from './combat-events.js';
import { tr } from './language.js';

interface GameMapProps {
  readonly snapshot: PlayerGameView;
  readonly legalTerritoryIds: readonly string[];
  readonly selectedTerritoryId: string | undefined;
  readonly selectedSourceId?: string | undefined;
  readonly selectedTargetId?: string | undefined;
  readonly pendingPlacements?: Readonly<Record<string, number>>;
  readonly onSelect: ((territoryId: string) => void) | undefined;
  readonly onClearSelection?: () => void;
}

const colorClass: Record<string, string> = {
  blue: 'owner-blue',
  red: 'owner-red',
  black: 'owner-black',
  yellow: 'owner-yellow',
  green: 'owner-green',
  magenta: 'owner-magenta',
};

export function GameMap({
  snapshot,
  legalTerritoryIds,
  selectedTerritoryId,
  selectedSourceId,
  selectedTargetId,
  pendingPlacements = {},
  onSelect,
  onClearSelection,
}: GameMapProps) {
  const { territories: TERRITORIES, connections: MAP_CONNECTIONS } =
    resolveBoardPresentation(snapshot.definition);
  const previousCombatSnapshot = useRef(snapshot);
  const combatTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [observedCombat, setObservedCombat] = useState<{
    from: string;
    to: string;
  }>();
  useEffect(() => {
    const previous = previousCombatSnapshot.current;
    previousCombatSnapshot.current = snapshot;
    if (previous.gameId !== snapshot.gameId) {
      clearTimeout(combatTimer.current);
      setObservedCombat(undefined);
      return;
    }
    if (!hasNewCombat(previous, snapshot)) return;
    clearTimeout(combatTimer.current);
    const combat = snapshot.turn?.lastCombat;
    if (!combat || snapshot.turn?.playerId === snapshot.selfPlayerId) {
      setObservedCombat(undefined);
      return;
    }
    setObservedCombat({
      from: combat.fromTerritoryId,
      to: combat.toTerritoryId,
    });
    combatTimer.current = setTimeout(() => setObservedCombat(undefined), 4000);
  }, [snapshot]);
  useEffect(() => () => clearTimeout(combatTimer.current), []);
  // Armies other players add or move show as «+3» / «−3» on the country for a
  // few seconds, so waiting players see each move.
  const previousArmies = useRef(snapshot);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [armyChanges, setArmyChanges] = useState<
    Readonly<Record<string, number>>
  >({});
  useEffect(() => {
    const previous = previousArmies.current;
    previousArmies.current = snapshot;
    if (
      previous.gameId !== snapshot.gameId ||
      previous.selfPlayerId !== snapshot.selfPlayerId
    ) {
      setArmyChanges({});
      return;
    }
    if (hasNewCombat(previous, snapshot)) return;
    const deltas: Record<string, number> = {};
    for (const [id, now] of Object.entries(snapshot.territories ?? {})) {
      const before = previous.territories?.[id];
      if (
        !before ||
        !now.ownerId ||
        before.ownerId !== now.ownerId ||
        now.ownerId === snapshot.selfPlayerId ||
        before.armies === now.armies
      )
        continue;
      deltas[id] = now.armies - before.armies;
    }
    if (!Object.keys(deltas).length) return;
    setArmyChanges((current) => {
      const next = { ...current };
      for (const [id, delta] of Object.entries(deltas))
        next[id] = (next[id] ?? 0) + delta;
      return next;
    });
    clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => setArmyChanges({}), 5000);
  }, [snapshot]);
  useEffect(() => () => clearTimeout(changeTimer.current), []);
  const [inspectedId, setInspectedId] = useState<string>();
  useEffect(() => {
    setInspectedId(undefined);
  }, [snapshot.gameId, snapshot.revision]);
  const [resetKey, setResetKey] = useState(0);
  const [mapScale, setMapScale] = useState(1);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 600;
  const revealIds = [
    ...new Set(
      [selectedSourceId, selectedTargetId, selectedTerritoryId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  const picker = useRef<HTMLDialogElement>(null);
  const legal = new Set(legalTerritoryIds);
  function selectTerritory(id: string, actionable: boolean) {
    if (
      id === inspectedId ||
      id === selectedTerritoryId ||
      id === selectedSourceId ||
      id === selectedTargetId
    ) {
      setInspectedId(undefined);
      onClearSelection?.();
      return;
    }
    setInspectedId(id);
    if (actionable) onSelect?.(id);
  }
  const pickerTargets =
    selectedSourceId && snapshot.turn?.phase === 'attack'
      ? new Set(
          snapshot.legalActions.attackChoices.find(
            (choice) => choice.from === selectedSourceId,
          )?.targets ?? [],
        )
      : legal;
  const players = new Map(
    snapshot.players.map((player) => [player.id, player]),
  );
  const pendingFrom = snapshot.pendingAction?.fromTerritoryId;
  const pendingTo = snapshot.pendingAction?.conqueredTerritoryId;
  const detailId =
    selectedTargetId ??
    selectedSourceId ??
    pendingTo ??
    selectedTerritoryId ??
    inspectedId;
  const detail = detailId ? snapshot.territories?.[detailId] : undefined;
  const detailOwner = detail?.ownerId ? players.get(detail.ownerId) : undefined;
  const self = players.get(snapshot.selfPlayerId);
  const isActiveActor =
    snapshot.status === 'ACTIVE' &&
    snapshot.turn?.playerId === snapshot.selfPlayerId &&
    !self?.eliminated &&
    !snapshot.legalActions.readOnly;
  const actions = snapshot.legalActions.actions;
  const hasActiveMapAction =
    isActiveActor &&
    ((snapshot.turn?.phase === 'attack' && actions.includes('attack')) ||
      (snapshot.turn?.phase === 'regroup' && actions.includes('regroup')) ||
      ((snapshot.turn?.phase === 'ordinary_exchange' ||
        snapshot.turn?.phase === 'territory_reinforcement' ||
        snapshot.turn?.phase === 'continent_reinforcement') &&
        actions.includes('place_reinforcements')));
  const hasSetupMapAction =
    snapshot.status === 'SETUP' &&
    snapshot.setup?.currentPlayerId === snapshot.selfPlayerId &&
    !snapshot.legalActions.readOnly;
  const canSelectTerritory = hasActiveMapAction || hasSetupMapAction;
  const selectionStep =
    snapshot.status === 'FINISHED'
      ? tr(
          'Partida finalizada · Podés inspeccionar el mapa final',
          'Game over · You can inspect the final map',
        )
      : snapshot.legalActions.readOnly || self?.eliminated
        ? tr(
            'Mapa de solo lectura · Podés inspeccionar los territorios',
            'Read-only map · You can inspect the territories',
          )
        : snapshot.status === 'ACTIVE' && !isActiveActor
          ? tr(
              'Esperando al jugador en turno · Podés inspeccionar el mapa',
              'Waiting for the player on turn · You can inspect the map',
            )
          : isActiveActor &&
              snapshot.turn?.phase === 'attack' &&
              actions.includes('attack')
            ? selectedSourceId
              ? tr(
                  'Elegí el territorio defensor',
                  'Choose the defending territory',
                )
              : tr(
                  'Elegí el territorio atacante',
                  'Choose the attacking territory',
                )
            : isActiveActor &&
                snapshot.turn?.phase === 'regroup' &&
                actions.includes('regroup')
              ? selectedSourceId
                ? tr(
                    'Elegí el destino del reagrupamiento',
                    'Choose where to regroup to',
                  )
                : tr(
                    'Elegí el origen del reagrupamiento',
                    'Choose where to regroup from',
                  )
              : isActiveActor &&
                  (snapshot.turn?.phase === 'ordinary_exchange' ||
                    snapshot.turn?.phase === 'territory_reinforcement' ||
                    snapshot.turn?.phase === 'continent_reinforcement') &&
                  actions.includes('place_reinforcements')
                ? tr('Distribuí tus refuerzos', 'Place your reinforcements')
                : hasSetupMapAction
                  ? tr(
                      'Elegí un territorio señalado',
                      'Choose a highlighted territory',
                    )
                  : tr('Inspeccioná el tablero', 'Inspect the board');
  const isActionable = (id: string) =>
    canSelectTerritory && legal.has(id) && Boolean(onSelect);
  const legalKind =
    snapshot.turn?.phase === 'attack' || snapshot.turn?.phase === 'regroup'
      ? selectedSourceId
        ? 'legal-target'
        : 'legal-source'
      : 'legal-placement';
  /** Shared by a country and its name and armies, drawn in a later layer. */
  const territoryClass = (id: string) => {
    const territory = snapshot.territories?.[id];
    const owner = territory?.ownerId
      ? players.get(territory.ownerId)
      : undefined;
    const actionable = isActionable(id);
    return [
      'territory',
      owner ? colorClass[owner.color] : 'unoccupied',
      actionable ? 'legal' : 'passive',
      actionable ? legalKind : '',
      selectedTerritoryId === id ? 'selected' : '',
      selectedSourceId === id ? 'selected-source' : '',
      selectedSourceId && selectedTargetId === id ? 'selected-target' : '',
      pendingFrom === id ? 'pending-source' : '',
      pendingTo === id ? 'pending-target' : '',
      inspectedId === id && selectedTerritoryId !== id ? 'inspected' : '',
      snapshot.legalActions.territoryBonusCardIds.includes(id)
        ? 'bonus-available'
        : '',
    ].join(' ');
  };
  return (
    <section
      className="map-frame"
      aria-label={tr('Mapa de territorios', 'Territory map')}
    >
      {observedCombat && (
        <div className="observed-combat" role="status">
          <span>
            ⚔ {TERRITORIES.find((t) => t.id === observedCombat.from)?.label}
          </span>
          <span aria-hidden="true">→</span>
          <span>
            🛡 {TERRITORIES.find((t) => t.id === observedCombat.to)?.label}
          </span>
        </div>
      )}
      <div className="map-instructions">
        <h1>{selectionStep}</h1>
        <p>
          {canSelectTerritory && onSelect
            ? tr(
                'Seleccioná un territorio señalado en el mapa.',
                'Select a highlighted territory on the map.',
              )
            : tr(
                'Podés consultar los países y sus ejércitos.',
                'You can look at the countries and their armies.',
              )}
        </p>
      </div>
      <MapViewport
        resetKey={resetKey}
        onScaleChange={setMapScale}
        // On phones the chosen countries move into view above the open menu, as in Reconquista.
        {...(narrow && revealIds.length
          ? {
              reveal: revealIds
                .map((id) => `.game-map [data-territory-id="${id}"]`)
                .join(','),
            }
          : {})}
      >
        <svg
          className="game-map"
          viewBox="40 0 1720 960"
          role="group"
          aria-label={tr('Mapa de territorios', 'Territory map')}
        >
          <MapArtwork definition={snapshot.definition} part="definitions" />
          <MapArtwork definition={snapshot.definition} part="background" />
          <g className="map-connections" aria-hidden="true">
            {MAP_CONNECTIONS.filter(({ kind }) => kind === 'special-link').map(
              ({ from, to, kind }) => {
                return SPECIAL_ROUTE_SEGMENTS[`${from}:${to}`]?.map(
                  ({ path, edge }, index) => (
                    <g
                      key={`${from}-${to}-${index}`}
                      data-adjacency={`${from}:${to}`}
                      data-visual-kind={kind}
                    >
                      <path className="route-underlay" d={path} />
                      <path
                        className="route-ink"
                        d={path}
                        markerStart="url(#chart-arrow)"
                        markerEnd={edge ? undefined : 'url(#chart-arrow)'}
                      />
                    </g>
                  ),
                );
              },
            )}
          </g>
          {TERRITORIES.map(({ id, label, continent, path }, index) => {
            const territory = snapshot.territories?.[id];
            const displayedArmies =
              (territory?.armies ?? 0) + (pendingPlacements[id] ?? 0);
            const owner = territory?.ownerId
              ? players.get(territory.ownerId)
              : undefined;
            const actionable = isActionable(id);
            return (
              <g
                key={id}
                data-territory-id={id}
                data-continent={continent}
                className={territoryClass(id)}
                role="button"
                tabIndex={0}
                aria-pressed={selectedTerritoryId === id || inspectedId === id}
                aria-label={tr(
                  `${label}. ${owner ? `Controla ${owner.nickname}` : 'Sin ocupar'}. ${displayedArmies} ejércitos${actionable ? '. Opción legal' : '. Disponible para inspeccionar'}${selectedSourceId === id ? '. Origen seleccionado' : ''}${selectedTargetId === id ? '. Destino seleccionado' : ''}`,
                  `${label}. ${owner ? `Held by ${owner.nickname}` : 'Unoccupied'}. ${displayedArmies} armies${actionable ? '. Legal choice' : '. Available to inspect'}${selectedSourceId === id ? '. Selected origin' : ''}${selectedTargetId === id ? '. Selected destination' : ''}`,
                )}
                onClick={() => {
                  selectTerritory(id, actionable);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectTerritory(id, actionable);
                  }
                }}
              >
                <path className="territory-fill" d={path} />
                <title>{`${index + 1}. ${label}`}</title>
              </g>
            );
          })}
          {/* Names and armies over every country, so no neighbor covers them. */}
          <g className="territory-marks" aria-hidden="true">
            {TERRITORIES.map(({ id, label, continent, x, y, scale }) => {
              const territory = snapshot.territories?.[id];
              const displayedArmies =
                (territory?.armies ?? 0) + (pendingPlacements[id] ?? 0);
              return (
                <g
                  key={id}
                  data-continent={continent}
                  className={territoryClass(id)}
                  transform={
                    scale
                      ? `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`
                      : undefined
                  }
                >
                  <text className="territory-label" x={x} y={y}>
                    {id === 'great_britain'
                      ? tr('G. Bretaña', 'G. Britain')
                      : label}
                  </text>
                  {/* A drawn shadow instead of a filter, so zooming never waits for it. */}
                  <circle
                    className="army-shadow"
                    cx={x}
                    cy={y + 24.2}
                    r="13.6"
                  />
                  <circle className="army-marker" cx={x} cy={y + 23} r="13" />
                  <text className="army-count" x={x} y={y + 28}>
                    {territory
                      ? displayedArmies
                      : snapshot.status === 'SETUP'
                        ? '—'
                        : 0}
                  </text>
                </g>
              );
            })}
          </g>
          <MapArtwork definition={snapshot.definition} part="wash" />
          <MapArtwork definition={snapshot.definition} part="ornaments" />
          {observedCombat && (
            <g className="observed-combat-outlines" aria-hidden="true">
              {TERRITORIES.filter(
                (t) =>
                  t.id === observedCombat.from || t.id === observedCombat.to,
              ).map((t) => (
                <path
                  key={t.id}
                  d={t.path}
                  className={
                    t.id === observedCombat.from
                      ? 'combat-attacker'
                      : 'combat-defender'
                  }
                />
              ))}
            </g>
          )}
          {/* Over the combat outlines, so moves stay readable. */}
          <g className="army-changes" aria-hidden="true">
            {TERRITORIES.filter(({ id }) => armyChanges[id]).map(
              ({ id, x, y }) => {
                const delta = armyChanges[id]!;
                const owner = players.get(
                  snapshot.territories?.[id]?.ownerId ?? '',
                );
                return (
                  <g
                    key={id}
                    className={`army-change color-${owner?.color ?? 'none'}`}
                    transform={`translate(${x + 26} ${y + 10})`}
                  >
                    <rect x="-12" y="-8" width="24" height="16" rx="8" />
                    <text y="3.5">
                      {delta > 0 ? `+${delta}` : `−${-delta}`}
                    </text>
                  </g>
                );
              },
            )}
          </g>
        </svg>
      </MapViewport>
      <div className="map-selection-bar">
        <span className="map-selected-detail" aria-live="polite">
          <strong
            title={
              detailId
                ? `${detailOwner ? detailOwner.nickname : tr('Sin ocupar', 'Unoccupied')} · ${(detail?.armies ?? 0) + (pendingPlacements[detailId] ?? 0)} ${tr('ejércitos', 'armies')}`
                : undefined
            }
          >
            {detailId
              ? (TERRITORIES.find(({ id }) => id === detailId)?.label ??
                detailId)
              : tr('Sin territorio seleccionado', 'No territory selected')}
          </strong>
          {' · '}
          {Math.round(mapScale * 100)}%
        </span>
        <span className="gesture-hint">
          {tr(
            'Arrastrá para mover · pinza o rueda para ampliar',
            'Drag to move · pinch or wheel to zoom',
          )}
        </span>
        {selectedSourceId && onClearSelection && (
          <button
            className="secondary"
            type="button"
            onClick={onClearSelection}
          >
            {tr('Cambiar origen', 'Change origin')}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => picker.current?.showModal()}
        >
          {tr('Lista de destinos', 'Destination list')}
        </button>
      </div>
      <dialog
        ref={picker}
        className="territory-picker"
        aria-labelledby="territory-picker-title"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            picker.current?.close();
        }}
      >
        <div className="picker-heading">
          <strong id="territory-picker-title">
            {tr('Selección de territorio', 'Territory selection')}
          </strong>
          <button
            type="button"
            className="secondary"
            onClick={() => picker.current?.close()}
          >
            {tr('Cerrar ×', 'Close ×')}
          </button>
        </div>
        <div className="picker-content">
          <h2>
            {canSelectTerritory && onSelect
              ? tr('Territorios disponibles', 'Available territories')
              : tr('Inspeccionar país', 'Inspect country')}
          </h2>
          <p>{selectionStep}</p>
          <div className="country-list">
            {TERRITORIES.filter(
              (t) =>
                !canSelectTerritory || !onSelect || pickerTargets.has(t.id),
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                className="secondary"
                onClick={() => {
                  selectTerritory(t.id, canSelectTerritory && legal.has(t.id));
                  setResetKey((key) => key + 1);
                  picker.current?.close();
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </dialog>
    </section>
  );
}
