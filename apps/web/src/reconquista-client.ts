import { useEffect, useRef, useState } from 'react';
import { createCommandId } from './command-id.js';
import { reconquistaCountryName } from './place-names.js';
import {
  RECONQUISTA_PROTOCOL,
  reconquistaBoardSchema,
  reconquistaCommandResultSchema,
  reconquistaEntrySchema,
  reconquistaViewSchema,
  type ReconquistaAction,
  type ReconquistaBoard,
  type ReconquistaEntry,
  type ReconquistaView,
} from '@game/protocol/reconquista';
import {
  campaignPhaseNames,
  preparationStageNames,
} from './reconquista-labels.js';
import { parseServerJson, tr } from './language.js';

const RECONQUISTA_API = '/api/reconquista';

export class ReconquistaRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export async function reconquistaRequest(
  path: string,
  body?: unknown,
  method?: 'DELETE' | 'PATCH',
): Promise<unknown> {
  const response = await fetch(RECONQUISTA_API + path, {
    credentials: 'same-origin',
    ...(method ? { method } : {}),
    ...(body === undefined
      ? {}
      : {
          method: method ?? 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const value: unknown = await response
    .text()
    .then(parseServerJson)
    .catch(() => ({}));
  if (!response.ok) {
    const code =
      typeof value === 'object' &&
      value !== null &&
      'code' in value &&
      typeof value.code === 'string'
        ? value.code
        : 'REQUEST_FAILED';
    throw new ReconquistaRequestError(code, response.status);
  }
  return value;
}

export function reconquistaErrorMessage(caught: unknown): string {
  const code = caught instanceof ReconquistaRequestError ? caught.code : '';
  switch (code) {
    case 'UNAUTHORIZED':
      return tr(
        'Necesitás un asiento en esta partida o la sesión de administrador.',
        'You need a seat in this game or the administrator session.',
      );
    case 'NOT_FOUND':
      return tr('La partida no existe.', 'The game does not exist.');
    case 'RATE_LIMITED':
      return tr(
        'Demasiados intentos. Esperá un momento.',
        'Too many attempts. Wait a moment.',
      );
    case 'INVALID_RECONQUISTA_ACTION':
      return tr(
        'La acción ya no es válida. Se actualizó la partida.',
        'The action is no longer valid. The game was updated.',
      );
    case 'INCOMPATIBLE_RECONQUISTA_CONTRACT':
      return tr(
        'La acción tiene datos incompletos.',
        'The action has incomplete data.',
      );
    case 'COLOR_IN_USE':
      return tr(
        'Ese color ya estaba en uso. Elegimos otro libre.',
        'That color was already in use. We picked a free one.',
      );
    case 'NICKNAME_IN_USE':
      return tr(
        'Ese nombre ya está en uso. Elegí otro.',
        'That name is already in use. Choose another.',
      );
    case 'GAME_PAUSED':
      return tr('La partida está en pausa.', 'The game is paused.');
    case 'BOT_CONTROLLED':
      return tr(
        'Un bot juega este asiento. Pedile al anfitrión que te lo devuelva.',
        'A bot is playing this seat. Ask the host to give it back.',
      );
    case 'SEAT_TAKEN':
      return tr(
        'Ese asiento ya lo tomó otra persona.',
        'Someone else already took that seat.',
      );
    case 'TOO_MANY_BOTS':
      return tr(
        'Tiene que quedar al menos un asiento para una persona.',
        'At least one seat must stay for a person.',
      );
    case 'STALE_REVISION':
      return tr(
        'Otro jugador actuó antes. Se actualizó la partida.',
        'Another player acted first. The game was updated.',
      );
    default:
      return code
        ? tr(
            `No se pudo completar la acción (${code}).`,
            `The action could not be completed (${code}).`,
          )
        : tr(
            'No se pudo completar la acción.',
            'The action could not be completed.',
          );
  }
}

type Connection = 'connecting' | 'connected' | 'disconnected';

export function useReconquistaGame(gameId: string) {
  const [view, setView] = useState<ReconquistaView | null>(null);
  const [entry, setEntry] = useState<ReconquistaEntry | null>(null);
  const [board, setBoard] = useState<ReconquistaBoard | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const pending = useRef<{
    protocolVersion: typeof RECONQUISTA_PROTOCOL;
    commandId: string;
    revision: number;
    action: ReconquistaAction;
  } | null>(null);
  const accept = (value: ReconquistaView) =>
    setView((previous) =>
      previous &&
      previous.gameId === value.gameId &&
      previous.revision > value.revision
        ? previous
        : value,
    );
  async function refresh() {
    const nextEntry = reconquistaEntrySchema.parse(
      await reconquistaRequest('/games/' + gameId + '/entry'),
    );
    if (!mounted.current) return;
    setEntry(nextEntry);
    try {
      const state = reconquistaViewSchema.parse(
        await reconquistaRequest('/games/' + gameId + '/state'),
      );
      if (mounted.current) accept(state);
    } catch (caught) {
      if (!(caught instanceof ReconquistaRequestError) || caught.status !== 401)
        throw caught;
      // Without a seat, the host session still sees the public view.
      const observer = await reconquistaRequest(
        '/games/' + gameId + '/state?observer=1',
      ).catch(() => null);
      if (mounted.current)
        if (observer) accept(reconquistaViewSchema.parse(observer));
        else setView(null);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void reconquistaRequest('/board')
      .then((value) => {
        if (mounted.current) {
          const parsed = reconquistaBoardSchema.parse(value);
          setBoard({
            ...parsed,
            countries: parsed.countries.map((c) => ({
              ...c,
              name: reconquistaCountryName(c.id, c.name),
            })),
          });
        }
      })
      .catch(() => {
        if (mounted.current) setConnection('disconnected');
      });
    const poll = () =>
      refresh()
        .then(() => {
          if (mounted.current) setConnection('connected');
        })
        .catch(() => {
          if (mounted.current) setConnection('disconnected');
        });
    // The server announces each change on the live connection; polling covers the gaps while it is down.
    let socket: WebSocket | undefined;
    let open = false;
    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(
        `${scheme}://${window.location.host}${RECONQUISTA_API}/games/${gameId}/live`,
      );
      socket.onopen = () => {
        open = true;
        void poll();
      };
      socket.onmessage = () => void poll();
      socket.onclose = () => {
        open = false;
      };
    };
    connect();
    void poll();
    let ticks = 0;
    const timer = setInterval(() => {
      if (open) return;
      void poll();
      if (++ticks % 3 === 0 && socket?.readyState === WebSocket.CLOSED)
        connect();
    }, 2000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [gameId]);
  async function run(operation: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      await operation();
      return true;
    } catch (caught) {
      setError(reconquistaErrorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function send(action: ReconquistaAction): Promise<boolean> {
    return run(async () => {
      if (!view) return;
      pending.current ??= {
        protocolVersion: RECONQUISTA_PROTOCOL,
        commandId: createCommandId(),
        revision: view.revision,
        action,
      };
      try {
        const value = reconquistaCommandResultSchema.parse(
          await reconquistaRequest(
            '/games/' + gameId + '/commands',
            pending.current,
          ),
        );
        pending.current = null;
        accept(value.state);
      } catch (caught) {
        if (caught instanceof ReconquistaRequestError && caught.status < 500) {
          pending.current = null;
          await refresh().catch(() => {});
        }
        throw caught;
      }
    });
  }
  /** Runs dependent commands in order; each step sees the state left by the previous one. */
  function sendSteps(
    steps: readonly ((
      current: ReconquistaView,
    ) => ReconquistaAction | undefined)[],
  ): Promise<boolean> {
    return run(async () => {
      let current = view;
      for (const step of steps) {
        const action = current && step(current);
        if (!current || !action) return;
        current = reconquistaCommandResultSchema.parse(
          await reconquistaRequest('/games/' + gameId + '/commands', {
            protocolVersion: RECONQUISTA_PROTOCOL,
            commandId: createCommandId(),
            revision: current.revision,
            action,
          }),
        ).state;
        accept(current);
      }
    });
  }
  /** Shares the on-turn selection with the other players; a lost update only delays the outline. */
  function shareFocus(originId: string, targetId: string) {
    void reconquistaRequest('/games/' + gameId + '/focus', {
      ...(originId ? { originId } : {}),
      ...(targetId ? { targetId } : {}),
    }).catch(() => {});
  }
  return {
    view,
    entry,
    board,
    connection,
    error,
    busy,
    run,
    send,
    sendSteps,
    refresh,
    accept,
    shareFocus,
    clearError: () => setError(''),
  };
}

export type ActionMode =
  | 'observer'
  | 'wait'
  | 'placement'
  | 'reveal'
  | 'attack'
  | 'transfer'
  | 'occupation'
  | 'regroup'
  | 'closing'
  | 'zone'
  | 'finished';

export interface Presentation {
  readonly mode: ActionMode;
  readonly mine: boolean;
  readonly actorId: string | undefined;
  readonly title: string;
  readonly phase: string;
  readonly round: number | undefined;
}

/** A condominio offered by whoever expelled one of a country's two occupants. */
export function condominiumOffer(view: ReconquistaView) {
  const occupation = view.campaign?.occupation;
  if (occupation?.condominium !== 'proposed') return null;
  const proposerId = occupation.arrivals[0]!.playerId;
  const partnerId = view.territories
    .find((t) => t.id === occupation.targetId)
    ?.forces.find((f) => f.playerId !== proposerId && f.armies > 0)?.playerId;
  return partnerId
    ? { proposerId, partnerId, targetId: occupation.targetId }
    : null;
}

/** Same role as game-presentation.ts in Classic: one current action per view. */
export function reconquistaPresentation(view: ReconquistaView): Presentation {
  const me = view.self?.playerId;
  const campaign = view.campaign;
  if (campaign) {
    const legal = view.self?.campaign?.legal;
    const phase = campaign.extraPass
      ? tr('Refuerzos extra', 'Extra reinforcements')
      : (campaignPhaseNames[campaign.phase] ?? campaign.phase);
    const base = {
      actorId: legal?.actorId ?? campaign.actorId,
      phase,
      round: campaign.round,
    };
    if (campaign.phase === 'finished')
      return {
        ...base,
        mode: 'finished',
        mine: false,
        title: tr('Resultado', 'Result'),
      };
    if (!view.self)
      return { ...base, mode: 'observer', mine: false, title: phase };
    if (campaign.eliminations[me!])
      return {
        ...base,
        mode: 'observer',
        mine: false,
        title: tr('Eliminado', 'Eliminated'),
      };
    const occupation = legal?.occupation;
    if (occupation?.arrivals[0]?.playerId === me)
      return {
        ...base,
        mode: 'occupation',
        mine: true,
        title: tr('Traslado', 'Move'),
      };
    // Menu names follow Classic.
    if (legal?.canReinforce)
      return {
        ...base,
        mode: 'placement',
        mine: true,
        title: legal.canExchange
          ? tr('Canje y refuerzos', 'Exchange and reinforcements')
          : tr('Refuerzos', 'Reinforcements'),
      };
    if (campaign.zoneDecisions.some((d) => d.playerId === me))
      return {
        ...base,
        mode: 'zone',
        mine: true,
        title: tr('Zona internacional', 'International zone'),
      };
    if (
      campaign.phase === 'attack' &&
      legal &&
      legal.actorId === me &&
      (legal.canFinishAttacks ||
        legal.attacks.length > 0 ||
        legal.missileShots.length > 0)
    )
      return {
        ...base,
        mode: 'attack',
        mine: true,
        title: tr('Ataque', 'Attack'),
      };
    if (legal?.canFinishRegroup || legal?.canFinishAllyRegroup)
      return {
        ...base,
        mode: 'regroup',
        mine: true,
        title: tr('Traslado', 'Move'),
      };
    if (legal?.canFinishTurn)
      return {
        ...base,
        mode: 'closing',
        mine: true,
        title: tr('Cartas', 'Cards'),
      };
    return { ...base, mode: 'wait', mine: false, title: phase };
  }
  const legal = view.self?.legal;
  const phase = preparationStageNames[view.stage] ?? view.stage;
  const base = {
    actorId: legal?.actorId ?? view.hostility?.actorId,
    phase,
    round: undefined,
  };
  if (!view.self)
    return { ...base, mode: 'observer', mine: false, title: phase };
  if (legal?.canPlace)
    return { ...base, mode: 'placement', mine: true, title: phase };
  if (legal?.canReveal)
    return {
      ...base,
      mode: 'reveal',
      mine: true,
      title: tr('Revelar situación', 'Reveal situation'),
    };
  if (legal?.transfer)
    return {
      ...base,
      mode: 'transfer',
      mine: true,
      title: tr('Traslado', 'Move'),
    };
  // First hostility uses the same Ataque and Traslado menus as full turns.
  if (view.stage === 'first-hostility' && legal && legal.actorId === me) {
    if (view.hostility?.phase === 'attack' && legal.attacks.length > 0)
      return {
        ...base,
        mode: 'attack',
        mine: true,
        title: tr('Ataque', 'Attack'),
      };
    return {
      ...base,
      mode: 'regroup',
      mine: true,
      title: tr('Traslado', 'Move'),
    };
  }
  return { ...base, mode: 'wait', mine: false, title: phase };
}
