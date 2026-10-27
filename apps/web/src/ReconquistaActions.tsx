import { useEffect, useState } from 'react';
import type {
  CampaignAction,
  ReconquistaAction,
  ReconquistaBoard,
  ReconquistaView,
} from '@game/protocol/reconquista';
import { ActionRoute } from './ActionRoute.js';
import { ActionTitle, Amount } from './GameplayControls.js';
import { UiIcon } from './UiIcon.js';
import { continentNames, playerColorNames } from './reconquista-labels.js';
import type { Presentation } from './reconquista-client.js';

export type Weapon = 'dice' | 'missile';

interface ActionProps {
  readonly view: ReconquistaView;
  readonly board: ReconquistaBoard;
  readonly presentation: Presentation;
  readonly selected: string;
  readonly target: string;
  readonly weapon: Weapon;
  readonly onWeapon: (weapon: Weapon) => void;
  readonly onSelected: (id: string) => void;
  readonly onTarget: (id: string) => void;
  readonly busy: boolean;
  readonly send: (action: ReconquistaAction) => Promise<boolean>;
  /** Several commands in a row, each built from the state the previous one left. */
  readonly sendSteps?: (
    steps: readonly ((
      current: ReconquistaView,
    ) => ReconquistaAction | undefined)[],
  ) => Promise<boolean>;
  readonly onOpenPanel: (id: string) => void;
  readonly onPreview?: (preview: MapPreview) => void;
  /** While the dice roll, the next attack waits. */
  readonly rolling?: boolean | undefined;
}

/** Changes to the viewer's forces shown on the map while an amount is chosen. */
export type MapPreview = Readonly<
  Record<string, { readonly armies: number; readonly missiles: number }>
>;

/** Shows a move of armies and missiles on the map until the menu changes. */
function useMovePreview(
  onPreview: ActionProps['onPreview'],
  originId: string | undefined,
  targetId: string | undefined,
  armies: number,
  missiles: number,
) {
  useEffect(() => {
    if (!onPreview) return;
    onPreview(
      originId && targetId && armies + missiles > 0
        ? {
            [originId]: { armies: -armies, missiles: -missiles },
            [targetId]: { armies, missiles },
          }
        : {},
    );
    return () => onPreview({});
  }, [onPreview, originId, targetId, armies, missiles]);
}

const MISSILE_COST = 6;

function sum(values: Readonly<Record<string, number>>) {
  return Object.values(values).reduce((total, n) => total + n, 0);
}

function withAmount(
  values: Readonly<Record<string, number>>,
  id: string,
  amount: number,
) {
  const next = { ...values };
  if (amount <= 0) delete next[id];
  else next[id] = amount;
  return next;
}

const unique = (values: readonly string[]) => [...new Set(values)];

/**
 * Reinforcements kept by the screen: general armies first, then each
 * continent's own armies, and 6→1 missile conversions.
 */
export interface PlacementPlan {
  readonly placements: Readonly<Record<string, number>>;
  readonly continentPlacements: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly conversions: Readonly<Record<string, number>>;
  /** The pool the player went back to; otherwise the first one not placed. */
  readonly pool?: string | undefined;
}

export const emptyPlan: PlacementPlan = {
  placements: {},
  continentPlacements: {},
  conversions: {},
};

const GENERAL = 'general';

/** Armies planned for one country, from every pool. */
export function plannedArmies(plan: PlacementPlan, id: string) {
  return (
    (plan.placements[id] ?? 0) +
    Object.values(plan.continentPlacements).reduce(
      (total, placements) => total + (placements[id] ?? 0),
      0,
    )
  );
}

/** Pools in order (general first, continents last) and what each has left. */
function placementPools(view: ReconquistaView, plan: PlacementPlan) {
  const legal = view.self?.campaign?.legal;
  const general = view.campaign
    ? (legal?.freeBudget ?? 0)
    : (view.self?.legal?.budget ?? 0);
  const budgets = view.campaign ? (legal?.continentBudgets ?? {}) : {};
  const pools = [
    { id: GENERAL, left: general - sum(plan.placements) },
    ...Object.entries(budgets).map(([id, budget]) => ({
      id,
      left: budget - sum(plan.continentPlacements[id] ?? {}),
    })),
  ];
  const current =
    pools.find((p) => p.id === plan.pool) ??
    pools.find((p) => p.left > 0) ??
    pools[0]!;
  return { pools, current };
}

