import { WINDOW_ONE_DAY_MS } from '../security/rateLimit.ts';
import type { Db } from '../store/db.ts';

/**
 * 하루(86,400,000ms)가 지난 속도 제한 칸을 지운다(PLAN §5.3: `window_start < :now - 86400000`).
 * 지운 행 수를 돌려준다.
 */
export function pruneRateBuckets(db: Db, now: number = Date.now()): number {
  const cutoff = now - WINDOW_ONE_DAY_MS;
  const result = db.prepare('DELETE FROM rate_buckets WHERE window_start < ?').run(cutoff);
  return result.changes;
}

export const cleanExpiredRateBuckets = pruneRateBuckets;
export const deleteExpiredRateBuckets = pruneRateBuckets;
