import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { LiveGameClient } from './live-game.js';

export function useLiveGame(gameId: string) {
  const client = useMemo(() => new LiveGameClient(gameId), [gameId]);
  const state = useSyncExternalStore(
    client.subscribe,
    client.getState,
    client.getState,
  );
  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);
  return { client, state };
}
