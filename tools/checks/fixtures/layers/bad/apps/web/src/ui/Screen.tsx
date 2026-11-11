import { openIdb } from '../adapters/local/idb.ts';

export async function loadBadScreen() {
  const mod = await import('../adapters/realtime/socket.ts');
  return { openIdb, mod };
}
