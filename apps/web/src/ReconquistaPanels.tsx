import { Fragment, useEffect, useState } from 'react';
import type {
  CampaignAction,
  ReconquistaAction,
  ReconquistaBoard,
  ReconquistaView,
} from '@game/protocol/reconquista';
import { UiIcon } from './UiIcon.js';
import { CardArt, ContinentArt } from './ReconquistaCardArt.js';
import {
  continentCardHint,
  continentNames,
  pactKindNames,
  playerColorNames,
  situationCard,
  symbolHints,
  specialCardNames,
  symbolNames,
} from './reconquista-labels.js';

interface PanelProps {
  readonly view: ReconquistaView;
  readonly board: ReconquistaBoard;
  readonly busy: boolean;
  readonly send: (action: ReconquistaAction) => Promise<boolean>;
}

const toggle = (values: readonly string[], id: string) =>
  values.includes(id) ? values.filter((v) => v !== id) : [...values, id];

function campaignSend(send: PanelProps['send']) {
  return (action: CampaignAction) => send({ kind: 'campaign', action });
}

function PlayerChip({
  view,
  playerId,
}: {
  readonly view: ReconquistaView;
  readonly playerId: string;
}) {
  const player = view.players.find((p) => p.id === playerId);
  return (
    <span className="pact-participant">
      {player?.nickname ?? playerId}
      <span
        className={`color-dot color-${player?.color ?? ''}`}
        role="img"
        aria-label={playerColorNames[player?.color ?? ''] ?? ''}
        title={playerColorNames[player?.color ?? ''] ?? ''}
      />
    </span>
  );
}

export function ReconquistaObjective({
  view,
}: {
  readonly view: ReconquistaView;
}) {
  return (
    <section className="panel private-panel">
      <span className="privacy-badge">INFORMACIÓN PRIVADA</span>
      <details open>
        <summary className="objective-heading">
          <h2>
            {view.self && view.self.objectives.length > 1
              ? 'Tus objetivos'
              : 'Tu objetivo'}
          </h2>
        </summary>
        <div className="objective-box">
          {!view.self ? (
            <p>Los observadores no ven los objetivos de los jugadores.</p>
          ) : view.self.objectives.length === 0 ? (
            <p>Todavía no se asignaron objetivos.</p>
          ) : (
            view.self.objectives.map((o) => {
              // Manual: a color not in play, or the player's own, means the
              // player to the right; the card says so.
              const color = o.objectiveId.replace(/^destroy_/, '');
              const target = view.players.find(
                (p) => p.id === o.targetPlayerId,
              );
              const colorName = playerColorNames[color];
              const fallback =
                !!colorName && !!target && target.color !== color;
              const own = view.players.some(
                (p) => p.id === view.self?.playerId && p.color === color,
              );
              return (
                <Fragment key={o.objectiveId}>
                  <p>
                    {o.description}
                    {fallback &&
                      ' De no ser posible, al jugador de la derecha.'}
                  </p>
                  {target &&
                    (fallback ? (
                      <p className="objective-target">
                        Resultado:{' '}
                        <PlayerChip view={view} playerId={target.id} />.{' '}
                        {own
                          ? `El ${colorName} sos vos.`
                          : `El ${colorName} no está en juego.`}
                      </p>
                    ) : (
                      <p className="objective-target">
                        Jugador: <PlayerChip view={view} playerId={target.id} />
                      </p>
                    ))}
                </Fragment>
              );
            })
          )}
        </div>
      </details>
    </section>
  );
}