/** Countries where the current pool can go: a continent's only in that continent. */
export function placementTargets(
  view: ReconquistaView,
  board: ReconquistaBoard,
  plan: PlacementPlan,
) {
  const countries = view.campaign
    ? (view.self?.campaign?.legal.placementCountryIds ?? [])
    : (view.self?.legal?.placementCountryIds ?? []);
  const { current } = placementPools(view, plan);
  if (current.id === GENERAL) return countries;
  return countries.filter(
    (id) =>
      board.countries.find((c) => c.id === id)?.continentId === current.id,
  );
}

/**
 * Classic-style icon switch: the menu's counter or attack button changes to
 * missiles while pressed. The explanation lives in the tooltip only.
 */
function MissileToggle({
  pressed,
  onToggle,
  title,
  disabled,
  count = 0,
  shortcut,
}: {
  /** M toggles the attack's missile. */
  readonly shortcut?: 'missile';
  readonly pressed: boolean;
  readonly onToggle: () => void;
  readonly title: string;
  readonly disabled: boolean;
  readonly count?: number;
}) {
  return (
    <button
      type="button"
      // Pressed looks like Classic's primary button, released like its secondary one.
      className={pressed ? 'missile-toggle' : 'secondary missile-toggle'}
      aria-pressed={pressed}
      data-shortcut={shortcut}
      aria-label={count ? `${title}: ${count}` : title}
      title={title}
      disabled={disabled}
      onClick={onToggle}
    >
      <UiIcon name="missile" />
      {count > 0 && <span className="missile-toggle-count">{count}</span>}
    </button>
  );
}

/** Countries the map highlights for the current action. */
export function legalMapChoices(
  view: ReconquistaView,
  presentation: Presentation,
  selected: string,
  weapon: Weapon,
  /** Refuerzos: only the countries the current pool can reach. */
  placementIds?: readonly string[],
): {
  legal: string[];
  missiles: string[];
  origins: string[];
  targets: string[];
} {
  const prep = view.self?.legal;
  const legal = view.self?.campaign?.legal;
  switch (presentation.mode) {
    case 'placement':
      return {
        legal: [
          ...(placementIds ??
            (view.campaign
              ? (legal?.placementCountryIds ?? [])
              : (prep?.placementCountryIds ?? []))),
        ],
        missiles: [],
        origins: [],
        targets: [],
      };
    case 'attack': {
      const attacks = view.campaign
        ? (legal?.attacks ?? [])
        : (prep?.attacks ?? []);
      // Missiles start with full turns: first hostility is dice only.
      const shots = view.campaign ? (legal?.missileShots ?? []) : [];
      const missile = !!view.campaign && weapon === 'missile';
      const routes = missile ? shots : attacks;
      const origins = unique(routes.map((r) => r.originId));
      const targets = unique(
        routes.filter((r) => r.originId === selected).map((r) => r.targetId),
      );
      return {
        legal: unique([...origins, ...targets]),
        missiles: missile ? targets : [],
        origins,
        targets,
      };
    }
    case 'regroup': {
      const routes = view.campaign
        ? (legal?.regroups ?? [])
        : (prep?.regroups ?? []);
      const origins = unique(routes.map((r) => r.originId));
      const targets = routes
        .filter((r) => r.originId === selected)
        .map((r) => r.targetId);
      return {
        legal: unique([...origins, ...targets]),
        missiles: [],
        origins,
        targets,
      };
    }
    default:
      return { legal: [], missiles: [], origins: [], targets: [] };
  }
}

