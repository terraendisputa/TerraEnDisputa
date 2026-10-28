import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GamePanels, type GamePanel } from './GamePanels.js';
import { CombatDice } from './GameplayControls.js';
import { ThemeToggle } from './ThemeToggle.js';
import { TurnSound } from './PlayerRoster.js';
import { MusicToggle } from './MusicToggle.js';
import { UiIcon, type IconName } from './UiIcon.js';
import { GAME_SHORT_NAME } from './identity.js';
import { ModeLogo, useModeFavicon } from './ModeLogo.js';
import { ReconquistaMap } from './ReconquistaMap.js';
import { hasNewRoll } from './reconquista-combat-events.js';
import { useReconquistaNotifications } from './reconquista-notifications.js';
import {
  ReconquistaActions,
  emptyPlan,
  placementTargets,
  plannedArmies,
  legalMapChoices,
  type MapPreview,
  type PlacementPlan,
  type Weapon,
} from './ReconquistaActions.js';
import {
  ReconquistaCards,
  ReconquistaObjective,
  ReconquistaPacts,
  SituationCardPopover,
  SituationIndicator,
} from './ReconquistaPanels.js';
import { ReconquistaClock } from './ReconquistaClock.js';
import {
  condominiumOffer,
  reconquistaPresentation,
  reconquistaRequest,
  useReconquistaGame,
  type ActionMode,
} from './reconquista-client.js';
import type {
  ReconquistaAction,
  ReconquistaView,
} from '@game/protocol/reconquista';
import { RECONQUISTA_NAME, playerColorNames } from './reconquista-labels.js';
import './reconquista-game.css';

const connectionLabels = {
  connecting: 'Conectando',
  connected: 'Conectado',
  disconnected: 'Desconectado',
} as const;

const modeIcon: Partial<Record<ActionMode, IconName>> = {
  placement: 'reinforcement',
  reveal: 'situation',
  attack: 'sword',
  transfer: 'movement',
  occupation: 'movement',
  regroup: 'movement',
  closing: 'cards',
  zone: 'pact',
  finished: 'objective',
};