export function ReconquistaCards({
  view,
  board,
  busy,
  send,
  newCardIds = [],
}: PanelProps & { readonly newCardIds?: readonly string[] }) {
  const self = view.self?.campaign;
  const me = view.self?.playerId;
  const legal = self?.legal;
  const [cards, setCards] = useState<string[]>([]);
  const [continents, setContinents] = useState<string[]>([]);
  const [refused, setRefused] = useState(false);
  // The refusal stays a few seconds and leaves when the game moves on.
  useEffect(() => {
    if (!refused) return;
    const timeout = window.setTimeout(() => setRefused(false), 4_000);
    return () => window.clearTimeout(timeout);
  }, [refused, view.revision]);
  const act = campaignSend(send);
  const name = (id: string) =>
    board.countries.find((c) => c.id === id)?.name ?? id;
  if (!view.campaign || !self)
    return (
      <section className="panel cards-panel" aria-label="Tus cartas">
        <p>Todavía no tenés cartas.</p>
      </section>
    );
  const publicSelf = view.campaign.players.find((p) => p.playerId === me);
  const handIds = self.hand.map((c) => c.id);
  const selectedCards = cards.filter((id) => handIds.includes(id));
  const selectedContinents = continents.filter((id) =>
    publicSelf?.continentIds.includes(id),
  );
  const canExchange = !!legal?.canExchange && !busy;
  // Only a combination the engine accepts enables the exchange.
  const sameIds = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  const validExchange = (legal?.exchanges ?? []).some(
    (option) =>
      sameIds(option.cardIds, selectedCards) &&
      sameIds(option.continentIds, selectedContinents),
  );
  const bonusIds = legal?.bonusCardIds ?? [];
  // A single selected card with its +3 available enables the +3 button.
  const bonusCard =
    selectedCards.length === 1 &&
    selectedContinents.length === 0 &&
    bonusIds.includes(selectedCards[0]!)
      ? self.hand.find((c) => c.id === selectedCards[0])
      : undefined;
  const closingTurn =
    view.campaign.phase === 'closing' && !!legal?.canFinishTurn;
  const myTurn = view.campaign.actorId === me;
  return (
    <section className="panel cards-panel" aria-label="Tus cartas">
      <details className="private-hand" open>
        <summary>Cartas · {self.hand.length}/5</summary>
        {self.hand.length === 0 && <p>Todavía no tenés cartas.</p>}
        <div className="exchange-card-selection">
          {self.hand.map((card) => {
            const selected = selectedCards.includes(card.id);
            const inherited = card.acquisition === 'inheritance';
            // Selecting a card whose +3 is available offers to claim it.
            const bonus = bonusIds.includes(card.id);
            return (
              <button
                key={card.id}
                type="button"
                className={`territory-card hand-card ${card.bonusUsed ? 'bonus-used' : 'bonus-available'} ${selected ? 'selected' : ''} ${inherited ? 'inherited-card' : ''} ${newCardIds.includes(card.id) ? 'new-card' : ''}`}
                aria-pressed={canExchange || bonus ? selected : undefined}
                disabled={busy || (!canExchange && !bonus)}
                title={
                  bonus && card.countryId
                    ? `Cobrar +3 en ${name(card.countryId)}`
                    : undefined
                }
                aria-label={`${card.countryId ? name(card.countryId) : 'Comodín sin país'}, ${symbolNames[card.symbol]}${inherited ? ', heredada, solo para canje' : card.bonusUsed ? ', +3 usado' : bonus ? ', cobrar +3' : ''}${selected ? ', seleccionada' : ''}`}
                onClick={() =>
                  setCards(
                    canExchange
                      ? toggle(selectedCards, card.id)
                      : selected
                        ? []
                        : [card.id],
                  )
                }
              >
                {/* Every card: country on top, drawing, then (special cards
                    only) the type and its rule. */}
                <strong className="card-name">
                  {card.countryId ? name(card.countryId) : 'Comodín'}
                </strong>
                <span
                  className={`card-symbol symbol-${card.symbol}`}
                  aria-hidden="true"
                >
                  <CardArt art={card.symbol} />
                </span>
                {symbolHints[card.symbol] && (
                  <span className="card-copy">
                    {card.countryId && (
                      <small>{specialCardNames[card.symbol]}</small>
                    )}
                    <small className="card-hint">
                      {symbolHints[card.symbol]}
                    </small>
                  </span>
                )}
                <span className="card-badges">
                  {inherited && (
                    <small className="card-badge">Solo para canje</small>
                  )}
                  {!inherited && card.bonusUsed && (
                    <small className="card-badge">+3 usado</small>
                  )}
                  {bonus && <strong className="card-badge">+3</strong>}
                  {selected && (
                    <strong className="selected-check" aria-hidden="true">
                      ✓
                    </strong>
                  )}
                </span>
              </button>
            );
          })}
          {publicSelf?.continentIds.map((id) => {
            const selected = selectedContinents.includes(id);
            return (
              <button
                key={'continent:' + id}
                type="button"
                className={`territory-card hand-card continent-card ${selected ? 'selected' : ''}`}
                aria-pressed={canExchange ? selected : undefined}
                disabled={!canExchange}
                onClick={() => setContinents(toggle(selectedContinents, id))}
              >
                <strong className="card-name">{continentNames[id]}</strong>
                <span className="card-symbol" aria-hidden="true">
                  <ContinentArt continentId={id} />
                </span>
                <span className="card-copy">
                  <small>Continente</small>
                  <small className="card-hint">{continentCardHint(id)}</small>
                </span>
                {selected && (
                  <strong className="selected-check" aria-hidden="true">
                    ✓
                  </strong>
                )}
              </button>
            );
          })}
        </div>
      </details>
      {myTurn && (
        // Every card button at the bottom right, in this order: +1, continent,
        // +3 with its country and exchange.
        <div className="action-card card-actions">
          <button
            type="button"
            className="icon-button text-icon claim-card"
            title="Solicitar carta de país"
            aria-label="Solicitar carta de país"
            disabled={busy}
            onClick={() => {
              if (closingTurn && legal?.canClaimCountry)
                void act({ kind: 'claim-country' });
              else setRefused(true);
            }}
          >
            <UiIcon name="cards" />
            <span>+1</span>
          </button>
          {closingTurn &&
            legal?.continentIds.map((id) => (
              <button
                key={id}
                type="button"
                className="icon-button text-icon claim-continent"
                title={`Solicitar carta de ${continentNames[id]}`}
                aria-label={`Solicitar carta de ${continentNames[id]}`}
                disabled={busy}
                onClick={() =>
                  void act({ kind: 'claim-continent', continentId: id })
                }
              >
                <UiIcon name="cards" />
                <span>Continente</span>
              </button>
            ))}
          {bonusCard?.countryId && (
            <button
              type="button"
              className="icon-button text-icon claim-bonus"
              title={`Cobrar +3 en ${name(bonusCard.countryId)}`}
              aria-label={`Cobrar +3 en ${name(bonusCard.countryId)}`}
              disabled={busy}
              onClick={() =>
                void act({ kind: 'claim-bonus', cardId: bonusCard.id }).then(
                  (ok) => ok && setCards([]),
                )
              }
            >
              +3 {name(bonusCard.countryId)}
            </button>
          )}
          {legal?.canExchange && (
            <button
              type="button"
              className="icon-button exchange-submit"
              title="Canjear selección"
              aria-label="Canjear selección"
              disabled={busy || !validExchange}
              onClick={() =>
                void act({
                  kind: 'exchange',
                  cardIds: selectedCards,
                  continentIds: selectedContinents,
                }).then((ok) => {
                  if (ok) {
                    setCards([]);
                    setContinents([]);
                  }
                })
              }
            >
              <UiIcon name="exchange" />
            </button>
          )}
        </div>
      )}
      {refused && (
        // Only after trying to request a card that cannot be requested.
        <p className="muted-copy card-refusal" role="status">
          No podés solicitar una carta.
        </p>
      )}
      {self.hand.length === 5 && (
        <p className="action-help">
          Mano completa: no recibís otra carta por conquista.
        </p>
      )}
    </section>
  );
}