export function ReconquistaActions(
  props: ActionProps & {
    readonly plan: PlacementPlan;
    readonly onPlan: (plan: PlacementPlan) => void;
  },
) {
  const { view, presentation } = props;
  const player = (id: string) =>
    view.players.find((p) => p.id === id)?.nickname ?? id;
  const me = view.self?.playerId;
  const canStartCampaign =
    view.stage === 'first-hostility' && !view.campaign && me === view.circle[0];
  switch (presentation.mode) {
    case 'placement':
      return <Placement {...props} />;
    case 'reveal':
      return (
        <div className="action-card action-layout primary-action-card">
          <button
            type="button"
            className="completion-action"
            title="Revelar la carta de situación"
            disabled={props.busy}
            onClick={() => void props.send({ kind: 'reveal' })}
          >
            <UiIcon name="situation" /> Revelar
          </button>
        </div>
      );
    case 'attack':
      return <Attack {...props} />;
    case 'transfer':
      return <Transfer {...props} />;
    case 'occupation':
      return <Occupation {...props} />;
    case 'regroup':
      return (
        <Regroup
          {...props}
          onFinishFirstHostility={
            canStartCampaign
              ? () => {
                  // Finishing the regroup closes the attacks too: full turns
                  // open in the closing step, never back in Ataque (user
                  // report 2026-10-22).
                  const steps: ((
                    current: ReconquistaView,
                  ) => ReconquistaAction | undefined)[] = [];
                  if (view.hostility?.phase === 'attack')
                    steps.push(() => ({ kind: 'finish-attacks' }));
                  steps.push(() => ({ kind: 'start-campaign' }));
                  steps.push((current) =>
                    current.self?.campaign?.legal.canFinishRegroup
                      ? {
                          kind: 'campaign',
                          action: { kind: 'finish-regroup' },
                        }
                      : undefined,
                  );
                  void props.sendSteps?.(steps);
                }
              : undefined
          }
        />
      );
    case 'closing':
      // Card requests live in the Cards panel; the turn ends with the bar's flag.
      return null;
    case 'zone':
      return <Zone {...props} />;
    case 'finished':
      return <Finished view={view} />;
    default:
      return (
        <>
          <p className="turn-notice">
            {presentation.actorId ? (
              <>
                Observando el turno de{' '}
                <strong>{player(presentation.actorId)}</strong>.
              </>
            ) : (
              presentation.phase
            )}
          </p>
        </>
      );
  }
}