/** Reconquista game in Classic's four-zone screen (decisions D67–D74). */
export function ReconquistaGameScreen({ gameId }: { readonly gameId: string }) {
  const game = useReconquistaGame(gameId);
  const { view, board, entry } = game;
  const [panel, setPanel] = useState<string | null>(null);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const [situationOpen, setSituationOpen] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [target, setTarget] = useState('');
  const [weapon, setWeapon] = useState<Weapon>('dice');
  const [plan, setPlan] = useState<PlacementPlan>(emptyPlan);
  const [movePreview, setMovePreview] = useState<MapPreview>({});
  const seenSituation = useRef<string | null | undefined>(undefined);
  useModeFavicon('reconquista');
  useEffect(() => {
    document.title = `${GAME_SHORT_NAME} · ${RECONQUISTA_NAME}`;
  }, []);
  // Phone menus use type under 16px; without a scale limit iPhones zoom the page
  // when a list opens. The map zooms by itself, so the page needs no pinch zoom.
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
  // The situation card opens by itself once each time a new one is revealed.
  const situationId = view?.situation?.id ?? null;
  useEffect(() => {
    if (!view) return;
    if (
      seenSituation.current !== undefined &&
      situationId !== seenSituation.current &&
      situationId
    )
      setSituationOpen(true);
    seenSituation.current = situationId;
  }, [situationId, view]);
  // Each new roll, repeated identical ones included, replays the dice and opens them.
  const previousView = useRef<ReconquistaView | null | undefined>(undefined);
  const [rollCount, setRollCount] = useState(0);
  useEffect(() => {
    const before = previousView.current;
    previousView.current = view;
    if (
      before &&
      view &&
      before.gameId === view.gameId &&
      hasNewRoll(before, view)
    ) {
      setRollCount((value) => value + 1);
      setDiceOpen(true);
      setRolling(
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
    }
  }, [view]);
  // The next attack waits while the dice roll, as long as Classic's roll lasts.
  const [rolling, setRolling] = useState(false);
  useEffect(() => {
    if (!rolling) return;
    const timeout = window.setTimeout(() => setRolling(false), 2_000);
    return () => window.clearTimeout(timeout);
  }, [rollCount, rolling]);
  // The action menu keeps the step it had until the dice stop, so a
  // conquest opens Traslado only after the roll.
  const newRoll = !!(
    previousView.current &&
    view &&
    previousView.current.gameId === view.gameId &&
    hasNewRoll(previousView.current, view)
  );
  const heldView = useRef(view);
  if (!rolling && !newRoll) heldView.current = view;
  const menuView = heldView.current ?? view;
  // As in Classic, a newly received card opens the Cards panel with that card highlighted.
  const handIds = (view?.self?.campaign?.hand ?? []).map((c) => c.id);
  // The key also changes when the player's view first arrives, even with an empty hand.
  const handKey = view?.self ? `hand:${handIds.join(',')}` : '';
  const seenHand = useRef<readonly string[] | undefined>(undefined);
  const [newCardIds, setNewCardIds] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!view?.self) return;
    const fresh = seenHand.current
      ? handIds.filter((id) => !seenHand.current!.includes(id))
      : [];
    seenHand.current = handIds;
    if (!fresh.length) return;
    setNewCardIds(fresh);
    setPanel('cards');
    setMobileActionsOpen(false);
  }, [handKey]);
  const unread = useReconquistaNotifications(view, panel, setPanel);
  // Closing the turn opens the Cards panel, where cards are requested.
  const closingMine =
    view?.campaign?.phase === 'closing' &&
    view.campaign.actorId === view.self?.playerId &&
    !view.self?.campaign?.legal.canReinforce;
  useEffect(() => {
    if (closingMine) setPanel('cards');
  }, [closingMine]);
  // While closing, a few idle seconds mark the end-turn flag so the turn is not forgotten.
  const [endTurnReminder, setEndTurnReminder] = useState(false);
  useEffect(() => {
    setEndTurnReminder(false);
    if (!closingMine) return;
    const timeout = window.setTimeout(() => setEndTurnReminder(true), 5_000);
    return () => window.clearTimeout(timeout);
  }, [closingMine, view?.revision]);
  // Armies from an exchange made while closing go to the Refuerzos menu.
  const closingPlacement =
    view?.campaign?.phase === 'closing' &&
    !!view.self?.campaign?.legal.canReinforce;
  useEffect(() => {
    if (closingPlacement) setPanel('actions');
  }, [closingPlacement]);
  const presentation = menuView ? reconquistaPresentation(menuView) : undefined;
  const turnKey = `${presentation?.mode}:${presentation?.actorId}:${menuView?.campaign?.round}:${menuView?.campaign?.extraPass}`;
  useEffect(() => {
    setPlan(emptyPlan);
    setSelected('');
    setTarget('');
    // Like Classic, the action panel closes when the turn leaves this player.
    if (!presentation?.mine)
      setPanel((current) => (current === 'actions' ? null : current));
  }, [turnKey]);
  // Every step the player must act on opens its menu by itself once the
  // dice stop, replacing whatever panel was open:
  // incorporation (initial, extra and ordinary), conquest, attack, regroup.
  const hostilityStep =
    presentation?.mine &&
    [
      'placement',
      'reveal',
      'zone',
      'attack',
      'transfer',
      'occupation',
      'regroup',
    ].includes(presentation.mode)
      ? turnKey
      : '';
  useEffect(() => {
    if (hostilityStep && !rolling) setPanel('actions');
  }, [hostilityStep, rolling]);
  // The result, with the winners' cards, opens on its own when the game ends.
  const finished = presentation?.mode === 'finished';
  useEffect(() => {
    if (finished && !rolling) setPanel('actions');
  }, [finished, rolling]);
  // The player on turn shares what is selected, so everyone sees the same outlines.
  const mine = !!presentation?.mine;
  useEffect(() => {
    if (mine) game.shareFocus(selected, target);
  }, [mine, selected, target, turnKey]);
  if (!board || !entry)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel">
          <h1>{RECONQUISTA_NAME}</h1>
          <p>
            {game.connection === 'disconnected'
              ? 'La partida de Reconquista no está disponible en este servidor.'
              : 'Cargando la partida…'}
          </p>
          <a className="button-link" href="/admin">
            Volver al panel del anfitrión
          </a>
        </section>
      </main>
    );
  if (!view || view.stage === 'lobby')
    return <ReconquistaLobby gameId={gameId} game={game} />;
  const p = presentation!;
  const me = view.self?.playerId;
  // Moving into a conquered country: origins and target in the conquerors' colours, for everyone.
  const occupation = view.campaign?.occupation;
  const firstConquest = view.hostility?.pendingConquest;
  const conquest = occupation
    ? [
        ...occupation.arrivals.map((a) => ({
          id: a.originId,
          playerId: a.playerId,
        })),
        { id: occupation.targetId, playerId: occupation.creditId },
      ]
    : firstConquest
      ? [firstConquest.originId, firstConquest.targetId].map((id) => ({
          id,
          playerId: p.actorId ?? '',
        }))
      : undefined;
  // Off turn, the on-turn player's selection shows unless this player marked a country.
  const sharedFocus =
    view.focus &&
    view.focus.playerId === p.actorId &&
    view.focus.playerId !== me
      ? view.focus
      : undefined;
  const choices = legalMapChoices(
    menuView!,
    p,
    selected,
    weapon,
    p.mode === 'placement' ? placementTargets(view, board, plan) : undefined,
  );
  const player = (id: string) => view.players.find((x) => x.id === id);
  const name = (id: string) =>
    board.countries.find((c) => c.id === id)?.name ?? id;
  const combat = view.campaign?.lastCombat ?? view.hostility?.lastCombat;
  // Planned reinforcements and conversions appear on the map before confirming, as in Classic.
  const mapPreview: MapPreview =
    p.mode === 'placement'
      ? Object.fromEntries(
          [
            ...new Set([
              ...Object.keys(plan.placements),
              ...Object.values(plan.continentPlacements).flatMap((c) =>
                Object.keys(c),
              ),
              ...Object.keys(plan.conversions),
            ]),
          ].map((id) => [
            id,
            {
              armies: plannedArmies(plan, id) - 6 * (plan.conversions[id] ?? 0),
              missiles: plan.conversions[id] ?? 0,
            },
          ]),
        )
      : movePreview;
  const missile = view.campaign?.lastMissile ?? view.hostility?.lastMissile;
  const countryCount = (id: string) =>
    view.territories.filter((t) => t.forces.some((f) => f.playerId === id))
      .length;
  const onCountry = (id: string) => {
    if (p.mode === 'attack' || p.mode === 'regroup') {
      // A small country next to the origin is first taken as destination;
      // clicking it again makes it the origin, and clicking the origin clears it.
      if (id === selected) {
        setSelected('');
        setTarget('');
      } else if (
        selected &&
        choices.targets.includes(id) &&
        !(id === target && choices.origins.includes(id))
      )
        setTarget(id);
      else {
        setSelected(id);
        setTarget('');
      }
    } else setSelected(id);
    if (p.mine) setPanel('actions');
  };
  const notifications: Record<string, { message: string; count: number }> = {
    ...unread,
  };
  const incoming = view.campaign
    ? view.campaign.pacts.filter(
        (x) => x.status === 'proposed' && x.partnerId === me,
      ).length +
      view.campaign.alliances.filter(
        (x) => x.status === 'proposed' && x.allyId === me,
      ).length +
      (condominiumOffer(view)?.partnerId === me ? 1 : 0)
    : 0;
  if (incoming)
    notifications.pacts = {
      message: [unread.pacts?.message, 'Propuesta de pacto pendiente']
        .filter(Boolean)
        .join(' · '),
      count: Math.max(incoming, unread.pacts?.count ?? 0),
    };
  if (p.mine && p.mode === 'closing') {
    const legal = view.self?.campaign?.legal;
    if (
      legal &&
      (legal.canClaimCountry ||
        legal.continentIds.length > 0 ||
        legal.bonusCardIds.length > 0)
    )
      notifications.cards = { message: 'Podés solicitar cartas', count: 1 };
  } else if (p.mine && !(p.mode === 'placement' && plan !== emptyPlan))
    // Refuerzos keeps its «!» until the first army is added.
    notifications[p.mode] = { message: 'Tu turno', count: 1 };
  const actionKinds: { mode: ActionMode; label: string; icon: IconName }[] = [
    {
      mode: 'placement',
      label: 'Refuerzos / Distribución',
      icon: 'reinforcement',
    },
    { mode: 'attack', label: 'Ataque', icon: 'sword' },
    { mode: 'regroup', label: 'Traslado / Reagrupamiento', icon: 'movement' },
  ];
  const panels: GamePanel[] = [
    {
      id: 'objective',
      label: 'Objetivo',
      content: <ReconquistaObjective view={view} />,
    },
    {
      id: 'cards',
      label: `Cartas · ${view.self?.campaign?.hand.length ?? 0}`,
      content: (
        <div className="reconquista-cards-panel">
          <ReconquistaCards
            view={view}
            board={board}
            newCardIds={newCardIds}
            busy={game.busy}
            send={game.send}
          />
        </div>
      ),
    },
    {
      id: 'pacts',
      label: 'Pactos',
      content: (
        <ReconquistaPacts
          view={view}
          board={board}
          busy={game.busy}
          send={game.send}
          selected={selected}
          target={target}
        />
      ),
    },
    {
      id: 'actions',
      label: p.title,
      navigation: false,
      icon: modeIcon[p.mode] ?? 'plus',
      content: (
        // Same wrappers as Classic so its menu layout rules apply unchanged.
        <div className="contextual-panel-host">
          <section
            className="panel phase-panel action-dock"
            id="contextual-actions"
            aria-label="Acciones contextuales"
          >
            <div className="gameplay-actions">
              <ReconquistaActions
                key={turnKey}
                view={menuView!}
                board={board}
                presentation={p}
                selected={selected}
                target={target}
                weapon={weapon}
                onWeapon={(w) => {
                  setWeapon(w);
                  setTarget('');
                }}
                onSelected={setSelected}
                onTarget={setTarget}
                busy={game.busy}
                send={game.send}
                sendSteps={game.sendSteps}
                onOpenPanel={setPanel}
                plan={plan}
                onPlan={setPlan}
                onPreview={setMovePreview}
                rolling={rolling}
              />
            </div>
          </section>
        </div>
      ),
    },
    // Off turn the play buttons are hidden until it is this player's turn.
    ...(p.mine || p.mode === 'finished' ? actionKinds : []).map(
      ({ mode, label, icon }): GamePanel => {
        const current =
          p.mode === mode ||
          (mode === 'placement' &&
            ['reveal', 'zone', 'finished'].includes(p.mode)) ||
          (mode === 'regroup' && ['transfer', 'occupation'].includes(p.mode));
        return {
          id: mode,
          targetId: 'actions',
          label: current ? p.title : label,
          icon: current ? (modeIcon[p.mode] ?? icon) : icon,
          disabled: !(current && (p.mine || p.mode === 'finished')),
          disabledReason: 'Disponible en la fase correspondiente de tu turno',
          content: null,
        };
      },
    ),
  ];
  // End-turn flag after the panel buttons: usable at any moment of one's own
  // hostility turn; incorporation must be completed first.
  const firstTurnOwner =
    view.stage === 'first-hostility' && !view.campaign && me === view.circle[0];
  const myTurn = view.campaign
    ? view.campaign.actorId === me && view.campaign.phase !== 'finished'
    : firstTurnOwner;
  const canEndTurn = view.campaign
    ? !!view.self?.campaign?.legal.canEndTurn
    : firstTurnOwner;
  const endTurn = () => {
    const steps: ((
      current: ReconquistaView,
    ) => ReconquistaAction | undefined)[] = [];
    if (!view.campaign) {
      // A pending first-hostility transfer moves one army, as when no amount is chosen.
      if (view.self?.legal.transfer)
        steps.push(() => ({ kind: 'transfer', armies: 1 }));
      steps.push(() => ({ kind: 'start-campaign' }));
    }
    steps.push((current) => {
      const legal = current.self?.campaign?.legal;
      if (
        !legal?.canEndTurn ||
        (legal.endTurnMayForfeit &&
          !window.confirm(
            'Todavía podés pedir cartas o premios. ¿Terminar el turno igual?',
          ))
      )
        return undefined;
      return {
        kind: 'campaign',
        action: { kind: 'end-turn', confirmForfeit: true },
      };
    });
    void game.sendSteps(steps);
  };
  const endTurnButton = myTurn ? (
    <button
      type="button"
      className="end-turn-tab"
      title={
        canEndTurn
          ? 'Terminar turno'
          : 'Colocá todos tus ejércitos para terminar el turno'
      }
      aria-label="Terminar turno"
      disabled={game.busy || !canEndTurn}
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
  const inspectedPlayer = inspected ? player(inspected) : undefined;
  const publicCards = (id: string) =>
    view.campaign?.players.find((x) => x.playerId === id);
  return (
    <main className="game-shell playing-shell reconquista-shell">
      <header
        className={`topbar${toolbarCollapsed ? ' toolbar-collapsed' : ''}`}
        id="game-toolbar"
      >
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
          onClick={() => setToolbarCollapsed(!toolbarCollapsed)}
        >
          <UiIcon name={toolbarCollapsed ? 'expand' : 'collapse'} />
        </button>
        <a
          className="brand"
          href="/admin"
          title={`${GAME_SHORT_NAME} ${RECONQUISTA_NAME}`}
        >
          <span>{GAME_SHORT_NAME}</span>
          <small className="mode-label">{RECONQUISTA_NAME}</small>
        </a>
        <p className={`connection ${game.connection}`} aria-live="polite">
          {connectionLabels[game.connection]}
        </p>
        <div className="seat-exit-bar">
          {/* A button like Classic's, so it keeps Classic's size. */}
          <button
            type="button"
            className="secondary seat-exit-button"
            aria-label="Salir de la partida"
            title="Salir de la partida"
            onClick={() => window.location.assign('/admin')}
          >
            <UiIcon name="leave" />
          </button>
          <ThemeToggle />
        </div>
      </header>
      <TurnSound actorId={p.actorId} selfId={me} />
      <MusicToggle
        mode="reconquista"
        moment={
          view.campaign?.phase === 'finished'
            ? 'final'
            : view.stage === 'first-hostility' ||
                ['attack', 'regroup', 'ally-regroup', 'zone-decision'].includes(
                  view.campaign?.phase ?? '',
                )
              ? 'intense'
              : 'calm'
        }
      />
      <nav className="player-roster" aria-label="Jugadores y turno">
        <span
          className="roster-brand"
          title={`${GAME_SHORT_NAME} ${RECONQUISTA_NAME}`}
          aria-label={`${GAME_SHORT_NAME} ${RECONQUISTA_NAME}`}
        >
          <ModeLogo mode="reconquista" />
        </span>
        <div
          className="roster-seats"
          aria-label="Jugadores; desplazá para ver más"
        >
          {(view.campaign?.order ?? view.circle).map((id) => {
            const x = player(id);
            if (!x) return null;
            const eliminated = !!view.campaign?.eliminations[id];
            return (
              <button
                key={id}
                type="button"
                className={`roster-player color-${x.color}${eliminated ? ' is-eliminated' : ''}${id === me ? ' is-self' : ''}`}
                aria-current={id === p.actorId ? 'true' : undefined}
                aria-expanded={inspected === id}
                aria-label={`Ver información de ${x.nickname}${id === p.actorId ? ', turno actual' : ''}`}
                title={x.nickname}
                onClick={() => {
                  setInspected(inspected === id ? null : id);
                  setSituationOpen(false);
                }}
              >
                <span className="roster-name">{x.nickname}</span>
                <span className="turn-alert" aria-hidden="true">
                  !
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      {inspectedPlayer && (
        <section
          className="player-popover"
          aria-label={`Información de ${inspectedPlayer.nickname}`}
        >
          <header>
            <strong>
              {inspectedPlayer.nickname}
              {inspectedPlayer.id === me ? ' · vos' : ''}
            </strong>
            <button
              type="button"
              aria-label="Cerrar información del jugador"
              onClick={() => setInspected(null)}
            >
              <UiIcon name="close" />
            </button>
          </header>
          <p className="player-stat">
            <strong>{countryCount(inspectedPlayer.id)}</strong> países
          </p>
          {publicCards(inspectedPlayer.id) && (
            <p>
              <UiIcon name="cards" />{' '}
              {publicCards(inspectedPlayer.id)!.cardCount} cartas ·{' '}
              {publicCards(inspectedPlayer.id)!.exchanges} canjes
            </p>
          )}
          <small>
            {view.campaign?.eliminations[inspectedPlayer.id]
              ? 'Eliminado'
              : inspectedPlayer.id === p.actorId
                ? 'Jugando ahora'
                : 'En partida'}
          </small>
        </section>
      )}
      {situationOpen && !inspectedPlayer && (
        <SituationCardPopover
          view={view}
          onClose={() => setSituationOpen(false)}
        />
      )}
      <div className="gameplay-stage">
        <div className="board-layout">
          <div className="board-main">
            <ReconquistaMap
              board={board}
              view={view}
              {...(selected || target || !sharedFocus
                ? { selected, target, markerId: me ?? '' }
                : {
                    selected: sharedFocus.originId ?? '',
                    target: sharedFocus.targetId ?? '',
                    markerId: sharedFocus.playerId,
                  })}
              {...(conquest ? { conquest } : {})}
              onClear={() => {
                setSelected('');
                setTarget('');
              }}
              legalIds={choices.legal}
              missileIds={choices.missiles}
              preview={mapPreview}
              onCountry={game.busy ? undefined : onCountry}
            />
            <div
              id="game-actions"
              className={`action-cluster${mobileActionsOpen ? ' mobile-actions-open' : ''}`}
            >
              {game.error && (
                <p className="error-banner global-error" role="alert">
                  {game.error}
                </p>
              )}
              <section className="floating-dice" aria-label="Última tirada">
                <button
                  className="dice-toggle"
                  type="button"
                  aria-expanded={diceOpen}
                  aria-controls="floating-dice-content"
                  onClick={() => setDiceOpen(!diceOpen)}
                >
                  <UiIcon name="dice" /> Dados
                  <span aria-hidden="true">{diceOpen ? '⌃' : '⌄'}</span>
                </button>
                <div id="floating-dice-content" hidden={!diceOpen}>
                  <CombatDice
                    result={
                      combat
                        ? {
                            attackerDice: combat.attackRolls,
                            defenderDice: combat.defenseRolls,
                            conquered: !!(
                              view.campaign?.occupation ??
                              view.hostility?.pendingConquest
                            ),
                          }
                        : undefined
                    }
                    resultKey={
                      combat ? `${rollCount}:${JSON.stringify(combat)}` : ''
                    }
                  />
                  {missile && (
                    <section className="panel combat-result">
                      <div className="panel-heading-row">
                        <div>
                          <p className="eyebrow">Último misil</p>
                          <h2>
                            {name(missile.originId)} → {name(missile.targetId)}
                          </h2>
                        </div>
                        <span className="result-badge">
                          {missile.damage} baja{missile.damage === 1 ? '' : 's'}
                        </span>
                      </div>
                    </section>
                  )}
                </div>
              </section>
              <button
                type="button"
                className="mobile-action-toggle"
                aria-expanded={mobileActionsOpen}
                aria-controls="contextual-actions"
                onClick={() => {
                  setPanel(mobileActionsOpen ? null : 'actions');
                  setMobileActionsOpen(!mobileActionsOpen);
                }}
              >
                <span className="compact-action-copy">
                  <strong>{p.title}</strong>
                  <small>{p.mine ? '' : p.phase}</small>
                </span>
                {p.mine && (
                  <span className="panel-notification" aria-label="Tu turno">
                    !
                  </span>
                )}
                <UiIcon name={mobileActionsOpen ? 'close' : 'plus'} />
              </button>
              <div className="phase-row">
                <div
                  className="right-turn-summary"
                  role="status"
                  title={`${p.title} · ${p.phase}`}
                >
                  <strong>
                    {p.mine
                      ? 'Tu turno'
                      : p.actorId
                        ? `Turno de ${player(p.actorId)?.nickname ?? ''}`
                        : p.phase}
                  </strong>
                  <span>
                    {p.round !== undefined && (
                      <>
                        <strong>Ronda {p.round}</strong> ·{' '}
                      </>
                    )}
                    {p.phase}
                  </span>
                  <SituationIndicator
                    view={view}
                    open={situationOpen}
                    onOpen={(open) => {
                      setSituationOpen(open);
                      if (open) setInspected(null);
                    }}
                  />
                  <ReconquistaClock view={view} />
                </div>
              </div>
            </div>
          </div>
          <GamePanels
            panels={panels}
            selected={panel}
            onSelect={setPanel}
            notifications={notifications}
            trailing={endTurnButton}
          />
        </div>
      </div>
    </main>
  );
}

/** Entry and waiting room with Classic's markup; the host manages the game from /admin. */
function ReconquistaLobby({
  gameId,
  game,
}: {
  readonly gameId: string;
  readonly game: ReturnType<typeof useReconquistaGame>;
}) {
  const { entry, view } = game;
  const [nickname, setNickname] = useState('');
  const [color, setColor] = useState('');
  if (!entry) return null;
  const free = Object.keys(playerColorNames).filter(
    (c) => !entry.players.some((p) => p.color === c),
  );
  const chosenColor = free.includes(color) ? color : (free[0] ?? '');
  // Another player took the chosen color first: say which one replaces it.
  const colorTaken = !!color && !free.includes(color) && !!chosenColor;
  const self = view?.self
    ? entry.players.find((p) => p.id === view.self!.playerId)
    : undefined;
  const full = entry.players.length === entry.playerCount;
  const started = entry.stage === 'started';
  if (!self)
    return (
      <main className="entry-layout">
        <section className="panel entry-panel">
          <a className="text-link" href="/">
            ← Inicio
          </a>
          <p className="eyebrow">Partida {gameId.slice(0, 8)}</p>
          <h1>Entrar a la mesa</h1>
          {!full && !started ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void game.run(async () => {
                  try {
                    await reconquistaRequest('/games/' + gameId + '/join', {
                      nickname,
                      color: chosenColor,
                    });
                  } finally {
                    // Also after COLOR_IN_USE: the list shows the color that replaces it.
                    if (!color) setColor(chosenColor);
                    await game.refresh();
                  }
                });
              }}
            >
              <label>
                Apodo
                <input
                  required
                  maxLength={32}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </label>
              <label>
                Color
                <select
                  value={chosenColor}
                  onChange={(e) => setColor(e.target.value)}
                >
                  {free.map((c) => (
                    <option key={c} value={c}>
                      {playerColorNames[c]}
                    </option>
                  ))}
                </select>
              </label>
              {colorTaken && (
                <p className="muted-copy" role="status">
                  El {playerColorNames[color]} ya estaba en uso. Se te asignó el{' '}
                  {playerColorNames[chosenColor]}.
                </p>
              )}
              <button disabled={game.busy || !chosenColor} type="submit">
                {game.busy ? 'Conectando…' : 'Unirme'}
              </button>
            </form>
          ) : (
            <p>No hay asientos disponibles.</p>
          )}
          <p>
            Cerrar el navegador o desconectarte no libera tu asiento. Usá el
            mismo navegador para volver.
          </p>
          {game.error && (
            <p className="error-banner" role="alert">
              {game.error}
            </p>
          )}
        </section>
      </main>
    );
  return (
    <main className="game-shell lobby-shell reconquista-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          title={`${GAME_SHORT_NAME} ${RECONQUISTA_NAME}`}
        >
          <span>{GAME_SHORT_NAME}</span>
          <small className="mode-label">{RECONQUISTA_NAME}</small>
        </a>
        <div>
          <strong>{self.nickname}</strong>
          <span>{playerColorNames[self.color]}</span>
        </div>
        <p className={`connection ${game.connection}`} aria-live="polite">
          {connectionLabels[game.connection]}
        </p>
        <div className="seat-exit-bar">
          <ThemeToggle />
        </div>
      </header>
      {game.error && (
        <p className="error-banner global-error" role="alert">
          {game.error}
        </p>
      )}
      <div className="lobby-layout">
        <section className="panel lobby-main">
          <p className="eyebrow">Sala de espera</p>
          <h1>
            {entry.players.length} de {entry.playerCount} jugadores
          </h1>
          <ul className="player-list">
            {entry.players.map((x, index) => (
              <li key={x.id} className={x.id === self.id ? 'self-player' : ''}>
                <span
                  className={`color-dot color-${x.color}`}
                  aria-hidden="true"
                />
                <span>
                  <strong>
                    {x.nickname}
                    {x.id === self.id ? ' (vos)' : ''}
                  </strong>
                  <small>Asiento {index + 1}</small>
                  <small>{playerColorNames[x.color]}</small>
                </span>
                <span className={x.ready ? 'ready' : 'waiting'}>
                  {x.ready ? 'Listo' : 'Esperando'}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <aside className="panel lobby-actions">
          <h2>Tu estado</h2>
          <p>
            El anfitrión inicia la partida cuando estén todos los asientos
            ocupados y listos.
          </p>
          <button
            type="button"
            disabled={game.busy || self.ready}
            onClick={() =>
              void game.run(async () => {
                await reconquistaRequest('/games/' + gameId + '/ready', {});
                await game.refresh();
              })
            }
          >
            {self.ready ? 'Listo' : 'Estoy listo'}
          </button>
        </aside>
      </div>
    </main>
  );
}