type ProposalKind =
  | 'world'
  | 'continent'
  | 'intercontinental'
  | 'countries'
  | 'zone'
  | 'condominium';

// The manual's pact kinds (pp. 27–30), in its order.
const proposalKinds: readonly ProposalKind[] = [
  'countries',
  'continent',
  'intercontinental',
  'world',
  'zone',
  'condominium',
];

/** Same structure, classes and behavior as Classic's PactsPanel, plus Reconquista's pact kinds. */
export function ReconquistaPacts({
  view,
  board,
  busy,
  send,
  selected,
  target,
}: PanelProps & { readonly selected: string; readonly target: string }) {
  const campaign = view.campaign;
  const me = view.self?.playerId;
  const act = campaignSend(send);
  const [kindChoice, setKindChoice] = useState('');
  const [partnerChoice, setPartnerChoice] = useState('');
  const [firstContinent, setFirstContinent] = useState('');
  const [secondContinent, setSecondContinent] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [partnerOrigin, setPartnerOrigin] = useState('');
  const name = (id: string) =>
    board.countries.find((c) => c.id === id)?.name ?? id;
  const participant = (id: string) => {
    const p = view.players.find((player) => player.id === id);
    return (
      <span className="pact-participant">
        {p?.nickname ?? 'Jugador'}
        {p && (
          <span
            className={`color-dot color-${p.color}`}
            role="img"
            aria-label={playerColorNames[p.color] ?? p.color}
            title={playerColorNames[p.color] ?? p.color}
          />
        )}
      </span>
    );
  };
  if (!campaign)
    return (
      <section className="panel pacts-panel">
        <p className="muted-copy">No hay pactos activos.</p>
      </section>
    );
  const disabled =
    busy ||
    campaign.phase === 'finished' ||
    !!(me && campaign.eliminations[me]);
  const armiesOf = (countryId: string, playerId: string | undefined) =>
    view.territories
      .find((t) => t.id === countryId)
      ?.forces.find((f) => f.playerId === playerId);
  const owns = (countryId: string, playerId: string | undefined) =>
    !!playerId && !!armiesOf(countryId, playerId);
  const countries = [...board.countries].sort((a, b) =>
    a.name.localeCompare(b.name, 'es'),
  );
  const partners = view.players.filter(
    (p) => p.id !== me && !campaign.eliminations[p.id],
  );
  // Fields in order: type, player, your country or continent, theirs.
  // Between continents needs two controlled, bordering continents (D78).
  const scopes = view.self?.campaign?.legal.pactScopes ?? {};
  // Each field offers only what the engine accepts for the choices before it.
  const neighbors = (id: string) =>
    board.connections.flatMap(([a, b]) =>
      a === id ? [b] : b === id ? [a] : [],
    );
  const withinThree = (from: string) => {
    const reached = new Set([from]);
    let frontier = [from];
    for (let step = 0; step < 3; step++) {
      frontier = frontier.flatMap(neighbors).filter((id) => !reached.has(id));
      frontier.forEach((id) => reached.add(id));
    }
    reached.delete(from);
    return reached;
  };
  const strong = (countryId: string, playerId: string | undefined) =>
    (armiesOf(countryId, playerId)?.armies ?? 0) > 1;
  const countryTargets = (originId: string, partnerId: string) =>
    [...withinThree(originId)].filter((id) => owns(id, partnerId));
  const zoneUsed = (partnerId: string) =>
    campaign.pacts.some(
      (p) =>
        p.kind === 'zone' &&
        [p.proposerId, p.partnerId].some((id) => id === me || id === partnerId),
    );
  const exchangesOf = (playerId: string | undefined) =>
    campaign.players.find((p) => p.playerId === playerId)?.exchanges ?? 0;
  const zoneCountries = (partnerId: string) =>
    exchangesOf(me) < 3 || exchangesOf(partnerId) < 3 || zoneUsed(partnerId)
      ? []
      : view.territories
          .filter(
            (t) =>
              t.ownership.kind === 'exclusive' &&
              t.ownership.playerId === me &&
              t.forces[0]?.armies === 1 &&
              t.forces[0]?.missiles === 0 &&
              [me, partnerId].every((id) =>
                neighbors(t.id).some((n) => owns(n, id)),
              ),
          )
          .map((t) => t.id);
  const thirdParty = (id: string, partnerId: string) =>
    !owns(id, me) && !owns(id, partnerId);
  const condominiumTargets = (
    originId: string,
    allyOriginId: string,
    partnerId: string,
  ) =>
    neighbors(originId).filter(
      (id) => thirdParty(id, partnerId) && neighbors(allyOriginId).includes(id),
    );
  const condominiumAllyOrigins = (originId: string, partnerId: string) =>
    view.territories
      .filter(
        (t) =>
          strong(t.id, partnerId) &&
          condominiumTargets(originId, t.id, partnerId).length > 0,
      )
      .map((t) => t.id);
  const condominiumOrigins = (partnerId: string) =>
    view.territories
      .filter(
        (t) =>
          strong(t.id, me) &&
          condominiumAllyOrigins(t.id, partnerId).length > 0,
      )
      .map((t) => t.id);
  const validFor = (kind: ProposalKind, partnerId: string) =>
    kind === 'intercontinental'
      ? (scopes[partnerId]?.continentPairs.length ?? 0) > 0
      : kind === 'continent'
        ? (scopes[partnerId]?.continents.length ?? 0) > 0
        : kind === 'countries'
          ? view.territories.some(
              (t) =>
                owns(t.id, me) && countryTargets(t.id, partnerId).length > 0,
            )
          : kind === 'zone'
            ? zoneCountries(partnerId).length > 0
            : kind === 'condominium'
              ? condominiumOrigins(partnerId).length > 0
              : true;
  const kinds = proposalKinds.filter((k) =>
    partners.some((p) => validFor(k, p.id)),
  );
  const kind = kinds.find((k) => k === kindChoice);
  const kindPartners = kind ? partners.filter((p) => validFor(kind, p.id)) : [];
  const partnerPlayer = kindPartners.find((p) => p.id === partnerChoice);
  const partner = partnerPlayer?.id ?? '';
  const choice =
    kind && partnerPlayer ? { kind, partner: partnerPlayer } : undefined;
  const only = (ids: readonly string[]) =>
    countries.filter((c) => ids.includes(c.id));
  const originIds = !partner
    ? []
    : kind === 'countries'
      ? view.territories
          .filter(
            (t) => owns(t.id, me) && countryTargets(t.id, partner).length > 0,
          )
          .map((t) => t.id)
      : kind === 'zone'
        ? zoneCountries(partner)
        : kind === 'condominium'
          ? condominiumOrigins(partner)
          : [];
  const pickedOrigin = origin || selected;
  const originId = originIds.includes(pickedOrigin) ? pickedOrigin : '';
  const allyOrigins = originId ? condominiumAllyOrigins(originId, partner) : [];
  const allyOriginId = allyOrigins.includes(partnerOrigin) ? partnerOrigin : '';
  const targetIds = !originId
    ? []
    : kind === 'countries'
      ? countryTargets(originId, partner)
      : kind === 'condominium' && allyOriginId
        ? condominiumTargets(originId, allyOriginId, partner)
        : [];
  const pickedTarget = destination || target;
  const targetId = targetIds.includes(pickedTarget) ? pickedTarget : '';
  const pairs = scopes[partner]?.continentPairs ?? [];
  const sharedContinents = scopes[partner]?.continents ?? [];
  const firstOptions = [...new Set(pairs.map(([mine]) => mine))];
  const secondOptions = pairs
    .filter(([mine]) => mine === firstContinent)
    .map(([, theirs]) => theirs);
  const pact = (
    pactKind: 'countries' | 'continent' | 'intercontinental' | 'world' | 'zone',
    countryIds: string[],
    chosen: string[],
  ): CampaignAction => ({
    kind: 'propose-pact',
    partnerId: partner,
    pactKind,
    countryIds,
    continentIds: chosen,
  });
  const proposal: CampaignAction | undefined = !choice
    ? undefined
    : kind === 'world'
      ? pact('world', [], [])
      : kind === 'continent'
        ? sharedContinents.includes(firstContinent)
          ? pact('continent', [], [firstContinent])
          : undefined
        : kind === 'intercontinental'
          ? firstOptions.includes(firstContinent) &&
            secondOptions.includes(secondContinent)
            ? pact('intercontinental', [], [firstContinent, secondContinent])
            : undefined
          : kind === 'countries'
            ? originId && targetId
              ? pact('countries', [originId, targetId], [])
              : undefined
            : kind === 'zone'
              ? originId
                ? pact('zone', [originId], [])
                : undefined
              : originId && allyOriginId && targetId
                ? {
                    kind: 'propose-alliance',
                    allyId: partner,
                    originId,
                    allyOriginId,
                    targetId,
                  }
                : undefined;
  const terms = (p: (typeof campaign.pacts)[number]) =>
    [
      pactKindNames[p.kind],
      ...(p.countryIds.length ? [p.countryIds.map(name).join(' / ')] : []),
      ...(p.continentIds.length
        ? [p.continentIds.map((id) => continentNames[id]).join(' / ')]
        : []),
    ].join(': ');
  const condominium = (a: (typeof campaign.alliances)[number]) =>
    `Condominio: ${name(a.originId)} y ${name(a.allyOriginId)} → ${name(a.targetId)}`;
  const countrySelect = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: typeof countries,
  ) => (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Elegí país</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
  const continentSelect = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: readonly string[],
  ) => (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Elegí continente</option>
        {options.map((id) => (
          <option key={id} value={id}>
            {continentNames[id]}
          </option>
        ))}
      </select>
    </label>
  );
  const active = campaign.pacts.filter((p) => p.status === 'active');
  const activeAlliances = campaign.alliances.filter(
    (a) => a.status !== 'proposed',
  );
  const proposals = campaign.pacts.filter((p) => p.status === 'proposed');
  const allianceProposals = campaign.alliances.filter(
    (a) => a.status === 'proposed',
  );
  const answer = (onAccept: () => void, onReject: () => void) => (
    <>
      <button type="button" disabled={disabled} onClick={onAccept}>
        Aceptar
      </button>
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={onReject}
      >
        Rechazar
      </button>
    </>
  );
  return (
    <section className="panel pacts-panel">
      <details open>
        <summary className="pacts-heading">
          <div>
            <h2>Pactos</h2>
          </div>
          <span className="count-badge">
            {campaign.pacts.length + campaign.alliances.length}
          </span>
        </summary>
        {active.length + activeAlliances.length === 0 && (
          <p className="muted-copy">No hay pactos activos.</p>
        )}
        {active.map((p) => (
          <div key={p.id} className="pact-row">
            <span className="pact-copy">
              <small>
                {p.withdrawal ? 'Retiro anunciado · aún vigente' : 'Activo'}
              </small>
              <strong>{terms(p)}</strong>
              <span>
                {participant(p.proposerId)} ↔ {participant(p.partnerId)}
              </span>
            </span>
            {view.self &&
              p.kind !== 'origin' &&
              !p.withdrawal &&
              !!me &&
              [p.proposerId, p.partnerId].includes(me) && (
                <button
                  type="button"
                  className="danger-quiet"
                  disabled={disabled}
                  onClick={() =>
                    window.confirm(
                      'Retirarte anuncia la ruptura y conserva temporalmente tu obligación. ¿Continuar?',
                    ) && void act({ kind: 'withdraw-pact', pactId: p.id })
                  }
                >
                  Retirarme
                </button>
              )}
          </div>
        ))}
        {activeAlliances.map((a) => (
          <div key={a.id} className="pact-row">
            <span className="pact-copy">
              <small>
                {a.status === 'accepted'
                  ? 'Activo'
                  : 'Ataque conjunto en curso'}
              </small>
              <strong>{condominium(a)}</strong>
              <span>
                {participant(a.proposerId)} ↔ {participant(a.allyId)}
              </span>
            </span>
            {view.self &&
              a.status === 'accepted' &&
              a.proposerId === me &&
              campaign.actorId === me &&
              campaign.phase === 'attack' && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    void act({ kind: 'start-alliance', allianceId: a.id })
                  }
                >
                  Atacar juntos
                </button>
              )}
            {view.self &&
              a.status === 'active' &&
              !a.exhaustive &&
              !!me &&
              [a.proposerId, a.allyId].includes(me) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled}
                  onClick={() => void act({ kind: 'stop-alliance' })}
                >
                  Detener
                </button>
              )}
          </div>
        ))}
        {proposals.map((p) => (
          <div key={p.id} className="pact-row">
            <span className="pact-copy">
              <small>Propuesta pendiente</small>
              <strong>{terms(p)}</strong>
              <span>
                {participant(p.proposerId)} → {participant(p.partnerId)}
              </span>
            </span>
            {view.self &&
              p.partnerId === me &&
              answer(
                () =>
                  void act({
                    kind: 'respond-pact',
                    pactId: p.id,
                    accept: true,
                  }),
                () =>
                  void act({
                    kind: 'respond-pact',
                    pactId: p.id,
                    accept: false,
                  }),
              )}
          </div>
        ))}
        {allianceProposals.map((a) => (
          <div key={a.id} className="pact-row">
            <span className="pact-copy">
              <small>Propuesta pendiente</small>
              <strong>{condominium(a)}</strong>
              <span>
                {participant(a.proposerId)} → {participant(a.allyId)}
              </span>
            </span>
            {view.self &&
              a.allyId === me &&
              answer(
                () =>
                  void act({
                    kind: 'respond-alliance',
                    allianceId: a.id,
                    accept: true,
                  }),
                () =>
                  void act({
                    kind: 'respond-alliance',
                    allianceId: a.id,
                    accept: false,
                  }),
              )}
          </div>
        ))}
        {view.self &&
          campaign.phase !== 'finished' &&
          !campaign.occupation &&
          kinds.length > 0 && (
            <div className="pact-proposal-form">
              <label>
                Tipo de pacto
                <select
                  value={kind ?? ''}
                  disabled={disabled}
                  onChange={(e) => {
                    setKindChoice(e.target.value);
                    setFirstContinent('');
                    setSecondContinent('');
                  }}
                >
                  <option value="">Elegí tipo</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {pactKindNames[k]}
                    </option>
                  ))}
                </select>
              </label>
              {kind && (
                <label>
                  Jugador
                  <select
                    value={partner}
                    disabled={disabled}
                    onChange={(e) => {
                      setPartnerChoice(e.target.value);
                      setFirstContinent('');
                      setSecondContinent('');
                      setDestination('');
                      setPartnerOrigin('');
                    }}
                  >
                    <option value="">Elegí jugador</option>
                    {kindPartners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nickname} ({playerColorNames[p.color] ?? p.color})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {choice &&
                kind === 'continent' &&
                continentSelect(
                  'Continente',
                  sharedContinents.includes(firstContinent)
                    ? firstContinent
                    : '',
                  setFirstContinent,
                  sharedContinents,
                )}
              {choice &&
                kind === 'intercontinental' &&
                continentSelect(
                  'Tu continente',
                  firstOptions.includes(firstContinent) ? firstContinent : '',
                  (value) => {
                    setFirstContinent(value);
                    setSecondContinent('');
                  },
                  firstOptions,
                )}
              {choice &&
                kind === 'intercontinental' &&
                continentSelect(
                  `Continente de ${choice.partner.nickname}`,
                  secondOptions.includes(secondContinent)
                    ? secondContinent
                    : '',
                  setSecondContinent,
                  secondOptions,
                )}
              {choice &&
                (kind === 'countries' ||
                  kind === 'zone' ||
                  kind === 'condominium') &&
                countrySelect(
                  kind === 'zone' ? 'Tu país débil' : 'Tu país',
                  originId,
                  (value) => {
                    setOrigin(value);
                    setPartnerOrigin('');
                    setDestination('');
                  },
                  only(originIds),
                )}
              {choice &&
                kind === 'countries' &&
                countrySelect(
                  `País de ${choice.partner.nickname}`,
                  targetId,
                  setDestination,
                  only(targetIds),
                )}
              {choice &&
                kind === 'condominium' &&
                countrySelect(
                  `País de ${choice.partner.nickname}`,
                  allyOriginId,
                  (value) => {
                    setPartnerOrigin(value);
                    setDestination('');
                  },
                  only(allyOrigins),
                )}
              {choice &&
                kind === 'condominium' &&
                countrySelect(
                  'País a conquistar',
                  targetId,
                  setDestination,
                  only(targetIds),
                )}
              {choice && (
                <p className="pact-summary">
                  <small>Vista previa · todavía no enviada</small>
                  <strong>
                    {!proposal
                      ? pactKindNames[choice.kind]
                      : proposal.kind === 'propose-alliance'
                        ? `Condominio: ${name(proposal.originId)} y ${name(proposal.allyOriginId)} → ${name(proposal.targetId)}`
                        : proposal.kind === 'propose-pact'
                          ? [
                              pactKindNames[proposal.pactKind],
                              ...(proposal.countryIds.length
                                ? [proposal.countryIds.map(name).join(' / ')]
                                : []),
                              ...(proposal.continentIds.length
                                ? [
                                    proposal.continentIds
                                      .map((id) => continentNames[id])
                                      .join(' / '),
                                  ]
                                : []),
                            ].join(': ')
                          : ''}
                  </strong>
                  <span>con {participant(choice.partner.id)}</span>
                </p>
              )}
              <button
                type="button"
                disabled={disabled || !proposal}
                onClick={() => {
                  if (!proposal) return;
                  void act(proposal).then((ok) => {
                    if (ok) {
                      setKindChoice('');
                      setPartnerChoice('');
                      setOrigin('');
                      setDestination('');
                      setPartnerOrigin('');
                      setFirstContinent('');
                      setSecondContinent('');
                    }
                  });
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

export function SituationIndicator({
  view,
  open,
  onOpen,
}: {
  readonly view: ReconquistaView;
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
}) {
  if (!view.situation) return null;
  const card = situationCard(view.situation.typeId);
  return (
    <button
      type="button"
      className="situation-indicator"
      aria-expanded={open}
      aria-controls="situation-card"
      title={`Situación: ${card.name}. Ver efecto.`}
      onClick={() => onOpen(!open)}
    >
      <UiIcon name="situation" />
      <span>
        <span className="visually-hidden">Situación: </span>
        <strong>{card.name}</strong>
      </span>
    </button>
  );
}

/** Rendered at the screen root: fixed popovers inside blurred panels would be clipped. */
export function SituationCardPopover({
  view,
  onClose,
}: {
  readonly view: ReconquistaView;
  readonly onClose: () => void;
}) {
  if (!view.situation) return null;
  const card = situationCard(view.situation.typeId);
  const player = (id: string) =>
    view.players.find((p) => p.id === id)?.nickname ?? id;
  return (
    <section
      id="situation-card"
      className="player-popover situation-card"
      aria-label={`Carta de situación: ${card.name}`}
    >
      <header>
        <strong>
          <UiIcon name="situation" /> {card.name}
        </strong>
        <button
          type="button"
          aria-label="Cerrar carta de situación"
          onClick={onClose}
        >
          <UiIcon name="close" />
        </button>
      </header>
      {card.effect && <p>{card.effect}</p>}
      {view.crisis && (
        <p className="affected-line">
          {view.crisis.affectedPlayerIds.length > 1
            ? 'Jugadores afectados:'
            : 'Jugador afectado:'}{' '}
          {view.crisis.affectedPlayerIds.length === 0
            ? 'nadie.'
            : view.crisis.affectedPlayerIds.map((id) => {
                const p = view.players.find((x) => x.id === id);
                return (
                  <span key={id} className="affected-player">
                    <span
                      className={`color-dot color-${p?.color ?? ''}`}
                      aria-hidden="true"
                    />
                    <span>{player(id)}</span>
                    <span className="visually-hidden">
                      {' '}
                      ({playerColorNames[p?.color ?? ''] ?? p?.color})
                    </span>
                  </span>
                );
              })}
        </p>
      )}
      {!!view.crisis?.tiebreaks?.length && (
        <p>Hubo empate: los empatados volvieron a tirar.</p>
      )}
      {view.restingPlayerId && (
        <p className="affected-line">
          Jugador afectado:{' '}
          <span className="affected-player">
            <span
              className={`color-dot color-${view.players.find((x) => x.id === view.restingPlayerId)?.color ?? ''}`}
              aria-hidden="true"
            />
            <span>{player(view.restingPlayerId)}</span>
          </span>
        </p>
      )}
    </section>
  );
}