function Placement({
  view,
  board,
  selected,
  onSelected,
  busy,
  send,
  plan,
  onPlan,
}: ActionProps & {
  readonly plan: PlacementPlan;
  readonly onPlan: (plan: PlacementPlan) => void;
}) {
  const me = view.self!.playerId;
  const { pools, current } = placementPools(view, plan);
  const countries = placementTargets(view, board, plan);
  const general = current.id === GENERAL;
  const poolName = (id: string) =>
    id === GENERAL ? 'Generales' : (continentNames[id] ?? id);
  const name = (id: string) =>
    board.countries.find((c) => c.id === id)?.name ?? id;
  const existing = (id: string) =>
    view.territories
      .find((t) => t.id === id)
      ?.forces.find((f) => f.playerId === me)?.armies ?? 0;
  const pending = pools.reduce((total, p) => total + p.left, 0);
  const canPlaceHere = countries.includes(selected);
  const poolPlacements = general
    ? plan.placements
    : (plan.continentPlacements[current.id] ?? {});
  const placed = poolPlacements[selected] ?? 0;
  const maximum = Math.max(0, placed + current.left);
  const conversions = plan.conversions[selected] ?? 0;
  const maxConversions = (id: string, next: PlacementPlan) =>
    Math.max(
      0,
      Math.floor((existing(id) + plannedArmies(next, id) - 1) / MISSILE_COST),
    );
  // Missiles start with full turns.
  const missileReady =
    !!view.campaign &&
    !!view.self?.campaign?.legal.placementCountryIds.includes(selected);
  const update = (next: PlacementPlan) => {
    // Fewer armies can leave a conversion without its 6; drop the extra ones.
    const conversions = Object.fromEntries(
      Object.entries(next.conversions)
        .map(([id, n]) => [id, Math.min(n, maxConversions(id, next))] as const)
        .filter(([, n]) => n > 0),
    );
    onPlan({ ...next, conversions });
  };
  const allPlaced = pools.every((p) => p.left === 0);
  return (
    <div className="action-card action-layout primary-action-card reinforcement-card">
      {/* Like Classic's reinforcement card; the initial incorporation has no inner title. */}
      {view.campaign && <ActionTitle title="Refuerzos" />}
      <ActionRoute
        reserve={pending}
        target={canPlaceHere ? selected : undefined}
        targets={countries}
        onTarget={(id) => onSelected(id ?? '')}
        labelOf={name}
        disabled={busy}
      />
      {canPlaceHere && maximum > 0 && (
        <Amount
          value={placed}
          minimum={0}
          maximum={maximum}
          onChange={(value) => {
            const amounts = withAmount(poolPlacements, selected, value);
            const next = general
              ? { ...plan, placements: amounts }
              : {
                  ...plan,
                  continentPlacements: {
                    ...plan.continentPlacements,
                    [current.id]: amounts,
                  },
                };
            // Once the pool is placed, the next one comes up by itself.
            const left = current.left - value + placed;
            update(left > 0 ? next : { ...next, pool: undefined });
          }}
          disabled={busy}
        />
      )}
      {missileReady && (
        <div
          className="missile-plan"
          role="group"
          aria-label={`Misiles en ${name(selected)}`}
        >
          {conversions > 0 && (
            <>
              <button
                type="button"
                className="secondary compact-button"
                aria-label="Deshacer un misil"
                title="Deshacer un misil"
                disabled={busy}
                onClick={() =>
                  update({
                    ...plan,
                    conversions: withAmount(
                      plan.conversions,
                      selected,
                      conversions - 1,
                    ),
                  })
                }
              >
                −
              </button>
              <span className="missile-plan-count">
                <UiIcon name="missile" /> {conversions}
              </span>
            </>
          )}
          <button
            type="button"
            className="secondary add-missile"
            data-shortcut="missile"
            title={
              maxConversions(selected, plan) > conversions
                ? 'Convertir 6 ejércitos en 1 misil (M)'
                : 'Convertir 6 ejércitos en 1 misil: tiene que quedar al menos 1 ejército en el país'
            }
            disabled={busy || maxConversions(selected, plan) <= conversions}
            onClick={() =>
              update({
                ...plan,
                conversions: withAmount(
                  plan.conversions,
                  selected,
                  conversions + 1,
                ),
              })
            }
            aria-label="Agregar 1 misil"
          >
            +1 <UiIcon name="missile" />
          </button>
        </div>
      )}
      {pools.length > 1 && (
        <div className="action-footer">
          <ul className="reinforcement-pools">
            {pools.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="pool-step"
                  aria-pressed={p.id === current.id}
                  disabled={busy}
                  onClick={() => update({ ...plan, pool: p.id })}
                >
                  {poolName(p.id)}: {p.left}
                  {p.id === current.id &&
                    p.id !== GENERAL &&
                    `, solo en ${poolName(p.id)}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="icon-button confirm-placement"
        aria-label="Confirmar colocación"
        title="Confirmar colocación (Enter)"
        data-shortcut="confirm"
        disabled={busy || !allPlaced}
        onClick={() => {
          const action: ReconquistaAction = view.campaign
            ? {
                kind: 'campaign',
                action: {
                  kind: 'reinforce',
                  placements: plan.placements,
                  conversions: plan.conversions,
                  continentPlacements: plan.continentPlacements,
                },
              }
            : {
                kind: view.stage === 'extra-placement' ? 'extra' : 'place',
                placements: plan.placements,
                conversions: {},
              };
          void send(action).then((ok) => {
            if (ok) onPlan(emptyPlan);
          });
        }}
      >
        <UiIcon name="check" />
      </button>
    </div>
  );
}

function Attack({
  view,
  board,
  selected,
  target,
  weapon: chosenWeapon,
  onWeapon,
  onSelected,
  onTarget,
  busy,
  send,
  rolling = false,
}: ActionProps) {
  const me = view.self!.playerId;
  const campaign = !!view.campaign;
  const legal = view.self?.campaign?.legal;
  const hasMissiles = view.territories.some((t) =>
    t.forces.some((f) => f.playerId === me && f.missiles > 0),
  );
  const prep = view.self!.legal;
  const attacks = campaign ? (legal?.attacks ?? []) : prep.attacks;
  const shots = campaign ? (legal?.missileShots ?? []) : [];
  // Missiles start with full turns: first hostility is dice only.
  const missile = campaign && chosenWeapon === 'missile';
  const name = (id: string) =>
    board.countries.find((c) => c.id === id)?.name ?? id;
  const player = (id: string) =>
    view.players.find((p) => p.id === id)?.nickname ?? id;
  const [defender, setDefender] = useState('');
  const routes = missile ? shots : attacks;
  const sources = unique(routes.map((r) => r.originId));
  const targets = unique(
    routes.filter((r) => r.originId === selected).map((r) => r.targetId),
  );
  const opponents =
    view.territories
      .find((t) => t.id === target)
      ?.forces.filter((f) => f.playerId !== me) ?? [];
  const chosenDefender = opponents.some((f) => f.playerId === defender)
    ? defender
    : (opponents[0]?.playerId ?? '');
  const matches = (r: { originId: string; targetId: string }) =>
    r.originId === selected && r.targetId === target;
  const forDefender = (r: object) =>
    !('defenderId' in r) || r.defenderId === chosenDefender;
  const attack = attacks.find((r) => matches(r) && forDefender(r));
  const shot = shots.find((r) => matches(r) && forDefender(r));
  const act = (action: CampaignAction | ReconquistaAction) =>
    void send(
      'kind' in action &&
        ['attack-country', 'fire', 'finish-attacks'].includes(action.kind)
        ? { kind: 'campaign', action: action as CampaignAction }
        : (action as ReconquistaAction),
    );
  const ready = missile ? !!shot : !!attack;
  return (
    <div
      className={`action-card action-layout primary-action-card attack-card${campaign ? ' with-missile' : ''}`}
    >
      {missile && <ActionTitle title="Ataque con misil" />}
      {routes.length === 0 && (
        <p className="muted-copy">
          {missile
            ? 'No hay disparos disponibles.'
            : 'No hay ataques disponibles.'}
        </p>
      )}
      <ActionRoute
        source={sources.includes(selected) ? selected : undefined}
        target={targets.includes(target) ? target : undefined}
        sources={sources}
        targets={targets}
        routes={routes.map((r) => [r.originId, r.targetId] as const)}
        onSource={(id) => {
          onSelected(id ?? '');
          onTarget('');
        }}
        onTarget={(id) => onTarget(id ?? '')}
        labelOf={name}
        disabled={busy}
      />
      {campaign && opponents.length > 1 && (
        <label className="defender-choice">
          <small>Defensor</small>
          <select
            value={chosenDefender}
            disabled={busy}
            onChange={(e) => setDefender(e.target.value)}
          >
            {opponents.map((f) => (
              <option key={f.playerId} value={f.playerId}>
                {player(f.playerId)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="icon-button attack-button"
        disabled={!ready || busy || rolling}
        aria-label={missile ? 'Disparar misil' : 'Atacar'}
        title={
          missile && shot
            ? `Misil · distancia ${shot.distance} · −${shot.damage} ejército${shot.damage > 1 ? 's' : ''}`
            : 'Atacar (Enter)'
        }
        data-shortcut="confirm"
        onClick={() => {
          if (missile)
            act({
              kind: 'fire',
              originId: selected,
              targetId: target,
              defenderId: chosenDefender,
            });
          else
            act(
              campaign
                ? {
                    kind: 'attack-country',
                    originId: selected,
                    targetId: target,
                    defenderId: chosenDefender,
                  }
                : { kind: 'attack', originId: selected, targetId: target },
            );
        }}
      >
        {/* A missile attack fires with the mushroom cloud. */}
        <UiIcon name={missile ? 'nuke' : 'sword'} />
      </button>
      {/* Hidden until the player has a missile somewhere. */}
      {campaign && (hasMissiles || missile) && (
        <MissileToggle
          pressed={missile}
          shortcut="missile"
          title={
            shots.length
              ? 'Atacar con misil (M)'
              : 'Ningún país tuyo puede disparar un misil ahora'
          }
          disabled={busy || (!shots.length && !missile)}
          onToggle={() => onWeapon(missile ? 'dice' : 'missile')}
        />
      )}
      {(legal?.canFinishAttacks ||
        (!campaign && view.hostility?.phase === 'attack')) && (
        <button
          type="button"
          className="secondary end-attack"
          title="Terminar ataques"
          aria-label="Terminar ataques"
          disabled={busy || rolling || !!view.hostility?.pendingConquest}
          onClick={() =>
            campaign
              ? act({ kind: 'finish-attacks' })
              : void send({ kind: 'finish-attacks' })
          }
        >
          <UiIcon name="finish" />
        </button>
      )}
    </div>
  );
}

/** Classic's conquest transfer: origin and destination with the armies left on each side. */
function TransferCard({
  view,
  board,
  originId,
  targetId,
  maximum,
  busy,
  onConfirm,
  title,
  children,
  onPreview,
}: {
  readonly onPreview?: ActionProps['onPreview'];
  readonly view: ReconquistaView;
  readonly board: ReconquistaBoard;
  readonly originId: string;
  readonly targetId: string;
  readonly maximum: number;
  readonly busy: boolean;
  readonly onConfirm: (armies: number) => void;
  readonly title: string;
  readonly children?: React.ReactNode;
}) {
  const me = view.self?.playerId;
  const [armies, setArmies] = useState(1);
  const name = (id: string) =>
    board.countries.find((c) => c.id === id)?.name ?? id;
  const armiesOn = (id: string) =>
    view.territories
      .find((t) => t.id === id)
      ?.forces.find((f) => f.playerId === me)?.armies ?? 0;
  const n = Math.max(1, Math.min(armies, maximum));
  useMovePreview(onPreview, originId, targetId, n, 0);
  // Same Traslado menu as regrouping; after a conquest the route is fixed and mandatory.
  return (
    <div className="action-card action-layout primary-action-card regroup-card conquest-move">
      <ActionRoute
        source={originId}
        target={targetId}
        sources={[originId]}
        targets={[targetId]}
        onSource={() => undefined}
        onTarget={() => undefined}
        labelOf={(id) =>
          `${name(id)}: ${armiesOn(id) + (id === originId ? -n : n)}`
        }
        disabled
      />
      <Amount
        value={n}
        minimum={1}
        maximum={maximum}
        onChange={setArmies}
        disabled={busy}
      />
      {children}
      <button
        type="button"
        className="icon-button confirm-transfer"
        aria-label="Confirmar traslado"
        title={`${title} (Enter)`}
        data-shortcut="confirm"
        disabled={busy}
        onClick={() => onConfirm(n)}
      >
        <UiIcon name="check" />
      </button>
    </div>
  );
}

function Transfer({ view, board, busy, send, onPreview }: ActionProps) {
  const transfer = view.self!.legal.transfer!;
  return (
    <TransferCard
      onPreview={onPreview}
      view={view}
      board={board}
      originId={transfer.originId}
      targetId={transfer.targetId}
      maximum={transfer.maximum}
      busy={busy}
      title="Confirmar traslado"
      onConfirm={(armies) => void send({ kind: 'transfer', armies })}
    />
  );
}

function Occupation({ view, board, busy, send, onPreview }: ActionProps) {
  const occupation = view.self!.campaign!.legal.occupation!;
  const arrival = occupation.arrivals[0]!;
  const act = (action: CampaignAction) =>
    void send({ kind: 'campaign', action });
  return (
    <TransferCard
      onPreview={onPreview}
      view={view}
      board={board}
      originId={arrival.originId}
      targetId={occupation.targetId}
      maximum={arrival.maximum}
      busy={busy}
      title={
        occupation.capturedMissiles > 0
          ? `Confirmar traslado · capturás ${occupation.capturedMissiles} misil${occupation.capturedMissiles > 1 ? 'es' : ''}`
          : 'Confirmar traslado'
      }
      onConfirm={(armies) => act({ kind: 'occupy', armies })}
    >
      {occupation.invasion && !occupation.joint && !occupation.continuing && (
        <button
          type="button"
          className="secondary"
          aria-label="Seguir atacando desde afuera"
          title="Seguir atacando desde afuera"
          disabled={busy}
          onClick={() => act({ kind: 'continue-invasion' })}
        >
          <UiIcon name="sword" />
        </button>
      )}
    </TransferCard>
  );
}

/** One Traslado menu for every regroup: first hostility and full turns. */
function Regroup({
  view,
  board,
  selected,
  target,
  onSelected,
  onTarget,
  busy,
  send,
  onPreview,
  onFinishFirstHostility,
}: ActionProps & {
  readonly onFinishFirstHostility?: (() => void) | undefined;
}) {
  const legal = view.self?.campaign?.legal;
  // First hostility moves armies only: missiles start with full turns.
  const routes: {
    originId: string;
    targetId: string;
    armies: number;
    missiles: number;
  }[] = legal
    ? legal.regroups
    : view.self!.legal.regroups.map((r) => ({
        originId: r.originId,
        targetId: r.targetId,
        armies: r.maximum,
        missiles: 0,
      }));
  const [armies, setArmies] = useState(1);
  const [missiles, setMissiles] = useState(0);
  const [missileMode, setMissileMode] = useState(false);
  const sources = unique(routes.map((r) => r.originId));
  const targets = routes
    .filter((r) => r.originId === selected)
    .map((r) => r.targetId);
  const route = routes.find(
    (r) => r.originId === selected && r.targetId === target,
  );
  const name = (id: string) =>
    board.countries.find((c) => c.id === id)?.name ?? id;
  const act = (action: CampaignAction) =>
    void send({ kind: 'campaign', action });
  const a = Math.min(armies, route?.armies ?? 0),
    m = Math.min(missiles, route?.missiles ?? 0);
  const counting = missileMode && !!route && route.missiles > 0;
  useMovePreview(
    onPreview,
    route ? selected : undefined,
    route ? target : undefined,
    a,
    m,
  );
  const reset = () => {
    setArmies(1);
    setMissiles(0);
    setMissileMode(false);
  };
  return (
    <div
      className={`action-card action-layout primary-action-card regroup-card${route && route.missiles > 0 ? ' with-missile' : ''}`}
    >
      {counting && <ActionTitle title="Traslado de misiles" />}
      {routes.length === 0 && (
        <p className="muted-copy">No hay traslados disponibles.</p>
      )}
      <ActionRoute
        source={sources.includes(selected) ? selected : undefined}
        target={targets.includes(target) ? target : undefined}
        sources={sources}
        targets={targets}
        routes={routes.map((r) => [r.originId, r.targetId] as const)}
        onSource={(id) => {
          onSelected(id ?? '');
          onTarget('');
        }}
        onTarget={(id) => onTarget(id ?? '')}
        labelOf={name}
        disabled={busy}
      />
      {route &&
        (counting ? (
          <Amount
            label="Misiles a trasladar"
            value={m}
            minimum={0}
            maximum={route.missiles}
            onChange={setMissiles}
            disabled={busy}
          />
        ) : (
          route.armies > 0 && (
            <Amount
              value={a}
              minimum={0}
              maximum={route.armies}
              onChange={setArmies}
              disabled={busy}
            />
          )
        ))}
      {route && route.missiles > 0 && (
        <MissileToggle
          pressed={counting}
          count={m}
          title="Trasladar misiles"
          disabled={busy}
          onToggle={() => setMissileMode(!missileMode)}
        />
      )}
      <button
        type="button"
        className="icon-button"
        title="Confirmar traslado (Enter)"
        data-shortcut="confirm"
        aria-label="Confirmar traslado"
        disabled={!route || busy || a + m === 0}
        onClick={() => {
          if (!route) return;
          if (legal)
            act({
              kind: 'regroup-forces',
              originId: selected,
              targetId: target,
              armies: a,
              missiles: m,
            });
          else
            void send({
              kind: 'regroup',
              originId: selected,
              targetId: target,
              armies: a,
            });
          reset();
        }}
      >
        <UiIcon name="check" />
      </button>
      <button
        type="button"
        className="secondary icon-button"
        title="Cancelar selección"
        aria-label="Cancelar selección"
        disabled={busy || (!selected && !target)}
        onClick={() => {
          onSelected('');
          onTarget('');
          reset();
        }}
      >
        <UiIcon name="close" />
      </button>
      {(legal?.canFinishRegroup || onFinishFirstHostility) && (
        <button
          type="button"
          className="secondary finish-regroup"
          title="Terminar reagrupamiento"
          aria-label="Terminar reagrupamiento"
          disabled={busy}
          onClick={() =>
            legal ? act({ kind: 'finish-regroup' }) : onFinishFirstHostility?.()
          }
        >
          <UiIcon name="endRegroup" />
        </button>
      )}
      {legal?.canFinishAllyRegroup && (
        <button
          type="button"
          className="secondary finish-regroup"
          title={
            view.campaign?.phase === 'ally-regroup'
              ? 'Terminar reagrupamiento del socio'
              : 'Terminar participación del socio'
          }
          aria-label={
            view.campaign?.phase === 'ally-regroup'
              ? 'Terminar reagrupamiento del socio'
              : 'Terminar participación del socio'
          }
          disabled={busy}
          onClick={() => act({ kind: 'finish-ally-regroup' })}
        >
          <UiIcon name="endRegroup" />
        </button>
      )}
    </div>
  );
}

function Zone({ view, busy, send }: ActionProps) {
  const decision = view.campaign!.zoneDecisions.find(
    (d) => d.playerId === view.self?.playerId,
  )!;
  const act = (keep: boolean) =>
    void send({
      kind: 'campaign',
      action: { kind: 'decide-zone', pactId: decision.pactId, keep },
    });
  return (
    <div className="action-card action-layout primary-action-card attack-card">
      <button
        type="button"
        title="Se aplicó la penalización. Mantener el pacto de zona."
        disabled={busy}
        onClick={() => act(true)}
      >
        Mantener zona
      </button>
      <button
        type="button"
        className="secondary"
        title="Se aplicó la penalización. Terminar el pacto de zona."
        disabled={busy}
        onClick={() => act(false)}
      >
        Cerrar zona
      </button>
    </div>
  );
}

/** Like Classic's result: who won, their color and the objective card. */
function Finished({ view }: { readonly view: ReconquistaView }) {
  const winners = (view.campaign?.winners ?? []).flatMap(
    (id) => view.players.find((p) => p.id === id) ?? [],
  );
  const objectives = (view.winnerObjectives ?? []).flatMap((w) =>
    w.objectives.map((o) => o.description),
  );
  // Express ends by the clock, with Classic's tiebreak.
  const timeLimit = !!view.campaign?.timeLimit;
  return (
    <section
      className="finished-panel objective-box"
      aria-labelledby="finished-title"
    >
      <div className="finished-summary">
        <p className="eyebrow">
          {winners.length > 1 ? 'Victoria compartida' : 'Partida finalizada'}
        </p>
        <h1 id="finished-title">
          {winners.length === 0
            ? 'Empate'
            : `${winners.length > 1 ? 'Ganaron ' : 'Ganó '}${winners.map((p) => p.nickname).join(' y ')}`}
        </h1>
        {winners.map((p) => (
          <p className="winner-color" key={p.id}>
            <span
              className={`color-dot color-${p.color}`}
              title={playerColorNames[p.color] ?? p.color}
            />
          </p>
        ))}
      </div>
      <p className="winning-objective">
        <span>
          {timeLimit
            ? winners.length
              ? 'Se terminó el tiempo: ganó por desempate (más países, después tropas, canjes y cartas).'
              : 'Se terminó el tiempo con empate en países, tropas, canjes y cartas.'
            : objectives.length
              ? objectives.join(' ')
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
